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
node tools/hdelta/run_continual_nav.mjs          # N=8, ticks=24, steps=3
node tools/hdelta/run_experiments.mjs            # W1–W3 → results/hdelta/experiments.json
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

**Protocol (per seed).** Learn A (plastic) → snapshot Δw → respawn → B plastic → restore snapshot → B frozen. A is shared. A short context-pairing burst (rate-based outer product onto PFL3 laterality) runs at the start of each plastic phase, then the fly walks. Seeds: `params/hdelta/seeds.txt` (2000–2015).

**Metrics.** Per phase, last half of ticks: `correct = 0.6 · orient_to_goal + 0.4 · near_goal`. Frozen **fails B** when mean correct_B is below plastic and < 0.38. Plastic **remaps** when correct_B ≥ 0.35 and the B gap exceeds 0.15.

## Result (N = 8, ticks = 24, steps = 3)

Locked in `results/hdelta/continual_nav.json`. Shared context A correct = **0.60**. Context B: plastic **0.575 ± 0.046**, frozen **0.000**. Gap **0.575**. Verdict: **PASS — frozen fails on context B; plastic remaps.** Frozen still prefers the A (left) landmark on B (wrong_B = 0.60).

## Lab pack results (`results/hdelta/experiments.json`)

Declared box in `params/hdelta/v1.json` → `lab`. Plastic set unchanged (45 hΔ cells, 2832 outgoing edges).

| Exp | n | Result |
|---|---|---|
| W1 | 4 | plastic B **0.557**, frozen B **0.000**, gap **0.557** — PASS |
| W2 | 3 × 4 η | Remap saturates across `{0.02, 0.05, 0.10, 0.25}` (correct_B = 0.60); **mean \|Δw\|** scales with η (0.0008 → 0.0023 → 0.020 → 0.051). Pairing burst is enough even at 0.02 in this tick budget — recorded, not p-hacked. |
| W3 | 4 | After A, frozen B **0.000** (fail); unfreeze recover **0.600** — PASS |

## Claim

Online fast weights on hDeltaH/A/I/G outgoing synapses are necessary to remap a context→goal heading. After learning context A (left), freezing those weights causes failure on context B (right); keeping them plastic remaps.

## Falsifying experiment

Clamp or intersectionally block plasticity (or output) of hDeltaH/A/I/G in real flies after a first heading-goal association; the animal should fail to reverse the goal when the rewarded landmark switches, while the first-context heading remains. Restoring plasticity on those types should restore remapping. PFL3 is the predicted steering readout, not a newly invented motor neuron.

## What this is not

- Not a mushroom-body / DAN experiment (those types are untouched).
- Not a claim that static hΔ weights already store both contexts.
- Not CVA-SST Exp0 (mixed two-cue) or Exp1 (male Scene F vs M). Those results stay as published failures.
- Not M1–M3 (sex-swap controllers). Graph edits for dimorphic wiring are not applied here.

## Interactive lab

Live page: [`web/hdelta.html?v=lab1`](../web/hdelta.html) (Pages: `hdelta.html?v=lab1`). Same outer-product rule on the **45 real hΔ cells** (column bump); laterality is the collapsed hΔ→PFL3 L/R projection (261 real synapses). The Node pack runs the same rule on the **2832** outgoing chemical edges inside the full male LIF.

**How to play**

1. The fly walks as soon as the page loads (cyan path = plastic). Goal A (left, green) is armed.
2. **plastic ON/OFF** — freeze or unfreeze Δw mid-run. Frozen path turns orange. Frozen fly keeps the last mapping (after A it will still prefer left even if you click B).
3. **η / decay sliders** — learning rate and Δw leak, applied on the next tick. Default η = 0.10, decay = 0.998 (same as `params/hdelta/v1.json`).
4. **goal A (left)** / **goal B (right)** — switch the current target. If plastic, a short pairing burst writes the new PFL3 laterality; if frozen, weights do not change.
5. **A→B→A** — continual switch on the same two landmarks every ~7 s (A, B, A). No third heading: PFL3 readout is left/right only.
6. **clear weights** — zero Δw and respawn. **restart** — respawn, keep Δw.
7. **W1 overlay** — scripted A → plastic B (cyan) vs frozen B (orange) on the same pad.
8. Live readouts: **mean |Δw|**, **#edges updated** this tick (45 × 2 laterality slots), **heading error** to the current goal, **decoded goal** from `tanh(R−L)`.

Suggested mid-run experiment (matches headless W3): learn A (plastic) → freeze → click goal B (should fail, still decode A) → unfreeze (should remap to B).

## Experiment pack (headless)

```bash
node tools/hdelta/run_experiments.mjs --smoke
node tools/hdelta/run_experiments.mjs
# writes results/hdelta/experiments.json
```

Predeclared box: `params/hdelta/v1.json` → `lab`. Do not add η values after seeing results.

| Exp | Question | Protocol | Pass |
|---|---|---|---|
| **W1** | Are fast weights *necessary* to remap? | Learn A plastic; B plastic vs B frozen from the A snapshot | Frozen fails B (correct < 0.38 and below plastic); plastic remaps (correct_B ≥ 0.35, gap > 0.15) |
| **W2** | How does remap depend on η? | Plastic A→B at each η in `{0.02, 0.05, 0.10, 0.25}` | Default η = 0.10 still remaps; table recorded |
| **W3** | Freeze mid-run, then unfreeze? | Learn A → freeze → switch to B (must fail) → unfreeze on B (recover) | Frozen B fails; unfrozen B remaps |

Locked W1 (N = 8, ticks = 24, steps = 3) remains in `results/hdelta/continual_nav.json`. The lab pack re-runs W1 in the smaller declared box so W1–W3 share one JSON.

## Files

| Path | Role |
|---|---|
| `tools/lib/lif_engine.mjs` | `enableFastW` / Hebbian / freeze / `fastWStats` |
| `tools/hdelta/build_pools.py` | traced type → idx |
| `tools/hdelta/assay.mjs` | shared phase / W1 |
| `tools/hdelta/run_continual_nav.mjs` | two-context assay (W1) |
| `tools/hdelta/run_experiments.mjs` | pack W1–W3 |
| `params/hdelta/v1.json` | claim, η, scene, lab box |
| `params/hdelta/pools.json` | committed indices |
| `results/hdelta/continual_nav.json` | locked W1 N=8 |
| `results/hdelta/experiments.json` | W1–W3 pack |
| `web/hdelta.html` | interactive lab (`?v=lab1`) |
