# Fruit-fly CNS — live connectome driving a body

The **complete adult male *Drosophila* central nervous system** (brain + ventral nerve cord) on a **small pad arena**. The public Pages default is a **robot controller**: sensors → LIF → leg/descending MNs → portable `forward`/`yawRate` → **quadrotor axes** (`pitch` / `yaw` / `strafe` / `throttle`, hover ~1.45) on a visual drone chassis (no NeuroMechFly mesh posing, no MuJoCo vault). Add `?body=cube` for the box plant or `?body=fly` to restore NeuroMechFly / MuJoCo. Male CNS only; female BANC under `web/data/female/` is not shipped on Pages.

## Sex-swap digital twin (CVA-SST)

Closed-loop **Courtship-vs-Aggression Sex-Swap Twin**: entire male CNS graph, NT-aware LIF, portable MN chassis, BANC transplant v2, CI vs AI in one scene. **Claim FAILED** (N=16, no CI↔AI sign flip). Methods and results: **[`docs/SEX_SWAP_TWIN.md`](docs/SEX_SWAP_TWIN.md)**.

```bash
python3 tools/sex_swap/verify_counts.py
python3 tools/sex_swap/build_isomorphism.py
python3 tools/sex_swap/build_sex_swap_graph.py
python3 tools/sex_swap/build_banc_transplant.py   # v2; gitignored *.bin
node tools/sex_swap/run_cva_assay.mjs             # default N=16
```

Honest MN→body coupling: drone/cube velocity comes **only** from MN-derived portable steering (gains for readability). Quiet pools → quiet chassis. No thrusters that bypass the brain (no “point at food” cheat). Optional fly mode keeps MN→pose→stance-slip / MuJoCo contact with the same rule.

**Robot controller / vision→steer:** compound eye (food beacon + landmarks) → optic/`visionL/R` pools → LIF → leg + descending MNs → [`web/controller/portable.js`](web/controller/portable.js) (`steering.forward` → pitch, `yawRate` → yaw; T2 strafe; wing MNs climb). Hard-refresh with `?v=drone1`. **Stim map** (default on drone, or `?stim=1`): click pools like T1L/T1R to Hz-inject through LIF and watch drone pitch/yaw/throttle — causal motor mapping, not beacon-chase tuning. Flight free-joint lift remains **off** unless `?flight=1` (fly mode only).

This is the map published 3 September 2026 by FlyEM / HHMI Janelia, the University of Cambridge, MRC LMB, and Google Research:

> Berg et al. *Sexual dimorphism in the complete connectome of the Drosophila male central nervous system.* Cell (2026).

~166,000 traced neurons (male), millions of synaptic edges, somas in real EM coordinates, and reconstructed morphologies for landmark cells.

## Run locally

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python prepare.py          # first time: builds web/data from the public Male CNS files
python export_effectors.py # MN→muscle + proprio pools → web/data/effectors.json
python serve.py            # opens http://127.0.0.1:8787/
```

`prepare.py` expects the public tables already under `data/` (annotations, neurotransmitters, connectome-weights, brain/VNC meshes). Those are CC-BY from [male-cns.janelia.org](https://male-cns.janelia.org/).

### Server flags

```bash
python serve.py --host 127.0.0.1 --port 8787   # default (local)
python serve.py --host 0.0.0.0 --port 8787 --no-open   # containers / public plant
```

CORS is `Access-Control-Allow-Origin: *` so a static GitHub Pages front-end can call a remote MuJoCo plant.

### Remote plant (Pages → Fly.io, etc.)

The static UI in `web/` talks to `/physics/*` on the same origin by default. To point at an external plant:

1. Query string: `?plant=https://your-plant.example`
2. Or `localStorage.ffbPlant = "https://your-plant.example"`
3. Or leave unset → same-origin

See `web/plantConfig.js`. The Docker image (`Dockerfile`) runs `serve.py --host 0.0.0.0` for plant hosting.

## What you are seeing

Closed loop:

1. Light and odor from procedural landmarks drive the real sensory neurons.
2. Spikes propagate through the connectome (LIF + short-term depression, fast EPSP vs slow neuromod).
3. Descending + VNC **motor neurons** produce portable chassis commands (`forward`, `yawRate`).
4. **Default (Pages):** a visual **quadrotor** maps those commands to pitch / yaw / strafe / throttle (hover ~1.45) on the small pad. **`?body=cube`:** box plant. **`?body=fly`:** NeuroMechFly mesh + MuJoCo (local/remote plant) or kinematic MN→pose→stance-slip.

**x-ray CNS** shows the reconstructed brain (inside the cube or cuticle). Stim buttons bias sensory channels — motion still only emerges if MNs fire.

See [`docs/BRAIN_TO_BODY.md`](docs/BRAIN_TO_BODY.md) for the sensory→MN→actuator map, drone/cube steering math, and annotation gaps.

## Lesion assay + robot controller

Virtual surgeries on the LIF connectome (silence / boost / cut / swap L/R / delay / hunger), a **see → dark → yaw animal → dark-retrieve** assay (bright beacon; memory, not reacquisition), and the **robot controller** API (`portableControls` → `{v, omega}`). See [`docs/LESION_ASSAY.md`](docs/LESION_ASSAY.md) and [`docs/BRAIN_TO_BODY.md`](docs/BRAIN_TO_BODY.md).

```js
// In the browser console after load:
ffbPortable.snapshot(); // vision + MN steering
ffbPortable.stub();     // { v, omega } for a robot driver
ffbPortable.drone();    // { pitch, yaw, strafe, throttle } quadrotor
ffbPortable.howto;      // control-law text
```

Calm closed-loop: MN-only body drive (no thrusters). Flight translation gated off unless `?flight=1`. `calm2` keeps softDrive / joint spans modest.

```bash
python serve.py
# http://127.0.0.1:8787/?assay=1&dev=1

node tools/baseline_intact.mjs 16
node tools/sweep_lesions.mjs --lesion none --lesion 'silence:HS'
```

Intact dark-retrieve baselines live under `results/lesion_sweeps/baseline_intact_dish_v2_dark.json`. Wire-hunting waits until intact post-yaw **dark** approach is clearly above chance with encode lock-on — lights-on reacquisition no longer counts.

