#!/usr/bin/env python3
"""Index hDeltaH/A/I/G (+ PFL3, EPG) in neurons.bin order.

Requires data/body-annotations.feather (gitignored). Writes params/hdelta/pools.json.
Does not invent neurons: type strings from Berg et al. Male CNS v1.0, status==Traced.
"""
from __future__ import annotations

import json
import re
import struct
from pathlib import Path

import pyarrow.feather as feather

ROOT = Path(__file__).resolve().parents[2]
ANN = ROOT / "data" / "body-annotations.feather"
CSR = ROOT / "web" / "data" / "connectome.bin"
OUT = ROOT / "params" / "hdelta" / "pools.json"

PLASTIC_TYPES = ("hDeltaH", "hDeltaA", "hDeltaI", "hDeltaG")
COL_RE = re.compile(r"_C(\d+)")
EPG_RE = re.compile(r"_(?:L|R)(\d+)")


def mcsr_header(path: Path) -> dict:
    raw = path.read_bytes()[:12]
    magic = raw[:4].decode("ascii", errors="replace")
    n, nnz = struct.unpack_from("<II", raw, 4)
    return {"magic": magic, "n": int(n), "nnz": int(nnz)}


def column_of(instance: str, typ: str | None = None) -> int | None:
    inst = str(instance)
    m = COL_RE.search(inst)
    if m:
        return int(m.group(1))
    if typ == "EPG":
        m = EPG_RE.search(inst)
        if m:
            return int(m.group(1))
    return None


def take(df, mask) -> list[dict]:
    rows = []
    sub = df.loc[mask]
    for idx, row in sub.iterrows():
        inst = str(row.get("instance") or "")
        rows.append({
            "idx": int(idx),
            "bodyId": int(row["bodyId"]),
            "type": str(row["type"]),
            "instance": inst,
            "side": str(row.get("somaSide") or ""),
            "column": column_of(inst, str(row.get("type") or "")),
        })
    return rows


def main() -> None:
    if not ANN.exists():
        raise SystemExit(f"missing {ANN} — curl the Male CNS annotations feather (see tools/sex_swap/download_manifest.json)")
    hdr = mcsr_header(CSR)
    if hdr["magic"] != "MCSR":
        raise SystemExit(f"bad CSR magic {hdr['magic']}")

    df = feather.read_table(ANN).to_pandas()
    df = df[df["status"] == "Traced"].reset_index(drop=True)
    if len(df) != hdr["n"]:
        raise SystemExit(f"traced n={len(df)} != CSR n={hdr['n']}")

    typ = df["type"].fillna("").astype(str)
    cells = {t: take(df, typ == t) for t in PLASTIC_TYPES}
    pfl3 = take(df, typ == "PFL3")
    epg = take(df, typ == "EPG")
    plastic_ids = [c["idx"] for t in PLASTIC_TYPES for c in cells[t]]

    import numpy as np
    indptr = np.fromfile(CSR, dtype=np.uint32, count=hdr["n"] + 1, offset=12)
    n_out = int(sum(int(indptr[i + 1] - indptr[i]) for i in plastic_ids))

    payload = {
        "dataset": "Male CNS v1.0",
        "n": hdr["n"],
        "nnz": hdr["nnz"],
        "filter": "status==Traced; type exact match; no invented cells",
        "plastic_types": list(PLASTIC_TYPES),
        "counts": {t: len(cells[t]) for t in PLASTIC_TYPES},
        "n_plastic": len(plastic_ids),
        "n_plastic_out_edges": n_out,
        "n_PFL3": len(pfl3),
        "n_EPG": len(epg),
        "cells": cells,
        "plastic_ids": plastic_ids,
        "PFL3": pfl3,
        "PFL3_L": [c["idx"] for c in pfl3 if c["side"] == "L"],
        "PFL3_R": [c["idx"] for c in pfl3 if c["side"] == "R"],
        "EPG_cells": epg,
        "EPG": [c["idx"] for c in epg],
        "EPG_L": [c["idx"] for c in epg if c["side"] == "L"],
        "EPG_R": [c["idx"] for c in epg if c["side"] == "R"],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload))
    print(f"wrote {OUT.relative_to(ROOT)}")
    print(f"  plastic {payload['n_plastic']} cells, {n_out} out-edges")
    for t in PLASTIC_TYPES:
        print(f"  {t:10s} {payload['counts'][t]:3d}")
    print(f"  PFL3 {len(pfl3)} (L {len(payload['PFL3_L'])} R {len(payload['PFL3_R'])})")
    print(f"  EPG  {len(epg)}")


if __name__ == "__main__":
    main()
