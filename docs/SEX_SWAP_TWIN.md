# Courtship-vs-Aggression Sex-Swap Twin (CVA-SST)

Closed-loop digital twin of the adult *Drosophila* CNS in which **only sex-specific / dimorphic wiring** is edited, on a **fixed body, sensors, and isomorphic weights**. This is not a mapping notebook, not a female-only LIF, and not a walk demo.

## Abstract

We built a closed-loop sex-swap twin of the Berg et al. (Cell, 3 Sept 2026) male CNS connectome (prepared **n = 165122**, **nEdges = 6235682**, minWeight 5; source annotations **211577** rows, NT table **1835518** rows) paired with Bates et al. BANC v888 female annotations (meta **188508 × 81**; prepared **n = 139458**, **nEdges = 3372365**, minWeight 3). BANC regions: optic_lobe **108764**, central_brain **47688**, VNC **31688**; BANC `super_class` descending **1316**, ascending **1849**. Male descending (**group 1326**; `descending_neuron` = 1314) and ascending (**group 2393**; `ascending_neuron` = 1846) neurons sit in the **same MCSR** as optic lobe, central brain, and VNC — the intact neck connective. A dimorphic set of **2368** neurons / **478** types (male-specific 1258, sexually dimorphic 771, potentially sexually dimorphic 177, potentially male-specific 162) accounts for **176325** outgoing edges. Cross-sex map: `malecns_match` non-null **23608**; `malecns_cell_type` nunique **10445** overlapping **5250** male traced types; `cell_type` overlap **7442**. BANC transplant **v2** (ablate male-specific + potentially MS outgoing; replace body-matched `malecns_match` and type-matched `malecns_cell_type` dimorphic outgoing with BANC-mapped edges; **keep unmatched sexually-dimorphic male outgoing**) yields female_swap nnz **6124057** (body-mapped **22115**, type-transplant **6247**; **1678** neurons' outs removed; **690** unmatched SD kept; **1420** MS ablated). **CVA-SST** is a compact headless assay (no UI): one pad scene with a female-silhouette + courtship/touch channel versus a male-silhouette + cVA/smell channel; male vs isomorphic-only vs BANC female-swap vs shuffled sex-edges. **N=16 (ticks=48, steps=8): no CI↔AI sign flip.** Claim status: **FAILED**. Secondary: iso_only collapses aIPg **1.45→0.006** Hz; transplant restores **~0.71** Hz without flipping preference.

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
python3 tools/sex_swap/build_banc_transplant.py        # v2; gitignored connectome_female_swap.bin
node tools/sex_swap/run_cva_assay.mjs --smoke          # 4 seeds × 12 ticks
node tools/sex_swap/run_cva_assay.mjs                  # default N=16, ticks=48, steps=8
```

Seeds: `params/sex_swap_seeds.txt` (1000–1015). Parameters, claim, and pool names: `params/sex_swap_v1.json`.

**Male filter.** Annotations feather has **211577** rows (14 MB); `status == Traced` yields **165122**, matching `web/data/neurons.bin`. NT feather **1835518** rows (42 MB). Berg ~166700 includes non-Traced / lower-confidence bodies. Edges: weight ≥ 5 among traced IDs (**6235682**). Dimorphism: male-specific 1258, sexually dimorphic 771, potentially sexually dimorphic 177, potentially male-specific 162.

**Female filter.** BANC meta has **188508 × 81** rows (glia, unproofread, empty superclass included). Regions: optic_lobe 108764, central_brain 47688, VNC (`ventral_nerve_cord`) 31688. `super_class` descending = 1316, ascending = 1849 (full meta; prepared female groups are 1312 / 2356 after the proofread-neuron filter). Prepared graph keeps proofread neurons with `super_class` not in `{glia, not_a_neuron, trachea, ""}` → **139458**. `malecns_match` is non-null on **23608** meta rows.

**Neck.** Same male CSR contains optic sensory + central brain + VNC. Group counts: descending = 1326, ascending = 2393. Superclass exact: `descending_neuron` = 1314, `ascending_neuron` = 1846 (remainder are `sensory_descending` / `sensory_ascending` / `efferent_ascending` as in `prepare.py`). Berg et al. reconstructed an intact neck connective (brain+VNC in one volume).

**Isomorphism.** Prefer (1) BANC `malecns_match` → male `bodyId` and (2) `malecns_cell_type` ↔ male `type`; fall back to type-name intersection with BANC `cell_type`. `malecns_cell_type` nunique **10445**, overlap with male traced types **5250**; `cell_type` overlap **7442**. Dimorphism set = `{male-specific, sexually dimorphic, potentially male-specific, potentially sexually dimorphic}` → **2368 cells, 478 types**. 1:1 partners are incomplete (~17105 unique traced bodies with a match). Unmatched male-specific types are ablated, not hallucinated.

**Controllers (BANC transplant v2; female_swap uses an alternate CSR).**

| Controller | Edit |
|---|---|
| `male` | none (intact male CSR) |
| `iso_only` | outgoing of all 2368 dimorphic cells scaled to 0 on the male CSR |
| `female_swap` | v2: ablate male-specific (+potentially MS) outs; replace body-matched (`malecns_match`) and type-matched (`malecns_cell_type`) dimorphic outs with BANC-mapped edges; **KEEP unmatched sexually-dimorphic male outs**. Loaded as `connectome_female_swap.bin` |
| `shuffle_sex` | degree-preserving shuffle of dimorphic outgoing targets on the male CSR (per seed) |

Body, photoreceptors, ORNs/ppk, and isomorphic (non-dimorphic) weights stay the male graph. Unmatched male-specific types are ablated, not hallucinated as new somas.

**State model.** Existing NT-aware LIF (`tools/lib/lif_engine.mjs`): ACh excitatory; GABA/Glu/histamine inhibitory (`inhibGain`); DA/5HT/OA as slow modulators; STD. Sensory write-in: `bindChannels(vision, smell, courtship, touch)` at stronger drive (~32–48 Hz), with female cue modulating courtship/touch and male cue modulating smell (cVA). CI/AI use **second-order** cue→`courtship_core` / `aIPg` rates after the graph, not the write-in. Embodiment: portable MN → `{v, ω}` cube chassis. NeuroMechFly is **not** closed.

**Metrics.** CI = 0.35 × fraction of time oriented toward the female cue (|bearing| < 45°) + 0.65 × tanh(`courtship_core` Hz). AI = 0.35 × orientation to the male cue + 0.65 × tanh(aIPg Hz). Courtship pool types requested: P1a/P1b/TN1*/vPR6/pIP1/mAL_m1/mAL_m8/aSP10* — Berg v1.0 has **P1a = P1b = 0**; the P1 cluster is typed **pC1_*** (n = 156). Aggression: aIPg1–7 (aIPg3 = 0 in this release).

## Main figures

1. **Counts and neck.** Male/female source vs prepared n, nEdges, minWeight; DN/AN in one CSR (Fig. 1 equivalent: `results/sex_swap/counts.json`).
2. **Isomorphism.** malecns_match coverage, type overlap, unmatched sex-specific counts (`isomorph_summary.json`).
3. **Graph edits.** 2368 dimorphic cells, 176325 out-edges; BANC transplant v2 female_swap nnz 6124057 (`graph_edit_manifest.json`, `transplant_summary.json`).
4. **CVA scene.** Fixed pad; female silhouette (front-left) + courtship/touch drive; male silhouette (front-right) + cVA/smell drive; MN tank-steer chassis.
5. **CI vs AI by controller (N=16).** Means below; **signFlip = false**.
6. **Secondary finding.** iso_only aIPg collapse and partial restore under transplant — not a preference flip.

## Results (N=16, ticks=48, steps=8)

| controller | mean CI | mean AI | Δ(CI−AI) | wing Hz | aIPg Hz |
|---|---|---|---|---|---|
| male | 0.837 | 0.548 | +0.289 | 6.35 | 1.447 |
| iso_only | 0.825 | 0.157 | +0.669 | 4.50 | 0.006 |
| female_swap | 0.823 | 0.380 | +0.443 | 5.00 | 0.715 |
| shuffle_sex | 0.870 | 0.592 | +0.278 | 4.53 | 1.918 |

**signFlip = false.** All four controllers remain CI > AI. `cva_assay_summary.json`.

**Secondary:** iso_only collapses aIPg **1.45→0.006**; BANC transplant restores **~0.71** without a CI↔AI flip.

## Claim

**Status: FAILED** (`FAILED_NO_SIGN_FLIP`).

Intended claim: sex-specific/dimorphic wiring alone (isomorphic weights, body, sensors fixed) is necessary and sufficient to flip closed-loop courtship vs aggression preference under matched scenes; isomorphic-only and shuffled sex-edges do not flip.

N=16 BANC transplant v2 did **not** produce a CI↔AI sign flip (male Δ+0.289, female_swap Δ+0.443). The claim is rejected on this assay.

## What failed (plain language)

- **No CI↔AI flip after BANC transplant v2 (N=16).** Male, iso_only, female_swap, and shuffle_sex all stay courtship-preferring (CI > AI). Female-swap Δ(+0.443) does not invert male Δ(+0.289). **signFlip = false; claim FAILED.**
- **Secondary, not a flip:** iso_only collapses aIPg 1.447→0.006 Hz; transplant restores ~0.715 Hz. Aggression-pool drive is wiring-sensitive; preference sign is not.
- **No silencing falsifier for a failed flip.** There is no demonstrated CI↔AI flip to abolish with intersectional silence of P1/aIPg/mAL/TN1/vPR6/pIP1. That experiment is not offered here.
- **P1a/P1b type strings are empty** in Male CNS v1.0; we used the real `pC1_*` cluster (n = 156) rather than inventing P1a cells. aIPg3 is also empty.
- **NeuroMechFly courtship kinematics are not closed.** Chassis is the existing portable MN→cube `{v, ω}` plant. Do not read wing-extension Hz as a 3D song posture.
- **Prepared n < paper n.** Male 165122 vs ~166700 because only `Traced`. Female 139458 vs ~188k meta rows because glia/unproofread/empty superclass are excluded.
- **Pages UI / `?sex=` viewer not shipped.** Offline node assay only.
- **Cross-sex 1:1 maps are incomplete.** Unmatched SD outgoing is kept (690 cells); unmatched MS is ablated (1420), not invented.

## Parameter file and seed list

- Graph construction: `tools/sex_swap/build_sex_swap_graph.py`
- BANC transplant v2: `tools/sex_swap/build_banc_transplant.py`
- Parameters (claim_status FAILED_NO_SIGN_FLIP, pools, Hz): `params/sex_swap_v1.json`
- Seeds: `params/sex_swap_seeds.txt` (1000…1015)
- One-sentence claim status: **FAILED** (no CI↔AI sign flip). See **Claim** above.
