# Sensory path — as a fly on Earth

Connectome-primary gap-fill. World signals become **Hz on annotated Male CNS pools only**. No invented cell IDs, no RGB camera dump into neurons, no food-salience blob into motion cells, no bearing-to-fruit chassis PID.

Full architecture: [`BRAIN_TO_BODY.md`](BRAIN_TO_BODY.md). Ethic: [`THRIVE.md`](THRIVE.md).

## Vision (compound eye, not a photo)

```
utopia 3D (fruit, dew, moss, sky, other fly)
  → hexagonal ommatidia (`web/eye.js`, ~lattice RINGS=19, Δφ≈3.8°)
      R1–R6 / Rh1  achromatic broadband   →  R16* sectors
      R7           UV                     →  R7* sectors
      R8           blue–green (Rh5/Rh6)   →  R8* sectors
  → lamina
      L1  ON contrast  (brightening)
      L2  OFF contrast (darkening)
      L3  UV / DC object (not food identity)
  → medulla / lobula plate
      T4a–d  ON Hassenstein–Reichardt  (front/back/up/down)
      T5a–d  OFF correlators
      + geometric optic flow (ego-velocity × 1/depth = motion parallax)
      + loom / expansion (approaching surfaces; both T4a and T4b)
  → wide-field
      HS  horizontal T4/T5
      VS  vertical T4/T5 + loom
  → `encodeOpticRates` Hz → real stim.json IDs → LIF (`sim.worker.js`)
```

What a fly **does** see here: luminance contrast on the moss floor, UV-weighted sky and dew, yellow-weighted ripe fruit, motion parallax when he walks, looming when something (or the fruit) approaches.

What he **does not** see: an sRGB framebuffer, a 2D photo texture, or “this pixel is food so fire HS.” Object tags (`salFood` / `salWater`) remain **HUD / portable diagnostics only**.

`visionL` / `visionR` are the broad visual pools, filled from that eye’s R16 + R7 + R8 + L1 + motion — still L/R from the two eye axes (0.5 rad), not from a salience klinotaxis gain.

Pool IDs: `web/data/stim.json` (`R16` 1394, `R7` 1384, `R8` 1329, `L1–L3` ~177x, `T4*`/`T5*` ~16xx, `HS` 8, `VS` 34, `vision` 4114 split L/R by soma X). Empty stays empty.

## Other Earth-fly senses (existing pools)

| Sense | World | Pools |
|---|---|---|
| Olfaction | Lagrangian plumes (`plume.js`) at antenna tips | `foodORN` `pherORN` `co2ORN` `aversiveORN` L/R; **residual smell** also gets floral |
| Wind / JO | Gentle garden breeze + self-motion airflow | `JO` L/R |
| Taste | Graded contact at **nearest fruit** / (opt-in) bitter | `sweet` `bitter` `taste` |
| Hygro | Moist plume + dew (including extra puddle) + shade | `hygro` ← `hygrosensory` |
| Contact / courtship | Other-fly / nearest-food proximity | `ppk23` `ppk25` `IR52b` L/R |
| Proprio / campaniform / hair plates | MN pose or MuJoCo contacts | `cho*` `hp*` `csa*` `tact*` `prop*` (L/R); **residual campaniform / proprio** |
| Clock / neuromod | **l-LNv CRY from R7 UV**; DAN from sugar; hunger/sleep/arousal — calm Hz | `sLNv` `lLNv` `LNd` `DN1a` `DN1p` `DAN` `OA` `HT` `pep` |

No extra types. If a pool is empty in the Male CNS export, write-in is a no-op.

## Motor quiet (cns4 + fullfly1 + dynw1)

Idle DLM/DVM/ADMN do not flap (`wingFromEma`, high gate). Idle MN9 does not mouth (`feedFromEma` dead-zone). T1/neck stay cns3-calm. Idle T2/T3/DNa → planted rest (`embodyMuscle`); abdomen dead-zoned **and high-passed** so tonic pool hits are not a butt-lift loop. Walk slip is gated on **phasic** T2/T3+DNa, not a constant push from saturated neuromeres.

## Synapses over time (dynw1)

Chemical edges in `sim.worker.js` are **not unit hits**. Each spike transmits

`I_j += sign(NT_i) · wScale · chemWeight(w_ij) · u_i · x_ij`

with Tsodyks–Markram `u` (facilitation, per pre cell) and `x` (depression, per connectome edge). ACh/GABA/Glu depress under repeats; OA facilitates; histamine stays near-tonic. HUD shows live `syn u / x / eff`. Optional tiny hΔ Δw on the 45 traced hDelta cells only — the fly is not the hΔ lab.

## Cache

Pages: [`?v=browseranimal1`](https://wjb000.github.io/fruitflybrain/?v=browseranimal1). Coverage table: [`LINKAGE.md`](LINKAGE.md).
