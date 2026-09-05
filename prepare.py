#!/usr/bin/env python3
"""Build browser-ready assets from the FlyEM Male CNS v1.0 connectome.

Source: Berg et al., Cell 2026 — complete adult male Drosophila CNS
(brain + ventral nerve cord), 166k neurons. Data is CC-BY from
https://male-cns.janelia.org/
"""

from __future__ import annotations

import json
import os
import struct
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.feather as feather

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
WEBDATA = os.path.join(ROOT, "web", "data")
SKEL_DIR = os.path.join(DATA, "skeletons")
SWC_URL = (
    "https://storage.googleapis.com/flyem-male-cns/"
    "v1.0/segmentation/skeletons-malecns/skeletons-swc/{}.swc"
)

# Voxel size of Male CNS EM space.
NM_PER_VOXEL = 8.0
UM_PER_VOXEL = NM_PER_VOXEL / 1000.0

# Codex-style synapse threshold (MCNS default is 5).
MIN_WEIGHT = 5

GROUPS = [
    # name,                  match prefixes of superclass,           hex
    ("optic sensory",        ("ol_sensory",),                        "#f5d76e"),
    ("optic lobe",           ("ol_intrinsic",),                      "#b07cff"),
    ("visual projection",    ("visual_projection",),                 "#ff4fd8"),
    ("visual centrifugal",   ("visual_centrifugal",),                "#d24bff"),
    ("brain sensory",        ("cb_sensory",),                        "#ffd166"),
    ("central brain",        ("cb_intrinsic",),                      "#3dff9a"),
    ("brain motor",          ("cb_motor", "cb_efferent"),            "#ff5c7a"),
    ("endocrine",            ("cb_endocrine", "vnc_endocrine"),      "#9aff6a"),
    ("descending",           ("descending_neuron", "sensory_descending"), "#ff9f1c"),
    ("ascending",            ("ascending_neuron", "sensory_ascending",
                              "efferent_ascending"),                 "#4de4ff"),
    ("VNC sensory",          ("vnc_sensory",),                       "#ffe566"),
    ("VNC",                  ("vnc_intrinsic", "vnc_tbc", "ENS"),    "#4d7cff"),
    ("motor",                ("vnc_motor", "vnc_efferent",
                              "efferent_descending"),                "#ff3b5c"),
]

NT_NAMES = [
    "unknown", "acetylcholine", "gaba", "glutamate", "histamine",
    "dopamine", "serotonin", "octopamine",
]
NT_TO_ID = {n: i for i, n in enumerate(NT_NAMES)}
NT_TO_ID["unclear"] = 0

# Types we always try to reconstruct as 3D skeletons.
SHOW_TYPES = [
    "DNp01", "DNp02", "DNp03", "DNp04", "DNp09", "DNp11",
    "DNg02_a", "DNg02_b",
    "pIP1", "aIPg1", "aIPg2", "aIPg3", "aIPg7",
    "mAL_m1", "mAL_m8", "aSP10C_a",
    "vPR6", "TN1A", "P1a", "P1b",
    "s-LNv", "LNd", "DN1a", "DN1pA",
    "MBON01", "MBON07", "MBON09", "MBON21",
    "PAM01", "PPL1-γ1pedc",
]


def _log(msg: str) -> None:
    print(msg, flush=True)


def _ensure_dirs() -> None:
    os.makedirs(WEBDATA, exist_ok=True)
    os.makedirs(SKEL_DIR, exist_ok=True)


def load_neurons() -> pd.DataFrame:
    _log("loading annotations…")
    ann = feather.read_table(os.path.join(DATA, "body-annotations.feather")).to_pandas()
    df = ann[ann["status"] == "Traced"].copy()
    df = df.reset_index(drop=True)

    nt = feather.read_table(
        os.path.join(DATA, "body-neurotransmitters.feather"),
        columns=["body", "consensus_nt", "predicted_nt"],
    )
    nt = nt.filter(pc.is_in(nt["body"], value_set=pa.array(df["bodyId"].to_numpy())))
    ntd = nt.to_pandas().drop_duplicates("body")
    df = df.merge(ntd, left_on="bodyId", right_on="body", how="left")

    def nt_id(row) -> int:
        for key in ("consensus_nt", "predicted_nt"):
            v = row.get(key)
            if isinstance(v, str) and v in NT_TO_ID:
                return NT_TO_ID[v]
        return 0

    df["nt_id"] = df.apply(nt_id, axis=1).astype(np.uint8)

    super_to_group = {}
    for gi, (name, prefixes, _col) in enumerate(GROUPS):
        for p in prefixes:
            super_to_group[p] = gi

    def group_of(s) -> int:
        if not isinstance(s, str):
            return 255
        if s in super_to_group:
            return super_to_group[s]
        # strip _tbc suffix used for "to be confirmed"
        if s.endswith("_tbc"):
            return group_of(s[: -len("_tbc")])
        return 255

    df["group"] = df["superclass"].map(group_of).astype(np.uint8)

    xyz = np.full((len(df), 3), np.nan, np.float64)
    has = df["somaLocation"].notna().to_numpy()
    if has.any():
        xyz[has] = np.stack(df.loc[has, "somaLocation"].to_numpy())
    df["x"], df["y"], df["z"] = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    return df


def fill_missing_soma(df: pd.DataFrame, brain_verts: np.ndarray, vnc_verts: np.ndarray) -> None:
    """Sensory neurons often have somas outside the CNS. Park them on the shell."""
    missing = np.isnan(df["x"].to_numpy())
    if not missing.any():
        return
    rng_ids = df.loc[missing, "bodyId"].to_numpy()
    groups = df.loc[missing, "group"].to_numpy()
    vnc_groups = {i for i, (n, *_) in enumerate(GROUPS) if n.startswith("VNC") or n == "motor"}
    pts = np.zeros((missing.sum(), 3), np.float64)
    for k, (bid, g) in enumerate(zip(rng_ids, groups)):
        verts = vnc_verts if int(g) in vnc_groups else brain_verts
        pts[k] = verts[int(bid) % len(verts)]
    x = df["x"].to_numpy(copy=True)
    y = df["y"].to_numpy(copy=True)
    z = df["z"].to_numpy(copy=True)
    x[missing] = pts[:, 0]
    y[missing] = pts[:, 1]
    z[missing] = pts[:, 2]
    df["x"], df["y"], df["z"] = x, y, z


def parse_obj(path: str) -> tuple[np.ndarray, np.ndarray]:
    verts, faces = [], []
    with open(path) as f:
        for line in f:
            if line.startswith("v "):
                verts.append([float(x) for x in line.split()[1:4]])
            elif line.startswith("f "):
                idx = [int(p.split("/")[0]) - 1 for p in line.split()[1:]]
                if len(idx) == 3:
                    faces.append(idx)
                elif len(idx) == 4:
                    faces.append([idx[0], idx[1], idx[2]])
                    faces.append([idx[0], idx[2], idx[3]])
    return np.asarray(verts, np.float32), np.asarray(faces, np.uint32)


def transform_xyz(xyz: np.ndarray, center: np.ndarray) -> np.ndarray:
    """EM voxels -> microns, VNC hanging down, dorsal toward +Z."""
    c = xyz - center
    out = np.empty_like(c, dtype=np.float32)
    out[:, 0] = c[:, 0] * UM_PER_VOXEL
    out[:, 1] = -c[:, 2] * UM_PER_VOXEL
    out[:, 2] = -c[:, 1] * UM_PER_VOXEL
    return out


def write_mesh_bin(path: str, verts: np.ndarray, faces: np.ndarray) -> None:
    with open(path, "wb") as f:
        f.write(b"MESH")
        f.write(struct.pack("<II", verts.shape[0], faces.shape[0]))
        f.write(np.ascontiguousarray(verts, np.float32).tobytes())
        f.write(np.ascontiguousarray(faces, np.uint32).tobytes())


def build_connectome(ids: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    _log("loading connectome (1 GB)…")
    t = feather.read_table(os.path.join(DATA, "connectome-weights.feather"))
    t = t.filter(pc.greater_equal(t["weight"], MIN_WEIGHT))
    _log(f"  {t.num_rows:,} edges with weight ≥ {MIN_WEIGHT}")

    id_to_idx = {int(b): i for i, b in enumerate(ids)}
    pre = pd.Series(t["body_pre"].to_numpy()).map(id_to_idx)
    post = pd.Series(t["body_post"].to_numpy()).map(id_to_idx)
    w = t["weight"].to_numpy()
    ok = pre.notna() & post.notna()
    pre = pre[ok].to_numpy(np.uint32)
    post = post[ok].to_numpy(np.uint32)
    w = w[ok].astype(np.uint16, copy=False)
    # clip just in case a weight exceeds uint16
    if w.max() > np.iinfo(np.uint16).max:
        w = np.minimum(w, np.iinfo(np.uint16).max).astype(np.uint16)
    _log(f"  {len(pre):,} edges among traced neurons")

    n = len(ids)
    order = np.argsort(pre, kind="mergesort")
    pre, post, w = pre[order], post[order], w[order]
    counts = np.bincount(pre, minlength=n).astype(np.uint32)
    indptr = np.zeros(n + 1, np.uint32)
    indptr[1:] = np.cumsum(counts)
    return indptr, post, w


def write_neurons_bin(path: str, xyz: np.ndarray, group, nt, flags) -> None:
    n = xyz.shape[0]
    with open(path, "wb") as f:
        f.write(b"MCNS")
        f.write(struct.pack("<II", 1, n))
        f.write(np.ascontiguousarray(xyz, np.float32).tobytes())
        f.write(np.ascontiguousarray(group, np.uint8).tobytes())
        f.write(np.ascontiguousarray(nt, np.uint8).tobytes())
        f.write(np.ascontiguousarray(flags, np.uint8).tobytes())


def write_csr_bin(path: str, indptr, indices, weight) -> None:
    n = indptr.shape[0] - 1
    nnz = indices.shape[0]
    with open(path, "wb") as f:
        f.write(b"MCSR")
        f.write(struct.pack("<II", n, nnz))
        f.write(np.ascontiguousarray(indptr, np.uint32).tobytes())
        f.write(np.ascontiguousarray(indices, np.uint32).tobytes())
        f.write(np.ascontiguousarray(weight, np.uint16).tobytes())


def pick_showcase(df: pd.DataFrame) -> list[int]:
    chosen: list[int] = []
    seen = set()

    def add_rows(rows, limit=None):
        n = 0
        for i in rows.index:
            if i in seen:
                continue
            seen.add(i)
            chosen.append(int(i))
            n += 1
            if limit is not None and n >= limit:
                break

    types = df["type"].fillna("")
    inst = df["instance"].fillna("")
    for t in SHOW_TYPES:
        add_rows(df[types == t], limit=2)

    add_rows(df[df["class"] == "Kenyon_Cell"], 4)
    add_rows(df[df["class"] == "MBON"], 2)
    add_rows(df[df["class"] == "DAN"], 2)
    add_rows(df[types.isin(["HSN", "HSE", "HSS", "H2", "VS"])], 6)
    add_rows(df[df["superclass"] == "visual_projection"], 4)
    add_rows(df[df["superclass"] == "descending_neuron"], 4)
    add_rows(df[df["superclass"] == "ascending_neuron"], 2)
    add_rows(df[df["dimorphism"] == "male-specific"], 6)
    fru = df["fruDsx"].fillna("")
    add_rows(df[fru.str.startswith("fru_high") | fru.str.startswith("coexpress_high")], 4)
    add_rows(df[inst.str.contains("GF", na=False)], 2)
    return chosen[:48]


def parse_swc(text: str) -> list[list[float]]:
    nodes = {}
    for line in text.splitlines():
        if not line or line[0] == "#":
            continue
        p = line.split()
        if len(p) < 7:
            continue
        nid, x, y, z, parent = int(p[0]), float(p[2]), float(p[3]), float(p[4]), int(p[6])
        nodes[nid] = (x, y, z, parent)
    if not nodes:
        return []
    children: dict[int, list[int]] = {k: [] for k in nodes}
    roots = []
    for nid, (_x, _y, _z, parent) in nodes.items():
        if parent in nodes:
            children[parent].append(nid)
        else:
            roots.append(nid)

    paths: list[list[tuple[float, float, float]]] = []

    def walk(start: int, prev: list[tuple[float, float, float]]):
        cur = start
        pts = list(prev)
        while True:
            x, y, z, _ = nodes[cur]
            pts.append((x, y, z))
            kids = children.get(cur, [])
            if not kids:
                paths.append(pts)
                return
            if len(kids) == 1:
                cur = kids[0]
                continue
            paths.append(pts)
            for k in kids:
                walk(k, [pts[-1]])
            return

    for r in roots:
        walk(r, [])

    # downsample long branches
    out: list[list[float]] = []
    for pts in paths:
        if len(pts) < 2:
            continue
        step = max(1, len(pts) // 90)
        kept = pts[::step]
        if kept[-1] != pts[-1]:
            kept.append(pts[-1])
        flat: list[float] = []
        for x, y, z in kept:
            flat.extend((x, y, z))
        out.append(flat)
    return out


def download_swc(body_id: int) -> str | None:
    dest = os.path.join(SKEL_DIR, f"{body_id}.swc")
    if os.path.exists(dest) and os.path.getsize(dest) > 50:
        return dest
    url = SWC_URL.format(body_id)
    try:
        urllib.request.urlretrieve(url, dest)
        if os.path.getsize(dest) < 50:
            os.remove(dest)
            return None
        return dest
    except Exception:
        if os.path.exists(dest):
            os.remove(dest)
        return None


def fetch_skeletons(df: pd.DataFrame, center: np.ndarray, indices: list[int]) -> list[dict]:
    _log(f"downloading {len(indices)} showcase skeletons…")
    items = []
    with ThreadPoolExecutor(max_workers=16) as ex:
        futs = {
            ex.submit(download_swc, int(df.iloc[i]["bodyId"])): i for i in indices
        }
        for fut in as_completed(futs):
            i = futs[fut]
            path = fut.result()
            if not path:
                continue
            with open(path, errors="ignore") as f:
                paths_raw = parse_swc(f.read())
            if not paths_raw:
                continue
            paths = []
            for flat in paths_raw:
                xyz = np.asarray(flat, np.float64).reshape(-1, 3)
                xyz = transform_xyz(xyz, center)
                paths.append(xyz.reshape(-1).tolist())
            row = df.iloc[i]
            items.append({
                "i": i,
                "id": int(row["bodyId"]),
                "name": str(row["instance"] or row["type"] or row["bodyId"]),
                "type": str(row["type"] or ""),
                "group": int(row["group"]) if row["group"] != 255 else 5,
            })
            items[-1]["paths"] = paths
            _log(f"  skeleton {items[-1]['name']}  {sum(len(p)//3 for p in paths)} pts")
    items.sort(key=lambda d: d["i"])
    return items


def main() -> None:
    _ensure_dirs()
    df = load_neurons()
    _log(f"traced neurons: {len(df):,}")

    brain_v, brain_f = parse_obj(os.path.join(DATA, "meshes", "brain.obj"))
    vnc_v, vnc_f = parse_obj(os.path.join(DATA, "meshes", "vnc.obj"))
    fill_missing_soma(df, brain_v, vnc_v)

    xyz_raw = df[["x", "y", "z"]].to_numpy(np.float64)
    center = np.nanmean(xyz_raw, axis=0)
    xyz = transform_xyz(xyz_raw, center)
    brain_t = transform_xyz(brain_v.astype(np.float64), center)
    vnc_t = transform_xyz(vnc_v.astype(np.float64), center)

    flags = np.zeros(len(df), np.uint8)
    flags |= (df["somaLocation"].notna().to_numpy() * 1).astype(np.uint8)
    flags |= ((df["dimorphism"] == "male-specific").to_numpy() * 2).astype(np.uint8)
    flags |= ((df["dimorphism"] == "sexually dimorphic").to_numpy() * 4).astype(np.uint8)
    fru = df["fruDsx"].fillna("").astype(str)
    flags |= (fru.str.contains("fru").to_numpy() * 8).astype(np.uint8)
    flags |= (fru.str.contains("dsx").to_numpy() * 16).astype(np.uint8)

    group = df["group"].to_numpy(np.uint8)
    nt = df["nt_id"].to_numpy(np.uint8)

    write_neurons_bin(os.path.join(WEBDATA, "neurons.bin"), xyz, group, nt, flags)
    write_mesh_bin(os.path.join(WEBDATA, "brain.mesh"), brain_t, brain_f)
    write_mesh_bin(os.path.join(WEBDATA, "vnc.mesh"), vnc_t, vnc_f)

    ids = df["bodyId"].to_numpy(np.int64)
    indptr, indices, weight = build_connectome(ids)
    write_csr_bin(os.path.join(WEBDATA, "connectome.bin"), indptr, indices, weight)

    showcase_idx = pick_showcase(df)
    skeletons = fetch_skeletons(df, center, showcase_idx)
    with open(os.path.join(WEBDATA, "skeletons.json"), "w") as f:
        json.dump({"items": skeletons}, f)

    # Stimulus index lists (compact).
    def idx_where(mask) -> list[int]:
        return np.flatnonzero(mask.to_numpy()).astype(int).tolist()

    cls = df["class"].fillna("").astype(str)
    super_c = df["superclass"].fillna("").astype(str)
    typ = df["type"].fillna("").astype(str)
    stim = {
        "vision": idx_where(super_c.str.startswith("ol_sensory") | (cls == "visual")),
        "smell": idx_where(cls == "olfactory"),
        "taste": idx_where((cls == "gustatory") | (cls == "chemosensory")),
        "touch": idx_where(cls.str.contains("mechanosensory")),
        "courtship": idx_where(
            (df["dimorphism"] == "male-specific") | fru.str.contains("fru_high")
        ),
        "escape": idx_where(typ == "DNp01"),
    }

    groups_meta = []
    for gi, (name, _pref, color) in enumerate(GROUPS):
        groups_meta.append({
            "id": gi,
            "name": name,
            "color": color,
            "count": int((group == gi).sum()),
        })
    groups_meta.append({
        "id": 255,
        "name": "other",
        "color": "#8892a8",
        "count": int((group == 255).sum()),
    })

    meta = {
        "n": int(len(df)),
        "nEdges": int(indices.shape[0]),
        "minWeight": MIN_WEIGHT,
        "groups": groups_meta,
        "nt": NT_NAMES,
        "stim": {k: len(v) for k, v in stim.items()},
        "citation": (
            "Berg et al. Sexual dimorphism in the complete connectome of the "
            "Drosophila male central nervous system. Cell (2026). "
            "FlyEM / Janelia / Cambridge / MRC LMB / Google Research. CC-BY."
        ),
        "dataset": "Male CNS v1.0",
        "centerVoxel": center.tolist(),
        "umPerVoxel": UM_PER_VOXEL,
        "showcase": [
            {"i": s["i"], "id": s["id"], "name": s["name"], "type": s["type"],
             "group": s["group"]}
            for s in skeletons
        ],
    }
    with open(os.path.join(WEBDATA, "meta.json"), "w") as f:
        json.dump(meta, f)
    # stim indices are large; store separately
    with open(os.path.join(WEBDATA, "stim.json"), "w") as f:
        json.dump(stim, f)

    _log(f"wrote {WEBDATA}")
    _log(f"  neurons {len(df):,}  edges {indices.shape[0]:,}  skeletons {len(skeletons)}")
    for g in groups_meta:
        _log(f"    {g['name']:22s} {g['count']:6d}")


if __name__ == "__main__":
    main()
