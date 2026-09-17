# Fruit-fly CNS — live connectome driving a body

The **complete adult male *Drosophila* central nervous system** (brain + ventral nerve cord) driving a **NeuroMechFly body** in a **fly utopia**. Canonical public site: **[https://wjb000.github.io/fruitflybrain/](https://wjb000.github.io/fruitflybrain/)** (`?v=ogbody1`). Homepage default is the fly mesh (`?body=fly` omitted). Cube and drone remain optional (`?body=cube` / `?body=drone`). Male CNS only; female BANC under `web/data/female/` is not shipped on Pages.

Pages is served from the `gh-pages` branch (currently **ogbody1**). That build is **ahead of this `main` tree’s `web/`** (which still has the older drone-default robot-controller snapshot). Do not redeploy `main`’s `web/` onto Pages — that would switch the public default back to drone. Merge the live fly stack (open PR **#9** / `cursor/utopia2-happier-linked-eec6`) into `main` when you want clone-from-`main` to match the public site.

## Sex-swap digital twin (CVA-SST)

Closed-loop **Courtship-vs-Aggression Sex-Swap Twin**: entire male CNS graph, NT-aware LIF, portable MN chassis, BANC transplant v2. **Exp0 FAILED** (N=16 mixed scene, no CI↔AI sign flip). **Exp1 FAILED** (intact male Scene F vs M: aIPg not gated by male/cVA). Methods and results: **[`docs/SEX_SWAP_TWIN.md`](docs/SEX_SWAP_TWIN.md)**.

```bash
python3 tools/sex_swap/verify_counts.py
python3 tools/sex_swap/build_isomorphism.py
python3 tools/sex_swap/build_sex_swap_graph.py
python3 tools/sex_swap/build_banc_transplant.py   # v2; gitignored *.bin
node tools/sex_swap/run_cva_assay.mjs             # Exp0 default N=16
node tools/sex_swap/run_exp1_male_scenes.mjs      # Exp1 male Scene F vs M (no female_swap)
```

Honest MN→body coupling: on Pages the fly’s motion comes **only** from annotated MNs (kinematic NeuroMechFly pose → planted stance-slip). Quiet pools → quiet body. No thrusters that bypass the brain (no “point at food” cheat). Optional cube/drone modes keep portable MN steering with the same rule. A live MuJoCo plant is **opt-in** (`?plant=`), not required for the public animal.

**Follow-me (webcam blob, optional drone demo):** [`web/follow.html?v=follow1`](web/follow.html) puts the male CNS in a quadrotor and follows a webcam / synthetic “you” blob. Thin encoding only (centroid + area → virtual person beacon + `sensoryBoost` Hz on visionL/R / optic). Steering is still eye → LIF → MN → portable drone axes — **not** a PID go-to-pixel. No webcam? Drag the blob on the thumbnail. Optional hΔ plastic/frozen teaching overlay (client-side; worker has no `enableFastW`). Honest: **simulation** of a cam blob, not a real FPV quad. One-pager: [`docs/FOLLOW_ME.md`](docs/FOLLOW_ME.md). The homepage stays the fly body.

How to use:

1. Open `follow.html?v=follow1` (allow webcam or drag the synthetic blob).
2. Wait for male CNS load; drone hovers — **FLY IN CONTROL** when MNs drive axes.
3. Move / drag the blob; drone yaws toward it and advances when centered via the brain path.
4. Toggle fast weights ON to adapt while you move; freeze and jump sides to see worse reacquisition.

**Optional robot controller (`?body=drone`):** compound eye → optic/`visionL/R` pools → LIF → leg + descending MNs → [`web/controller/portable.js`](web/controller/portable.js) (`steering.forward` → pitch, `yawRate` → yaw; T2 strafe; wing MNs climb). **Stim map** (`?stim=1`): click pools like T1L/T1R to Hz-inject through LIF. Flight free-joint lift remains **off** unless `?flight=1` (fly mode only).

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

### Remote plant (optional MuJoCo)

**Public Pages already shows the full NeuroMechFly animal without a Mac plant.** Static github.io has no Python/MuJoCo: the shipped path is **in-browser kinematic NMF** (anatomical hinges, stance plant, MN drive). Dead Cloudflare tunnels are **not** auto-probed on github.io (that seized/vaulted the thorax).

True MuJoCo contact (`physics.py` / flygym) needs a host that can run the Docker image (`Dockerfile` → `serve.py --host 0.0.0.0`). There is **no always-on public plant URL** in this repo: the example `DEFAULT_PLANT` Cloudflare tunnel does not resolve. Attaching one:

1. Query string: `?plant=https://your-plant.example` (opt-in on Pages)
2. Or `localStorage.ffbPlant` on local/dev (ignored on static hosts)
3. Local `serve.py` still serves same-origin `/physics`

See `web/plantConfig.js` on the live Pages build. Smallest next step for contact physics on the public internet: a user-approved always-on plant host (Fly.io / Railway / etc.) **or** finish the in-browser plant path already sketched in the live `web/` stack — not a second architecture. Do not put secrets in the static UI.

## What you are seeing

Closed loop:

1. Light and odor from procedural landmarks drive the real sensory neurons.
2. Spikes propagate through the connectome (LIF + short-term depression, fast EPSP vs slow neuromod).
3. Descending + VNC **motor neurons** pose the NeuroMechFly legs (empty pools stay limp). Optional cube/drone modes map the same MNs to portable `{v, ω}` / quadrotor axes.
4. **Default (Pages):** NeuroMechFly mesh + planted stance-slip in the garden utopia (no Mac required). **Live MuJoCo:** local `serve.py` or `?plant=https://…`. **`?body=cube`:** box from portable `{v,ω}`. **`?body=drone`:** visual quadrotor from portable axes.

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

## hΔ fast-weight continual nav

Online fast weights on **hDeltaH / A / I / G** outgoing synapses; plastic vs frozen ablation on a two-context heading remap. Frozen fails the second context. Methods: [`docs/FAST_WEIGHT_HDELTA.md`](docs/FAST_WEIGHT_HDELTA.md). Demo: [`web/hdelta.html`](web/hdelta.html). Does **not** reopen CVA-SST Exp0/Exp1 or M1–M3.

```bash
python3 tools/hdelta/build_pools.py
node tools/hdelta/run_continual_nav.mjs          # W1
node tools/hdelta/run_experiments.mjs            # W1–W3 → results/hdelta/experiments.json
```

Interactive lab: [`web/hdelta.html?v=lab1`](web/hdelta.html) (Pages cache-bust). Freeze Δw mid-run, set η / decay, switch goal A/B or sequential A→B→A.

