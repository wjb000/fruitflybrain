#!/usr/bin/env python3
"""Index motor / joint / proprio pools in the same order as neurons.bin.

Male: FlyEM body-annotations (status == Traced), matching prepare.py.
Female: BANC proofread neurons, matching prepare_banc.py.

Joint pools follow NeuroMechFly's 7 DoF × 6 legs: coxa yaw/roll/pitch,
trochanter-femur, tibia, tarsus — antagonist motor neurons from the
published type names (promotor/remotor, flexor/extensor, depressor/levator).
"""

from __future__ import annotations

import json
import os

import pandas as pd
import pyarrow.feather as feather

ROOT = os.path.dirname(os.path.abspath(__file__))

LEGS = [
    ("L1", "T1", "L", "left", "front_leg"),
    ("R1", "T1", "R", "right", "front_leg"),
    ("L2", "T2", "L", "left", "middle_leg"),
    ("R2", "T2", "R", "right", "middle_leg"),
    ("L3", "T3", "L", "left", "hind_leg"),
    ("R3", "T3", "R", "right", "hind_leg"),
]

# Male CNS type strings (Berg et al. / MANC motor names).
MALE_MUSCLE = {
    "coxaProm": r"Tergopleural/Pleural promotor|Tergopleural",
    "coxaRem": r"Pleural remotor/abductor",
    "coxaRotA": r"Sternal anterior rotator",
    "coxaRotP": r"Sternal posterior rotator",
    "coxaAdd": r"Sternal adductor",
    "trFlex": r"Tr flexor MN|Acc\. tr flexor",
    "trExt": r"Tr extensor MN|Sternotrochanter MN|Tergotr",
    "feRed": r"Fe reductor|ltm2-femur",
    "tiFlex": r"Ti flexor MN|Acc\. ti flexor",
    "tiExt": r"Ti extensor MN|ltm1-tibia",
    "taDep": r"Ta depressor",
    "taLev": r"Ta levator",
}

# BANC cell_type / peripheral_target_type (Bates et al.).
BANC_MUSCLE = {
    "coxaProm": r"promotor",
    "coxaRem": r"remotor|abductor",
    "coxaRotA": r"anterior_rotator",
    "coxaRotP": r"posterior_rotator",
    "coxaAdd": r"adductor",
    "trFlex": r"trochanter_flexor|accessory_trochanter",
    "trExt": r"trochanter_extensor|sternotrochanter|tergotrochanter",
    "feRed": r"femur_reductor|long_tendon",
    "tiFlex": r"tibia_flexor|accessory_tibia_flexor",
    "tiExt": r"tibia_extensor|FETi|SETi",
    "taDep": r"tarsus_depressor",
    "taLev": r"tarsus_levator",
}

T1_NERVES = {"ProLN", "ProCN", "ProAN", "DProN", "VProN", "PrN"}
T2_NERVES = {"MesoLN"}
T3_NERVES = {"MetaLN", "DMetaN"}

OPTIC_KEYS = [
    "R16", "R7", "R8", "L1", "L2", "L3",
    "T4a", "T4b", "T4c", "T4d",
    "T5a", "T5b", "T5c", "T5d",
    "HS", "VS",
]
ODOR_KEYS = ["foodORN", "pherORN", "co2ORN", "JO", "aversiveORN", "sweet", "bitter"]
CLOCK_KEYS = ["sLNv", "lLNv", "LNd", "DN1a", "DN1p", "DAN", "OA", "HT", "pep"]


def proprio_stim(pools: dict) -> dict:
    keys = [
        "hygro", "proprio", "chordotonal", "hairplate", "campaniform",
        "choT1", "choT2", "choT3", "hpT1", "hpT2", "hpT3",
        "csaT1", "csaT2", "csaT3", "tactT1", "tactT2", "tactT3",
        "propT1", "propT2", "propT3",
        "choT1L", "choT1R", "choT2L", "choT2R", "choT3L", "choT3R",
        "tactT1L", "tactT1R", "tactT2L", "tactT2R", "tactT3L", "tactT3R",
    ]
    out = {}
    for k in keys:
        src = "hygrosensory" if k == "hygro" else k
        if src in pools:
            out[k] = pools[src]
    for k in OPTIC_KEYS + ODOR_KEYS + CLOCK_KEYS:
        if k in pools:
            out[k] = pools[k]
    return out


def idx_series(mask) -> list[int]:
    return [int(i) for i in mask.to_numpy().nonzero()[0]]


def dump(path: str, n: int, pools: dict) -> None:
    counts = {k: len(v) for k, v in pools.items()}
    with open(path, "w") as f:
        json.dump({"n": int(n), "counts": counts, "pools": pools}, f)
    print("wrote", path)
    for k, c in sorted(counts.items(), key=lambda kv: -kv[1]):
        if c:
            print(f"  {k:16s} {c:5d}")


def merge_stim(path: str, extra: dict) -> None:
    with open(path) as f:
        stim = json.load(f)
    stim.update(extra)
    with open(path, "w") as f:
        json.dump(stim, f)
    print("merged stim", path)
    for k, v in extra.items():
        print(f"  {k:16s} {len(v):5d}")


def export_male() -> None:
    ann = feather.read_table(os.path.join(ROOT, "data", "body-annotations.feather")).to_pandas()
    df = ann[ann["status"] == "Traced"].reset_index(drop=True)
    typ = df["type"].fillna("").astype(str)
    inst = df["instance"].fillna("").astype(str)
    side = df["somaSide"].fillna("").astype(str)
    super_c = df["superclass"].fillna("").astype(str)
    nerve = df["exitNerve"].fillna("").astype(str)
    neu = df["somaNeuromere"].fillna("").astype(str)
    fru = df["fruDsx"].fillna("").astype(str)
    recv = df["receptorType"].fillna("").astype(str)
    cls = df["class"].fillna("").astype(str)
    subclass = df["subclass"].fillna("").astype(str)
    entry = df["entryNerve"].fillna("").astype(str)
    vnc_mn = super_c == "vnc_motor"

    def take(mask):
        return idx_series(mask)

    pools = {
        "T1L": take(vnc_mn & (neu == "T1") & (side == "L")),
        "T1R": take(vnc_mn & (neu == "T1") & (side == "R")),
        "T2L": take(vnc_mn & (neu == "T2") & (side == "L")),
        "T2R": take(vnc_mn & (neu == "T2") & (side == "R")),
        "T3L": take(vnc_mn & (neu == "T3") & (side == "L")),
        "T3R": take(vnc_mn & (neu == "T3") & (side == "R")),
        "abdomen": take(vnc_mn & neu.str.startswith("A")),
        "DLM": take(typ.str.contains("DLM")),
        "DVM": take(typ.str.contains("DVM")),
        "ADMN": take(nerve == "ADMN"),
        "MN9": take(typ == "MN9"),
        "proboscis": take(nerve == "PhN"),
        "neck": take(nerve == "CvN"),
        "DNa": take(typ.str.match(r"DNa")),
        "DNg02": take(typ.str.startswith("DNg02")),
        "DNp01": take(typ == "DNp01"),
        "DNp": take(typ.str.startswith("DNp")),
        "aIPg": take(typ.str.startswith("aIPg")),
        "pIP1": take(typ == "pIP1"),
        "fru": take(fru.str.contains("fru_high")),
        "ppk23": take(recv.str.contains("ppk23")),
        "ppk25": take(recv.str.contains("ppk25")),
        "IR52b": take(recv.str.contains("IR52b")),
        "hygrosensory": take(cls == "hygrosensory"),
    }

    inst_L = inst.str.endswith("_L") | (side == "L")
    inst_R = inst.str.endswith("_R") | (side == "R")
    nerve_T = {
        "T1": entry.isin(T1_NERVES),
        "T2": entry.isin(T2_NERVES),
        "T3": entry.isin(T3_NERVES),
    }
    side_of = {"L": inst_L, "R": inst_R}

    for leg, seg, lr, _left, _part in LEGS:
        seg_m = vnc_mn & (neu == seg) & (side == lr)
        for muscle, pat in MALE_MUSCLE.items():
            pools[f"{leg}_{muscle}"] = take(seg_m & typ.str.contains(pat))

    pools["R16"] = take(typ == "R1-R6")
    pools["R7"] = take(typ.str.startswith("R7"))
    pools["R8"] = take(typ.str.startswith("R8"))
    pools["L1"] = take(typ == "L1")
    pools["L2"] = take(typ == "L2")
    pools["L3"] = take(typ == "L3")
    for d in "abcd":
        pools[f"T4{d}"] = take(typ == f"T4{d}")
        pools[f"T5{d}"] = take(typ == f"T5{d}")
    pools["HS"] = take(typ.str.match(r"^HS"))
    pools["VS"] = take(typ.str.match(r"^VS"))
    pools["foodORN"] = take(typ.str.match(
        r"^ORN_(DM1|DM2|DM4|VA2|VM2|VM5d|VM7|DM3|DM6|VM3|VA6|VM4|VC3|VC4|DM5)"
    ))
    pools["pherORN"] = take(typ.str.match(r"^ORN_(DA1|VA1d|VA1v|DL3|DL4)"))
    pools["co2ORN"] = take(typ.str.match(r"^ORN_V$"))
    pools["JO"] = take(typ.str.startswith("JO"))
    pools["aversiveORN"] = take(typ.str.match(r"^ORN_(DM5|DL5|DA2|DL1)$"))
    pools["sweet"] = take(typ.str.contains(r"claw_tpGRN|dorsal_tpGRN|LgLG1|LgLG2"))
    pools["bitter"] = take(typ.str.contains(r"^LB3|LgLG4|LgLG7|LgLG8"))
    pools["sLNv"] = take(typ == "s-LNv")
    pools["lLNv"] = take(typ == "l-LNv")
    pools["LNd"] = take(typ.str.startswith("LNd"))
    pools["DN1a"] = take(typ == "DN1a")
    pools["DN1p"] = take(typ.str.startswith("DN1p"))
    pools["DAN"] = take(cls == "DAN")
    pools["OA"] = take(typ.str.startswith("OA-"))
    pools["HT"] = take(typ.str.startswith("5-HT"))
    pools["pep"] = take(typ.str.match(r"^(DH44|LK|ITP|AstA|NPF)"))

    # Proprio / tactile by neuromere (entry nerve). L/R only when instance encodes it.
    cho = subclass == "chordotonal organ"
    hp = subclass == "hair plate"
    csa = subclass == "campaniform sensilla"
    tact = cls == "mechanosensory_tactile"
    prop = cls == "mechanosensory_proprioceptive"
    pools["proprio"] = take(prop)
    pools["chordotonal"] = take(cho)
    pools["hairplate"] = take(hp)
    pools["campaniform"] = take(csa)
    for seg, nmask in nerve_T.items():
        pools[f"cho{seg}"] = take(cho & nmask)
        pools[f"hp{seg}"] = take(hp & nmask)
        pools[f"csa{seg}"] = take(csa & nmask)
        pools[f"tact{seg}"] = take(tact & nmask)
        pools[f"prop{seg}"] = take(prop & nmask)
        for lr, smask in side_of.items():
            pools[f"cho{seg}{lr}"] = take(cho & nmask & smask)
            pools[f"tact{seg}{lr}"] = take(tact & nmask & smask)

    dump(os.path.join(ROOT, "web", "data", "effectors.json"), len(df), pools)
    merge_stim(os.path.join(ROOT, "web", "data", "stim.json"), proprio_stim(pools))


def export_female() -> None:
    meta = feather.read_table(os.path.join(ROOT, "data", "banc", "banc_888_meta.feather")).to_pandas()
    pr = meta["proofread"].astype(str).str.upper() == "TRUE"
    sc = meta["super_class"].fillna("")
    keep = pr & ~sc.isin(["glia", "not_a_neuron", "trachea", ""])
    df = meta.loc[keep].reset_index(drop=True)

    side = df["side"].fillna("").astype(str)
    typ = df["cell_type"].fillna("").astype(str)
    manc = df["malecns_cell_type"].fillna("").astype(str) if "malecns_cell_type" in df.columns else typ
    pt = df["peripheral_target_type"].fillna("").astype(str)
    name = (typ + " " + manc + " " + pt)
    neu = df["neuromere"].fillna("").astype(str)
    beff = df["body_part_effector"].fillna("").astype(str)
    bsens = df["body_part_sensory"].fillna("").astype(str)
    scv = df["super_class"].fillna("").astype(str)
    cfun = df["cell_function"].fillna("").astype(str)
    cclass = df["cell_class"].fillna("").astype(str)
    det = df["cell_function_detailed"].fillna("").astype(str) if "cell_function_detailed" in df.columns else cfun

    def take(mask):
        return idx_series(mask)

    motorish = (scv == "motor") | (cfun == "leg_motor") | beff.isin(["front_leg", "middle_leg", "hind_leg"])

    pools = {
        "T1L": take((neu == "T1") & (side == "left") & ((scv == "motor") | (cfun == "leg_motor") | (beff == "front_leg"))),
        "T1R": take((neu == "T1") & (side == "right") & ((scv == "motor") | (cfun == "leg_motor") | (beff == "front_leg"))),
        "T2L": take((neu == "T2") & (side == "left") & ((scv == "motor") | (cfun == "leg_motor") | (beff == "middle_leg"))),
        "T2R": take((neu == "T2") & (side == "right") & ((scv == "motor") | (cfun == "leg_motor") | (beff == "middle_leg"))),
        "T3L": take((neu == "T3") & (side == "left") & ((scv == "motor") | (cfun == "leg_motor") | (beff == "hind_leg"))),
        "T3R": take((neu == "T3") & (side == "right") & ((scv == "motor") | (cfun == "leg_motor") | (beff == "hind_leg"))),
        "abdomen": take(beff == "abdomen"),
        "DLM": take(typ.str.contains("DLM")),
        "DVM": take(typ.str.contains("DVM")),
        "ADMN": take(beff == "wing"),
        "MN9": take(typ == "MN9"),
        "proboscis": take((beff == "proboscis") | (cfun == "proboscis_motor") | (cfun == "pharynx_motor")),
        "neck": take((beff == "neck") | (cfun == "neck_motor")),
        "DNa": take(typ.str.match(r"DNa")),
        "DNg02": take(typ.str.startswith("DNg02")),
        "DNp01": take(typ == "DNp01"),
        "DNp": take(typ.str.startswith("DNp")),
        "aIPg": take(typ.str.startswith("aIPg")),
        "pIP1": take(typ == "pIP1"),
        "fru": take(df["sexually_dimorphic"] == "female-specific"),
        "ppk23": take((bsens == "front_leg") | (bsens == "labellum")),
        "hygrosensory": take(cfun == "hygrosensory"),
    }
    if len(pools["T1L"]) + len(pools["T1R"]) < 20:
        pools["T1L"] = take((beff == "front_leg") & (side == "left"))
        pools["T1R"] = take((beff == "front_leg") & (side == "right"))
        pools["T2L"] = take((beff == "middle_leg") & (side == "left"))
        pools["T2R"] = take((beff == "middle_leg") & (side == "right"))
        pools["T3L"] = take((beff == "hind_leg") & (side == "left"))
        pools["T3R"] = take((beff == "hind_leg") & (side == "right"))

    for leg, seg, lr, side_name, part in LEGS:
        seg_m = motorish & (neu == seg) & (side == side_name)
        for muscle, pat in BANC_MUSCLE.items():
            pools[f"{leg}_{muscle}"] = take(seg_m & name.str.contains(pat, case=False))

    photo = cclass == "photoreceptor_neuron"
    pools["R16"] = take(typ.str.match(r"^R[1-6]($|[^0-9])") | ((cfun == "visual_achromatic") & photo))
    pools["R7"] = take(typ.str.startswith("R7") | (photo & typ.str.contains("R7")))
    pools["R8"] = take(typ.str.startswith("R8") | (photo & typ.str.contains("R8")))
    if not pools["R7"] and not pools["R8"]:
        pools["R7"] = take(photo)
    pools["L1"] = take(typ == "L1")
    pools["L2"] = take(typ == "L2")
    pools["L3"] = take(typ == "L3")
    for d in "abcd":
        pools[f"T4{d}"] = take(typ == f"T4{d}")
        pools[f"T5{d}"] = take(typ == f"T5{d}")
    pools["HS"] = take(typ.str.match(r"^HS"))
    pools["VS"] = take(typ.str.match(r"^VS"))
    pools["foodORN"] = take(det.str.contains(
        r"yeasty_volatile|decaying_fruit_volatile|fruity_volatile|alcoholic_fermentation_volatile"
    ))
    pools["pherORN"] = take(det.str.contains("pheromone_volatile"))
    pools["co2ORN"] = take(det.str.contains("carbon_dioxide"))
    pools["JO"] = take((cfun == "auditory") | ((cclass == "chordotonal_organ_neuron") & bsens.str.contains("antenna")))
    pools["aversiveORN"] = take(det.str.contains("aversive_volatile"))
    pools["sweet"] = take(det.str.contains(r"sugar|Gr5a|Gr64f", case=False))
    pools["bitter"] = take(det.str.contains(r"bitter|Gr66a|Gr33a", case=False))
    pools["sLNv"] = take(typ.str.startswith("s-LNv"))
    pools["lLNv"] = take(typ.str.startswith("l-LNv"))
    pools["LNd"] = take(typ.str.startswith("LNd"))
    pools["DN1a"] = take(typ.str.startswith("DN1a"))
    pools["DN1p"] = take(typ.str.startswith("DN1p"))
    pools["DAN"] = take(typ.str.match(r"^(PAM|PPL|PPM)"))
    pools["OA"] = take(typ.str.startswith("OA-"))
    pools["HT"] = take(typ.str.startswith("5-HT"))
    npep = df["neuropeptide_verified"].fillna("").astype(str) if "neuropeptide_verified" in df.columns else det
    pools["pep"] = take(
        npep.str.contains(r"Dh44|AstA|ITP", case=False)
        | npep.str.contains(r"(?:^|,)Lk(?:,|$)", case=False)
        | typ.str.contains(r"DH44|ITP|AstA")
    )

    cho = cclass == "chordotonal_organ_neuron"
    csa = (cfun == "proprioception") & (
        cclass.str.contains("campaniform") | pt.str.contains("campaniform") | det.str.contains("mechanical_strain")
    )
    hp = pt.str.contains("hair_plate")
    tact = (cfun == "tactile") | (cclass == "bristle_neuron")
    prop = cfun == "proprioception"
    pools["proprio"] = take(prop)
    pools["chordotonal"] = take(cho)
    pools["hairplate"] = take(hp)
    pools["campaniform"] = take(csa | (pt.str.contains("campaniform")))
    part_of = {"T1": "front_leg", "T2": "middle_leg", "T3": "hind_leg"}
    for seg, part in part_of.items():
        on_leg = bsens.str.contains(part)
        pools[f"cho{seg}"] = take(cho & on_leg)
        pools[f"hp{seg}"] = take(hp & on_leg)
        pools[f"csa{seg}"] = take((csa | pt.str.contains("campaniform")) & on_leg)
        pools[f"tact{seg}"] = take(tact & on_leg)
        pools[f"prop{seg}"] = take(prop & on_leg)
        for lr, side_name in (("L", "left"), ("R", "right")):
            sm = side == side_name
            pools[f"cho{seg}{lr}"] = take(cho & on_leg & sm)
            pools[f"tact{seg}{lr}"] = take(tact & on_leg & sm)

    dump(os.path.join(ROOT, "web", "data", "female", "effectors.json"), len(df), pools)
    merge_stim(os.path.join(ROOT, "web", "data", "female", "stim.json"), proprio_stim(pools))


if __name__ == "__main__":
    print("=== male CNS joints ===")
    export_male()
    print("=== female BANC joints ===")
    export_female()
