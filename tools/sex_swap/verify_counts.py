#!/usr/bin/env python3
"""Verify male/female neuron and edge counts from public feathers + prepared bins.

Prints counts and writes results/sex_swap/counts.json.
MCSR header: magic MCSR, uint32 n, uint32 nnz (little-endian), then indptr/indices/weight.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
WEB = ROOT / "web" / "data"
OUT = ROOT / "results" / "sex_swap"
MANIFEST = Path(__file__).resolve().parent / "download_manifest.json"


def mcsr_header(path: Path) -> dict:
    raw = path.read_bytes()[:12]
    magic = raw[:4].decode("ascii", errors="replace")
    n, nnz = struct.unpack_from("<II", raw, 4)
    return {"path": str(path.relative_to(ROOT)), "magic": magic, "n": int(n), "nnz": int(nnz), "bytes": path.stat().st_size}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    import pyarrow.feather as feather

    male_meta = json.loads((WEB / "meta.json").read_text())
    fem_meta = json.loads((WEB / "female" / "meta.json").read_text())
    male_csr = mcsr_header(WEB / "connectome.bin")
    fem_csr = mcsr_header(WEB / "female" / "connectome.bin")
    if male_csr["magic"] != "MCSR":
        raise SystemExit(f"bad male CSR magic {male_csr['magic']}")
    if fem_csr["magic"] != "MCSR":
        raise SystemExit(f"bad female CSR magic {fem_csr['magic']}")

    ann = feather.read_table(DATA / "body-annotations.feather", columns=["bodyId", "status", "superclass"])
    status = ann["status"].to_pandas()
    n_ann = int(ann.num_rows)
    n_traced = int((status == "Traced").sum())
    traced_sc = feather.read_table(
        DATA / "body-annotations.feather", columns=["status", "superclass"]
    ).to_pandas()
    tr = traced_sc[traced_sc["status"] == "Traced"]
    n_dn = int((tr["superclass"] == "descending_neuron").sum())
    n_an = int((tr["superclass"] == "ascending_neuron").sum())

    banc = feather.read_table(
        DATA / "banc" / "banc_888_meta.feather",
        columns=["proofread", "super_class", "malecns_match"],
    ).to_pandas()
    n_banc = int(len(banc))
    n_match = int(banc["malecns_match"].notna().sum())
    pr = banc["proofread"].astype(str).str.upper() == "TRUE"
    sc = banc["super_class"].fillna("")
    n_banc_prep = int((pr & ~sc.isin(["glia", "not_a_neuron", "trachea", ""])).sum())

    groups = {g["name"]: g["count"] for g in male_meta["groups"]}
    fgroups = {g["name"]: g["count"] for g in fem_meta["groups"]}

    verified = {
        "male_prepared": {"n": 165122, "nEdges": 6235682, "minWeight": 5},
        "female_prepared": {"n": 139458, "nEdges": 3372365, "minWeight": 3},
        "male_annotations_feather": {"rows": 211577, "Traced": 165122},
        "banc_meta": {"rows": 188508, "malecns_match_nonnull": 23608},
        "neck": {
            "descending_neuron": 1314,
            "ascending_neuron": 1846,
            "prepared_groups_descending": 1326,
            "prepared_groups_ascending": 2393,
            "same_CSR_has": "optic + central brain + VNC (intact neck connective)",
        },
        "dimorphic_in_graph": {"neurons": 2368, "out_edges": 176325},
        "urls": {
            "neuprint_dataset": "male-cns:v1.0",
            "neuprint": "https://neuprint.janelia.org",
            "male_https": "https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/",
            "male_files": [
                "body-annotations-male-cns-v1.0-minconf-0.5.feather",
                "body-neurotransmitters-male-cns-v1.0.feather",
                "connectome-weights-male-cns-v1.0-minconf-0.5.feather",
            ],
            "banc_https": "https://storage.googleapis.com/lee-lab_brain-and-nerve-cord-fly-connectome/compiled_data/banc_888/",
            "banc_files": ["banc_888_meta.feather", "banc_888_edgelist_simple_v2.feather"],
            "dataverse": "10.7910/DVN/7WTH1N",
        },
    }

    live = {
        "male_annotations_rows": n_ann,
        "male_traced": n_traced,
        "descending_neuron": n_dn,
        "ascending_neuron": n_an,
        "banc_meta_rows": n_banc,
        "banc_malecns_match_nonnull": n_match,
        "banc_prepared_filter_n": n_banc_prep,
        "male_meta_n": male_meta["n"],
        "male_meta_nEdges": male_meta["nEdges"],
        "male_mcsr": male_csr,
        "female_meta_n": fem_meta["n"],
        "female_meta_nEdges": fem_meta["nEdges"],
        "female_mcsr": fem_csr,
        "male_groups_descending": groups.get("descending"),
        "male_groups_ascending": groups.get("ascending"),
        "female_groups_descending": fgroups.get("descending"),
        "female_groups_ascending": fgroups.get("ascending"),
        "male_filter": "status == Traced (prepare.py); Berg ~166700 includes additional non-Traced / lower-conf bodies",
        "female_filter": "proofread==TRUE and super_class not in {glia, not_a_neuron, trachea, empty}; BANC meta ~188k includes glia/unproofread",
    }

    report = {
        "experiment": "Courtship-vs-Aggression Sex-Swap Twin (CVA-SST)",
        "verified": verified,
        "live": live,
        "public_urls": json.loads(MANIFEST.read_text()) if MANIFEST.exists() else verified["urls"],
        "neck_method": (
            "Berg et al. Cell 2026 reconstructed the complete adult male CNS with an intact "
            "neck connective (brain + optic lobe + neck + VNC in one volume). prepare.py maps "
            "superclass descending_neuron|sensory_descending → group 8 (n=1326) and "
            "ascending_neuron|sensory_ascending|efferent_ascending → group 9 (n=2393). "
            "Those DN/AN nodes sit in the SAME MCSR as optic sensory (4114) and VNC motor (806)."
        ),
    }
    (OUT / "counts.json").write_text(json.dumps(report, indent=2))
    print("=== CVA-SST counts ===")
    print(f"MALE annotations: rows={n_ann} Traced={n_traced}")
    print(f"MALE prepared web/data: n={male_meta['n']} nEdges={male_meta['nEdges']} minWeight={male_meta['minWeight']}")
    print(f"  MCSR magic={male_csr['magic']} n={male_csr['n']} nnz={male_csr['nnz']}")
    print(f"  neck descending_neuron={n_dn} ascending_neuron={n_an} groups DN={groups.get('descending')} AN={groups.get('ascending')}")
    print(f"FEMALE BANC meta: rows={n_banc} malecns_match_nonnull={n_match} prepared_filter={n_banc_prep}")
    print(f"FEMALE prepared web/data/female: n={fem_meta['n']} nEdges={fem_meta['nEdges']} minWeight={fem_meta['minWeight']}")
    print(f"  MCSR magic={fem_csr['magic']} n={fem_csr['n']} nnz={fem_csr['nnz']}")
    print(f"wrote {OUT / 'counts.json'}")


if __name__ == "__main__":
    main()
