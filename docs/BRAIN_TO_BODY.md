# Brain → body mapping

> **Public runtime:** male CNS only, **fly body default**. Female BANC notes below are historical / offline export notes — the UI does not spawn or select females.

**Ethic:** thriving, healthy closed-loop function. See [`THRIVE.md`](THRIVE.md). Quiet annotated pools → quiet actuators. Empty annotation pools stay empty (no invented MNs, no neuromere fill-in, no cosmetic wing idle / CPG gait / free-joint walk–turn thrusters).

## Architecture — connectome vs gap-fill

He needs the **full Male CNS connectome**, plus **coded logic only where the map or the plant is incomplete**. Behavior is not a hand-coded tree.

```
  CONNECTOME (primary)                         GAP-FILL (helpers only)
  ────────────────────                         ──────────────────────
  web/data/{neurons,connectome}.bin            world → Hz into *existing* pools
  ~166k Traced cells, real synapses            (eye, ORN, proprio, clock)
  sim.worker.js LIF + NT-aware weights + TM STD           kinematic plant / adhesion / settle
                                               utopia garden affordances
                                               optional hΔ Δw on real hDelta types
         │                                              │
         └──────── annotated MN / effector Hz ──────────┘
                           │
                           ▼
              NeuroMechFly pose → stance-slip / MuJoCo contact
```

### What is the connectome (do not replace)

| Piece | Where | Role |
|---|---|---|
| Traced Male CNS graph | `web/data/neurons.bin`, `connectome.bin` | Berg et al. 2026; somas + chemical edges |
| Pool ID lists | `web/data/{stim,effectors}.json` | Real type/instance labels from FlyEM |
| LIF + synapses | `sim.worker.js` | Poisson drive, **connectome edge weights** (`chemWeight`), NT-aware sign, **Tsodyks–Markram STD/STF** (efficacy varies over time), DA/OA/5HT |
| MN / effector readout | `agent.js` `motEma` | Weighted MN hits (incoming |I|) on annotated muscle / descending / wing / neck pools |
| Optional hΔ | `hdelta.html` / `tools/hdelta/` | Fast weights on **real** hDeltaH/A/I/G outgoing edges. Live fly: tiny Δw on those 45 cells only — not the lab demo |

`cmd.walk` / `cmd.turn` are **UI labels** derived from those MN EMAs. They are never free-joint thrusters and never a CPG clock.

### What is gap-fill code (documented helpers)

Coded logic is allowed **only** to bridge missing annotations or missing physics — always writing into **existing** pools or plant state. Empty MN IDs stay empty.

| Helper | Gap it fills | Honest limit |
|---|---|---|
| `eye.js` + `encodeOpticRates` / `visFromEye` | Cameras / garden have no native ommatidial spike trains | Compound-eye R1–R6 / R7 / R8 → L1 ON / L2 OFF → T4/T5 (HR + parallax/loom) → HS/VS Hz on **real** IDs. **Not** RGB frames, **not** food-salience blobs into motion cells, **not** a bearing PID. See [`SENSORY.md`](SENSORY.md). |
| `plume.js` + ORN write-in | World odor is not an EM filament | Hz into real `foodORN` / `pherORN` / `co2ORN` / `aversiveORN` / `JO` |
| `readProprio` / `readProprioMj` | Browser kinematic path has no campaniform organs | Joint/contact → existing `cho*` `hp*` `csa*` `tact*` `prop*` (L/R = soma-X split of those IDs) |
| Clock / neuromod calm Hz | No circadian photodiode on l-LNv except CRY path | Low Hz on real `sLNv` `lLNv` `LNd` `DN1*` `DAN` `OA` `HT` `pep` |
| `poseMap.js` `antagPair` / `softDrive` | Co-contraction of real flex/ext would cancel DoF; small pools saturate | Contrast from **those** pool EMAs; unipolar empty partner stays a modest rest offset — no invented antagonists, no CPG |
| T1 (foreleg) pose scale | T1 has coxaProm + Ta* (T2/T3 do not); sparse 2–8 cell pools were saturating | Scale T1 hinges down so reach/groom stays, arm-flail dies. Same real MN IDs |
| Idle planted freeze (`embodyMuscle`) | T1 Ta* Poisson + all-feet twitch read as toe-tapping | Quiet T2/T3/DNa → all six legs at anatomical rest (planted). Not a CPG. |
| Stance/swing from MN contrast | Connectome does not output a tripod clock | While walking, each leg’s flex vs ext (tr/ti/ta) unplants swing feet; stance feet make slip. Same EMAs, no oscillator. |
| Empty Ta*/coxaProm kinematic couple | Male T2/T3 lack those muscle names | Hinges follow tibia/trochanter **only while walking**. `motEma` for those pools stays 0 — no invented IDs. |
| Walk gate from T2/T3 + `DNa` | T1 twitch was gating slip as if he were walking | Quiet T1 → quiet idle; T2/T3/DNa walk EMAs still translate; **tonic saturated T2/T3 is high-passed** so crawl is not a constant push |
| Abdomen segments (`abdomenFromEma`) | 207-cell pool + one mesh joint was a butt twitch | Dead-zone + gate + **phasic high-pass**; soma-Y split of **those** abdomen MN IDs → NMF abdomen12–6 posture chain |
| Time-varying synapse weights | Unit/always-on hits + mild per-cell STD looped the same MN pools | Connectome `chemWeight` × TM `u·x` per chemical edge; HUD `syn u/x/eff` |
| Antenna JO reflex | NMF antennae were static (tips for odor only) | Calm **pedicel + funiculus + arista** from real `JO` L/R Hz after head FK. No antennal MN IDs invented. Pose feeds back into JO. |
| Head/abdomen FK | Flat NMF segments did not follow neck/abdomen joints | Pose `c_head` children (eyes, antennae, mouth) and abdomen3–6 from the driven joints |
| Halteres | Mesh existed, never posed | Rest when still; beat above `WING_FLAP_GATE` (same DLM/DVM/ADMN); **yaw-rate gyro** when folded. Sense: `csaT3` campaniform. |
| Residual smell/taste/touch | Aggregate stim keys double-covered typed ORN/GRN/proprio | Bind leftover IDs only; untyped cells get world Hz. Worker max-merge. |
| Residual campaniform / proprio | Aggregate keys double-covered typed `csaT*` / `propT*` | Bind leftover IDs only (~219 campaniform, ~316 proprio) |
| Nearest fruit / extra dew | Only spawn food and one pool were tasted / hygro | All food clusters → sweet/IR52b; extra puddle + shade → hygro |
| Floral volatiles | Blossoms were visual-only | Residual smell (untyped ORNs) ← flower plume. Not foodORN. |
| l-LNv CRY | Clock used a fake sine “day” | `lLNv` from compound-eye R7 UV; shade dims local day |
| DAN sugar | DAN was arousal-only | Sweet contact adds Hz on existing DAN |
| Fruit CO₂ | CO₂ only from other flies | Ripe fruit fermentation → `co2ORN` |
| Calmer whole-body | MN Poisson jittered XY/yaw | Stance-slip EMA + tighter yaw; slower hinge tau. Same MN IDs, no CPG |
| `closeLoopProprio` | Leg-only proprio left neck/abdomen/halteres mute | Neck → `hpT1`; abdomen → `propT3`/`choT3`; yaw/wing → `csaT3`. Existing IDs. |
| Abdomen L/R yaw | 207-cell pool was curl-only | Soma-X split of **those** abdomen MN IDs → NMF lateral bend |
| Wing L/R | One ADMN/DLM/DVM blob posed both wings | Soma-X split of **those** wing MN IDs → per-wing stroke |
| Neck `poseSoftParts` | Plant has no neck joint; 25 CvN cells were a head-thrash | Pitch from `neck` magnitude, yaw/roll from `neckL`/`neckR`; smoothed, dead-zoned |
| Planted stance-slip (`fly.js`) | Pages has no MuJoCo contact | Body XY from MN-posed feet; T2/T3 carry walk, T1 weighted low; `y` held at `standZ` + `standSettle` |
| Anatomical NMF hinges | World-XYZ puppet axes flexed mid/hind legs wrong | Bone-frame pitch/yaw/roll from `nmf.json` rest; L/R mirrored; `NMF_JOINT_LIMIT` |
| Stance plant IK | Rest tarsi floated/clipped vs moss | Tibia/tarsus contact on `GROUND_Y` when MN stance; no CPG |
| Organ-split proprio | One flex blend into cho/hp/csa | hp ← coxa; cho ← FeTi; csa ← stance/load. Existing IDs |
| Walk gate from T2/T3 + `DNa` | T1 twitch was gating slip as if he were walking | Quiet T1 → quiet idle; T2/T3/DNa walk EMAs still translate; **tonic saturated T2/T3 is high-passed** so crawl is not a constant push |
| Wing mesh gate (`wingFromEma`) | DLM/DVM/ADMN idle Poisson + 10 Hz sine read as tapping | Visual flap only above `WING_FLAP_GATE` (~0.48); low amp; rest quat below. No cosmetic CPG. Flight translation still `?flight=1` only |
| Mouth / MN9 (`feedFromEma`) | MN9 is 2 cells — one spike saturates `softDrive` into constant mouthing | Dead-zone + low gain; proboscis/haustellum stay at rest unless sustained MN9/proboscis |
| Adhesion / vault settle (`physics.py`) | NMF plant vaults without sticky feet | `set_leg_adhesion_states`; bleed upward vault; **no** walk thruster |
| Utopia garden (`world/procgen.js`) | Lab dish is aversive and empty | Fruit, dew, shade, blossoms, hedge bounce — sensory world only |
| Hedge bounce (`WORLD_SOFT_LIMIT`) | Open ground has no ethological rim | Redirect velocity; never shock / punish / wall GRNs |
| Optional cam / follow encoding | Webcam is not an ommatidium | Centroid → `visionL/R` + optic Hz (follow-me lab) |
| Optional mid-run hΔ | Static connectome has no fast weights | Tiny Δw on traced hDeltaH/A/I/G outgoing edges in the live worker (not the hΔ lab / PFL3 tank-steer) |

### What we will not add

- Behavior trees, finite-state “seek food / flee bitter” controllers
- CPG / tripod gait oscillators that pose legs without MN rates
- Walk/turn/climb thrusters that set `{v,ω}` from food bearing
- Invented MN IDs to fill empty T2/T3 `coxaProm` / `taDep` / `taLev`
- Cosmetic wing idle when `DLM`/`DVM`/`ADMN` are quiet
- Always-on tarsus or abdomen fidget when walk/abdomen MNs are quiet

## Pipeline

```
Garden utopia (light, odor, contact, proprio)
  → sensory pools (stim/effectors IDs)
    → LIF worker (sim.worker.js): Poisson drive + connectome synapses
      → MN / effector pool rates (Hz → soft 0–1)
        → agent.js cmd.walk/turn (+ muscle/wing/…) from bilateral leg + descending EMAs
          → DEFAULT: NeuroMechFly mesh (fly.js) → planted stance-slip
               or MuJoCo plant (physics.py) when a live plant is opted in
          → ?body=cube: portable.js → cube chassis (kinematic box)
          → ?body=drone: portable.js steering.forward/yawRate → droneSetpoints (quadrotor)
```

## Fly body — NeuroMechFly (Pages default)

Embodiment is the **male NeuroMechFly mesh as his OG body**: MN → antagonist muscles → anatomical NMF hinges (not world-XYZ puppet axes), NMF-like joint limits, stance tarsi on the moss, proprio from those joints. Flight translation is off unless `?flight=1`. Pages does **not** auto-dial a remote MuJoCo tunnel (that vaulted/seized the thorax); kinematic NMF is the thrive path. Opt in with `?plant=https://…` — then visual root tracks plant thorax XYZ (`applyMujoco`). See [`OG_BODY.md`](OG_BODY.md).

**Control law (connectome-only; no beacon-chase gain tweaks):**

```
Compound eye (R1–R6 / R7 / R8 → L1/L2 → T4/T5 → HS/VS; parallax + loom)
  → visionL/R + optic pools (Hz write-in)
    → LIF connectome
      → descending + leg MN EMAs
        → cmd.muscle[L1…R3] (empty pools stay 0)
          → pose legs → stance-slip XY / yaw
```

Cube: `?body=cube`. Drone: `?body=drone`. Cache-bust: `?v=ogbody1`.

Plant URL: `web/plantConfig.js` (Pages → kinematic unless `?plant=` / `localStorage.ffbPlant`). Ghost hygiene: plant `BODY_TTL` + `/physics/clear` on load when a plant is live. Garden hedge bounce/redirect (never punish) in both plant and kinematic paths. Scent bomb is ORN-only and **off by default**. Bitter / assay pole stay off unless `?bitter=1` / `?assay=1`.

## Robot controller — optional drone / cube

`?body=drone` is a visual quadrotor in the same garden (`web/chassis.js` `createDroneChassis`). The male connectome, compound eye, and optional odor still run. Cube (`?body=cube`) is the kinematic box.

**Control law (connectome-only; stim-map → drone axes — no beacon-chase gain tweaks):**

```
eye (R1–R6 / R7 / R8 → L1/L2 → T4/T5 → HS/VS)
  → visionL/R + optic pools (Hz write-in)
    → LIF connectome
      → descending + leg MN EMAs
        → cmd.walk / cmd.turn
          → portableControls → steering.forward / yawRate
            → droneSetpoints → { pitch, yaw, strafe, throttle }
              → stepDroneChassis (or your quadrotor)
```

| MN / portable signal | Drone axis |
|---|---|
| `cmd.walk` / DNa / T1–T3 → `steering.forward` | pitch (+ forward `v`) |
| `cmd.turn` (T1L vs T1R) → `steering.yawRate` | yaw |
| T2L / T2R (+ mild vision Δ) → `steering.strafe` | lateral |
| DLM / DVM / ADMN + DNa → `steering.climb` | climb; hover throttle **~1.45** |

1. `cmd.walk` / `cmd.turn` from neuromere MN EMAs (`T1L…T3R`) + `DNa` (walk)
   in `agent.js` — same as fly/cube UI labels. **No** bearing-to-food thruster.
2. `portableControls()` → `steering.forward` / `steering.yawRate` (unchanged
   cube/robot mapping) plus drone extras `strafe` / `climb`.
3. `droneSetpoints()` maps those to quadrotor axes. Cube still uses
   `chassisSetpoints()` with the same `vGain` / `yawGain` as before.
4. `EmbodiedFly.stepDroneChassis`: integrate heading, XY, hover altitude,
   visual pitch/roll; **no** MuJoCo, **no** nmf mesh FK.

Restore cube: `?body=cube`. Restore drone: `?body=drone`. Cache-bust: `?v=ogbody1`.

**Hardware how-to:** see `ROBOT_HOWTO` in `web/controller/portable.js`, or
`ffbPortable.howto` in the browser. Publish `v` / `omega` each tick.

## Stim-map mode (gentle exploration)

Off on the fly-body homepage. Open `?stim=1` / `?map=1` (HUD link always). Hold or toggle a named pool button (e.g. **T1L**, **T1R**, **DNa**, **HS**, **visionL/R**). That **Hz-injects** those neuron IDs on the LIF worker (optional explore gain), so they spike → synapses / effector readout → MN pose / portable steering. Live HUD shows forward/yaw (and drone axes when `?body=drone`). **Pulse all** fills a small table of peak fwd vs yaw. This is causal stim mapping — not surgery, not closed-loop beacon-chase gain tweaks. Do not bypass with direct chassis velocity from the button.

## Sensory channels → neuron pools

| World signal | Pool / channel keys | Notes |
|---|---|---|
| Compound eye | `R16*`, `R7*`, `R8*` sectors; `L1–L3`; `T4a–d`/`T5a–d`; `HS`/`VS` | Ommatidial lattice; L1/L2 ON/OFF; T4/T5 HR + 3D flow/loom; **not** RGB/salience. [`SENSORY.md`](SENSORY.md) |
| Food / pher / CO₂ / aversive plumes | `foodORN`, `pherORN`, `co2ORN`, `aversiveORN` L/R | Antenna sampling + klinotaxis |
| Wind | `JO` L/R | Body-frame wind at arista tips |
| Taste | `sweet`, `bitter`, `taste` | Graded contact at food / bitter drops |
| Hygro | `hygro` ← `hygrosensory` | Moist plume + water proximity |
| Contact / courtship | `ppk23`, `ppk25`, `IR52b` L/R | Proximity to other fly / food |
| Proprio / tactile | `cho*`, `hp*`, `csa*`, `tact*`, `prop*`, aggregates | From MN pose or MuJoCo contacts |
| Clock / neuromod | `sLNv`, `lLNv`, `LNd`, `DN1a`, `DN1p`, `DAN`, `OA`, `HT`, `pep` | Day, hunger, arousal, sleep (calm Hz) |
| Manual stim buttons | `vision`, `smell*`, `taste`, `touch` | Gentle UI extras; still MN-gated body |

## Motor / effector pools → actuators

| Pool | Body DOF / actuator |
|---|---|
| `L*|R*_{coxaProm,Rem,RotA,RotP,Add}` | Coxa pitch / yaw / roll (NMF 3 DoF) |
| `*_trFlex` / `*_trExt` (+ `feRed` assist) | Trochanter–femur pitch (+ roll from feRed) |
| `*_tiFlex` / `*_tiExt` | Tibia pitch |
| `*_taDep` / `*_taLev` | Tarsus pitch. Empty on male T2/T3 — kinematic couple from tibia **while walking only** |
| Neuromere aggregates `T1L`…`T3R` | UI walk label + walk-gate for planted gait |
| `DNa` | Walk-gate with T2/T3 (not a thruster) |
| `DLM`, `DVM`, `ADMN` | Wing mesh flap **only above a high gate**; halteres beat on the same gate. Flight still `?flight=1` |
| `MN9`, `proboscis` | Proboscis / haustellum — dead-zoned; idle MN9 does not mouth |
| `neck`, `neckL`, `neckR` | Head **pitch** from pooled CvN; **yaw/roll** from L/R (smoothed) + FK onto eyes/antennae/mouth |
| `JO` L/R | Calm antenna pedicel reflex (sensory, not fake MNs) |
| `abdomen` (soma-Y → `abdomen12`…`abdomen6`) | Multi-segment posture; **quiet unless phasic** (tonic 207-cell Poisson is not a butt-lift loop) |
| Courtship (`aIPg`/`pIP1`/`DNg02`/`fru`) | Can add abdomen curl when sustained |
| `DNp01` | Mode label only (arousal path; not a default stim) |

Ground translation: **stance slip from MN-posed feet** (kinematic) or
**MuJoCo contact** (plant). Flight translation: **off by default**; with
`?flight=1` / `allow_flight`, wing-MN–gated free-joint lift/thrust only.
`cmd.walk` / `cmd.turn` are UI labels derived from bilateral leg MN pools —
they are **not** sent as free-joint thrusters.

### Vision → walking (sensory write-in)

Compound eye (`eye.js`: R1–R6 / R7 / R8, L1/L2, T4/T5, HS/VS, parallax + loom) →
Hz on `visionL/R` and optic channels with natural L/R from the two eyes → LIF
(`sim.worker.js`) → descending/leg MN pools → MN hinge pose → stance-slip (fly)
or portable `forward`/`yawRate` (cube/drone). No bypass that sets turn/walk from
food bearing. Default spawn faces the ripe fruit so the lattice has a near
surface. Assay beacon only if `?assay=1`. Details: [`SENSORY.md`](SENSORY.md).

## Mapped vs unmapped (annotation limits)

### Mapped (real labels → drive)

- Male T1 coxa / tr / fe / ti / ta muscle MNs; T2–T3 remotor, rotators,
  adductor, tr, fe, ti (see `web/data/effectors.json` counts).
- Female BANC: denser ta* on most legs; still empty `L2/R2/L3/R3_coxaProm`
  (and `R2_coxaRem`) where BANC lacks those muscle names.
- Wings, neck (±L/R), abdomen, proboscis, optic, ORN, JO, proprio suites,
  clock/neuromod pools listed above.

### Unmapped — empty because annotations are empty

Do **not** invent MNs for these:

| Pool | Why empty |
|---|---|
| Male `L2/R2/L3/R3_coxaProm` | FlyEM type strings lack promotor labels in T2/T3 |
| Male `L2/R2/L3/R3_taDep`, `*_taLev` | No Ta depressor/levator labels in those neuromeres |
| Female `L2/R2/L3/R3_coxaProm`, `R2_coxaRem` | BANC peripheral_target / cell_type gaps |
| Female `ppk25`, `IR52b` | Not labeled in BANC export (male has both) |
| Female `R16` | BANC photoreceptor typing often folds into R7/R8 |

### Structural limits (not annotation holes)

- NeuroMechFly plant position-actuates **42 leg DoFs** only; head / abdomen /
  proboscis / wing mesh motion is MN-driven in the browser (`poseSoftParts`)
  while the plant may apply wing-MN–gated free-joint flight forces only when `allow_flight` is set.
- No muscle-level neck joint in the plant — head yaw/pitch is visual from
  `neck*` MN rates.
- Descending interneurons (`DNp`, `DNg02`, …) shape behavior via the
  connectome and mode labels; they are not wired as fake leg muscles.

### Embodiment status (utopia2 / linked1 / dynw1)

Closed or kept honest on the homepage fly body:

| Aspect | Status |
|---|---|
| Default body | NeuroMechFly mesh + MN hinges (`plantMode: fly`) |
| Default world | Happier fly utopia: warm daylight, living moss + grass, several fruit clusters, extra dew, leafy shade, six blossoms, gentle breeze, hedge bounce |
| Synapses | Connectome edge weights (`chemWeight`) × NT-aware TM STD/STF on chemical edges. Efficacy `u·x` varies over time. Not unit hits. Tiny hΔ Δw on 45 traced cells |
| Six-leg gait | Idle: all planted at rest. Walk: T2/T3+DNa **phasic** gate; stance-slip **EMA** so MN jitter is not a fidget loop |
| Soft parts | Head+eyes+antennae+mouth FK from neck; abdomen12–6 **and** soma-X yaw from abdomen MNs; wings L/R from DLM/DVM/ADMN split; halteres rest / beat with wings / **gyro from yaw-rate**; JO antenna **pedicel+funiculus+arista** |
| Vision → legs | Compound eye → `visionL/R` + optic Hz (R16/R7/R8, L1/L2, T4/T5, HS/VS from flow/loom) → LIF → annotated MNs → pose → stance-slip. No RGB dump, no salFood→HS, no bearing thruster |
| Other senses | ORN plumes; **residual smell** including **floral**; fruit CO₂; JO + self-motion + antenna pose; hygro L/R + extra dew/shade; nearest-fruit taste/IR52b; ppk; courtship; `cho*` `hp*` `csa*` `tact*` `prop*` including L/R; **residual campaniform/proprio**; **l-LNv CRY from R7**; DAN from sugar |
| Neck / T1 pose | `poseMap.js`: T1 scale + neck dead-zone/smoothing. Sparse-pool Hz decode in `sim.worker.js` |
| Wings / mouth | High `WING_FLAP_GATE`; MN9/proboscis dead-zone. Idle mesh stays at rest. No cosmetic flap |
| Abdomen | Dead-zoned + **phasic** 207-cell pool; soma-Y segments; quiet unless meaningfully driven |
| Empty MN pools | Stay 0 (male T2/T3 coxaProm, taDep/taLev). Unipolar remotor is a modest rest offset. Walking may kinematically couple those **hinges** |
| Connectome vs gap-fill | LIF + real synapses primary; helpers listed above. No CPG / thruster / invented MNs |
| HUD | Mapped vs empty; live MN; per-leg S/W; **syn u / x / eff** (time-varying synaptic efficacy) |

Still open (not invented around):

- Male T2/T3 coxa promotor and tarsus MNs are unlabeled — mid/hind coxa/ta have **no cell IDs**; walking uses kinematic couple only.
- Connectome may not produce a strong tripod from vision write-in; swing/stance follows real MN flex/ext, not a clock.
- Pages kinematic path is not full MuJoCo contact; attach `?plant=` for the 42-DoF plant.
- No annotated antennal motor pool — antenna motion is JO reflex + head FK only.
- No annotated haltere MN pool — mesh is wing-MN beat + yaw gyro; sense is `csaT3` campaniform.
- Courtship song posture is not a closed 3D kinematic.
- `DNp` (320) and `fru` (2611) shape the connectome / mild court label; they are not fake leg muscles.
- Headless lesion/hΔ packs are not the browser eye + NMF loop.

Honest coverage table: [`LINKAGE.md`](LINKAGE.md).

## Regenerating maps

```bash
python export_effectors.py   # → web/data/{effectors,stim}.json (male public path)
```

Requires `data/body-annotations.feather` (male). Female BANC export remains available in the same script for offline comparison but is not used by the public UI.
