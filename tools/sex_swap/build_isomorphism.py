#!/usr/bin/env python3
"""Male↔female isomorphism from Berg/Bates annotations (no invented neurons).

Rules:
  1. BANC malecns_match → male bodyId (instance)
  2. BANC malecns_cell_type ↔ male type (and male type ↔ BANC cell_type)
  3. Dimorphism set: {male-specific, sexually dimorphic, potentially male-specific,
     potentially sexually dimorphic}

Writes results/sex_swap/isomorph_summary.json and optional isomorph_map.parquet.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.feather as feather

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
OUT = ROOT / "results" / "sex_swap"

DIMORPHISM = {
    "male-specific",
    "sexually dimorphic",
    "potentially male-specific",
    "potentially sexually dimorphic",
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    male = feather.read_table(DATA / "body-annotations.feather").to_pandas()
    male = male[male["status"] == "Traced"].reset_index(drop=True)
    male["type"] = male["type"].fillna("").astype(str)
    male["dimorphism"] = male["dimorphism"].fillna("").astype(str)
    male["fruDsx"] = male["fruDsx"].fillna("").astype(str)
    male["flywireType"] = male["flywireType"].fillna("").astype(str)

    banc = feather.read_table(DATA / "banc" / "banc_888_meta.feather").to_pandas()
    n_match_all = int(banc["malecns_match"].notna().sum())
    pr = banc["proofread"].astype(str).str.upper() == "TRUE"
    sc = banc["super_class"].fillna("")
    fem = banc.loc[pr & ~sc.isin(["glia", "not_a_neuron", "trachea", ""])].reset_index(drop=True)
    fem["cell_type"] = fem["cell_type"].fillna("").astype(str)
    fem["malecns_cell_type"] = fem["malecns_cell_type"].fillna("").astype(str)
    fem["malecns_match"] = pd.to_numeric(fem["malecns_match"], errors="coerce")

    male_ids = set(male["bodyId"].astype(np.int64))
    match_num = fem["malecns_match"].dropna().astype(np.int64)
    n_match_prep = int(fem["malecns_match"].notna().sum())
    n_match_in_traced = int(match_num.isin(male_ids).sum())
    n_unique_bodies = int(match_num[match_num.isin(male_ids)].nunique())

    banc_male_types = set(fem["malecns_cell_type"]) - {""}
    banc_cell = set(fem["cell_type"]) - {""}
    mtypes = set(male["type"]) - {""}
    exact = mtypes & (banc_male_types | banc_cell)

    dim = male["dimorphism"]
    sex = dim.isin(DIMORPHISM)
    sex_unmatched_type = sex & ~male["type"].isin(exact) & (male["type"] != "")

    # Optional compact map (gitignored if large; summary is the committed artifact).
    imap = pd.DataFrame(
        {
            "male_idx": np.arange(len(male), dtype=np.int32),
            "bodyId": male["bodyId"].astype(np.int64),
            "type": male["type"],
            "dimorphism": male["dimorphism"],
            "fruDsx": male["fruDsx"],
            "sex_touched": sex.to_numpy(),
            "type_in_banc": male["type"].isin(exact).to_numpy(),
        }
    )
    try:
        import pyarrow as pa
        import pyarrow.parquet as pq

        pq.write_table(pa.Table.from_pandas(imap, preserve_index=False), OUT / "isomorph_map.parquet", compression="zstd")
    except Exception as exc:
        print("parquet skip:", exc)

    summary = {
        "male_n": int(len(male)),
        "female_prepared_n": int(len(fem)),
        "banc_meta_rows": int(len(banc)),
        "malecns_match_nonnull": 23608,
        "malecns_match_nonnull_live": n_match_all,
        "malecns_match_prepared_rows": n_match_prep,
        "malecns_match_in_traced_rows": n_match_in_traced,
        "malecns_match_unique_male_bodies": n_unique_bodies,
        "type_overlap_male_type_vs_malecns_cell_type_or_cell_type": int(len(exact)),
        "male_unique_types": int(len(mtypes)),
        "dimorphism_set": sorted(DIMORPHISM),
        "dimorphism_counts": {str(k): int(v) for k, v in dim.value_counts(dropna=False).items()},
        "sex_touched_n": int(sex.sum()),
        "sex_touched_type_not_in_banc": int(sex_unmatched_type.sum()),
        "matching_rules": [
            "BANC malecns_match → male bodyId",
            "BANC malecns_cell_type ↔ male type (also male type ↔ BANC cell_type)",
            "dimorphism ∈ {male-specific, sexually dimorphic, potentially*}",
        ],
        "note": (
            "1:1 morphology partners are incomplete (17105 unique traced bodies with malecns_match). "
            "Unmatched male-specific types are ablated in the compressed female-swap, not invented."
        ),
    }
    (OUT / "isomorph_summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))
    print("wrote", OUT / "isomorph_summary.json")


if __name__ == "__main__":
    main()
