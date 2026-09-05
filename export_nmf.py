#!/usr/bin/env python3
"""Export NeuroMechFly meshes + rest pose (thorax-relative, Three.js coords)."""

from __future__ import annotations

import json
import struct
import warnings
from pathlib import Path

import numpy as np
import yaml

import mujoco as mj
from flygym.anatomy import ALL_CONNECTED_SEGMENT_PAIRS
from flygym.compose.fly.neuromechfly import DEFAULT_VISUALS_CONFIG_PATH
from flygym_demo.complex_terrain.common import make_locomotion_fly

ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "web" / "data"
MAGIC = b"NMF1"
PARENT = {child: parent for parent, child in ALL_CONNECTED_SEGMENT_PAIRS}

# MuJoCo (x forward, y left, z up) → Three.js (x right, y up, z forward).
C = np.array(
    [[0.0, -1.0, 0.0], [0.0, 0.0, 1.0], [1.0, 0.0, 0.0]],
    dtype=np.float64,
)


def _quat_to_mat(wxyz) -> np.ndarray:
    mat = np.zeros(9, dtype=np.float64)
    mj.mju_quat2Mat(mat, np.asarray(wxyz, dtype=np.float64))
    return mat.reshape(3, 3)


def _mat_to_quat(mat: np.ndarray) -> list[float]:
    out = np.zeros(4, dtype=np.float64)
    mj.mju_mat2Quat(out, np.asarray(mat, dtype=np.float64).reshape(9))
    return [float(x) for x in out]


def _rotate(q_wxyz, p) -> np.ndarray:
    return _quat_to_mat(q_wxyz) @ np.asarray(p, dtype=np.float64).reshape(3)


def three_pos(p) -> list[float]:
    v = C @ np.asarray(p, dtype=np.float64).reshape(3)
    return [float(v[0]), float(v[1]), float(v[2])]


def three_quat_from_R(R_mj: np.ndarray) -> list[float]:
    return _mat_to_quat(C @ R_mj @ C.T)


def _materials() -> dict:
    with open(DEFAULT_VISUALS_CONFIG_PATH) as f:
        raw = yaml.safe_load(f)
    out = {}
    for name, spec in raw.items():
        if not isinstance(spec, dict):
            continue
        mat = spec.get("material") or {}
        tex = spec.get("texture") or {}
        rgba = mat.get("rgba") or [1, 1, 1, 1]
        rgb = tex.get("rgb1")
        color = [float(x) for x in (rgb if rgb else rgba[:3])]
        opacity = float(rgba[3]) if len(rgba) > 3 else 1.0
        apply = spec.get("apply_to")
        patterns = [apply] if isinstance(apply, str) else list(apply or [])
        out[name] = {
            "color": color,
            "opacity": opacity,
            "roughness": 0.22 if name in ("eye", "wing") else 0.55,
            "apply_to": patterns,
        }
    return out


def _match_material(seg: str, materials: dict) -> str:
    import fnmatch

    for name, spec in materials.items():
        for pat in spec["apply_to"]:
            if fnmatch.fnmatch(seg, pat):
                return name
    return "headthorax"


def export() -> None:
    fly = make_locomotion_fly(name="nmf", colorize=False)
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="Compiling a fly model")
        model, data = fly.compile()

    for dof, angle in fly.jointdof_to_neutralangle.items():
        jid = mj.mj_name2id(model, mj.mjtObj.mjOBJ_JOINT, dof.name)
        if jid < 0:
            continue
        data.qpos[int(model.jnt_qposadr[jid])] = float(angle)
    mj.mj_forward(model, data)

    thorax_bid = mj.mj_name2id(model, mj.mjtObj.mjOBJ_BODY, "c_thorax")
    th_p = np.array(data.xpos[thorax_bid], dtype=np.float64)
    th_R = _quat_to_mat(data.xquat[thorax_bid])
    stand_z = float(th_p[2])

    materials = _materials()
    order = [s.name for s in fly.get_bodysegs_order()]
    meshes = []
    segments = []

    for seg in order:
        gid = mj.mj_name2id(model, mj.mjtObj.mjOBJ_GEOM, seg)
        mid = int(model.geom_dataid[gid])
        vadr = int(model.mesh_vertadr[mid])
        vn = int(model.mesh_vertnum[mid])
        fadr = int(model.mesh_faceadr[mid])
        fn = int(model.mesh_facenum[mid])
        verts_mj = np.array(model.mesh_vert[vadr : vadr + vn], dtype=np.float64)
        faces = np.array(model.mesh_face[fadr : fadr + fn], dtype=np.int32)
        gpos = np.array(model.geom_pos[gid], dtype=np.float64)
        gquat = np.array(model.geom_quat[gid], dtype=np.float64)
        local = np.empty_like(verts_mj)
        for i, p in enumerate(verts_mj):
            local[i] = gpos + _rotate(gquat, p)
        verts = (C @ local.T).T.astype(np.float32)
        idx = faces[:, ::-1].reshape(-1).astype(np.uint32)

        bid = mj.mj_name2id(model, mj.mjtObj.mjOBJ_BODY, seg)
        p = np.array(data.xpos[bid], dtype=np.float64)
        R = _quat_to_mat(data.xquat[bid])
        p_rel = th_R.T @ (p - th_p)
        R_rel = th_R.T @ R

        mesh_i = len(meshes)
        meshes.append((verts, idx))
        segments.append(
            {
                "name": seg,
                "parent": PARENT.get(seg),
                "mesh": mesh_i,
                "material": _match_material(seg, materials),
                "restPos": three_pos(p_rel),
                "restQuat": three_quat_from_R(R_rel),
            }
        )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    bin_path = OUT_DIR / "nmf.bin"
    with bin_path.open("wb") as f:
        f.write(MAGIC)
        f.write(struct.pack("<I", len(meshes)))
        for verts, idx in meshes:
            f.write(struct.pack("<II", verts.shape[0], idx.size // 3))
            f.write(np.ascontiguousarray(verts, dtype="<f4").tobytes())
            f.write(np.ascontiguousarray(idx, dtype="<u4").tobytes())

    meta = {
        "standZ": stand_z,
        "units": "mm",
        "root": "c_thorax",
        "legs": {"L1": "lf", "R1": "rf", "L2": "lm", "R2": "rm", "L3": "lh", "R3": "rh"},
        "materials": {
            k: {"color": v["color"], "opacity": v["opacity"], "roughness": v["roughness"]}
            for k, v in materials.items()
        },
        "segments": segments,
    }
    json_path = OUT_DIR / "nmf.json"
    json_path.write_text(json.dumps(meta, separators=(",", ":")))
    print(
        f"wrote {bin_path.relative_to(ROOT)} ({bin_path.stat().st_size} bytes)  "
        f"{json_path.relative_to(ROOT)} ({json_path.stat().st_size} bytes)"
    )
    print(f"  {len(segments)} segments  standZ={stand_z:.3f} mm")
    feet = [s for s in segments if s["name"].endswith("tarsus5")]
    print("  tarsus5 rest y", {s["name"]: round(s["restPos"][1], 3) for s in feet})


if __name__ == "__main__":
    export()
