# Brain → body mapping

> **Public runtime:** male CNS only. Female BANC notes below are historical / offline export notes — the UI does not spawn or select females.

Honest closed loop: **sensory → connectome LIF → motor neurons → body**.
Quiet annotated pools → quiet actuators. Empty annotation pools stay empty
(no invented MNs, no neuromere fill-in, no cosmetic wing idle / CPG gait /
free-joint walk–turn thrusters).

## Pipeline

```
Dish (light, odor, contact, proprio)
  → sensory pools (stim/effectors IDs)
    → LIF worker (sim.worker.js): Poisson drive + connectome synapses
      → MN / effector pool rates (Hz → soft 0–1)
        → agent.js cmd.walk/turn (+ muscle/wing/…) from bilateral leg + descending EMAs
          → DEFAULT: portable.js steering.forward/yawRate → cube chassis (kinematic)
          → ?body=fly: MuJoCo plant (physics.py) OR kinematic NMF (fly.js)
```

## Robot controller — cube chassis (Pages default)

Embodiment is a box+arrow on the small pad (`web/chassis.js`). The male
connectome, compound eye, and optional odor still run. This **is** the robot
controller: the same `v` / `omega` a hardware driver would consume.

**Control law (connectome-only):**

```
eye L/R salience (beacon)
  → visionL/R + optic pools (Hz write-in, klinotaxis contrast)
    → LIF connectome
      → descending + leg MN EMAs
        → cmd.walk / cmd.turn
          → portableControls → steering.forward / yawRate
            → chassisSetpoints → { v, omega }
              → cube integrate (or your robot base)
```

1. `cmd.walk` / `cmd.turn` from neuromere MN EMAs (`T1L…T3R`) + `DNa` (walk)
   in `agent.js` — same as fly mode UI labels. **No** bearing-to-food thruster.
2. `portableControls()` → `steering.forward` / `steering.yawRate` (+ vision
   salience diagnostics for HUD / logging).
3. `chassisSetpoints()` scales to `v` / `omega` (readability / hardware gains;
   cube uses lower `vGain`, higher `yawGain` so MN L/R yaw is visible).
4. Portable steering **gates forward by `|yawRate|`** (turn-then-approach) and
   amplifies MN-derived turn — still no bearing-to-food thruster.
5. `EmbodiedFly.stepCubeChassis`: integrate heading and XY with soft rim;
   **no** MuJoCo, **no** nmf mesh FK, **no** free-joint thrusters.

Restore fly body: `?body=fly`. Cache-bust: `?v=stimmap1`.

**Hardware how-to:** see `ROBOT_HOWTO` in `web/controller/portable.js`, or
`ffbPortable.howto` in the browser. Publish `v` / `omega` each tick; silence
optic pools (`?lesion=silence:HS`) should weaken beacon-directed yaw.

Plant URL: `web/plantConfig.js` (Pages → Mac tunnel by default).
Ghost hygiene: plant `BODY_TTL` + `/physics/clear` on load; soft rim bounce
preserved in both plant and kinematic paths. Scent bomb is ORN-only and
**off by default**.


## Stim-map mode (causal motor mapping)

Open the sim (cube default) or `?stim=1` / `?map=1` (HUD link always). Hold or toggle a named pool button (e.g. **T1L**, **T1R**, **DNa**, **HS**, **visionL/R**). That **Hz-injects** those neuron IDs on the LIF worker (optional lesion **boost** gain), so they spike → synapses / effector readout → `cmd.walk`/`cmd.turn` → portable `forward`/`yawRate` → cube. Live HUD shows forward, yawRate, and a left/right hint; **pulse all** fills a small table of peak fwd vs yaw. This is causal stim mapping — not closed-loop beacon-chase gain tweaks. Do not bypass with direct chassis velocity from the button.

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
| Manual stim buttons | `vision`, `smell*`, `taste`, `touch`, `courtship`, `escape` | UI extras; still MN-gated body |

## Motor / effector pools → actuators

| Pool | Body DOF / actuator |
|---|---|
| `L*|R*_{coxaProm,Rem,RotA,RotP,Add}` | Coxa pitch / yaw / roll (NMF 3 DoF) |
| `*_trFlex` / `*_trExt` (+ `feRed` assist) | Trochanter–femur pitch (+ roll from feRed) |
| `*_tiFlex` / `*_tiExt` | Tibia pitch |
| `*_taDep` / `*_taLev` | Tarsus pitch (empty on male T2/T3 — see gaps) |
| Neuromere aggregates `T1L`…`T3R` | UI walk label + adhesion lift bias via muscle |
| `DNa` | Contributes to walk mode label only |
| `DLM`, `DVM`, `ADMN` | Wing power / flap (kinematic); plant flight force gated on same |
| `MN9`, `proboscis` | Proboscis / haustellum extension |
| `neck`, `neckL`, `neckR` | Head pitch magnitude + yaw from L/R CvN |
| `abdomen`, courtship (`aIPg`/`pIP1`/`DNg02`/`fru`) | Abdomen curl |
| `DNp01` | Escape mode label (arousal path) |

Ground translation: **stance slip from MN-posed feet** (kinematic) or
**MuJoCo contact** (plant). Flight translation: **off by default**; with
`?flight=1` / `allow_flight`, wing-MN–gated free-joint lift/thrust only.
`cmd.walk` / `cmd.turn` are UI labels derived from bilateral leg MN pools —
they are **not** sent as free-joint thrusters.

### Vision → walking (sensory write-in)

Compound eye (`eye.js`, including procgen food **beacon** + `landmarks`) →
stronger Hz on `visionL/R` and optic channels (`R16*`, `L1–L3`, `T4*/T5*`,
`HS`/`VS`) with L/R klinotaxis contrast → LIF (`sim.worker.js`) →
descending/leg MN pools → `cmd.walk`/`cmd.turn` → portable robot steering.
No bypass that sets turn/walk from food bearing.

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

## Regenerating maps

```bash
python export_effectors.py   # → web/data/{effectors,stim}.json (male public path)
```

Requires `data/body-annotations.feather` (male). Female BANC export remains available in the same script for offline comparison but is not used by the public UI.
