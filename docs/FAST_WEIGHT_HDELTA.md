# hΔ fast weights — continual navigation

Online fast weights on fan-shaped-body **hDeltaH / hDeltaA / hDeltaI / hDeltaG**, on the Berg et al. (Cell, 3 Sept 2026) male CNS graph. This is **not** CVA-SST. Exp0 / Exp1 / M1–M3 are left closed.

## Abstract

hΔ (pontine) neurons span fan-shaped-body columns and synapse onto PFL3 steering cells (Hulse et al. 2021). We treat their outgoing chemical synapses as a **fast-weight** matrix: a rapidly updated outer product / three-factor Hebbian Δw on top of the static connectome. A two-context heading task asks whether that plasticity is **necessary** to remap a goal. Context A pairs odor A with a **left** landmark; context B pairs odor B with a **right** landmark. **Plastic** hΔ weights remap onto B. **Frozen** weights (clamped after A) fail B and keep preferring A.

## Methods (postdoc rerun)

Public Male CNS v1.0. Do not invent neurons.

```bash
# annotations (gitignored) — same feather as CVA-SST counts
curl -L --fail -o data/body-annotations.feather \
  https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/body-annotations-male-cns-v1.0-minconf-0.5.feather

python3 tools/hdelta/build_pools.py
node tools/hdelta/run_continual_nav.mjs --smoke
node tools/hdelta/run_continual_nav.mjs          # N=8, ticks=32, steps=4
```

Prepared graph: `web/data/neurons.bin` + `connectome.bin` (n = 165122, nnz = 6235682, minWeight 5). Pool index order = `status == Traced` reset, matching `prepare.py`.

**Plastic set (type exact match).**

| Type | n (Traced) |
|---|---|
| hDeltaH | 8 |
| hDeltaA | 12 |
| hDeltaI | 17 |
| hDeltaG | 8 |
| **union** | **45** |

Outgoing chemical edges from the union: **2832**. Of those, **261** land on **PFL3** (24 cells; 12 L / 12 R). Every plastic hΔ cell has ≥1 PFL3 postsynaptic partner. EPG (n = 46) is heading write-in only; not plastic.

**State model.** Existing NT-aware LIF (`tools/lib/lif_engine.mjs`): ACh excitatory; GABA/Glu/histamine inhibitory; DA/5HT/OA slow; STD. **fastW** is an additive Δw on plastic outgoing edges, applied only when the presynaptic cell is in the hΔ set (all other synapses unchanged).

```
I_j += s · (√w_ij + fastW_ij)     # hΔ presynaptic chemical edges
fastW ← λ · fastW                 # decay, plastic only
fastW_ij += η · pre_i · target_j  # outer product; target = PFL3 laterality
```

`target_j = +1` on PFL3 matching the current goal side, `−1` on the opposite PFL3. Rate-based Hebbian uses heading-bump **drive** on hΔ (column cosine²) so learning does not wait on sparse spikes. Spike-based Hebbian on the same edges runs in `step()` when plastic. **Frozen:** apply Δw, skip decay and updates.

**Scene.** Fixed pad, two landmarks (left / right). Context A: food-odor channel high, goal = left. Context B: pheromone channel high, goal = right. Heading bump written into EPG + hΔ by FB/PB column parsed from instance (`_C#`). Embodiment: portable MN tank-steer **plus** fast-weight-decoded PFL3 laterality (`kFW` dominates by design — this experiment is about CX memory, not a new walk controller). NeuroMechFly is **not** closed.

**Protocol (per seed).** Learn A (plastic) → snapshot Δw → respawn → B plastic → restore snapshot → B frozen. A is shared. Seeds: `params/hdelta/seeds.txt` (2000–2015).

**Metrics.** Per phase, last half of ticks: `correct = 0.6 · orient_to_goal + 0.4 · near_goal`. Frozen **fails B** when mean correct_B < 0.42 and (correct_B − wrong_B) < 0.05. Plastic **remaps** when correct_B exceeds frozen by > 0.12 and prefers the right landmark.

## Claim

Online fast weights on hDeltaH/A/I/G outgoing synapses are necessary to remap a context→goal heading. After learning context A (left), freezing those weights causes failure on context B (right); keeping them plastic remaps.

## Falsifying experiment

Clamp or intersectionally block plasticity (or output) of hDeltaH/A/I/G in real flies after a first heading-goal association; the animal should fail to reverse the goal when the rewarded landmark switches, while the first-context heading remains. Restoring plasticity on those types should restore remapping. PFL3 is the predicted steering readout, not a newly invented motor neuron.

## What this is not

- Not a mushroom-body / DAN experiment (those types are untouched).
- Not a claim that static hΔ weights already store both contexts.
- Not CVA-SST Exp0 (mixed two-cue) or Exp1 (male Scene F vs M). Those results stay as published failures.
- Not M1–M3 (sex-swap controllers). Graph edits for dimorphic wiring are not applied here.

## Files

| Path | Role |
|---|---|
| `tools/lib/lif_engine.mjs` | `enableFastW` / Hebbian / freeze |
| `tools/hdelta/build_pools.py` | traced type → idx |
| `tools/hdelta/run_continual_nav.mjs` | two-context assay |
| `params/hdelta/v1.json` | claim, η, scene |
| `params/hdelta/pools.json` | committed indices |
| `results/hdelta/continual_nav.json` | metrics |
| `web/hdelta.html` | demo |

## Demo

[`web/hdelta.html`](../web/hdelta.html) — plastic vs frozen overlay on the two-landmark pad. Live page uses the same outer-product rule on the 45 real hΔ cells (column bump); the Node assay runs it inside the full male LIF.
