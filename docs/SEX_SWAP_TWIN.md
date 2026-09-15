# Courtship-vs-Aggression Sex-Swap Twin (CVA-SST)

Closed-loop digital twin of the adult *Drosophila* CNS in which **only sex-specific / dimorphic wiring** is edited, on a **fixed body, sensors, and isomorphic weights**. This is not a mapping notebook, not a female-only LIF, and not a walk demo.

## Abstract

We built a compressed closed-loop sex-swap twin of the Berg et al. (Cell, 3 Sept 2026) male CNS connectome (prepared **n = 165122**, **nEdges = 6235682**, minWeight 5) paired with Bates et al. BANC v888 female annotations (prepared **n = 139458**, **nEdges = 3372365**, minWeight 3). Descending (**group 1326**; `descending_neuron` = 1314) and ascending (**group 2393**; `ascending_neuron` = 1846) neurons sit in the **same MCSR** as optic lobe, central brain, and VNC — the intact neck connective of the male CNS volume. A dimorphic set of **2368** neurons (Berg labels: male-specific, sexually dimorphic, and potentially*) accounts for **176325** outgoing edges. The smallest experiment that still hits design goals A–D is **CVA-SST**: one pad scene with a female-silhouette + CHC/ppk channel versus a male-silhouette + cVA/smell channel; male vs isomorphic-only vs compressed female-swap vs shuffled sex-edges; courtship index (orientation to the female cue + wing/P1-cluster readout) versus aggression index (orientation to the male cue + aIPg readout). **Compressed female-swap smoke does not yet flip CI↔AI.** The claim remains the intended falsifiable discovery; sufficiency is not demonstrated until a full BANC edge transplant is run.

## Methods (postdoc rerun)

Public tables (do not invent neurons). neuPrint dataset **`male-cns:v1.0`**.

```text
https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/body-annotations-male-cns-v1.0-minconf-0.5.feather
https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/body-neurotransmitters-male-cns-v1.0.feather
https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/connectome-weights-male-cns-v1.0-minconf-0.5.feather
https://storage.googleapis.com/lee-lab_brain-and-nerve-cord-fly-connectome/compiled_data/banc_888/banc_888_meta.feather
https://storage.googleapis.com/lee-lab_brain-and-nerve-cord-fly-connectome/compiled_data/banc_888/banc_888_edgelist_simple_v2.feather
Harvard Dataverse DOI 10.7910/DVN/7WTH1N
```

```bash
mkdir -p data/banc
# curl the URLs above into data/ and data/banc/ (gitignored *.feather)
python3 tools/sex_swap/verify_counts.py
python3 tools/sex_swap/build_isomorphism.py
python3 tools/sex_swap/build_sex_swap_graph.py
node tools/sex_swap/run_cva_assay.mjs --smoke          # 4 seeds × 12 ticks
node tools/sex_swap/run_cva_assay.mjs --n 8 --ticks 24 # default quantitative pass
```

Seeds: `params/sex_swap_seeds.txt` (1000–1015). Parameters, claim, and pool names: `params/sex_swap_v1.json`.

**Male filter.** Annotations feather has 211577 rows; `status == Traced` yields 165122, matching `web/data/neurons.bin`. Berg ~166700 includes non-Traced / lower-confidence bodies. Edges: weight ≥ 5 among traced IDs.

**Female filter.** BANC meta has 188508 rows (glia, unproofread, empty superclass included). Prepared graph keeps proofread neurons with `super_class` not in `{glia, not_a_neuron, trachea, ""}` → 139458. `malecns_match` is non-null on **23608** meta rows.

**Neck.** Same male CSR contains optic sensory + central brain + VNC. Group counts: descending = 1326, ascending = 2393. Superclass exact: `descending_neuron` = 1314, `ascending_neuron` = 1846 (remainder are `sensory_descending` / `sensory_ascending` / `efferent_ascending` as in `prepare.py`). Berg et al. reconstructed an intact neck connective (brain+VNC in one volume).

**Isomorphism.** (1) BANC `malecns_match` → male `bodyId`. (2) `malecns_cell_type` ↔ male `type` (also male `type` ↔ BANC `cell_type`). Dimorphism set = `{male-specific, sexually dimorphic, potentially male-specific, potentially sexually dimorphic}` → 2368 cells. 1:1 partners are incomplete (~17105 unique traced bodies with a match). Unmatched male-specific types are ablated, not hallucinated.

**Controllers (compressed; edgeScale on the male CSR).**

| Controller | Edit |
|---|---|
| `male` | none |
| `iso_only` | outgoing of all 2368 dimorphic cells scaled to 0 |
| `female_swap` | male-specific (+potentially male-specific) outgoing scaled to 0; **sexually dimorphic outgoing restored** |
| `shuffle_sex` | degree-preserving shuffle of dimorphic outgoing targets (per seed) |

Body, photoreceptors, ORNs/ppk, and isomorphic (non-dimorphic) weights stay the male graph. This is **not** a full BANC edge transplant.

**State model.** Existing NT-aware LIF (`tools/lib/lif_engine.mjs`): ACh excitatory; GABA/Glu/histamine inhibitory (`inhibGain`); DA/5HT/OA as slow modulators; STD. Sensory write-in: `bindChannels(vision, smell, courtship, touch)` at ~20–40 Hz, with female cue modulating courtship/touch and male cue modulating smell (cVA). Embodiment: portable MN → `{v, ω}` cube chassis. NeuroMechFly is **not** closed.

**Metrics.** CI = 0.6 × fraction of time oriented toward the female cue (|bearing| < 45°) + 0.4 × tanh(wing MN / P1-cluster Hz). AI = 0.6 × orientation to the male cue + 0.4 × tanh(aIPg Hz). Courtship pool types requested: P1a/P1b/TN1*/vPR6/pIP1/mAL_m1/mAL_m8/aSP10* — Berg v1.0 has **P1a = P1b = 0**; the P1 cluster is typed **pC1_*** (n = 156). Aggression: aIPg1–7 (aIPg3 = 0 in this release).

## Main figures

1. **Counts and neck.** Male/female source vs prepared n, nEdges, minWeight; DN/AN in one CSR (Fig. 1 equivalent: `results/sex_swap/counts.json`).
2. **Isomorphism.** malecns_match coverage, type overlap, unmatched sex-specific counts (`isomorph_summary.json`).
3. **Graph edits.** 2368 dimorphic cells, 176325 out-edges; male / iso_only / female_swap / shuffle_sex (`graph_edit_manifest.json`).
4. **CVA scene.** Fixed pad; female silhouette (front-left) + courtship/touch drive; male silhouette (front-right) + cVA/smell drive; MN tank-steer chassis.
5. **CI vs AI by controller.** Mean ± s.d. across seeds (`cva_assay_summary.json`). Smoke: scene modulation present; **no CI↔AI sign flip**.
6. **Falsifier node set.** P1/pC1, aIPg1–7, mAL_m1/mAL_m8, TN1*, vPR6, pIP1 (and pIP10 if testing DN→wing MN).

## Claim

Sex-specific/dimorphic wiring alone (isomorphic weights, body, sensors fixed) is necessary and sufficient to flip closed-loop courtship vs aggression preference under matched scenes; isomorphic-only and shuffled sex-edges do not flip.

## Falsifying experiment

Intersectional silence of the twin-minimal sex-specific set (P1 / aIPg / mAL / TN1 / vPR6 / pIP1 contributors identified from Berg types in this graph) in real males should abolish the courtship–aggression flip predicted by the twin under the same two-cue sensory conditions; restoring those nodes’ output should restore it. If the twin (after full transplant) predicts a causal DN→VNC MN weight change, test intersectional silencing of that DN type (pIP1 / pIP10 → wing MNs).

## What failed (plain language)

- **No CI↔AI flip in compressed swap smoke.** Four seeds (1000–1003), 12 ticks: all four controllers gave the same mean Δ(CI−AI) = −0.30 (heading jitter only; MN displacement = 0). Vision write-in ~2 Hz; smell write-in detectable. Ablating male-specific outgoing while leaving sexually dimorphic edges intact did not invert preference. The claim is **not yet shown**; compressed edits are a necessity probe, not a sufficiency proof.
- **Full BANC edge transplant was not applied.** Female-swap does not insert female-specific partners’ synapses onto the male CSR. Cross-sex 1:1 maps are incomplete; unmatched female-specific types are not new somas.
- **P1a/P1b type strings are empty** in Male CNS v1.0; we used the real `pC1_*` cluster (n = 156) rather than inventing P1a cells. aIPg3 is also empty.
- **NeuroMechFly courtship kinematics are not closed.** Chassis is the existing portable MN→cube `{v, ω}` plant. Do not read wing-extension Hz as a 3D song posture.
- **Prepared n < paper n.** Male 165122 vs ~166700 because only `Traced`. Female 139458 vs ~188k meta rows because glia/unproofread/empty superclass are excluded.
- **Pages UI / `?sex=` viewer not shipped.** Offline node assay only.
- **N seeds in the committed smoke is small and ticks are short.** Re-run `run_cva_assay.mjs --n 8 --ticks 24` (seeds 1000–1007) before treating effect sizes as quantitative.

## Parameter file and seed list

- Graph construction: `tools/sex_swap/build_sex_swap_graph.py`
- Parameters (claim, falsifier, pools, Hz): `params/sex_swap_v1.json`
- Seeds: `params/sex_swap_seeds.txt` (1000…1015)
- One-sentence claim: see **Claim** above
