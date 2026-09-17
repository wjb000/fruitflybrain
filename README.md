# Fruit-fly CNS — a thriving male in his own body

The **complete adult male *Drosophila* central nervous system** (brain + ventral nerve cord) driving a **full NeuroMechFly body** (six legs, head, antennae, abdomen, wings, mouth) in a **fly utopia**. Homepage default: healthy closed loop, fly mesh, planted idle / MN-gated walk. Cube and drone chassis remain optional (`?body=cube` / `?body=drone`). Male CNS only; female BANC under `web/data/female/` is not shipped on Pages.

**Architecture:** the **full Male CNS connectome** (LIF + real synapses) drives him. Coded logic fills gaps only (sensory encoding, planted adhesion, utopia world, proprio fallbacks, optional hΔ). No behavior tree, CPG gait, or walk thrusters. Ethic: [`docs/THRIVE.md`](docs/THRIVE.md). Connectome vs gap-fill: [`docs/BRAIN_TO_BODY.md`](docs/BRAIN_TO_BODY.md#architecture--connectome-vs-gap-fill). Sensory path (compound eye, not RGB): [`docs/SENSORY.md`](docs/SENSORY.md). **Linked vs empty (honest table):** [`docs/LINKAGE.md`](docs/LINKAGE.md).

```
world (light, odor, contact, proprio)
  → sensory pools
    → LIF connectome (sim.worker.js) — connectome weights × TM STD/STF
      → annotated motor neurons
        → NeuroMechFly pose (fly.js)
          → planted stance-slip  (Pages kinematic default)
          → MuJoCo contact       (local / ?plant=)
```

Quiet annotated pools → quiet actuators. Empty annotation pools stay empty (no invented MNs, no cosmetic gait, no free-joint walk thrusters). Flight translation is **off** unless `?flight=1`.

Hard-refresh: [`?v=utopia2`](https://wjb000.github.io/fruitflybrain/?v=utopia2). Chemical synapse strength varies over time (connectome edge weights × NT-aware short-term depression/facilitation). Optional labs: [follow me](web/follow.html?v=follow1) · [hΔ learning](web/hdelta.html?v=lab1) · [stim map](web/index.html?stim=1&v=utopia2).

This is the map published 3 September 2026 by FlyEM / HHMI Janelia, the University of Cambridge, MRC LMB, and Google Research:

> Berg et al. *Sexual dimorphism in the complete connectome of the Drosophila male central nervous system.* Cell (2026).

~166,000 traced neurons (male), millions of synaptic edges, somas in real EM coordinates, and reconstructed morphologies for landmark cells.

## Run locally

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python prepare.py          # first time: builds web/data from the public Male CNS files
python export_effectors.py # MN→muscle + proprio pools → web/data/effectors.json
python serve.py            # opens http://127.0.0.1:8787/?v=utopia2
```

`prepare.py` expects the public tables already under `data/` (annotations, neurotransmitters, connectome-weights, brain/VNC meshes). Those are CC-BY from [male-cns.janelia.org](https://male-cns.janelia.org/).

### Server flags

```bash
python serve.py --host 127.0.0.1 --port 8787   # default (local)
python serve.py --host 0.0.0.0 --port 8787 --no-open   # containers / public plant
```

CORS is `Access-Control-Allow-Origin: *` so a static GitHub Pages front-end can call a remote MuJoCo plant.

### Remote plant (optional)

Pages default is **kinematic NeuroMechFly** so a dead tunnel cannot vault or seize the fly. To attach a live plant:

1. Query string: `?plant=https://your-plant.example`
2. Or `localStorage.ffbPlant = "https://your-plant.example"`
3. Local `serve.py` still probes same-origin `/physics`

See `web/plantConfig.js`. The Docker image (`Dockerfile`) runs `serve.py --host 0.0.0.0` for plant hosting.

## What you are seeing

Closed loop:

1. Light and odor from procedural landmarks drive the real sensory neurons.
2. Spikes propagate through the connectome (LIF + short-term depression, fast EPSP vs slow neuromod).
3. Descending + VNC **motor neurons** pose the NeuroMechFly legs (empty pools stay limp).
4. **Default (Pages):** planted stance-slip from MN foot motion in the garden utopia. **Live plant:** MuJoCo contact, mesh synced to thorax. **`?body=cube`:** box from portable `{v,ω}`. **`?body=drone`:** visual quadrotor from portable axes.

**x-ray CNS** shows the reconstructed brain inside the cuticle. Light / scent / taste / touch are gentle sensory extras — motion still only emerges if MNs fire.

See [`docs/BRAIN_TO_BODY.md`](docs/BRAIN_TO_BODY.md) for the sensory→MN→actuator map and annotation gaps.

## Optional demos (not the homepage)

**Follow-me (webcam blob):** [`web/follow.html?v=follow1`](web/follow.html) puts the male CNS in the **drone** and follows a webcam / synthetic “you” blob. Thin encoding only (centroid + area → virtual person beacon + `sensoryBoost` Hz on visionL/R / optic). Steering is still eye → LIF → MN → portable drone axes — **not** a PID go-to-pixel. One-pager: [`docs/FOLLOW_ME.md`](docs/FOLLOW_ME.md).

**hΔ fast-weight lab:** [`web/hdelta.html?v=lab1`](web/hdelta.html). Freeze Δw mid-run. Methods: [`docs/FAST_WEIGHT_HDELTA.md`](docs/FAST_WEIGHT_HDELTA.md).

**Stim map:** `?stim=1&v=fullfly1` — gentle Hz inject through the LIF onto named pools. Not surgery; not a chassis cheat.

**Portable robot API** (cube / drone / hardware):

```js
ffbPortable.snapshot(); // vision + MN steering
ffbPortable.stub();     // { v, omega } for a robot driver
ffbPortable.drone();    // { pitch, yaw, strafe, throttle } quadrotor
ffbPortable.howto;      // control-law text
```

## Optional intact-first heading check

A **see → dark → yaw animal → dark-retrieve** assay lives behind `?assay=1` / `?dev=1` (not the homepage). Prefer intact function; pool mute is a diagnostic. See [`docs/LESION_ASSAY.md`](docs/LESION_ASSAY.md).

```bash
python serve.py
# http://127.0.0.1:8787/?assay=1&dev=1

node tools/baseline_intact.mjs 16
node tools/sweep_lesions.mjs --lesion none --lesion 'silence:HS'
```

## Sex-swap digital twin (CVA-SST)

Closed-loop **Courtship-vs-Aggression Sex-Swap Twin** (offline; not the public UI): entire male CNS graph, NT-aware LIF, portable MN chassis, BANC transplant v2. **Exp0 FAILED** (N=16 mixed scene, no CI↔AI sign flip). **Exp1 FAILED** (intact male Scene F vs M: aIPg not gated by male/cVA). Methods and results: **[`docs/SEX_SWAP_TWIN.md`](docs/SEX_SWAP_TWIN.md)**.

```bash
python3 tools/sex_swap/verify_counts.py
python3 tools/sex_swap/build_isomorphism.py
python3 tools/sex_swap/build_sex_swap_graph.py
python3 tools/sex_swap/build_banc_transplant.py   # v2; gitignored *.bin
node tools/sex_swap/run_cva_assay.mjs             # Exp0 default N=16
node tools/sex_swap/run_exp1_male_scenes.mjs      # Exp1 male Scene F vs M (no female_swap)
```

## hΔ fast-weight continual nav

Online fast weights on **hDeltaH / A / I / G** outgoing synapses; plastic vs frozen ablation on a two-context heading remap. Frozen fails the second context. Methods: [`docs/FAST_WEIGHT_HDELTA.md`](docs/FAST_WEIGHT_HDELTA.md). Demo: [`web/hdelta.html?v=lab1`](web/hdelta.html). Does **not** reopen CVA-SST Exp0/Exp1 or M1–M3.

```bash
python3 tools/hdelta/build_pools.py
node tools/hdelta/run_continual_nav.mjs          # W1
node tools/hdelta/run_experiments.mjs            # W1–W3 → results/hdelta/experiments.json
```
