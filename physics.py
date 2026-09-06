#!/usr/bin/env python3
"""MuJoCo flesh for the connectome.

The brain only fires motor neurons. This module is the body: NeuroMechFly
position actuators on 42 leg DoFs, contact, adhesion, gravity. Thorax pose
is whatever physics does — no slip kinematics, no scripted gait.
"""

from __future__ import annotations

import math
import threading
import time
from dataclasses import dataclass, field

import numpy as np

from flygym.anatomy import LEGS as NMF_LEGS
from flygym.compose import ActuatorType, FlatGroundWorld
from flygym.simulation import Simulation
from flygym.utils.math import Rotation3D
from flygym.utils.mjcf import GEOM_TYPES
from flygym_demo.complex_terrain.common import make_locomotion_fly
import mujoco as mj

# Three.js dish: x right, y up, z forward. MuJoCo NeuroMechFly: x forward, y left, z up.
# three (x, y, z) <-> mujoco (z, -x, y)
ARENA_R = 17.4  # legacy dish; walls omitted in open world
OPEN_WORLD = True
WORLD_SOFT_LIMIT = 2400.0  # sanity only — not a playable rim
FLY_CEILING = 5.8
SPAWN_Z = 0.55
VISUAL_THORAX_Y = 1.18  # fly.js body.position.y inside the outer group
PERCH = dict(three_x=4.8, three_z=-7.4, r_pole=0.20, r_cap=0.42, h=2.18)

OUR_LEGS = ["L1", "L2", "L3", "R1", "R2", "R3"]  # maps 1:1 onto NMF lf,lm,lh,rf,rm,rh
NMF_TO_OUR = dict(zip(NMF_LEGS, OUR_LEGS))
OUR_TO_NMF = dict(zip(OUR_LEGS, NMF_LEGS))

# Antagonist → DoF. Same pairing as the connectome muscle pools / fly.js.
# (nmf child-link, axis) → (flex/positive MN, ext/negative MN, range rad, extra)
# MANC muscle → NeuroMechFly DoF (Azevedo et al.; Soler et al.).
# Promotor/remotor swing the coxa (pitch). Adductor vs remotor/abductor
# sets stance width (yaw). Rotators roll the coxa. TTMn is trExt.
DOF_MAP = [
    # Quieter spans post-densify: MN-only, no cheats, less seizure thrash.
    ("coxa", "pitch", "coxaProm", "coxaRem", 0.62, 0.0),
    ("coxa", "yaw", "coxaAdd", "coxaRem", 0.48, 0.0),
    ("coxa", "roll", "coxaRotA", "coxaRotP", 0.45, 0.0),
    ("trochanterfemur", "pitch", "trExt", "trFlex", 0.78, 0.0),
    ("trochanterfemur", "roll", "feRed", None, 0.28, 0.0),
    ("tibia", "pitch", "tiExt", "tiFlex", 0.62, 0.0),
    ("tarsus1", "pitch", "taLev", "taDep", 0.40, 0.0),
]

# Cartoon rest (fly.js REST) so visual deltas stay on the Three.js skeleton.
CARTOON = {
    "coxaYaw": 0.28,
    "coxaRoll": 0.06,
    "coxaPitch": 0.08,
    "femurX": 0.38,
    "femurZ": 0.42,
    "tibiaX": -0.62,
    "tarsusX": 0.22,
}
CARTOON_GAIN = 0.48

AXIS_TO_CARTOON = {
    ("coxa", "yaw"): "coxaYaw",
    ("coxa", "pitch"): "coxaPitch",
    ("coxa", "roll"): "coxaRoll",
    ("trochanterfemur", "pitch"): "femurX",
    ("trochanterfemur", "roll"): "femurZ",
    ("tibia", "pitch"): "tibiaX",
    ("tarsus1", "pitch"): "tarsusX",
}


def antagonist(pos: float, neg: float) -> float:
    p = float(pos or 0.0)
    n = float(neg or 0.0)
    mag = p + n
    # Quiet pools stay limp. Milder flex/ext — densified MN map must not thrash.
    if mag < 0.01:
        return 0.0
    raw = (p - n) / (mag + 0.08)
    return float(math.tanh(raw * 1.25))


def three_to_mj(x: float, z: float, y: float = SPAWN_Z) -> tuple[float, float, float]:
    return (float(z), -float(x), float(y))


def mj_to_three(x: float, y: float, z: float) -> tuple[float, float, float]:
    return (-float(y), float(z), float(x))


_C = np.array([[0.0, -1.0, 0.0], [0.0, 0.0, 1.0], [1.0, 0.0, 0.0]])


def _quat_to_mat(wxyz) -> np.ndarray:
    mat = np.zeros(9, dtype=float)
    mj.mju_quat2Mat(mat, np.asarray(wxyz, dtype=float))
    return mat.reshape(3, 3)


def _mat_to_quat(mat: np.ndarray) -> list[float]:
    out = np.zeros(4, dtype=float)
    mj.mju_mat2Quat(out, np.asarray(mat, dtype=float).reshape(9))
    return [float(x) for x in out]


def three_quat(wxyz) -> list[float]:
    return _mat_to_quat(_C @ _quat_to_mat(wxyz) @ _C.T)


def yaw_to_quat(yaw: float) -> tuple[float, float, float, float]:
    """Heading around vertical. Three.js heading 0 looks +z = MuJoCo +x."""
    h = 0.5 * float(yaw)
    return (math.cos(h), 0.0, 0.0, math.sin(h))


def quat_yaw_pitch_roll(w: float, x: float, y: float, z: float) -> tuple[float, float, float]:
    """MuJoCo wxyz, z-up → yaw (z), pitch (y), roll (x)."""
    sinp = 2.0 * (w * y - z * x)
    sinp = max(-1.0, min(1.0, sinp))
    pitch = math.asin(sinp)
    yaw = math.atan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z))
    roll = math.atan2(2.0 * (w * x + y * z), 1.0 - 2.0 * (x * x + y * y))
    return yaw, pitch, roll


def _add_dish(world: FlatGroundWorld) -> list:
    """Spawn-perch only. Open world: no ring wall — fly may roam the flat ground."""
    extras = []
    mx, my, _ = three_to_mj(PERCH["three_x"], PERCH["three_z"], 0.0)
    pole = world.mjcf_root.worldbody.add_geom(
        type=GEOM_TYPES["cylinder"],
        name="perch_pole",
        size=(PERCH["r_pole"], PERCH["h"] * 0.5, 0),
        pos=(mx, my, PERCH["h"] * 0.5),
        rgba=(0.42, 0.28, 0.14, 1),
        contype=0,
        conaffinity=0,
    )
    cap = world.mjcf_root.worldbody.add_geom(
        type=GEOM_TYPES["cylinder"],
        name="perch_cap",
        size=(PERCH["r_cap"], 0.05, 0),
        pos=(mx, my, PERCH["h"]),
        rgba=(0.28, 0.18, 0.08, 1),
        contype=0,
        conaffinity=0,
    )
    extras.extend([pole, cap])
    # Intentionally no ARENA_R ring walls when OPEN_WORLD — MuJoCo ground is unbounded flat.
    if not OPEN_WORLD:
        n = 20
        half = math.pi * ARENA_R / n
        for i in range(n):
            a = 2.0 * math.pi * i / n
            hx, hy = ARENA_R * math.cos(a), ARENA_R * math.sin(a)
            q = yaw_to_quat(a + math.pi / 2)
            extras.append(
                world.mjcf_root.worldbody.add_geom(
                    type=GEOM_TYPES["box"],
                    name=f"wall{i}",
                    size=(0.35, half, 2.2),
                    pos=(hx, hy, 2.2),
                    quat=q,
                    rgba=(0.22, 0.25, 0.3, 0.4),
                    contype=0,
                    conaffinity=0,
                )
            )
    return extras


def _pair_extras(world: FlatGroundWorld, fly, extras: list) -> None:
    from flygym.anatomy import ContactBodiesPreset
    from flygym.compose.physics import ContactParams

    segs = ContactBodiesPreset.LEGS_THORAX_ABDOMEN_HEAD.to_body_segments_list()
    params = ContactParams()
    for body_segment in segs:
        geoms = fly.bodyseg_to_mjcfgeom.get(body_segment) or []
        for body_geom in geoms:
            for extra in extras:
                world.mjcf_root.add_pair(
                    geomname1=body_geom.name,
                    geomname2=extra.name,
                    name=f"{body_geom.name}-{extra.name}-x",
                    friction=params.get_friction_tuple(),
                    solref=params.get_solref_tuple(),
                    solimp=params.get_solimp_tuple(),
                    margin=params.margin,
                )


@dataclass
class Body:
    fly_id: str
    fly: object
    sim: Simulation
    rest: np.ndarray
    dof_meta: list  # (our_leg, link, axis, cartoon_key, side)
    free_qposadr: int
    free_dofadr: int
    mass: float
    thorax_bodyid: int
    seg_ids: list = field(default_factory=list)
    stand_z: float = 0.6
    last_step: float = field(default_factory=time.time)
    born: float = field(default_factory=time.time)


# Soft dish limit (legacy). Open world uses WORLD_SOFT_LIMIT sanity only.
ARENA_SOFT = ARENA_R - 1.8
ARENA_EPS = 0.08
MAX_BODIES = 8
BODY_TTL = 25.0  # despawn if not stepped this long (ghost tabs)


@dataclass
class Plant:
    """One NeuroMechFly simulation per living fly."""

    timestep: float = 2e-4
    lock: threading.Lock = field(default_factory=threading.Lock)
    bodies: dict[str, Body] = field(default_factory=dict)
    max_bodies: int = MAX_BODIES
    body_ttl: float = BODY_TTL

    def spawn(self, fly_id: str, x: float, z: float, yaw: float = 0.0) -> dict:
        with self.lock:
            return self._spawn_locked(fly_id, x, z, yaw)

    def _spawn_locked(self, fly_id: str, x: float, z: float, yaw: float = 0.0) -> dict:
        if fly_id in self.bodies:
            body = self.bodies[fly_id]
            body.last_step = time.time()
            self._teleport(body, x, z, yaw)
            return self._snapshot(body)
        # Cap active bodies — ghost browser sessions used to pile up forever.
        self._evict_stale_locked(now=time.time())
        while len(self.bodies) >= self.max_bodies:
            oldest_id = min(self.bodies.items(), key=lambda kv: kv[1].born)[0]
            self.bodies.pop(oldest_id, None)
        fly = make_locomotion_fly(name=fly_id, colorize=False)
        world = FlatGroundWorld(name=f"dish_{fly_id}", half_size=40)
        extras = _add_dish(world)
        mx, my, mz = three_to_mj(x, z, SPAWN_Z)
        world.add_fly(
            fly,
            spawn_position=np.array([mx, my, mz], dtype=float),
            spawn_rotation=Rotation3D("quat", yaw_to_quat(yaw)),
        )
        _pair_extras(world, fly, extras)
        sim = Simulation(world, timestep=self.timestep)
        rest = np.array(
            [
                fly.jointdof_to_neutralaction_by_type[ActuatorType.POSITION][d]
                for d in fly.get_actuated_jointdofs_order(ActuatorType.POSITION)
            ],
            dtype=float,
        )
        sim.set_actuator_inputs(fly_id, ActuatorType.POSITION, rest)
        sim.set_leg_adhesion_states(fly_id, np.ones(6))
        sim.warmup(0.08)

        dofs = fly.get_actuated_jointdofs_order(ActuatorType.POSITION)
        meta = []
        for d in dofs:
            our = NMF_TO_OUR.get(d.child.pos, d.child.pos)
            key = AXIS_TO_CARTOON[(d.child.link, d.axis.value)]
            side = -1.0 if our.startswith("L") else 1.0
            meta.append((our, d.child.link, d.axis.value, key, side))

        jid = mj.mj_name2id(sim.mj_model, mj.mjtObj.mjOBJ_JOINT, fly_id)
        if jid < 0:
            for i in range(sim.mj_model.njnt):
                if int(sim.mj_model.jnt_type[i]) == int(mj.mjtJoint.mjJNT_FREE):
                    jid = i
                    break
        qadr = int(sim.mj_model.jnt_qposadr[jid])
        dadr = int(sim.mj_model.jnt_dofadr[jid])
        segs = fly.get_bodysegs_order()
        thorax_i = next(i for i, s in enumerate(segs) if s.is_thorax())
        thorax_id = int(sim._internal_bodyids_by_fly[fly_id][thorax_i])
        mass = float(sim.mj_model.body_mass[sim._internal_bodyids_by_fly[fly_id]].sum())
        stand_z = float(sim.mj_data.xpos[thorax_id][2])
        body = Body(
            fly_id=fly_id,
            fly=fly,
            sim=sim,
            rest=rest,
            dof_meta=meta,
            free_qposadr=qadr,
            free_dofadr=dadr,
            mass=mass,
            thorax_bodyid=thorax_id,
            seg_ids=[int(i) for i in sim._internal_bodyids_by_fly[fly_id]],
            stand_z=max(0.25, stand_z),
        )
        self.bodies[fly_id] = body
        self._teleport(body, x, z, yaw)
        body.stand_z = max(0.25, float(sim.mj_data.xpos[thorax_id][2]))
        return self._snapshot(body)

    def despawn(self, fly_id: str) -> None:
        with self.lock:
            self.bodies.pop(fly_id, None)

    def clear(self) -> dict:
        """Drop every body — call from client on load so ghosts never accumulate."""
        with self.lock:
            n = len(self.bodies)
            self.bodies.clear()
        return {"ok": True, "cleared": n}

    def _evict_stale_locked(self, now: float | None = None) -> list[str]:
        now = time.time() if now is None else now
        ttl = float(self.body_ttl)
        dead = [fid for fid, b in self.bodies.items() if (now - b.last_step) > ttl]
        for fid in dead:
            self.bodies.pop(fid, None)
        return dead

    def reset(self, fly_id: str, x: float, z: float, yaw: float = 0.0) -> dict:
        with self.lock:
            body = self.bodies.get(fly_id)
            if body is None:
                return self._spawn_locked(fly_id, x, z, yaw)
            body.sim.reset()
            body.sim.set_actuator_inputs(fly_id, ActuatorType.POSITION, body.rest)
            body.sim.set_leg_adhesion_states(fly_id, np.ones(6))
            self._teleport(body, x, z, yaw)
            body.sim.warmup(0.05)
            return self._snapshot(body)

    def step(self, dt: float, flies: dict) -> dict:
        """flies: {id: {muscle, dlm, dvm, admn, fly}} — MN rates only; no walk/turn cheats.

        Each client's step is a heartbeat: ids present get last_step refreshed;
        ids not seen for BODY_TTL are despawned (dead tabs release plant slots).
        """
        out = {}
        now = time.time()
        with self.lock:
            self._evict_stale_locked(now=now)
            seen = set(flies.keys()) if flies else set()
            for fly_id, cmd in (flies or {}).items():
                cmd = cmd or {}
                body = self.bodies.get(fly_id)
                if body is None:
                    self._spawn_locked(
                        fly_id,
                        float(cmd.get("x") or 0),
                        float(cmd.get("z") or 0),
                        float(cmd.get("yaw") or 0),
                    )
                    body = self.bodies.get(fly_id)
                if body is None:
                    continue
                body.last_step = now
                out[fly_id] = self._step_one(body, float(dt), cmd)
            # Also refresh last_step for ids that were only listed (heartbeat)
            # — already done above. Drop anything else older than TTL again.
            self._evict_stale_locked(now=now)
            _ = seen  # documented: client flock = live set
        return out

    def health(self) -> dict:
        with self.lock:
            self._evict_stale_locked()
            flies = {k: self._snapshot(v) for k, v in self.bodies.items()}
        return {
            "ok": True,
            "open_world": OPEN_WORLD,
            "world_soft_limit": WORLD_SOFT_LIMIT,
            "engine": "mujoco+neuromechfly",
            "timestep": self.timestep,
            "n": len(flies),
            "max": self.max_bodies,
            "ttl": self.body_ttl,
            "flies": {k: {"ncon": v.get("ncon"), "z": v.get("thoraxZ")} for k, v in flies.items()},
        }

    def _teleport(self, body: Body, x: float, z: float, yaw: float, *, z_up: float | None = None) -> None:
        adr = body.free_qposadr
        d = body.sim.mj_data
        if z_up is None:
            z_up = body.stand_z
        mx, my, mz = three_to_mj(x, z, z_up)
        q = yaw_to_quat(yaw)
        d.qpos[adr : adr + 3] = (mx, my, mz)
        d.qpos[adr + 3 : adr + 7] = q
        nv0 = body.free_dofadr
        d.qvel[nv0 : nv0 + 6] = 0
        mj.mj_forward(body.sim.mj_model, d)
        # Slide the free joint so the thorax, not the attachment, sits on (x, z).
        th = d.xpos[body.thorax_bodyid]
        want_x, want_y, _ = three_to_mj(x, z, th[2])
        d.qpos[adr] += want_x - th[0]
        d.qpos[adr + 1] += want_y - th[1]
        mj.mj_forward(body.sim.mj_model, d)

    def _targets(self, body: Body, muscle: dict) -> np.ndarray:
        tgt = body.rest.copy()
        for i, (leg, link, axis, _key, _side) in enumerate(body.dof_meta):
            pos_name, neg_name, span, _extra = next(
                (m[2], m[3], m[4], m[5]) for m in DOF_MAP if m[0] == link and m[1] == axis
            )
            m = (muscle or {}).get(leg) or {}
            pos = float(m.get(pos_name, 0.0) or 0.0)
            neg = float(m.get(neg_name, 0.0) or 0.0) if neg_name else 0.0
            if link == "trochanterfemur" and axis == "pitch":
                pos = pos + 0.6 * float(m.get("feRed", 0.0) or 0.0)
            tgt[i] = body.rest[i] + span * antagonist(pos, neg)
        return tgt

    def _step_one(self, body: Body, dt: float, cmd: dict) -> dict:
        """Drive leg position actuators + adhesion from MNs.

        Walking/turning/jumping must emerge from leg DoFs and contact — no
        free-joint walk/turn forces. Flight lift/thrust is OFF unless
        `allow_flight` is set (browser `?flight=1`); then wing MN activity
        (`fly` / dlm / dvm / admn) may apply free-joint thrust/hover.
        """
        sim = body.sim
        n_steps = int(max(1, min(240, round(dt / self.timestep))))
        tgt = self._targets(body, cmd.get("muscle") or {})
        sim.set_actuator_inputs(body.fly_id, ActuatorType.POSITION, tgt)

        muscle = cmd.get("muscle") or {}
        # Wing power from explicit fly fraction or raw wing MN rates.
        # allow_flight defaults False — walking-focused; UI passes True only with ?flight=1.
        allow_flight = bool(cmd.get("allow_flight"))
        fly_a = 0.0
        if allow_flight:
            fly_a = max(0.0, min(1.0, float(cmd.get("fly") or 0.0)))
            if fly_a < 0.01:
                dlm = float(cmd.get("dlm") or 0.0)
                dvm = float(cmd.get("dvm") or 0.0)
                admn = float(cmd.get("admn") or 0.0)
                fly_a = max(0.0, min(1.0, dlm * 1.6 + dvm * 1.45 + admn * 1.15))
            # Flight threshold not hair-trigger from wing-MN noise (raised post-densify).
            # Still hard-gated on MN drive; no walk/turn free-joint cheats.
            if fly_a < 0.48:
                fly_a = 0.0
        adh = np.zeros(6, dtype=float) if fly_a else np.ones(6, dtype=float)
        if not fly_a:
            for i, nmf in enumerate(NMF_LEGS):
                our = NMF_TO_OUR[nmf]
                m = muscle.get(our) or {}
                # Clear swing vs stance before peeling adhesion.
                lifting = float(m.get("trFlex") or 0) > float(m.get("trExt") or 0) + 0.28
                adh[i] = 0.35 if lifting else 1.0
        sim.set_leg_adhesion_states(body.fly_id, adh)

        model, data = sim.mj_model, sim.mj_data
        weight = body.mass * 9810.0
        # Modest wing-only free-joint force; legs alone move the body on the ground.
        thrust = body.mass * 12000.0 * fly_a
        hover = body.stand_z + 0.35 + fly_a * 2.6
        for _ in range(n_steps):
            data.qfrc_applied[:] = 0
            if fly_a:
                yaw, _pitch, _roll = quat_yaw_pitch_roll(
                    *data.qpos[body.free_qposadr + 3 : body.free_qposadr + 7]
                )
                data.qfrc_applied[body.free_dofadr + 0] = thrust * math.cos(yaw)
                data.qfrc_applied[body.free_dofadr + 1] = thrust * math.sin(yaw)
                mz = float(data.xpos[body.thorax_bodyid][2])
                vz = float(data.qvel[body.free_dofadr + 2])
                data.qfrc_applied[body.free_dofadr + 2] = (
                    weight + body.mass * (11000.0 * (hover - mz) - 2600.0 * vz)
                )
            sim.step()

        thz = float(data.xpos[body.thorax_bodyid][2])
        yaw, pitch, roll = quat_yaw_pitch_roll(
            *data.qpos[body.free_qposadr + 3 : body.free_qposadr + 7]
        )
        ncon = int(data.ncon)
        flipped = abs(pitch) > 0.70 or abs(roll) > 0.70
        lost = thz < 0.15 or thz > FLY_CEILING + 2.5 or not math.isfinite(thz)
        # Grounded walk should keep contacts; settle floaters / flips / hover-without-wings.
        airborne_wrong = (not fly_a) and ncon == 0 and thz > body.stand_z + 0.22
        floating = (not fly_a) and ncon == 0 and abs(thz - body.stand_z) > 0.12
        if flipped or lost or airborne_wrong or floating:
            snap = self._snapshot(body)
            self._teleport(
                body,
                snap["x"],
                snap["z"],
                0.0 if flipped else yaw,
                z_up=body.stand_z,
            )
            data.qvel[body.free_dofadr : body.free_dofadr + 6] = 0
            # Re-engage adhesion after settle so feet stick again.
            sim.set_leg_adhesion_states(body.fly_id, np.ones(6))
            mj.mj_forward(model, data)
        self._contain(body)
        return self._snapshot(body)

    def _contain(self, body: Body) -> None:
        """Open world: no XY cage. Sanity soft-limit far out; still clamp Z ceiling/floor."""
        d = body.sim.mj_data
        th = d.xpos[body.thorax_bodyid]
        mx, my, mz = float(th[0]), float(th[1]), float(th[2])
        adr = body.free_qposadr
        dadr = body.free_dofadr
        dirty = False
        limit = WORLD_SOFT_LIMIT if OPEN_WORLD else ARENA_SOFT
        r = math.hypot(mx, my)
        if r > limit and r > 1e-6:
            nx, ny = mx / r, my / r
            target = max(0.0, limit - ARENA_EPS)
            d.qpos[adr] += nx * target - mx
            d.qpos[adr + 1] += ny * target - my
            vx, vy = float(d.qvel[dadr]), float(d.qvel[dadr + 1])
            outward = vx * nx + vy * ny
            if outward > 0:
                d.qvel[dadr] = vx - 2.0 * outward * nx
                d.qvel[dadr + 1] = vy - 2.0 * outward * ny
            dirty = True
        if mz > FLY_CEILING:
            d.qpos[adr + 2] += FLY_CEILING - mz
            d.qvel[dadr + 2] = min(0.0, float(d.qvel[dadr + 2]))
            dirty = True
        elif mz < 0.15:
            d.qpos[adr + 2] += body.stand_z - mz
            d.qvel[dadr + 2] = 0
            dirty = True
        if dirty:
            mj.mj_forward(body.sim.mj_model, d)

    def _snapshot(self, body: Body) -> dict:
        sim = body.sim
        xpos = sim.mj_data.xpos[body.thorax_bodyid]
        xquat = sim.mj_data.xquat[body.thorax_bodyid]
        three_x, three_y, three_z = mj_to_three(float(xpos[0]), float(xpos[1]), float(xpos[2]))
        yaw, pitch, roll = quat_yaw_pitch_roll(xquat[0], xquat[1], xquat[2], xquat[3])
        q = sim.get_joint_angles(body.fly_id)
        act = []
        actuated = body.fly.get_actuated_jointdofs_order(ActuatorType.POSITION)
        all_dofs = body.fly.get_jointdofs_order()
        idx = {d: i for i, d in enumerate(all_dofs)}
        for d in actuated:
            act.append(float(q[idx[d]]))
        flex = {leg: 0.0 for leg in OUR_LEGS}
        for i, (leg, link, axis, key, side) in enumerate(body.dof_meta):
            flex[leg] += abs(act[i] - float(body.rest[i]))
        found, forces, *_ = sim.get_ground_contact_info(body.fly_id)
        contact = {}
        force = {}
        for i, nmf in enumerate(NMF_LEGS):
            our = NMF_TO_OUR[nmf]
            contact[our] = float(found[i]) > 0.5
            force[our] = float(np.linalg.norm(forces[i]))
        v = sim.mj_data.qvel[body.free_dofadr : body.free_dofadr + 3]
        fallen = abs(pitch) > 1.05 or abs(roll) > 1.05 or float(xpos[2]) < 0.15
        th_p = np.array(xpos, dtype=float)
        th_R = _quat_to_mat(xquat)
        bones = {}
        prefix = body.fly_id
        for seg in body.fly.get_bodysegs_order():
            bid = mj.mj_name2id(sim.mj_model, mj.mjtObj.mjOBJ_BODY, f"{prefix}/{seg.name}")
            if bid < 0:
                continue
            p = np.array(sim.mj_data.xpos[bid], dtype=float)
            R = _quat_to_mat(sim.mj_data.xquat[bid])
            p_rel = th_R.T @ (p - th_p)
            R_rel = th_R.T @ R
            bones[seg.name] = {
                "p": list(mj_to_three(float(p_rel[0]), float(p_rel[1]), float(p_rel[2]))),
                "q": _mat_to_quat(_C @ R_rel @ _C.T),
            }
        return {
            "x": three_x,
            "y": three_y,
            "z": three_z,
            "yaw": yaw,
            "pitch": pitch,
            "roll": roll,
            "quat": three_quat(xquat),
            "thoraxZ": float(xpos[2]),
            "bones": bones,
            "flex": flex,
            "contact": contact,
            "force": force,
            "ncon": int(sim.mj_data.ncon),
            "speed": float(math.hypot(v[0], v[1])),
            "fallen": bool(fallen),
            "mass": body.mass,
        }


def _self_test() -> int:
    print("building NeuroMechFly…", flush=True)
    t0 = time.time()
    plant = Plant()
    pose = plant.spawn("test", 0.0, 0.0, 0.0)
    print(
        f"spawn {time.time()-t0:.1f}s  thoraxZ={pose['thoraxZ']:.3f} ncon={pose['ncon']} "
        f"fallen={pose['fallen']} mass={pose['mass']:.4g} xyz=({pose['x']:.2f},{pose['y']:.2f},{pose['z']:.2f})",
        flush=True,
    )
    silent = {leg: {k: 0.0 for k in (
        "coxaProm", "coxaRem", "coxaRotA", "coxaRotP", "coxaAdd",
        "trFlex", "trExt", "feRed", "tiFlex", "tiExt", "taDep", "taLev",
    )} for leg in OUR_LEGS}
    z0 = pose["thoraxZ"]
    for i in range(8):
        pose = plant.step(0.04, {"test": {"muscle": silent, "dlm": 0, "dvm": 0, "admn": 0}})["test"]
        print(
            f"  hold {i} z={pose['thoraxZ']:.3f} ncon={pose['ncon']} fallen={pose['fallen']} speed={pose['speed']:.3f}",
            flush=True,
        )
    kick = {leg: dict(silent[leg]) for leg in OUR_LEGS}
    for leg in ("L1", "R2", "L3"):
        kick[leg]["trExt"] = 0.9
        kick[leg]["tiExt"] = 0.7
    for leg in ("R1", "L2", "R3"):
        kick[leg]["trFlex"] = 0.8
        kick[leg]["tiFlex"] = 0.6
    for i in range(6):
        pose = plant.step(0.04, {"test": {"muscle": kick, "dlm": 0, "dvm": 0}})["test"]
        print(
            f"  step {i} z={pose['thoraxZ']:.3f} ncon={pose['ncon']} speed={pose['speed']:.3f} "
            f"xz=({pose['x']:.2f},{pose['z']:.2f}) yaw={pose['yaw']:.2f}",
            flush=True,
        )
    ok = pose["ncon"] > 0 and pose["thoraxZ"] < z0 + 8 and not (pose["thoraxZ"] > 20)
    print("PASS" if ok else "FAIL", flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(_self_test())
