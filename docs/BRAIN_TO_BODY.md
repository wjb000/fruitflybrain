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
  sim.worker.js LIF + STD + neuromod           kinematic plant / adhesion / settle
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
| LIF + synapses | `web/sim.worker.js` | Poisson drive, sqrt-compressed weights, STD, DA/OA/5HT |
| MN / effector readout | `agent.js` `motEma` | Hz on annotated muscle / descending / wing / neck pools |
| Optional hΔ | `hdelta.html` / `tools/hdelta/` | Fast weights on **real** hDeltaH/A/I/G outgoing edges |

`cmd.walk` / `cmd.turn` are **UI labels** derived from those MN EMAs. They are never free-joint thrusters and never a CPG clock.

### What is gap-fill code (documented helpers)

Coded logic is allowed **only** to bridge missing annotations or missing physics — always writing into **existing** pools or plant state. Empty MN IDs stay empty.

| Helper | Gap it fills | Honest limit |
|---|---|---|
| `eye.js` + `agent.js` `opticRates` / `visFromEye` | Cameras / garden landmarks have no native ommatidial spike trains | Hz into real `R16*` `L1–L3` `T4*/T5*` `HS`/`VS` `visionL/R` — **not** a bearing-to-food chassis PID |
| `plume.js` + ORN write-in | World odor is not an EM filament | Hz into real `foodORN` / `pherORN` / `co2ORN` / `aversiveORN` / `JO` |
| `readProprio` / `readProprioMj` | Browser kinematic path has no campaniform organs | Joint/contact → existing `cho*` `hp*` `csa*` `tact*` `prop*` (L/R = soma-X split of those IDs) |
| Clock / neuromod calm Hz | No circadian photodiode on l-LNv except CRY path | Low Hz on real `sLNv` `lLNv` `LNd` `DN1*` `DAN` `OA` `HT` `pep` |
| `poseMap.js` `antagPair` / `softDrive` | Co-contraction of real flex/ext would cancel DoF; small pools saturate | Contrast from **those** pool EMAs; unipolar empty partner stays a modest rest offset — no invented antagonists, no CPG |
| T1 (foreleg) pose scale | T1 has coxaProm + Ta* (T2/T3 do not); sparse 2–8 cell pools were saturating | Scale T1 hinges down so reach/groom stays, arm-flail dies. Same real MN IDs |
| Neck `poseSoftParts` | Plant has no neck joint; 25 CvN cells were a head-thrash | Pitch from `neck` magnitude, yaw/roll from `neckL`/`neckR`; smoothed, dead-zoned |
| Planted stance-slip (`fly.js`) | Pages has no MuJoCo contact | Body XY from MN-posed feet; T2/T3 carry walk, T1 weighted low; `y` held at `standZ` |
| Walk gate from T2/T3 + `DNa` | T1 twitch was gating slip as if he were walking | Quiet T1 → quiet idle; T2/T3/DNa walk EMAs still translate |
| Wing mesh gate (`wingFromEma`) | DLM/DVM/ADMN idle Poisson + 10 Hz sine read as tapping | Visual flap only above `WING_FLAP_GATE` (~0.48); low amp; rest quat below. No cosmetic CPG. Flight translation still `?flight=1` only |
| Mouth / MN9 (`feedFromEma`) | MN9 is 2 cells — one spike saturates `softDrive` into constant mouthing | Dead-zone + low gain; proboscis/haustellum stay at rest unless sustained MN9/proboscis |
| Adhesion / vault settle (`physics.py`) | NMF plant vaults without sticky feet | `set_leg_adhesion_states`; bleed upward vault; **no** walk thruster |
| Utopia garden (`world/procgen.js`) | Lab dish is aversive and empty | Fruit, dew, shade, blossoms, hedge bounce — sensory world only |
| Hedge bounce (`WORLD_SOFT_LIMIT`) | Open ground has no ethological rim | Redirect velocity; never shock / punish / wall GRNs |
| Optional cam / follow encoding | Webcam is not an ommatidium | Centroid → `visionL/R` + optic Hz (follow-me lab) |
| Optional mid-run hΔ | Static connectome has no fast weights | Δw on traced hDelta types only |

### What we will not add

- Behavior trees, finite-state “seek food / flee bitter” controllers
- CPG / tripod gait oscillators that pose legs without MN rates
- Walk/turn/climb thrusters that set `{v,ω}` from food bearing
- Invented MN IDs to fill empty T2/T3 `coxaProm` / `taDep` / `taLev`
- Cosmetic wing idle when `DLM`/`DVM`/`ADMN` are quiet

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

Embodiment is the **male NeuroMechFly mesh** with MN→hinge pose and **planted stance-slip** (`web/fly.js`). Flight translation is off unless `?flight=1`. Pages does **not** auto-dial a remote MuJoCo tunnel (that vaulted/seized the thorax); kinematic NMF is the thrive path. Opt in with `?plant=https://…` — then visual root tracks plant thorax XYZ (`applyMujoco`).

**Control law (connectome-only; no beacon-chase gain tweaks):**

```
eye L/R salience (ripe fruit + garden landmarks)
  → visionL/R + optic pools (Hz write-in, klinotaxis contrast)
    → LIF connectome
      → descending + leg MN EMAs
        → cmd.muscle[L1…R3] (empty pools stay 0)
          → pose legs → stance-slip XY / yaw
```

Cube: `?body=cube`. Drone: `?body=drone`. Cache-bust: `?v=cns4`.

Plant URL: `web/plantConfig.js` (Pages → kinematic unless `?plant=` / `localStorage.ffbPlant`). Ghost hygiene: plant `BODY_TTL` + `/physics/clear` on load when a plant is live. Garden hedge bounce/redirect (never punish) in both plant and kinematic paths. Scent bomb is ORN-only and **off by default**. Bitter / assay pole stay off unless `?bitter=1` / `?assay=1`.

## Robot controller — optional drone / cube

`?body=drone` is a visual quadrotor in the same garden (`web/chassis.js` `createDroneChassis`). The male connectome, compound eye, and optional odor still run. Cube (`?body=cube`) is the kinematic box.

**Control law (connectome-only; stim-map → drone axes — no beacon-chase gain tweaks):**

```
eye L/R salience (beacon)
  → visionL/R + optic pools (Hz write-in, klinotaxis contrast)
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

Restore cube: `?body=cube`. Restore drone: `?body=drone`. Cache-bust: `?v=cns4`.

**Hardware how-to:** see `ROBOT_HOWTO` in `web/controller/portable.js`, or
`ffbPortable.howto` in the browser. Publish `v` / `omega` each tick.

## Stim-map mode (gentle exploration)

Off on the fly-body homepage. Open `?stim=1` / `?map=1` (HUD link always). Hold or toggle a named pool button (e.g. **T1L**, **T1R**, **DNa**, **HS**, **visionL/R**). That **Hz-injects** those neuron IDs on the LIF worker (optional explore gain), so they spike → synapses / effector readout → MN pose / portable steering. Live HUD shows forward/yaw (and drone axes when `?body=drone`). **Pulse all** fills a small table of peak fwd vs yaw. This is causal stim mapping — not surgery, not closed-loop beacon-chase gain tweaks. Do not bypass with direct chassis velocity from the button.

## Sensory channels → neuron pools

| World signal | Pool / channel keys | Notes |
|---|---|---|
| Compound eye | `R16*`, `R7*`, `R8*` sectors; `L1–L3`; `T4a–d`/`T5a–d`; `HS`/`VS` | From `eye.js` Hassenstein–Reichardt |
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
| `*_taDep` / `*_taLev` | Tarsus pitch (empty on male T2/T3 — see gaps) |
| Neuromere aggregates `T1L`…`T3R` | UI walk label + adhesion lift bias via muscle |
| `DNa` | Contributes to walk mode label only |
| `DLM`, `DVM`, `ADMN` | Wing mesh flap **only above a high gate**; plant flight force still `?flight=1` |
| `MN9`, `proboscis` | Proboscis / haustellum — dead-zoned; idle MN9 does not mouth |
| `neck`, `neckL`, `neckR` | Head **pitch** from pooled CvN; **yaw/roll** from L/R (smoothed, dead-zoned) |
| `abdomen`, courtship (`aIPg`/`pIP1`/`DNg02`/`fru`) | Abdomen curl |
| `DNp01` | Mode label only (arousal path; not a default stim) |

Ground translation: **stance slip from MN-posed feet** (kinematic) or
**MuJoCo contact** (plant). Flight translation: **off by default**; with
`?flight=1` / `allow_flight`, wing-MN–gated free-joint lift/thrust only.
`cmd.walk` / `cmd.turn` are UI labels derived from bilateral leg MN pools —
they are **not** sent as free-joint thrusters.

### Vision → walking (sensory write-in)

Compound eye (`eye.js`, including ripe fruit + garden `landmarks`) →
stronger Hz on `visionL/R` and optic channels (`R16*`, `L1–L3`, `T4*/T5*`,
`HS`/`VS`) with L/R klinotaxis contrast → LIF (`sim.worker.js`) →
descending/leg MN pools → MN hinge pose → stance-slip (fly) or portable
`forward`/`yawRate` (cube/drone). No bypass that sets turn/walk from food bearing.
Default spawn faces the ripe fruit so L/R vision has a target. Assay beacon only if `?assay=1`.

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

### Embodiment status (cns4 / utopia garden)

Closed or kept honest on the homepage fly body:

| Aspect | Status |
|---|---|
| Default body | NeuroMechFly mesh + MN hinges (`plantMode: fly`) |
| Default world | Fly utopia garden: moss floor, ripe fruit, berries, dew pool, shade plant, two blossoms, hedge bounce |
| Planted walk | Kinematic: T2/T3 + DNa gate slip; T1 feet down-weighted; y held at `standZ`. MuJoCo: vault/weak-plant settle in `physics.py` |
| Vision → legs | Eye → `visionL/R` + optic Hz → LIF → annotated MNs → pose → stance-slip. Spawn faces ripe fruit. No bearing thruster |
| Proprio / touch | `readProprio` / `readProprioMj` write `cho*` `hp*` `csa*` `tact*` `prop*` including L/R soma-X splits of existing IDs |
| Neck / T1 pose | `poseMap.js`: T1 scale + neck dead-zone/smoothing. Sparse-pool Hz decode in `sim.worker.js` |
| Wings / mouth | High `WING_FLAP_GATE`; MN9/proboscis dead-zone. Idle mesh stays at rest. No cosmetic flap |
| Soft home | Clearing radius 12.5, hedge bounce/redirect (never punish), `WORLD_SOFT_LIMIT` ~10.8 |
| Aversives | Bitter / assay pole / scent bomb **off** unless `?bitter=1` / `?assay=1` / HUD toggle |
| Flight | Off unless `?flight=1` |
| Plant / mesh sync | `applyMujoco` copies thorax XYZ + bones when a plant is live; Pages skips auto-tunnel |
| Empty MN pools | Stay 0 (male T2/T3 coxaProm, taDep/taLev). Unipolar remotor is a modest rest offset, not a slam |
| Connectome vs gap-fill | LIF + real synapses primary; helpers listed above. No CPG / thruster / invented MNs |

Still open (not invented around):

- Male T2/T3 coxa promotor and tarsus MNs are unlabeled — mid/hind coxa/ta stay under-actuated.
- Connectome may not produce a strong tripod gait from vision write-in; walk amplitude follows real MN rates.
- Head / abdomen / wings are visual (or wing-MN–gated flight only with `?flight=1`), not plant joints.
- Pages kinematic path is not full MuJoCo contact; attach `?plant=` for the 42-DoF plant.
- Headless lesion/hΔ packs are not the browser eye + NMF loop.
- Courtship song posture is not a closed 3D kinematic.

## Regenerating maps

```bash
python export_effectors.py   # → web/data/{effectors,stim}.json (male public path)
```

Requires `data/body-annotations.feather` (male). Female BANC export remains available in the same script for offline comparison but is not used by the public UI.
