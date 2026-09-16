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
| Olfaction | Lagrangian plumes (`plume.js`) at antenna tips | `foodORN` `pherORN` `co2ORN` `aversiveORN` L/R |
| Wind / JO | Body-frame wind + self-motion airflow | `JO` L/R |
| Taste | Graded contact at fruit / (opt-in) bitter | `sweet` `bitter` `taste` |
| Hygro | Moist plume + dew proximity | `hygro` ← `hygrosensory` |
| Contact / courtship | Other-fly / food proximity | `ppk23` `ppk25` `IR52b` L/R |
| Proprio / campaniform / hair plates | MN pose or MuJoCo contacts | `cho*` `hp*` `csa*` `tact*` `prop*` (L/R = soma-X of those IDs) |
| Clock / neuromod | Day, hunger, sleep, arousal — **calm Hz** | `sLNv` `lLNv` `LNd` `DN1a` `DN1p` `DAN` `OA` `HT` `pep` |

No extra types. If a pool is empty in the Male CNS export, write-in is a no-op.

## Motor quiet (cns4, kept)

Idle DLM/DVM/ADMN do not flap (`wingFromEma`, high gate). Idle MN9 does not mouth (`feedFromEma` dead-zone). T1/neck stay cns3-calm. Sensory upgrade does not reopen those gates.

## Cache

Pages: [`?v=cns4sense`](https://wjb000.github.io/fruitflybrain/?v=cns4sense).
