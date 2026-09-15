# CVA-SST sex-swap tools

Offline Courtship-vs-Aggression Sex-Swap Twin. No UI. BANC transplant **v2**; committed N=16 result is **FAILED** (no CI↔AI sign flip).

## Rerun

Feathers go in `data/` (male) and `data/banc/` (female); both globs are gitignored. Prepared male CSR is `web/data/connectome.bin`.

```bash
python3 tools/sex_swap/verify_counts.py
python3 tools/sex_swap/build_isomorphism.py
python3 tools/sex_swap/build_sex_swap_graph.py
python3 tools/sex_swap/build_banc_transplant.py
# writes results/sex_swap/connectome_female_swap.bin (gitignored) + transplant_summary.json

node tools/sex_swap/run_cva_assay.mjs
# default --n 16, ticks=48, steps=8; female_swap uses connectome_female_swap.bin
node tools/sex_swap/run_cva_assay.mjs --smoke
```

Do not commit `results/sex_swap/*.bin` or `data/banc/`. Rebuild the female-swap CSR with `build_banc_transplant.py`. Seeds: `params/sex_swap_seeds.txt` (1000–1015). Claim / drive / scene: `params/sex_swap_v1.json`.
