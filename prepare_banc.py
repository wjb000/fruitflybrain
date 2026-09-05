#!/usr/bin/env python3
"""Build browser assets from the BANC v888 female CNS connectome.

Bates et al. — female adult Drosophila brain AND ventral nerve cord.
Public data: gs://lee-lab_brain-and-nerve-cord-fly-connectome/
"""

from __future__ import annotations

import json
import os
import struct

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.feather as feather

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data", "banc")
OUT = os.path.join(ROOT, "web", "data", "female")
MIN_WEIGHT = 3  # Codex BANC default

NT_NAMES = [
    "unknown", "acetylcholine", "gaba", "glutamate", "histamine",
    "dopamine", "serotonin", "octopamine",
]
NT_TO_ID = {n: i for i, n in enumerate(NT_NAMES)}
NT_TO_ID["unclear"] = 0
NT_TO_ID["tyramine"] = 0

GROUPS = [
    ("optic sensory", "#f5d76e"),
    ("optic lobe", "#b07cff"),
    ("visual projection", "#ff4fd8"),
    ("visual centrifugal", "#d24bff"),
    ("brain sensory", "#ffd166"),
    ("central brain", "#3dff9a"),
    ("brain motor", "#ff5c7a"),
    ("endocrine", "#9aff6a"),
    ("descending", "#ff9f1c"),
    ("ascending", "#4de4ff"),
    ("VNC sensory", "#ffe566"),
    ("VNC", "#4d7cff"),
    ("motor", "#ff3b5c"),
]


def log(msg: str) -> None:
    print(msg, flush=True)


def parse_xyz(series: pd.Series) -> np.ndarray:
    n = len(series)
    xyz = np.full((n, 3), np.nan, np.float64)
    for i, s in enumerate(series):
        if not isinstance(s, str) or "," not in s:
            continue
        try:
            xyz[i] = [float(x) for x in s.split(",")[:3]]
        except ValueError:
            pass
    return xyz


def group_row(sc, region, cclass, cfun) -> int:
    sc = sc or ""
    region = region or ""
    cclass = cclass or ""
    cfun = cfun or ""
    if sc == "optic_lobe_intrinsic":
        return 1
    if sc == "visual_projection":
        return 2
    if sc == "visual_centrifugal":
        return 3
    if sc == "central_brain_intrinsic":
        return 5
    if sc == "descending":
        return 8
    if sc in ("ascending", "sensory_ascending"):
        return 9
    if sc == "ventral_nerve_cord_intrinsic":
        return 11
    if sc == "motor":
        return 12
    if sc in ("visceral_circulatory", "ascending_visceral_circulatory"):
        return 7
    if sc in ("sensory", "sensory_descending"):
        if "photoreceptor" in cclass or cfun.startswith("visual") or region == "optic_lobe":
            return 0
        if region == "ventral_nerve_cord":
            return 10
        return 4
    if "motor" in cfun or "motor" in cclass:
        if region == "central_brain":
            return 6
        return 12
    return 255


def write_neurons_bin(path, xyz, group, nt, flags) -> None:
    n = xyz.shape[0]
    with open(path, "wb") as f:
        f.write(b"MCNS")
        f.write(struct.pack("<II", 1, n))
        f.write(np.ascontiguousarray(xyz, np.float32).tobytes())
        f.write(np.ascontiguousarray(group, np.uint8).tobytes())
        f.write(np.ascontiguousarray(nt, np.uint8).tobytes())
        f.write(np.ascontiguousarray(flags, np.uint8).tobytes())


def write_csr_bin(path, indptr, indices, weight) -> None:
    n = indptr.shape[0] - 1
    nnz = indices.shape[0]
    with open(path, "wb") as f:
        f.write(b"MCSR")
        f.write(struct.pack("<II", n, nnz))
        f.write(np.ascontiguousarray(indptr, np.uint32).tobytes())
        f.write(np.ascontiguousarray(indices, np.uint32).tobytes())
        f.write(np.ascontiguousarray(weight, np.uint16).tobytes())


def write_mesh_bin(path, verts, faces) -> None:
    with open(path, "wb") as f:
        f.write(b"MESH")
        f.write(struct.pack("<II", verts.shape[0], faces.shape[0]))
        f.write(np.ascontiguousarray(verts, np.float32).tobytes())
        f.write(np.ascontiguousarray(faces, np.uint32).tobytes())


def transform_xyz(xyz, center) -> np.ndarray:
    """nm → µm, VNC hanging down, dorsal toward +Z — then we stand it up in JS."""
    c = xyz - center
    um = c / 1000.0
    out = np.empty_like(um, dtype=np.float32)
    out[:, 0] = um[:, 0]
    out[:, 1] = -um[:, 2]
    out[:, 2] = -um[:, 1]
    return out


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    log("loading BANC meta…")
    meta = feather.read_table(os.path.join(DATA, "banc_888_meta.feather")).to_pandas()
    pr = meta["proofread"].astype(str).str.upper() == "TRUE"
    sc = meta["super_class"].fillna("")
    keep = pr & ~sc.isin(["glia", "not_a_neuron", "trachea", ""])
    df = meta.loc[keep].reset_index(drop=True)
    log(f"  proofread neurons {len(df):,}")

    ids = df["root_888"].astype(str).to_numpy()
    xyz_nm = parse_xyz(df["root_position_nm"])
    miss = np.isnan(xyz_nm[:, 0])
    if miss.any():
        alt = parse_xyz(df["position"])
        # position is voxels; BANC ~4nm x 4nm x 45nm-ish — skip, use nm only
        xyz_nm[miss] = np.nanmean(xyz_nm[~miss], axis=0)

    center = np.nanmean(xyz_nm, axis=0)
    xyz = transform_xyz(xyz_nm, center)

    nt = np.zeros(len(df), np.uint8)
    pred = df["neurotransmitter_predicted"].fillna("").astype(str)
    for i, v in enumerate(pred):
        nt[i] = NT_TO_ID.get(v, 0)

    region = df["region"].fillna("").astype(str)
    cclass = df["cell_class"].fillna("").astype(str)
    cfun = df["cell_function"].fillna("").astype(str)
    scv = df["super_class"].fillna("").astype(str).to_numpy()
    group = np.array(
        [group_row(scv[i], region.iloc[i], cclass.iloc[i], cfun.iloc[i]) for i in range(len(df))],
        np.uint8,
    )

    flags = np.zeros(len(df), np.uint8)
    flags |= df["root_position_nm"].notna().to_numpy().astype(np.uint8) * np.uint8(1)
    flags |= (df["sexually_dimorphic"] == "female-specific").to_numpy().astype(np.uint8) * np.uint8(2)
    flags |= (df["sexually_dimorphic"] == "dimorphic").to_numpy().astype(np.uint8) * np.uint8(4)

    write_neurons_bin(os.path.join(OUT, "neurons.bin"), xyz, group, nt, flags)

    log("loading BANC edges…")
    t = feather.read_table(os.path.join(DATA, "banc_888_edgelist.feather"))
    t = t.filter(pc.greater_equal(t["count"], MIN_WEIGHT))
    log(f"  {t.num_rows:,} edges with count ≥ {MIN_WEIGHT}")
    id_to_idx = {str(b): i for i, b in enumerate(ids)}
    pre = pd.Series(t["pre"].to_pandas()).map(id_to_idx)
    post = pd.Series(t["post"].to_pandas()).map(id_to_idx)
    w = t["count"].to_numpy()
    ok = pre.notna() & post.notna()
    pre = pre[ok].to_numpy(np.uint32)
    post = post[ok].to_numpy(np.uint32)
    w = np.minimum(w[ok], 65535).astype(np.uint16)
    log(f"  {len(pre):,} edges among proofread neurons")
    n = len(ids)
    order = np.argsort(pre, kind="mergesort")
    pre, post, w = pre[order], post[order], w[order]
    counts = np.bincount(pre, minlength=n).astype(np.uint32)
    indptr = np.zeros(n + 1, np.uint32)
    indptr[1:] = np.cumsum(counts)
    write_csr_bin(os.path.join(OUT, "connectome.bin"), indptr, post, w)

    side = df["side"].fillna("").astype(str)
    typ = df["cell_type"].fillna("").astype(str)
    neu = df["neuromere"].fillna("").astype(str)
    beff = df["body_part_effector"].fillna("").astype(str)
    bsens = df["body_part_sensory"].fillna("").astype(str)

    def idx(mask) -> list[int]:
        return [int(i) for i in np.flatnonzero(mask.to_numpy() if hasattr(mask, "to_numpy") else mask)]

    def idxb(m) -> list[int]:
        return idx(pd.Series(m))

    pools = {
        "T1L": idx((neu == "T1") & (side == "left") & ((scv == "motor") | (cfun == "leg_motor") | (beff == "front_leg"))),
        "T1R": idx((neu == "T1") & (side == "right") & ((scv == "motor") | (cfun == "leg_motor") | (beff == "front_leg"))),
        "T2L": idx((neu == "T2") & (side == "left") & ((scv == "motor") | (cfun == "leg_motor") | (beff == "middle_leg"))),
        "T2R": idx((neu == "T2") & (side == "right") & ((scv == "motor") | (cfun == "leg_motor") | (beff == "middle_leg"))),
        "T3L": idx((neu == "T3") & (side == "left") & ((scv == "motor") | (cfun == "leg_motor") | (beff == "hind_leg"))),
        "T3R": idx((neu == "T3") & (side == "right") & ((scv == "motor") | (cfun == "leg_motor") | (beff == "hind_leg"))),
        "abdomen": idx(beff == "abdomen"),
        "DLM": idx(typ.str.contains("DLM")),
        "DVM": idx(typ.str.contains("DVM")),
        "ADMN": idx(beff == "wing"),
        "MN9": idx(typ == "MN9"),
        "proboscis": idx((beff == "proboscis") | (cfun == "proboscis_motor") | (cfun == "pharynx_motor")),
        "neck": idx((beff == "neck") | (cfun == "neck_motor")),
        "DNa": idx(typ.str.match(r"DNa")),
        "DNg02": idx(typ.str.startswith("DNg02")),
        "DNp01": idx(typ == "DNp01"),
        "DNp": idx(typ.str.startswith("DNp")),
        "aIPg": idx(typ.str.startswith("aIPg")),
        "pIP1": idx(typ == "pIP1"),
        "fru": idx(df["sexually_dimorphic"] == "female-specific"),
        "ppk23": idx((bsens == "front_leg") | (bsens == "labellum")),
        "hygrosensory": idx(cfun == "hygrosensory"),
    }
    # fallback T1 from body_part if neuromere empty
    if len(pools["T1L"]) + len(pools["T1R"]) < 20:
        pools["T1L"] = idx((beff == "front_leg") & (side == "left"))
        pools["T1R"] = idx((beff == "front_leg") & (side == "right"))
        pools["T2L"] = idx((beff == "middle_leg") & (side == "left"))
        pools["T2R"] = idx((beff == "middle_leg") & (side == "right"))
        pools["T3L"] = idx((beff == "hind_leg") & (side == "left"))
        pools["T3R"] = idx((beff == "hind_leg") & (side == "right"))

    stim = {
        "vision": idx((cclass.str.contains("photoreceptor")) | cfun.str.startswith("visual") | (bsens == "retina")),
        "smell": idx((cclass.str.contains("olfactory")) | (cfun == "olfactory")),
        "taste": idx((cclass.str.contains("gustatory")) | (cfun == "gustatory")),
        "touch": idx((cfun == "tactile") | (cclass.str.contains("bristle"))),
        "courtship": idx(df["sexually_dimorphic"] == "female-specific"),
        "escape": idx(typ == "DNp01"),
        "hygro": idx(cfun == "hygrosensory"),
        "ppk23": pools["ppk23"],
    }
    # split smell/ppk L/R in JS via xyz

    groups_meta = []
    for gi, (name, color) in enumerate(GROUPS):
        groups_meta.append({"id": gi, "name": name, "color": color, "count": int((group == gi).sum())})
    groups_meta.append({"id": 255, "name": "other", "color": "#8892a8", "count": int((group == 255).sum())})

    meta_js = {
        "n": int(len(df)),
        "nEdges": int(len(pre)),
        "minWeight": MIN_WEIGHT,
        "groups": groups_meta,
        "nt": NT_NAMES,
        "dataset": "BANC v888 female CNS",
        "citation": (
            "Bates et al. A connectome of the adult Drosophila central nervous system "
            "(BANC). Female brain + ventral nerve cord."
        ),
        "stim": {k: len(v) for k, v in stim.items()},
    }
    with open(os.path.join(OUT, "meta.json"), "w") as f:
        json.dump(meta_js, f)
    with open(os.path.join(OUT, "stim.json"), "w") as f:
        json.dump(stim, f)
    with open(os.path.join(OUT, "effectors.json"), "w") as f:
        json.dump({"n": int(len(df)), "counts": {k: len(v) for k, v in pools.items()}, "pools": pools}, f)
    with open(os.path.join(OUT, "skeletons.json"), "w") as f:
        json.dump({"items": []}, f)

    log(f"wrote {OUT}")
    log(f"  neurons {len(df):,}  edges {len(pre):,}")
    for g in groups_meta:
        log(f"    {g['name']:22s} {g['count']:6d}")
    log("  effectors:")
    for k, v in pools.items():
        log(f"    {k:14s} {len(v):5d}")
    log("  stim:")
    for k, v in stim.items():
        log(f"    {k:14s} {len(v):5d}")


if __name__ == "__main__":
    main()
