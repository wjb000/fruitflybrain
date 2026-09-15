# hΔ fast-weight continual navigation

Headless two-context heading remap **and** interactive lab. **Does not reopen CVA-SST Exp0/Exp1 or M1–M3.**

Plastic types: **hDeltaH / hDeltaA / hDeltaI / hDeltaG** (Berg Male CNS v1.0, `status==Traced`). Fast weights live on those cells’ outgoing chemical edges (`LifEngine.enableFastW`). Readout: real **hDelta → PFL3** synapses.

```bash
# once (needs data/body-annotations.feather)
python3 tools/hdelta/build_pools.py

node tools/hdelta/run_continual_nav.mjs --smoke
node tools/hdelta/run_continual_nav.mjs
# default --n 8; writes results/hdelta/continual_nav.json

node tools/hdelta/run_experiments.mjs --smoke
node tools/hdelta/run_experiments.mjs
# W1 plastic vs frozen, W2 η sweep, W3 freeze-mid-run
# writes results/hdelta/experiments.json
```

| Exp | Condition | What should happen |
|---|---|---|
| W1 | plastic vs frozen | frozen fails context B; plastic remaps |
| W2 | η ∈ {0.02, 0.05, 0.10, 0.25} | default 0.10 remaps; table in JSON |
| W3 | freeze after A, switch B, unfreeze | frozen fails B; unfreeze recovers |

| Condition | Context A (left goal) | Context B (right goal) |
|---|---|---|
| plastic | learn + approach | keep updating — remaps |
| frozen | same A learning | Δw clamped — fails B |

Demo / lab: [`web/hdelta.html?v=lab1`](../../web/hdelta.html). Methods: [`docs/FAST_WEIGHT_HDELTA.md`](../../docs/FAST_WEIGHT_HDELTA.md).
