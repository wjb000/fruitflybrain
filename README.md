# Fruit-fly CNS — live connectome driving a body

The **complete adult male *Drosophila* central nervous system** (brain + ventral nerve cord) driving a NeuroMechFly body in a dish. The public sim is **male CNS only** (the more complete map). Female BANC data may still exist under `web/data/female/` / `prepare_banc.py` as a historical offline path — it is not loaded or offered in the UI.

Honest MN→body coupling (Dan Robinson bar): legs, wings, head, abdomen, and proboscis move **only** from measured motor-neuron rates. Quiet pools → quiet body. No cosmetic wing flapping, no scripted CPG gait, no free-joint walk/turn thrusters.

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

1. Light and odor in the dish drive the real sensory neurons.
2. Spikes propagate through the connectome (LIF + short-term depression, fast EPSP vs slow neuromod).
3. Descending + VNC **motor neurons** set leg/wing/head/abdomen/proboscis actuators.
4. Locally **MuJoCo** (NeuroMechFly) is the flesh; on static hosts the flesh is kinematic MN→pose→stance-slip.

**x-ray CNS** makes the cuticle transparent so you can see the reconstructed brain inside. Stim buttons bias sensory channels — body motion still only emerges if MNs fire.

See [`docs/BRAIN_TO_BODY.md`](docs/BRAIN_TO_BODY.md) for the full sensory→MN→actuator map and the honest gap list (empty annotation pools stay empty).
