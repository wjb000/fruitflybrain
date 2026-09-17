/**
 * In-browser NeuroMechFly plant. No Mac, no paid host.
 *
 * 1. MuJoCo WASM (@mujoco/mujoco from jsDelivr) + NMF-compatible MJCF
 *    + MN stance-slip on the freejoint (WASM contacts alone stick in place)
 * 2. If WASM fails: contact/adhesion/gravity JS plant (same MN map + limits)
 *
 * Snapshot shape matches physics.py so applyPhysicsPose / applyMujoco work.
 */
import {
  buildNmfMjcf, mnTarget, MUJOCO_CDN, TIMESTEP, qmul, qrot, qinv, qaxis, qnormalize,
} from "./nmfMjcf.js?v=realfly2";
import {
  LEG_NAMES, GROUND_Y, anatomicalLegAxes, slipWeight, IDLE_WALK_GATE,
} from "./poseMap.js?v=realfly2";

const BODY_TTL = 25;
const MAX_BODIES = 8;

export const browserPlant = {
  ok: false,
  kind: "",
  err: "",
  engine: "",
  spec: null,
  impl: null,
};

function yawFromQuat(q) {
  const f = qrot(q, [0, 0, 1]);
  return Math.atan2(f[0], f[2]);
}
function pitchFromQuat(q) {
  const f = qrot(q, [0, 0, 1]);
  return Math.asin(Math.max(-1, Math.min(1, f[1])));
}
function rollFromQuat(q) {
  const r = qrot(q, [1, 0, 0]);
  return Math.atan2(r[1], Math.hypot(r[0], r[2]));
}

function matFromQuat(q) {
  const [w, x, y, z] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}
function mulMatT(R, v) {
  return [
    R[0] * v[0] + R[3] * v[1] + R[6] * v[2],
    R[1] * v[0] + R[4] * v[1] + R[7] * v[2],
    R[2] * v[0] + R[5] * v[1] + R[8] * v[2],
  ];
}
function relPose(thP, thQ, p, q) {
  const R = matFromQuat(thQ);
  const d = [p[0] - thP[0], p[1] - thP[1], p[2] - thP[2]];
  return { p: mulMatT(R, d), q: qnormalize(qmul(qinv(thQ), q)) };
}

function silentMuscle() {
  const m = {};
  for (const leg of LEG_NAMES) {
    m[leg] = {
      coxaProm: 0, coxaRem: 0, coxaRotA: 0, coxaRotP: 0, coxaAdd: 0,
      trFlex: 0, trExt: 0, feRed: 0, tiFlex: 0, tiExt: 0, taDep: 0, taLev: 0,
    };
  }
  return m;
}

function applyCtrlTargets(spec, cmd) {
  const t = cmd.t || 0;
  const out = [];
  for (const a of spec.actuators) {
    out.push(mnTarget(a, { ...cmd, t }));
  }
  return out;
}

/* ---------- JS contact plant (WASM fallback) ---------- */

function descendants(nmf, rootName) {
  const kids = {};
  for (const s of nmf.segments) {
    const p = s.parent || "__root";
    (kids[p] = kids[p] || []).push(s.name);
  }
  const out = [];
  const stack = [rootName];
  while (stack.length) {
    const n = stack.pop();
    out.push(n);
    for (const k of (kids[n] || [])) stack.push(k);
  }
  return out;
}

function applyHingeTree(posed, names, pivotName, axis, ang) {
  if (Math.abs(ang) < 1e-5) return;
  const pivot = posed[pivotName];
  if (!pivot) return;
  const dq = qaxis(axis, ang);
  for (const name of names) {
    const b = posed[name];
    if (!b) continue;
    const d = [b.p[0] - pivot.p[0], b.p[1] - pivot.p[1], b.p[2] - pivot.p[2]];
    const rd = qrot(dq, d);
    b.p = [pivot.p[0] + rd[0], pivot.p[1] + rd[1], pivot.p[2] + rd[2]];
    b.q = qnormalize(qmul(dq, b.q));
  }
}

function fkPosed(nmf, hingeAng) {
  const posed = {};
  for (const s of nmf.segments) {
    posed[s.name] = {
      p: (s.restPos || [0, 0, 0]).slice(),
      q: (s.restQuat || [1, 0, 0, 0]).slice(),
    };
  }
  const codes = nmf.legs || {};
  for (const our of LEG_NAMES) {
    const code = codes[our];
    const chain = [
      `${code}_coxa`, `${code}_trochanterfemur`, `${code}_tibia`,
      `${code}_tarsus1`, `${code}_tarsus2`, `${code}_tarsus3`,
      `${code}_tarsus4`, `${code}_tarsus5`,
    ].filter((n) => posed[n]);
    const coxa = nmf.segments.find((s) => s.name === `${code}_coxa`);
    const femur = nmf.segments.find((s) => s.name === `${code}_trochanterfemur`);
    const tibia = nmf.segments.find((s) => s.name === `${code}_tibia`);
    const tarsus = nmf.segments.find((s) => s.name === `${code}_tarsus1`);
    if (!coxa || !femur || !tibia || !tarsus) continue;
    const axes = anatomicalLegAxes(our.startsWith("L") ? -1 : 1, {
      coxa: coxa.restPos, femur: femur.restPos, tibia: tibia.restPos, tarsus: tarsus.restPos,
    });
    const joints = [
      { key: "coxa-yaw", pivot: 0 },
      { key: "coxa-pitch", pivot: 0 },
      { key: "coxa-roll", pivot: 0 },
      { key: "trochanterfemur-pitch", pivot: 1 },
      { key: "trochanterfemur-roll", pivot: 1 },
      { key: "tibia-pitch", pivot: 2 },
      { key: "tarsus1-pitch", pivot: 3 },
    ];
    for (const j of joints) {
      const ang = hingeAng[`${code}_${j.key}`] || 0;
      if (Math.abs(ang) < 1e-5) continue;
      const pivotName = chain[j.pivot];
      const pivot = posed[pivotName];
      if (!pivot) continue;
      const dq = qaxis(axes[j.key], ang);
      for (let i = j.pivot; i < chain.length; i++) {
        const b = posed[chain[i]];
        const d = [b.p[0] - pivot.p[0], b.p[1] - pivot.p[1], b.p[2] - pivot.p[2]];
        const rd = qrot(dq, d);
        b.p = [pivot.p[0] + rd[0], pivot.p[1] + rd[1], pivot.p[2] + rd[2]];
        b.q = qnormalize(qmul(dq, b.q));
      }
    }
  }
  const headTree = descendants(nmf, "c_head");
  applyHingeTree(posed, headTree, "c_head", [0, 1, 0], hingeAng.head_yaw || 0);
  applyHingeTree(posed, headTree, "c_head", [1, 0, 0], hingeAng.head_pitch || 0);
  applyHingeTree(posed, headTree, "c_head", [0, 0, 1], hingeAng.head_roll || 0);
  const abdNames = ["c_abdomen12", "c_abdomen3", "c_abdomen4", "c_abdomen5", "c_abdomen6"];
  for (const name of abdNames) {
    applyHingeTree(posed, descendants(nmf, name), name, [1, 0, 0], hingeAng[`${name}_pitch`] || 0);
  }
  applyHingeTree(posed, descendants(nmf, "c_abdomen12"), "c_abdomen12", [0, 1, 0], hingeAng.c_abdomen12_yaw || 0);
  for (const w of ["l_wing", "r_wing"]) {
    applyHingeTree(posed, descendants(nmf, w), w, [1, 0, 0], hingeAng[`${w}_pitch`] || 0);
  }
  return posed;
}

function worldOf(th, local) {
  return [
    th.x + qrot(th.q, local)[0],
    th.y + qrot(th.q, local)[1],
    th.z + qrot(th.q, local)[2],
  ];
}

class ContactPlant {
  constructor(nmf, spec) {
    this.kind = "browser-contact";
    this.engine = "browser-contact+gravity+adhesion";
    this.nmf = nmf;
    this.spec = spec;
    this.bodies = new Map();
    this.standZ = spec.standZ;
  }

  _make(id, x, z, yaw) {
    const h = 0.5 * yaw;
    return {
      id,
      x, y: this.standZ, z,
      q: [Math.cos(h), 0, Math.sin(h), 0],
      vx: 0, vy: 0, vz: 0,
      wx: 0, wy: 0, wz: 0,
      hinges: {},
      last: performance.now ? performance.now() : Date.now(),
      born: Date.now(),
    };
  }

  spawn(id, x, z, yaw) {
    let b = this.bodies.get(id);
    if (!b) {
      this._evict();
      b = this._make(id, x, z, yaw || 0);
      this.bodies.set(id, b);
    } else {
      b.x = x; b.z = z;
      const h = 0.5 * (yaw || 0);
      b.q = [Math.cos(h), 0, Math.sin(h), 0];
      b.y = this.standZ;
      b.vx = b.vy = b.vz = 0;
    }
    b.last = Date.now();
    return this._snapshot(b, { muscle: silentMuscle() });
  }

  despawn(id) { this.bodies.delete(id); }
  clear() { const n = this.bodies.size; this.bodies.clear(); return { ok: true, cleared: n }; }
  reset(id, x, z, yaw) {
    this.bodies.delete(id);
    return this.spawn(id, x, z, yaw);
  }

  _evict() {
    const now = Date.now();
    for (const [id, b] of this.bodies) {
      if (now - b.last > BODY_TTL * 1000) this.bodies.delete(id);
    }
    while (this.bodies.size >= MAX_BODIES) {
      let oldest = null, t = Infinity;
      for (const [id, b] of this.bodies) if (b.born < t) { t = b.born; oldest = id; }
      if (oldest) this.bodies.delete(oldest); else break;
    }
  }

  step(dt, flies) {
    this._evict();
    const out = {};
    for (const [id, cmd] of Object.entries(flies || {})) {
      let b = this.bodies.get(id);
      if (!b) {
        this.spawn(id, Number(cmd.x || 0), Number(cmd.z || 0), Number(cmd.yaw || 0));
        b = this.bodies.get(id);
      }
      if (!b) continue;
      b.last = Date.now();
      out[id] = this._stepOne(b, dt, cmd || {});
    }
    return out;
  }

  _stepOne(b, dt, cmd) {
    const spec = this.spec;
    const n = Math.max(1, Math.min(48, Math.round(dt / 0.002)));
    const h = dt / n;
    const walkDrive = Number(cmd.walk != null ? cmd.walk : 0);
    const walking = walkDrive >= IDLE_WALK_GATE;
    const codes = this.nmf.legs || {};
    const th0 = { x: b.x, y: b.y, z: b.z, q: b.q };
    const posed0 = fkPosed(this.nmf, b.hinges);
    const tip0 = {};
    for (const our of LEG_NAMES) {
      const code = codes[our];
      const tip = posed0[`${code}_tarsus5`];
      if (!tip) continue;
      tip0[our] = worldOf(th0, tip.p);
    }
    for (const a of spec.actuators) {
      if (!a.joint) continue;
      const key = a.kind === "leg" && a.leg && a.key
        ? `${(this.nmf.legs || {})[a.leg]}_${a.key}`
        : a.joint;
      const tgt = mnTarget(a, { ...cmd, t: cmd.t || 0 });
      const cur = b.hinges[key] || 0;
      const blend = 1 - Math.exp(-h * n / 0.055);
      b.hinges[key] = cur + (tgt - cur) * blend;
    }
    // Reduced g keeps explicit Euler planted (WASM uses 9810 mm/s²).
    const g = -55;
    const k = 140;
    const dmp = 8;
    const mass = 1.0;
    let nLeg = 0;
    const contact = {};
    const force = {};
    let posed = fkPosed(this.nmf, b.hinges);
    const th = { x: b.x, y: b.y, z: b.z, q: b.q };
    let fy = 0, fx = 0, fz = 0;
    let slipX = 0, slipZ = 0, slipN = 0, yawL = 0, yawR = 0;
    const yaw = yawFromQuat(b.q);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    for (const our of LEG_NAMES) {
      const code = codes[our];
      const tip = posed[`${code}_tarsus5`];
      if (!tip) { contact[our] = false; force[our] = 0; continue; }
      const w = worldOf(th, tip.p);
      const m = (cmd.muscle && cmd.muscle[our]) || {};
      const swing = !!m._swing;
      // Peel almost fully in swing — sticky swing feet caused vault/twitch.
      const adh = swing ? 0.06 : 1;
      let c = false;
      let f = 0;
      if (w[1] < GROUND_Y + 0.06) {
        c = true;
        nLeg += 1;
        const pen = GROUND_Y + 0.02 - w[1];
        const ny = k * Math.max(0, pen) - dmp * b.vy;
        fy += ny * adh;
        f = Math.abs(ny);
        if (adh > 0.55) {
          fx += -b.vx * 14;
          fz += -b.vz * 14;
        }
      }
      contact[our] = c;
      force[our] = f;
      // Stance-slip: planted feet that moved from hinge change push the thorax.
      // Same MN foot vectors as kinematic fallback — no walk thruster / CPG.
      if (walking && !swing && c && tip0[our]) {
        const dx = w[0] - tip0[our][0];
        const dz = w[2] - tip0[our][2];
        const ww = slipWeight(our);
        slipX -= dx * ww;
        slipZ -= dz * ww;
        slipN += ww;
        const back = -(dx * sy + dz * cy) * ww;
        if (our.startsWith("L")) yawL += back * 0.85;
        else yawR += back * 0.85;
      }
    }
    if (walking && slipN > 0.15) {
      let sx = slipX / slipN;
      let sz = slipZ / slipN;
      const step = Math.hypot(sx, sz);
      const maxStep = 0.068;
      if (step > maxStep) {
        const kk = maxStep / step;
        sx *= kk; sz *= kk;
      }
      // Gain scales with walkDrive (phasic T2/T3+DNa) — quiet idle stays put.
      const gain = 0.92 + 0.55 * Math.min(1, walkDrive);
      sx *= gain; sz *= gain;
      const a = 1 - Math.exp(-dt / 0.09);
      b._sx = (b._sx || 0) + (sx - (b._sx || 0)) * a;
      b._sz = (b._sz || 0) + (sz - (b._sz || 0)) * a;
      const dyawT = Math.max(-0.038, Math.min(0.038, (yawR - yawL) * 0.55 * walkDrive));
      b._dyaw = (b._dyaw || 0) + (dyawT - (b._dyaw || 0)) * a;
      b.x += b._sx;
      b.z += b._sz;
      // Bleed integrated velocity so adhesion damping does not fight the slip.
      b.vx *= 0.55;
      b.vz *= 0.55;
    } else {
      b._sx = (b._sx || 0) * 0.72;
      b._sz = (b._sz || 0) * 0.72;
      b._dyaw = (b._dyaw || 0) * 0.72;
      b.vx *= 0.78;
      b.vz *= 0.78;
    }
    b.vy += (g + fy / mass) * dt;
    b.vx += (fx / mass) * dt;
    b.vz += (fz / mass) * dt;
    b.vx *= walking ? 0.88 : 0.72;
    b.vz *= walking ? 0.88 : 0.72;
    b.vy *= 0.92;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    if (b.y < 0.35) { b.y = 0.35; b.vy = Math.max(0, b.vy); }
    if (b.y > this.standZ + 2.2 && !cmd.allow_flight) {
      b.y = this.standZ;
      b.vy = 0;
    }
    if (!cmd.allow_flight && b.y > this.standZ + 0.18) {
      b.y += 0.45 * (this.standZ - b.y);
      if (b.vy > 0) b.vy *= 0.15;
    }
    // Idle settle: kill residual XY fidget from Poisson hinge noise.
    if (!walking) {
      b.vx *= 0.5;
      b.vz *= 0.5;
      if (Math.hypot(b.vx, b.vz) < 0.02) { b.vx = 0; b.vz = 0; }
    }
    const yawOut = yaw + (b._dyaw || 0);
    b.q = qaxis([0, 1, 0], yawOut);
    return this._snapshot(b, cmd, { contact, force, nLeg, posed });
  }

  _snapshot(b, cmd, extra = {}) {
    const posed = extra.posed || fkPosed(this.nmf, b.hinges);
    const thP = [b.x, b.y, b.z];
    const bones = {};
    for (const s of this.nmf.segments) {
      const ps = posed[s.name];
      if (!ps) continue;
      bones[s.name] = { p: ps.p, q: ps.q };
    }
    const contact = extra.contact || {};
    const n_leg = extra.nLeg != null ? extra.nLeg : Object.values(contact).filter(Boolean).length;
    const q = b.q;
    return {
      x: b.x, y: b.y, z: b.z,
      yaw: yawFromQuat(q),
      pitch: pitchFromQuat(q),
      roll: rollFromQuat(q),
      quat: q,
      thoraxZ: b.y,
      bones,
      contact,
      force: extra.force || {},
      ncon: n_leg,
      n_leg,
      planted: n_leg >= 2 && b.y <= this.standZ + 0.22,
      speed: Math.hypot(b.vx, b.vz) + Math.hypot(b._sx || 0, b._sz || 0),
      fallen: Math.abs(pitchFromQuat(q)) > 1.05 || b.y < 0.2,
      mass: 1,
      engine: this.engine,
    };
  }

  health() {
    return {
      ok: true,
      engine: this.engine,
      kind: this.kind,
      timestep: 0.002,
      n: this.bodies.size,
      max: MAX_BODIES,
      ttl: BODY_TTL,
      nLegDoF: this.spec.nLegDoF,
      nNeck: this.spec.nNeck,
      nAbdomen: this.spec.nAbdomen,
      nWing: this.spec.nWing,
      nAdhesion: this.spec.nAdhesion,
      gravity: "explicit-Euler reduced g (WASM uses 9810 mm/s²)",
      limits: this.spec.limits,
    };
  }
}

/* ---------- MuJoCo WASM plant ---------- */

class WasmPlant {
  constructor(mj, model, data, spec, nmf) {
    this.kind = "mujoco-wasm";
    this.engine = "mujoco-wasm+neuromechfly";
    this.mj = mj;
    this.model = model;
    this.data = data;
    this.spec = spec;
    this.nmf = nmf;
    this.bodies = new Map();
    this.standZ = spec.standZ;
    this.qposadr = 0;
    try {
      const j = model.jnt("root");
      this.qposadr = Number(j.qposadr) || 0;
      j.delete?.();
    } catch (_) {}
    this.bodyId = {};
    for (const name of spec.bodyNames) {
      try {
        const acc = model.body(name);
        this.bodyId[name] = acc.id;
        acc.delete?.();
      } catch (_) {}
    }
    this.geomTarsus = {};
    for (const t of spec.tarsi) {
      try {
        const g = model.geom(`${t.body}_g`);
        this.geomTarsus[g.id] = t.our;
        g.delete?.();
      } catch (_) {}
    }
  }

  _teleport(x, z, yaw, y) {
    const d = this.data;
    const adr = this.qposadr;
    const yy = y != null ? y : this.standZ;
    d.qpos[adr] = x;
    d.qpos[adr + 1] = yy;
    d.qpos[adr + 2] = z;
    const h = 0.5 * yaw;
    d.qpos[adr + 3] = Math.cos(h);
    d.qpos[adr + 4] = 0;
    d.qpos[adr + 5] = Math.sin(h);
    d.qpos[adr + 6] = 0;
    const nv = d.qvel;
    if (nv && nv.length) {
      for (let i = 0; i < Math.min(6, nv.length); i++) nv[i] = 0;
    }
    this.mj.mj_forward(this.model, d);
  }

  spawn(id, x, z, yaw) {
    this._evict();
    if (!this.bodies.has(id) && this.bodies.size >= MAX_BODIES) {
      const oldest = [...this.bodies.entries()].sort((a, b) => a[1].born - b[1].born)[0];
      if (oldest) this.bodies.delete(oldest[0]);
    }
    this.bodies.set(id, { id, last: Date.now(), born: Date.now() });
    this._teleport(x, z, yaw || 0, this.standZ);
    const nWarm = 40;
    for (let i = 0; i < nWarm; i++) this.mj.mj_step(this.model, this.data);
    return this._snapshot();
  }

  despawn(id) { this.bodies.delete(id); }
  clear() {
    const n = this.bodies.size;
    this.bodies.clear();
    return { ok: true, cleared: n };
  }
  reset(id, x, z, yaw) {
    this.bodies.set(id, { id, last: Date.now(), born: Date.now() });
    this._teleport(x, z, yaw || 0, this.standZ);
    return this._snapshot();
  }
  _evict() {
    const now = Date.now();
    for (const [id, b] of this.bodies) {
      if (now - b.last > BODY_TTL * 1000) this.bodies.delete(id);
    }
  }

  step(dt, flies) {
    this._evict();
    const out = {};
    const entries = Object.entries(flies || {});
    // One WASM world — drive the first live fly (Pages flock is usually 1).
    // Extra ids share the same plant; extra bodies are kinematic copies of pose.
    const first = entries[0];
    if (!first) return out;
    const [id0, cmd0] = first;
    if (!this.bodies.has(id0)) this.spawn(id0, Number(cmd0?.x || 0), Number(cmd0?.z || 0), Number(cmd0?.yaw || 0));
    const pose = this._stepOne(dt, cmd0 || {});
    this.bodies.get(id0).last = Date.now();
    out[id0] = pose;
    for (let i = 1; i < entries.length; i++) {
      const [id, cmd] = entries[i];
      if (!this.bodies.has(id)) this.bodies.set(id, { id, last: Date.now(), born: Date.now() });
      this.bodies.get(id).last = Date.now();
      out[id] = { ...pose, x: Number(cmd?.x != null ? cmd.x : pose.x), z: Number(cmd?.z != null ? cmd.z : pose.z) };
    }
    return out;
  }

  _tipWorld() {
    const xpos = this.data.xpos;
    const out = {};
    for (const t of this.spec.tarsi) {
      const id = this.bodyId[t.body];
      if (id == null) continue;
      out[t.our] = [xpos[id * 3], xpos[id * 3 + 1], xpos[id * 3 + 2]];
    }
    return out;
  }

  _applyStanceSlip(cmd, tip0, contact) {
    const walkDrive = Number(cmd.walk != null ? cmd.walk : 0);
    if (walkDrive < IDLE_WALK_GATE) {
      this._sx = (this._sx || 0) * 0.72;
      this._sz = (this._sz || 0) * 0.72;
      this._dyaw = (this._dyaw || 0) * 0.72;
      return;
    }
    const tip1 = this._tipWorld();
    const snap = this._snapshot();
    const yaw = snap.yaw;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    let slipX = 0, slipZ = 0, slipN = 0, yawL = 0, yawR = 0;
    for (const our of LEG_NAMES) {
      const m = (cmd.muscle && cmd.muscle[our]) || {};
      const swing = !!m._swing;
      if (swing || !contact[our] || !tip0[our] || !tip1[our]) continue;
      const dx = tip1[our][0] - tip0[our][0];
      const dz = tip1[our][2] - tip0[our][2];
      const ww = slipWeight(our);
      slipX -= dx * ww;
      slipZ -= dz * ww;
      slipN += ww;
      const back = -(dx * sy + dz * cy) * ww;
      if (our.startsWith("L")) yawL += back * 0.85;
      else yawR += back * 0.85;
    }
    if (slipN <= 0.15) {
      this._sx = (this._sx || 0) * 0.72;
      this._sz = (this._sz || 0) * 0.72;
      this._dyaw = (this._dyaw || 0) * 0.72;
      return;
    }
    let sx = slipX / slipN;
    let sz = slipZ / slipN;
    const step = Math.hypot(sx, sz);
    const maxStep = 0.068;
    if (step > maxStep) {
      const kk = maxStep / step;
      sx *= kk; sz *= kk;
    }
    const gain = 0.92 + 0.55 * Math.min(1, walkDrive);
    sx *= gain; sz *= gain;
    const a = 1 - Math.exp(-(Number(cmd.dt) || 0.016) / 0.09);
    this._sx = (this._sx || 0) + (sx - (this._sx || 0)) * a;
    this._sz = (this._sz || 0) + (sz - (this._sz || 0)) * a;
    const dyawT = Math.max(-0.038, Math.min(0.038, (yawR - yawL) * 0.55 * walkDrive));
    this._dyaw = (this._dyaw || 0) + (dyawT - (this._dyaw || 0)) * a;
    const adr = this.qposadr;
    const d = this.data;
    d.qpos[adr] += this._sx;
    d.qpos[adr + 2] += this._sz;
    const yawOut = yaw + (this._dyaw || 0);
    const h = 0.5 * yawOut;
    d.qpos[adr + 3] = Math.cos(h);
    d.qpos[adr + 4] = 0;
    d.qpos[adr + 5] = Math.sin(h);
    d.qpos[adr + 6] = 0;
    // Bleed freejoint XY vel so adhesion does not fight the slip.
    if (d.qvel) {
      d.qvel[0] *= 0.45;
      d.qvel[2] *= 0.45;
    }
    this.mj.mj_forward(this.model, d);
  }

  _stepOne(dt, cmd) {
    const tip0 = this._tipWorld();
    const ctrl = this.data.ctrl;
    const tgts = applyCtrlTargets(this.spec, cmd);
    for (let i = 0; i < tgts.length && i < ctrl.length; i++) ctrl[i] = tgts[i];
    const n = Math.max(1, Math.min(80, Math.round(dt / TIMESTEP)));
    for (let i = 0; i < n; i++) this.mj.mj_step(this.model, this.data);
    let snap = this._snapshot();
    // Stance-slip: same MN foot vectors as contact plant — WASM adhesion alone
    // sticks the freejoint in place while hinges twitch.
    this._applyStanceSlip({ ...cmd, dt }, tip0, snap.contact || {});
    snap = this._snapshot();
    const flyA = Number(cmd.fly || 0);
    const vaulted = !cmd.allow_flight && snap.y > this.standZ + 0.45;
    const lost = snap.y < 0.12 || snap.y > 6 || !Number.isFinite(snap.y);
    if (vaulted || lost || snap.fallen) {
      this._teleport(snap.x, snap.z, snap.fallen ? 0 : snap.yaw, this.standZ);
      return this._snapshot();
    }
    if (!cmd.allow_flight && snap.y > this.standZ + 0.12 && flyA < 0.4) {
      const adr = this.qposadr;
      this.data.qpos[adr + 1] += 0.25 * (this.standZ - snap.y);
      if (this.data.qvel && this.data.qvel[1] > 0) this.data.qvel[1] *= 0.2;
      this.mj.mj_forward(this.model, this.data);
      return this._snapshot();
    }
    // Report slip speed so HUD v matches contact-plant scale when walking.
    if ((this._sx || 0) || (this._sz || 0)) {
      snap = this._snapshot();
      snap.speed = Math.hypot(this._sx || 0, this._sz || 0)
        + (snap.speed || 0) * 0.15;
    }
    return snap;
  }

  _snapshot() {
    const d = this.data;
    const m = this.model;
    const tid = this.bodyId.c_thorax;
    const xpos = d.xpos;
    const xquat = d.xquat;
    const thP = tid != null
      ? [xpos[tid * 3], xpos[tid * 3 + 1], xpos[tid * 3 + 2]]
      : [d.qpos[this.qposadr], d.qpos[this.qposadr + 1], d.qpos[this.qposadr + 2]];
    const thQ = tid != null
      ? [xquat[tid * 4], xquat[tid * 4 + 1], xquat[tid * 4 + 2], xquat[tid * 4 + 3]]
      : [d.qpos[this.qposadr + 3], d.qpos[this.qposadr + 4], d.qpos[this.qposadr + 5], d.qpos[this.qposadr + 6]];
    const bones = {};
    for (const name of this.spec.bodyNames) {
      const id = this.bodyId[name];
      if (id == null) continue;
      const p = [xpos[id * 3], xpos[id * 3 + 1], xpos[id * 3 + 2]];
      const q = [xquat[id * 4], xquat[id * 4 + 1], xquat[id * 4 + 2], xquat[id * 4 + 3]];
      bones[name] = relPose(thP, thQ, p, q);
    }
    const contact = { L1: false, R1: false, L2: false, R2: false, L3: false, R3: false };
    const force = { L1: 0, R1: 0, L2: 0, R2: 0, L3: 0, R3: 0 };
    try {
      const cons = d.contact;
      const ncon = d.ncon | 0;
      const sz = cons && cons.size ? cons.size() : ncon;
      for (let i = 0; i < sz; i++) {
        const c = cons.get ? cons.get(i) : null;
        if (!c) continue;
        const g1 = c.geom1, g2 = c.geom2;
        const our = this.geomTarsus[g1] || this.geomTarsus[g2];
        if (our) {
          contact[our] = true;
          const dist = Number(c.dist || 0);
          force[our] = Math.max(force[our], Math.abs(dist) * 80);
        }
        c.delete?.();
      }
      cons.delete?.();
    } catch (_) {
      // touch fallback: tarsus world y
      for (const t of this.spec.tarsi) {
        const id = this.bodyId[t.body];
        if (id == null) continue;
        const y = xpos[id * 3 + 1];
        if (y < GROUND_Y + 0.08) contact[t.our] = true;
      }
    }
    const n_leg = Object.values(contact).filter(Boolean).length;
    const qvel = d.qvel;
    const speed = qvel ? Math.hypot(qvel[0] || 0, qvel[2] || 0) : 0;
    const yaw = yawFromQuat(thQ);
    const pitch = pitchFromQuat(thQ);
    const roll = rollFromQuat(thQ);
    return {
      x: thP[0], y: thP[1], z: thP[2],
      yaw, pitch, roll, quat: thQ,
      thoraxZ: thP[1],
      bones, contact, force,
      ncon: d.ncon | 0,
      n_leg,
      planted: n_leg >= 2 && thP[1] <= this.standZ + 0.22,
      speed,
      fallen: Math.abs(pitch) > 1.05 || Math.abs(roll) > 1.05 || thP[1] < 0.15,
      mass: 1,
      engine: this.engine,
    };
  }

  health() {
    return {
      ok: true,
      engine: this.engine,
      kind: this.kind,
      timestep: TIMESTEP,
      n: this.bodies.size,
      max: MAX_BODIES,
      ttl: BODY_TTL,
      nLegDoF: this.spec.nLegDoF,
      nNeck: this.spec.nNeck,
      nAbdomen: this.spec.nAbdomen,
      nWing: this.spec.nWing,
      nAdhesion: this.spec.nAdhesion,
      gravity: GRAVITY_LABEL,
      limits: this.spec.limits,
    };
  }
}

const GRAVITY_LABEL = "9810 mm/s² (NMF millimetre world, Y-up)";

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(label || "timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

async function tryWasm(spec, nmf) {
  const mod = await import(/* @vite-ignore */ `${MUJOCO_CDN}/mujoco.js`);
  const loadMujoco = mod.default || mod.loadMujoco || mod;
  const mj = await loadMujoco({
    locateFile: (p) => `${MUJOCO_CDN}/${p}`,
  });
  if (!mj || !mj.MjModel) throw new Error("mujoco wasm missing MjModel");
  const model = mj.MjModel.from_xml_string(spec.xml);
  if (!model) throw new Error("from_xml_string failed");
  const data = new mj.MjData(model);
  mj.mj_forward(model, data);
  return new WasmPlant(mj, model, data, spec, nmf);
}

/**
 * Start the in-browser plant. Prefers MuJoCo WASM; falls back to JS contact.
 */
export async function startBrowserPlant(nmf) {
  const spec = buildNmfMjcf(nmf);
  browserPlant.spec = spec;
  try {
    const impl = await withTimeout(tryWasm(spec, nmf), 10000, "mujoco wasm timeout");
    browserPlant.impl = impl;
    browserPlant.ok = true;
    browserPlant.kind = impl.kind;
    browserPlant.engine = impl.engine;
    browserPlant.err = "";
    return browserPlant;
  } catch (e) {
    const impl = new ContactPlant(nmf, spec);
    browserPlant.impl = impl;
    browserPlant.ok = true;
    browserPlant.kind = impl.kind;
    browserPlant.engine = impl.engine;
    browserPlant.err = String(e?.message || e);
    return browserPlant;
  }
}

export function stopBrowserPlant() {
  browserPlant.ok = false;
  browserPlant.impl = null;
  browserPlant.kind = "";
}

export function browserHealth() {
  if (browserPlant.impl && browserPlant.impl.health) return browserPlant.impl.health();
  return { ok: false, error: browserPlant.err || "no browser plant" };
}

export { ContactPlant, silentMuscle, fkPosed };
