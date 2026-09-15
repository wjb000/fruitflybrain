#!/usr/bin/env python3
"""BANC transplant v2 onto the prepared male CSR (no new somas).

v2 policy:
  ablate male-specific (+potentially MS) outs;
  replace body-matched (malecns_match) and type-matched (malecns_cell_type)
  dimorphic outs with BANC-mapped edges;
  KEEP unmatched sexually-dimorphic male outs.

Writes:
  results/sex_swap/connectome_female_swap.bin  (MCSR; gitignored)
  results/sex_swap/transplant_summary.json
and updates graph_edit_manifest.json female_swap note.
"""

from __future__ import annotations

import json
import struct
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.compute as pc
import pyarrow.feather as feather

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
WEB = ROOT / "web" / "data"
OUT = ROOT / "results" / "sex_swap"
BANC = DATA / "banc"

MS = {"male-specific", "potentially male-specific"}
SD = {"sexually dimorphic", "potentially sexually dimorphic"}
DIMORPHISM = MS | SD

POLICY = (
    "v2: ablate male-specific (+potentially MS) outs; "
    "replace body-matched (malecns_match) and type-matched (malecns_cell_type) "
    "dimorphic outs with BANC-mapped edges; "
    "KEEP unmatched sexually-dimorphic male outs"
)

FEMALE_SWAP_NOTE = (
    "v2 BANC transplant: ablate male-specific (+potentially MS) outs; "
    "replace body-matched (malecns_match) and type-matched (malecns_cell_type) "
    "dimorphic outs with BANC-mapped edges; KEEP unmatched sexually-dimorphic "
    "male outs. CSR: results/sex_swap/connectome_female_swap.bin"
)

PRE_COLS = ("pre", "pre_root_id", "pre_pt_root_id", "bodyId_pre", "pre_id", "root_pre")
POST_COLS = ("post", "post_root_id", "post_pt_root_id", "bodyId_post", "post_id", "root_post")
W_COLS = ("count", "syn_count", "n_synapses", "weight", "synapses")
ID_COLS = ("root_888", "root_id", "pt_root_id", "id")


def _col(df, names, what: str) -> str:
    lower = {str(c).lower(): c for c in df.columns}
    for n in names:
        if n in df.columns:
            return n
        if n.lower() in lower:
            return lower[n.lower()]
    raise SystemExit(f"no {what} column in {list(df.columns)[:24]}")


def read_mcsr(path: Path, n: int):
    raw = path.read_bytes()
    if raw[:4] != b"MCSR":
        raise SystemExit(f"bad magic in {path}")
    hn, nnz = struct.unpack_from("<II", raw, 4)
    if hn != n:
        raise SystemExit(f"CSR n={hn} != annotations n={n}")
    off = 12
    indptr = np.frombuffer(raw, np.uint32, n + 1, off).copy()
    off += (n + 1) * 4
    indices = np.frombuffer(raw, np.uint32, nnz, off).copy()
    off += nnz * 4
    weight = np.frombuffer(raw, np.uint16, nnz, off).copy()
    return indptr, indices, weight, int(nnz)


def write_mcsr(path: Path, indptr: np.ndarray, indices: np.ndarray, weight: np.ndarray) -> None:
    n = int(indptr.shape[0] - 1)
    nnz = int(indices.shape[0])
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as f:
        f.write(b"MCSR")
        f.write(struct.pack("<II", n, nnz))
        f.write(np.ascontiguousarray(indptr, np.uint32).tobytes())
        f.write(np.ascontiguousarray(indices, np.uint32).tobytes())
        f.write(np.ascontiguousarray(weight, np.uint16).tobytes())


def pair_by_side(males: pd.DataFrame, fems: pd.DataFrame) -> list[tuple[int, int]]:
    """1:1 male_idx ↔ female row position, preferring matching side."""
    pairs: list[tuple[int, int]] = []
    used_f: set[int] = set()
    m_side = males["side"].fillna("").astype(str).str.lower()
    f_side = fems["side"].fillna("").astype(str).str.lower() if "side" in fems.columns else pd.Series([""] * len(fems))
    m_pos = list(males.index)
    f_pos = list(fems.index)
    for mi in m_pos:
        want = m_side.loc[mi]
        hit = None
        for fi in f_pos:
            if fi in used_f:
                continue
            fs = f_side.loc[fi] if fi in f_side.index else ""
            if want and fs and want == fs:
                hit = fi
                break
        if hit is None:
            for fi in f_pos:
                if fi not in used_f:
                    hit = fi
                    break
        if hit is None:
            continue
        used_f.add(hit)
        pairs.append((int(males.loc[mi, "_idx"]), int(fems.loc[hit, "_fidx"])))
    return pairs


def map_post(fid: np.int64, fem_id_to_row: dict, fem: pd.DataFrame, body_to_midx: dict, type_to_midx: dict) -> int | None:
    row = fem_id_to_row.get(int(fid))
    if row is None:
        return None
    mid = fem.at[row, "_match_id"]
    if mid == mid and int(mid) in body_to_midx:  # not NaN
        return body_to_midx[int(mid)]
    t = fem.at[row, "_map_type"]
    if t and t in type_to_midx:
        opts = type_to_midx[t]
        if opts:
            return int(opts[0])
    return None


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    male = feather.read_table(DATA / "body-annotations.feather").to_pandas()
    male = male[male["status"] == "Traced"].reset_index(drop=True)
    n = len(male)
    male["_idx"] = np.arange(n, dtype=np.int32)
    male["dimorphism"] = male["dimorphism"].fillna("").astype(str)
    male["type"] = male["type"].fillna("").astype(str)
    male["side"] = male["side"].fillna("").astype(str) if "side" in male.columns else ""
    male["bodyId"] = male["bodyId"].astype(np.int64)

    dim = male["dimorphism"]
    is_ms = dim.isin(MS)
    is_sd = dim.isin(SD)
    is_dim = dim.isin(DIMORPHISM)

    indptr, indices, weight, male_nnz = read_mcsr(WEB / "connectome.bin", n)

    banc_path = BANC / "banc_888_meta.feather"
    edge_path = BANC / "banc_888_edgelist_simple_v2.feather"
    if not banc_path.exists() or not edge_path.exists():
        raise SystemExit(f"need {banc_path} and {edge_path}")

    banc = feather.read_table(banc_path).to_pandas()
    id_col = _col(banc, ID_COLS, "BANC id")
    banc["_fid"] = pd.to_numeric(banc[id_col], errors="coerce")
    banc["malecns_match"] = pd.to_numeric(banc["malecns_match"], errors="coerce")
    banc["malecns_cell_type"] = banc["malecns_cell_type"].fillna("").astype(str)
    banc["cell_type"] = banc["cell_type"].fillna("").astype(str) if "cell_type" in banc.columns else ""
    if "side" not in banc.columns:
        banc["side"] = ""
    banc["side"] = banc["side"].fillna("").astype(str)
    banc["_map_type"] = banc["malecns_cell_type"].where(banc["malecns_cell_type"] != "", banc["cell_type"])

    pr = banc["proofread"].astype(str).str.upper() == "TRUE" if "proofread" in banc.columns else True
    sc = banc["super_class"].fillna("") if "super_class" in banc.columns else ""
    keep = pr & ~sc.isin(["glia", "not_a_neuron", "trachea", ""])
    fem = banc.loc[keep & banc["_fid"].notna()].copy().reset_index(drop=True)
    fem["_fidx"] = np.arange(len(fem), dtype=np.int32)
    fem["_match_id"] = fem["malecns_match"]

    body_to_midx = {int(b): int(i) for i, b in enumerate(male["bodyId"].to_numpy())}
    type_to_midx: dict[str, list[int]] = defaultdict(list)
    for i, t in enumerate(male["type"].to_numpy()):
        if t:
            type_to_midx[str(t)].append(int(i))

    fem_id_to_row = {int(fid): i for i, fid in enumerate(fem["_fid"].to_numpy()) if fid == fid}

    # Body-matched dimorphic males: any BANC row whose malecns_match is that bodyId.
    male_body_partners: dict[int, list[int]] = defaultdict(list)  # male_idx → fem _fidx
    for fi, mid in enumerate(fem["_match_id"].to_numpy()):
        if mid != mid:
            continue
        midx = body_to_midx.get(int(mid))
        if midx is None:
            continue
        if is_sd.iloc[midx] or is_dim.iloc[midx]:
            male_body_partners[int(midx)].append(int(fem.at[fi, "_fidx"]))

    body_matched = np.zeros(n, dtype=bool)
    for midx, partners in male_body_partners.items():
        if is_sd.iloc[midx] and partners:
            body_matched[midx] = True

    # Type-matched remaining SD males (malecns_cell_type ↔ male type).
    type_matched = np.zeros(n, dtype=bool)
    type_partner: dict[int, int] = {}  # male_idx → fem _fidx
    sd_left = male.loc[is_sd & ~body_matched]
    fem_by_type: dict[str, pd.DataFrame] = {}
    for t, g in fem.groupby(fem["malecns_cell_type"], sort=False):
        if t:
            fem_by_type[str(t)] = g
    for t, mg in sd_left.groupby(sd_left["type"], sort=False):
        if not t or t not in fem_by_type:
            continue
        pairs = pair_by_side(mg, fem_by_type[t])
        for midx, fidx in pairs:
            type_matched[midx] = True
            type_partner[int(midx)] = int(fidx)

    replace = (is_sd & (body_matched | type_matched)).to_numpy()
    ablate = is_ms.to_numpy()
    keep_sd = (is_sd & ~body_matched & ~type_matched).to_numpy()
    drop_outs = ablate | replace

    print("loading BANC edgelist (v2)…", flush=True)
    et = feather.read_table(edge_path)
    names = set(et.schema.names)
    pre_name = next((c for c in PRE_COLS if c in names), None)
    post_name = next((c for c in POST_COLS if c in names), None)
    w_name = next((c for c in W_COLS if c in names), None)
    if not pre_name or not post_name or not w_name:
        raise SystemExit(f"edgelist columns {et.schema.names} missing pre/post/weight")
    # minWeight 5 to match the male CSR.
    et = et.filter(pc.greater_equal(et[w_name], 5))
    pre_e = pd.to_numeric(et[pre_name].to_pandas(), errors="coerce")
    post_e = pd.to_numeric(et[post_name].to_pandas(), errors="coerce")
    w_e = pd.to_numeric(et[w_name].to_pandas(), errors="coerce").fillna(0)
    ok = pre_e.notna() & post_e.notna() & (w_e > 0)
    pre_e = pre_e[ok].astype(np.int64).to_numpy()
    post_e = post_e[ok].astype(np.int64).to_numpy()
    w_e = np.minimum(w_e[ok].to_numpy(), 65535).astype(np.uint16)

    fem_id_to_fidx = {int(fid): int(fidx) for fid, fidx in zip(fem["_fid"].to_numpy(), fem["_fidx"].to_numpy())}
    fidx_to_male_pre: dict[int, list[int]] = defaultdict(list)
    for midx, partners in male_body_partners.items():
        if not replace[midx]:
            continue
        for fidx in partners:
            fidx_to_male_pre[int(fidx)].append(int(midx))
    for midx, fidx in type_partner.items():
        if replace[midx]:
            fidx_to_male_pre[int(fidx)].append(int(midx))

    body_mapped_edges = 0
    type_transplant_edges = 0
    new_by_pre: dict[int, dict[int, int]] = defaultdict(lambda: defaultdict(int))

    for p, q, ww in zip(pre_e, post_e, w_e):
        fidx = fem_id_to_fidx.get(int(p))
        if fidx is None:
            continue
        males_pre = fidx_to_male_pre.get(int(fidx))
        if not males_pre:
            continue
        post_m = map_post(int(q), fem_id_to_row, fem, body_to_midx, type_to_midx)
        if post_m is None:
            continue
        w_int = int(ww)
        for midx in males_pre:
            slot = new_by_pre[int(midx)]
            prev = slot[int(post_m)]
            slot[int(post_m)] = min(65535, prev + w_int)
            if body_matched[midx]:
                body_mapped_edges += 1 if prev == 0 else 0
            elif type_matched[midx]:
                type_transplant_edges += 1 if prev == 0 else 0

    # Count mapped edges as unique (pre, post) after coalesce.
    body_mapped_edges = 0
    type_transplant_edges = 0
    for midx, posts in new_by_pre.items():
        n_e = len(posts)
        if body_matched[midx]:
            body_mapped_edges += n_e
        elif type_matched[midx]:
            type_transplant_edges += n_e

    # Rebuild CSR: keep rows whose outs are not dropped; append transplants.
    pre_out: list[np.ndarray] = []
    post_out: list[np.ndarray] = []
    w_out: list[np.ndarray] = []
    for i in range(n):
        a, b = int(indptr[i]), int(indptr[i + 1])
        if drop_outs[i]:
            posts = new_by_pre.get(i)
            if posts:
                pj = np.fromiter(posts.keys(), dtype=np.uint32, count=len(posts))
                wj = np.fromiter(posts.values(), dtype=np.uint16, count=len(posts))
                order = np.argsort(pj, kind="mergesort")
                pre_out.append(np.full(pj.size, i, np.uint32))
                post_out.append(pj[order])
                w_out.append(wj[order])
            continue
        if b > a:
            pre_out.append(np.full(b - a, i, np.uint32))
            post_out.append(indices[a:b])
            w_out.append(weight[a:b])

    if pre_out:
        pre = np.concatenate(pre_out)
        post = np.concatenate(post_out)
        w = np.concatenate(w_out)
    else:
        pre = np.zeros(0, np.uint32)
        post = np.zeros(0, np.uint32)
        w = np.zeros(0, np.uint16)

    order = np.argsort(pre, kind="mergesort")
    pre, post, w = pre[order], post[order], w[order]
    counts = np.bincount(pre, minlength=n).astype(np.uint32)
    new_indptr = np.zeros(n + 1, np.uint32)
    new_indptr[1:] = np.cumsum(counts)
    swap_nnz = int(post.shape[0])
    write_mcsr(OUT / "connectome_female_swap.bin", new_indptr, post, w)

    neurons_outs_removed = int(drop_outs.sum())
    sd_unmatched_kept = int(keep_sd.sum())
    ms_ablated = int(ablate.sum())

    summary = {
        "version": "v2",
        "policy": POLICY,
        "male_n": n,
        "male_nnz": male_nnz,
        "female_swap_nnz": swap_nnz,
        "body_mapped_edges": int(body_mapped_edges),
        "type_transplant_edges": int(type_transplant_edges),
        "neurons_outs_removed": neurons_outs_removed,
        "sd_unmatched_kept": sd_unmatched_kept,
        "ms_ablated": ms_ablated,
        "male_specific": ms_ablated,
        "n_body_matched_sd": int(body_matched.sum()),
        "n_type_matched_sd": int(type_matched.sum()),
        "connectome_out": "results/sex_swap/connectome_female_swap.bin",
    }
    (OUT / "transplant_summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))

    man_path = OUT / "graph_edit_manifest.json"
    if man_path.exists():
        man = json.loads(man_path.read_text())
        man.setdefault("controllers", {})
        man["controllers"]["female_swap"] = FEMALE_SWAP_NOTE
        man["banc_transplant"] = True
        man["banc_transplant_policy"] = POLICY
        man["female_swap_nnz"] = swap_nnz
        man_path.write_text(json.dumps(man))
        print("updated", man_path)
    print("wrote", OUT / "connectome_female_swap.bin")
    print("wrote", OUT / "transplant_summary.json")


if __name__ == "__main__":
    main()
