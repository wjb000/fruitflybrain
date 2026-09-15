# hΔ fast-weight continual navigation

Headless two-context heading remap. **Does not reopen CVA-SST Exp0/Exp1 or M1–M3.**

Plastic types: **hDeltaH / hDeltaA / hDeltaI / hDeltaG** (Berg Male CNS v1.0, `status==Traced`). Fast weights live on those cells’ outgoing chemical edges (`LifEngine.enableFastW`). Readout: real **hDelta → PFL3** synapses.

```bash
# once (needs data/body-annotations.feather)
python3 tools/hdelta/build_pools.py

node tools/hdelta/run_continual_nav.mjs --smoke
node tools/hdelta/run_continual_nav.mjs
# default --n 8, ticks=32, steps=4; writes results/hdelta/continual_nav.json
```

| Condition | Context A (left goal) | Context B (right goal) |
|---|---|---|
| plastic | learn + approach | keep updating — remaps |
| frozen | same A learning | Δw clamped — fails B |

Demo page: [`web/hdelta.html`](../../web/hdelta.html). Methods: [`docs/FAST_WEIGHT_HDELTA.md`](../../docs/FAST_WEIGHT_HDELTA.md).
