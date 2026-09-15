#!/usr/bin/env python3
"""Compressed sex-swap graph edits on the prepared male CSR (no new somas).

Controllers (same neurons.bin / NT / sensors / portable MN body):
  male         — intact outgoing
  iso_only     — zero ALL dimorphic outgoing (176325 edges)
  female_swap  — restore sexually-dimorphic outgoing; keep male-specific ablated
  shuffle_sex  — degree-preserving shuffle of dimorphic outgoing targets (per seed)

Writes results/sex_swap/graph_edit_manifest.json and refreshes params/sex_swap_v1.json
pool index lists from Berg type strings (P1a/P1b are empty in v1.0; P1 cluster is pC1_*).
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np
import pyarrow.feather as feather

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
WEB = ROOT / "web" / "data"
OUT = ROOT / "results" / "sex_swap"
PARAMS = ROOT / "params" / "sex_swap_v1.json"

DIMORPHISM = {
    "male-specific",
    "sexually dimorphic",
    "potentially male-specific",
    "potentially sexually dimorphic",
}

CLAIM = (
    "Sex-specific/dimorphic wiring alone (isomorphic weights, body, sensors fixed) "
    "is necessary and sufficient to flip closed-loop courtship vs aggression preference "
    "under matched scenes; isomorphic-only and shuffled sex-edges do not flip."
)
FALSIFIER = (
    "Intersectional silence of the twin-minimal sex-specific set "
    "(P1/aIPg/mAL/TN1/vPR6/pIP1 contributors) abolishes the predicted flip; "
    "restoring those nodes' output should restore it. If a specific DN→VNC MN "
    "weight change is implicated (pIP1/pIP10 → wing MN), test with intersectional "
    "silencing of that DN type."
)


def read_indptr(path: Path, n: int) -> np.ndarray:
    raw = path.read_bytes()
    if raw[:4] != b"MCSR":
        raise SystemExit("bad connectome.bin magic")
    hn, nnz = struct.unpack_from("<II", raw, 4)
    if hn != n:
        raise SystemExit(f"CSR n={hn} != annotations n={n}")
    return np.frombuffer(raw, np.uint32, n + 1, 12).copy(), int(nnz)


def idx_where(mask) -> list[int]:
    return [int(i) for i in np.flatnonzero(mask)]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    male = feather.read_table(DATA / "body-annotations.feather").to_pandas()
    male = male[male["status"] == "Traced"].reset_index(drop=True)
    n = len(male)
    dim = male["dimorphism"].fillna("").astype(str)
    typ = male["type"].fillna("").astype(str)
    fru = male["fruDsx"].fillna("").astype(str)

    male_specific = dim == "male-specific"
    sexually_dim = dim == "sexually dimorphic"
    potentially = dim.str.startswith("potentially")
    sex = dim.isin(DIMORPHISM)

    indptr, nnz = read_indptr(WEB / "connectome.bin", n)
    sex_idx = np.flatnonzero(sex.to_numpy())
    ms_idx = np.flatnonzero(male_specific.to_numpy())
    sd_idx = np.flatnonzero(sexually_dim.to_numpy())
    pot_idx = np.flatnonzero(potentially.to_numpy())

    def out_edges(idx: np.ndarray) -> int:
        return int((indptr[idx + 1] - indptr[idx]).sum()) if idx.size else 0

    n_sex_out = out_edges(sex_idx)
    n_ms_out = out_edges(ms_idx)
    n_sd_out = out_edges(sd_idx)

    pools = {
        "P1a": idx_where(typ == "P1a"),
        "P1b": idx_where(typ == "P1b"),
        "pC1": idx_where(typ.str.startswith("pC1")),
        "TN1": idx_where(typ.str.startswith("TN1")),
        "vPR6": idx_where(typ == "vPR6"),
        "pIP1": idx_where(typ == "pIP1"),
        "pIP10": idx_where(typ == "pIP10"),
        "mAL_m1": idx_where(typ == "mAL_m1"),
        "mAL_m8": idx_where(typ == "mAL_m8"),
        "aSP10": idx_where(typ.str.startswith("aSP10")),
        "aIPg": idx_where(typ.str.startswith("aIPg")),
        "aIPg1": idx_where(typ == "aIPg1"),
        "aIPg2": idx_where(typ == "aIPg2"),
        "aIPg3": idx_where(typ == "aIPg3"),
        "aIPg4": idx_where(typ == "aIPg4"),
        "aIPg5": idx_where(typ == "aIPg5"),
        "aIPg6": idx_where(typ == "aIPg6"),
        "aIPg7": idx_where(typ == "aIPg7"),
        "fru_high": idx_where(fru.str.contains("fru_high")),
    }
    courtship = sorted(
        set(pools["P1a"])
        | set(pools["P1b"])
        | set(pools["pC1"])
        | set(pools["TN1"])
        | set(pools["vPR6"])
        | set(pools["pIP1"])
        | set(pools["mAL_m1"])
        | set(pools["mAL_m8"])
        | set(pools["aSP10"])
    )
    aggression = sorted(set().union(*[pools[f"aIPg{k}"] for k in range(1, 8)]) | set(pools["aIPg"]))
    pools["courtship_core"] = courtship
    pools["aggression_core"] = aggression

    manifest = {
        "n": n,
        "nnz": nnz,
        "minWeight": 5,
        "dimorphism_set": sorted(DIMORPHISM),
        "n_dimorphic": int(sex.sum()),
        "n_dimorphic_out_edges": n_sex_out,
        "n_male_specific": int(male_specific.sum()),
        "n_male_specific_out_edges": n_ms_out,
        "n_sexually_dimorphic": int(sexually_dim.sum()),
        "n_sexually_dimorphic_out_edges": n_sd_out,
        "n_potentially": int(potentially.sum()),
        "controllers": {
            "male": "no edits; full prepared CSR",
            "iso_only": "edgeScale=0 on outgoing of all dimorphic idx (isomorphic-only)",
            "female_swap": (
                "v2 BANC transplant: ablate male-specific (+potentially MS) outs; "
                "replace body-matched (malecns_match) and type-matched (malecns_cell_type) "
                "dimorphic outs with BANC-mapped edges; KEEP unmatched sexually-dimorphic male outs. "
                "CSR: results/sex_swap/connectome_female_swap.bin (rebuild via build_banc_transplant.py)"
            ),
            "shuffle_sex": "shuffle post indices of dimorphic outgoing edges; preserve out-degree; per seed",
        },
        "male_specific_idx": ms_idx.astype(int).tolist(),
        "sexually_dimorphic_idx": sd_idx.astype(int).tolist(),
        "potentially_male_specific_idx": idx_where(dim == "potentially male-specific"),
        "potentially_sexually_dimorphic_idx": idx_where(dim == "potentially sexually dimorphic"),
        "dimorphic_idx": sex_idx.astype(int).tolist(),
        "pool_counts": {k: len(v) for k, v in pools.items()},
        "note_P1": "Berg v1.0 has no type==P1a/P1b (n=0); P1 cluster is typed pC1_* (n=156). TN1* n=35, vPR6 n=8, aIPg3 n=0.",
    }
    (OUT / "graph_edit_manifest.json").write_text(json.dumps(manifest))
    print(
        f"dimorphic neurons={manifest['n_dimorphic']} out-edges={manifest['n_dimorphic_out_edges']} "
        f"male-specific={manifest['n_male_specific']} sexually-dimorphic={manifest['n_sexually_dimorphic']}"
    )

    params = {
        "name": "CVA-SST",
        "version": "v1",
        "claim": CLAIM,
        "claim_status": "FAILED_NO_SIGN_FLIP",
        "falsifier": (
            "Not applicable: primary claim failed (no CI↔AI sign flip). "
            "No silencing falsifier is offered for a failed flip."
        ),
        "graph_seed": 20260915,
        "n_seeds_default": 16,
        "seeds_file": "params/sex_swap_seeds.txt",
        "embodiment": (
            "portable MN→{v, omega} cube chassis (web/controller/portable.js). "
            "NeuroMechFly plant is not closed in this experiment."
        ),
        "lif": {
            "dt": 0.5,
            "wScale": 0.012,
            "inhibGain": 2.15,
            "stimAmp": 0.11,
        },
        "drive_hz": {"vision": 48, "smell": 42, "courtship": 38, "touch": 32},
        "scene": {
            "ticks": 48,
            "stepsPerTick": 8,
            "dtBody": 0.05,
            "arenaR": 11,
            "femaleCue": {"x": -2.4, "z": 6.0},
            "maleCue": {"x": 2.4, "z": 6.0},
            "spawn": {"x": 0, "z": 0, "heading": 0},
        },
        "pools": {
            "courtship": ["P1a", "P1b", "pC1", "TN1", "vPR6", "pIP1", "mAL_m1", "mAL_m8", "aSP10"],
            "aggression": ["aIPg1", "aIPg2", "aIPg3", "aIPg4", "aIPg5", "aIPg6", "aIPg7"],
            "counts": {k: len(v) for k, v in pools.items()},
        },
        "controllers": ["male", "iso_only", "female_swap", "shuffle_sex"],
        "compressed_swap": False,
        "banc_transplant": True,
    }
    PARAMS.parent.mkdir(parents=True, exist_ok=True)
    PARAMS.write_text(json.dumps(params, indent=2))
    # Pool index file used by the assay (small JSON).
    (OUT / "cva_assay_pools.json").write_text(json.dumps({"n": n, "counts": {k: len(v) for k, v in pools.items()}, "pools": pools}))
    print("wrote", OUT / "graph_edit_manifest.json")
    print("wrote", PARAMS)


if __name__ == "__main__":
    main()
