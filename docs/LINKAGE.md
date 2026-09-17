# Linkage — what’s wired, what’s half-wired, what’s empty

Honest coverage of **sensory world → encoder → annotated pools → LIF (weighted + STD) → MN/effector pools → poseMap / soft parts / plant → visible DoFs**.

Public runtime: **male CNS**, NeuroMechFly **OG body**, utopia garden, Earth-fly vision path, **dynw1** time-varying synapses. No invented MNs, no CPG, no thrusters.

Cache: [`?v=ogbody1`](https://wjb000.github.io/fruitflybrain/?v=ogbody1). Architecture: [`BRAIN_TO_BODY.md`](BRAIN_TO_BODY.md). Senses: [`SENSORY.md`](SENSORY.md). Native morphology: [`OG_BODY.md`](OG_BODY.md).

## Pipeline

```
Garden (light, odor, wind, contact, pose)
  → encoder (eye.js / plume.js / readProprio / closeLoopProprio)
    → stim.json + effectors.json IDs  (Hz write-in; residual bind for aggregates)
      → sim.worker.js LIF  (connectome chemWeight × TM u·x)
        → motEma on annotated MN / effector pools
          → poseMap.js (antagonist DoFs; empty pools stay 0)
            → fly.js NeuroMechFly mesh (42 leg hinges + soft parts)
              → planted stance-slip  or  MuJoCo 42-DoF plant
```

Worker drive is **max-merge** across overlapping channels. Typed pools (foodORN, choT1, …) keep their own Hz. Aggregate leftovers (`smell` minus typed ORNs, `taste` minus GRNs, `touch` minus proprio) get residual world drive so untyped annotated cells are not idle.

## Status legend

| Tag | Meaning |
|---|---|
| **LINKED** | World or MN path reaches a visible DoF / LIF write-in on those IDs |
| **HALF-LINKED** | Path exists but is kinematic fill, aggregate-only, or readout without a dedicated mesh joint |
| **EMPTY-BY-ANNOTATION** | FlyEM type strings have **zero** cells; we do not invent IDs |
| **STRUCTURAL** | Mesh/plant has no joint; documented limit, not a missing label |

## Newly linked in `ogbody1`

| Gap | What changed | IDs used |
|---|---|---|
| World-XYZ puppet hinges | Per-leg NMF bone-frame axes; L/R pitch mirrored | same muscle MN IDs |
| Cartoon hinge slams | Per-neuromere `NMF_JOINT_LIMIT` (T1 < T3) | same |
| Floating / clipping tarsi | Stance contact IK on tibia/tarsus + thorax `standSettle` | same; no CPG |
| Tarsus5 origin as “foot” | Distal claw along tarsus4→5 | same |
| Mixed proprio | hp ← coxa; cho ← FeTi; csa ← stance/load | existing `hpT*` `choT*` `csaT*` `propT*` |

## Newly linked in `utopia2`

| Gap | What changed | IDs used |
|---|---|---|
| Untyped campaniform (~219) | Residual `campaniform` ← load/gyro/wing strain; typed `csaT*` keep neuromere channels | `stim.campaniform` minus `csaT1/2/3` |
| Untyped proprio (~316) | Residual `proprio` ← joint blend; typed `propT*` stay on their channels | `stim.proprio` minus `propT1/2/3` |
| All fruit, not just spawn food | Nearest cluster → `sweet` / `taste` / `IR52b` | existing GRN / IR52b |
| Floral volatiles | Blossom plume + proximity → **residual smell only** (not foodORN) | leftover `smell` IDs |
| Fruit fermentation CO₂ | Ripe fruit puffs → `co2ORN` | `ORN_V` 55 |
| Extra dew | Second puddle + shade moisture → `hygro` L/R | `hygrosensory` 66 |
| l-LNv CRY | Actual compound-eye **R7 UV**, not a fake sine day | `lLNv` 8 |
| DAN reward | Sugar contact adds Hz on existing DAN | `DAN` 340 |
| Shade canopy | Dims local day / raises hygro under the perch | clock + hygro (same IDs) |
| Whole-body motion | Stance-slip EMA + tighter yaw; slower hinge tau | same MN IDs — no CPG |

Kept from `linked1`: residual smell/taste/touch, courtship, antenna parts, haltere gyro, neck/abdomen proprio, abdomen yaw, wing L/R, eye glow, dynw1 synapses.

## Newly linked in `linked1`

| Gap | What changed | IDs used |
|---|---|---|
| Untyped olfactory cells | Residual `smell` L/R ← multi-plume blend (food+pher+CO₂+aversive) | `stim.smell` minus typed ORNs (~900 cells) |
| Taste aggregate | Residual `taste` ← max(sweet, bitter) without overwriting GRNs | `stim.taste` minus sweet/bitter |
| Touch aggregate | Residual `touch` ← ground/contact without overwriting cho/hp/csa | `stim.touch` minus proprio keys + JO |
| Courtship sensory | Other-fly proximity/view → `courtship` Hz (was UI-only) | `stim.courtship` 3149 |
| Antenna mesh | JO drives **pedicel + funiculus + arista**, not pedicel only | `JO` 672 |
| Antenna proprio | Posed antenna load feeds back into JO Hz | same JO IDs |
| Halteres | Yaw-rate gyro deflection when folded; beat still wing-gated | no MN pool — `csaT3` 199 for sense |
| Haltere proprio | Body yaw + wing power → metathoracic campaniform | `csaT3` L/R |
| Neck proprio | Head pose → prothoracic hair plates | `hpT1` L/R |
| Abdomen proprio | Curl → hind `propT3` / `choT3` | existing hind proprio IDs |
| Abdomen yaw | Soma-X split of the 207 abdomen MNs → lateral bend | `abdomen` 207 |
| Wings L/R | Soma-X split of DLM/DVM/ADMN → per-wing stroke | DLM 10, DVM 16, ADMN 32 |
| Eye glow | Photoreceptor `r16` write-in lights the NMF eye meshes | R16 / visionL/R |
| `fru` | Mild court label only (not a fake muscle) | `fru` 2611 |
| HUD | JO / hygro bars; halt from gyro; `~` on kinematically coupled T2/T3 hinges | — |

## Body parts (MN → mesh)

| Part | Annotated pool (n) | Mesh / DoF | Status |
|---|---|---|---|
| Thorax root `c_thorax` | — | Rigid root | **LINKED** (static) |
| Legs T1 L/R | coxaProm 4/4, rem/rot/add, tr, fe, ti, taDep 5/4, taLev 2/3 | 7 NMF hinges + tarsus2–5 follow | **LINKED** |
| Legs T2 L/R | rem/rot/add, tr, fe, ti; **coxaProm 0; ta\* 0** | Same 7 hinges; empty Ta/prom **coupled from tibia/tr while walking only** | **HALF-LINKED** / **EMPTY-BY-ANNOTATION** |
| Legs T3 L/R | same pattern as T2 | same | **HALF-LINKED** / **EMPTY-BY-ANNOTATION** |
| Neuromere T1L…T3R | 75–88 vnc_motor | Walk-gate + UI labels; not extra hinges (those MNs already in muscle pools) | **LINKED** (gate) |
| Neck `c_head` | neck 25, neckL/R 12 (CvN) | Pitch / yaw / roll + FK onto eyes, antennae, mouth | **LINKED** |
| Eyes `l/r_eye` | no extraocular MN | Follow head FK; emissive from R16 | **HALF-LINKED** (no eye-muscle IDs) |
| Antennae pedicel/funiculus/arista | **no antennal MN** | JO reflex on three segments after head FK | **HALF-LINKED** (sensory reflex, not MN) |
| Proboscis / haustellum | MN9 2, proboscis (PhN) 42 | Scale + rotate; dead-zoned | **LINKED** |
| Abdomen 1–6 | abdomen 207 (soma-Y bins + soma-X L/R) | 5-segment curl + lateral yaw | **LINKED** |
| Wings | DLM 10, DVM 16, ADMN 32 (± L/R split) | Flap only above `WING_FLAP_GATE`; L/R stroke | **LINKED** |
| Halteres | **no MN pool** | Rest / wing-beat / yaw gyro | **HALF-LINKED** |
| Tarsus 2–5 | no extra MN | Follow tarsus1 pitch | **HALF-LINKED** (kinematic) |

### Empty male muscle pools (do not invent)

| Pool | n | Why |
|---|---|---|
| `L2/R2/L3/R3_coxaProm` | 0 | FlyEM type strings lack promotor labels in T2/T3 |
| `L2/R2/L3/R3_taDep`, `*_taLev` | 0 | No Ta depressor/levator labels in those neuromeres |

Walking may **kinematically couple** those hinges from tibia/trochanter (`embodyMuscle._coupled`). `motEma` for those keys stays 0. HUD joint labels show `~` when coupled.

## Senses (world → pools)

| Sense | stim / effector (n) | Driven? | Status |
|---|---|---|---|
| Compound eye R1–R6 / R7 / R8 | R16 1394, R7 1384, R8 1329 (sectors L/R × 4) | `encodeOpticRates` | **LINKED** |
| Lamina L1–L3 | ~177x each L/R | ON/OFF / UV-DC | **LINKED** |
| T4/T5 | ~16xx each L/R | HR + parallax + loom | **LINKED** |
| HS / VS | 8 / 34 L/R | Wide-field from T4/T5 | **LINKED** |
| `vision` aggregate | 4114 | Split → `visionL/R` (same IDs). Aggregate channel is UI extra only — **not double-driven** | **LINKED** (via split) |
| food / pher / CO₂ / aversive ORN | 841 / 631 / 55 / 209 L/R | Antenna-tip plumes | **LINKED** |
| `smell` aggregate | 2639 | Residual untyped ORNs ← blend **including floral**; typed ORNs stay on their channels | **LINKED** (residual) |
| JO / wind | 672 L/R | Wind + self-motion + **antenna pose** | **LINKED** |
| Hygro | 66 L/R | Moist plume + dew (including extra puddle) + shade | **LINKED** |
| Sweet / bitter / taste | 460 / 156 / 1486 | Contact at **nearest fruit**; residual taste | **LINKED** |
| ppk23 / ppk25 / IR52b | 269 / 257 / 226 L/R | Other-fly / **nearest-food** contact | **LINKED** |
| `courtship` | 3149 | Other-fly proximity/view (and UI extra) | **LINKED** |
| `escape` | 2 (= DNp01) | UI extra / MN readout only — not a loom cheat into giant fiber | **HALF-LINKED** |
| `touch` aggregate | 5756 | Residual after proprio/JO | **LINKED** (residual) |
| Proprio cho/hp/csa/tact/prop | cho 425, hp 113, csa 426, … L/R by neuromere | Leg pose + **closeLoopProprio**; **residual campaniform (~219) and proprio (~316)** | **LINKED** |
| Clock / neuromod | sLNv 8, lLNv 8, LNd 10, DN1a 4, DN1p 12, DAN 340, OA 37, HT 8, pep 29 | l-LNv from **R7 UV**; DAN from sugar; others calm day/hunger/sleep | **LINKED** |

`neckL` / `neckR` also appear in `stim.json` (duplicate CvN IDs). They are **motor**, not sensory write-in.

## Effectors that are not mesh muscles

| Pool | n | Role | Status |
|---|---|---|---|
| `DNa` | 52 | Walk-gate with T2/T3 | **LINKED** (gate) |
| `DNp01` | 2 | Escape mode label | **HALF-LINKED** |
| `DNp` | 320 | Connectome only (not fake leg muscles) | **STRUCTURAL** |
| `DNg02` / `aIPg` / `pIP1` | 29 / 56 / 2 | Court label + abdomen when sustained | **LINKED** (label / curl) |
| `fru` | 2611 | Mild court label; synapses already in the graph | **HALF-LINKED** |
| Optic readout (HS, VS, T4…) | — | Assay / portable / HUD; not actuators | **LINKED** (diagnostic) |

## Pages (github.io)

Kinematic default on static hosts: **no** `/physics/health` fetch unless `?plant=` (`plantConfig.plantProbeOrigins` from linked2). Connectome loader reports ~38MB progress (`loadutil.js`). Female BANC is not shipped. Cache [`?v=ogbody1`](https://wjb000.github.io/fruitflybrain/?v=ogbody1). OG morphology: [`OG_BODY.md`](OG_BODY.md).

## Plant vs kinematic

| DoF | Kinematic Pages (OG mesh) | MuJoCo plant |
|---|---|---|
| 42 leg hinges | Anatomical NMF axes + `NMF_JOINT_LIMIT` + stance plant IK | Position-actuated MJCF ranges |
| Ground contact | Tarsus claw on moss; thorax `standSettle` | Contacts + adhesion |
| Head / neck | Visual FK (`poseSoftParts`) | **STRUCTURAL** — no neck joint |
| Abdomen 3–6 | Visual FK | Visual (plant does not curl segments) |
| Wings / halteres / mouth / antennae | Visual | Visual; flight force only if `?flight=1` |

## What we will not add

- Invented T2/T3 `coxaProm` / `taDep` / `taLev` cell IDs
- Invented antennal or haltere motor neurons
- CPG / tripod clock / walk thrusters
- RGB/salience dump into HS, or bearing-to-fruit PID
- Female BANC payload on Pages

## Regenerating maps

```bash
python export_effectors.py   # web/data/{effectors,stim}.json
node tools/linked1_linkage_sanity.mjs
node tools/utopia2_linkage_sanity.mjs
node tools/ogbody1_pose_sanity.mjs
```
