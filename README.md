# Male fruit-fly CNS — live connectome

The **complete adult male *Drosophila* central nervous system** (brain + ventral nerve cord) driving a walking fly in a dish.

His antennae smell a sugar drop; descending and VNC motor neurons from the connectome set speed and steering; a tripod gait moves the legs.

This is the map published 3 September 2026 by FlyEM / HHMI Janelia, the University of Cambridge, MRC LMB, and Google Research:

> Berg et al. *Sexual dimorphism in the complete connectome of the Drosophila male central nervous system.* Cell (2026).

~166,000 traced neurons, millions of synaptic edges, somas in real EM coordinates, and reconstructed morphologies for landmark cells (giant fiber, courtship neurons, Kenyon cells, descending neurons).

## Run

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python prepare.py          # first time: builds web/data from the public Male CNS files
python serve.py            # opens http://127.0.0.1:8787/
```

`prepare.py` expects the public tables already under `data/` (annotations, neurotransmitters, connectome-weights, brain/VNC meshes). Those are CC-BY from [male-cns.janelia.org](https://male-cns.janelia.org/).

## What you are seeing

A male fly in an arena. Closed loop:

1. Light and odor in the dish drive the real sensory neurons.
2. Spikes propagate through the Male CNS connectome (≥5 synapses/edge).
3. Descending + VNC motor rates set walk speed and left/right turn.
4. A tripod gait CPG (same split NeuroMechFly uses) moves the six legs.

**x-ray CNS** makes the cuticle transparent so you can see the reconstructed brain inside him. **Courtship** buzzes the wings; **escape** (giant fiber DNp01) makes him jump.
