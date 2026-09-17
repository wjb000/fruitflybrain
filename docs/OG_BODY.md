# OG body — NeuroMechFly as his native morphology

The connectome should inhabit the **same animal** the map was traced from: adult male *Drosophila*, NeuroMechFly skeleton, MANC/BANC muscle names. This is gap-fill **plant geometry**, not a second controller.

Cache: [`?v=ogbody1`](https://wjb000.github.io/fruitflybrain/?v=ogbody1). Pipeline: [`BRAIN_TO_BODY.md`](BRAIN_TO_BODY.md). Coverage: [`LINKAGE.md`](LINKAGE.md).

## What “OG body” means here

```
Annotated MN pools (effectors.json)
  → antagonist pairing (Azevedo / Soler → NMF 7 DoF)
    → hinge delta on *anatomical* axes, clamped to NMF-like limits
      → FK of NMF rest segments (nmf.json / nmf.bin)
        → stance tarsi meet the moss (contact IK, not a CPG)
          → cho / hp / csa / prop Hz from those joints + load
```

Quiet MN pools → anatomical rest (NMF neutral pose). Driven pools → coherent whole-body: head, six legs, abdomen, gated wings, JO antennae, MN9 mouth.

## Anatomical directions (Pages kinematic)

Virtual world-XYZ hinges made mid/hind legs flex like a bilateral puppet. Axes now come from **NMF rest bone directions**:

| DoF | Axis | Positive MN |
|---|---|---|
| coxa pitch | ipsilateral lateral (leg plane) | `coxaProm` vs `coxaRem` |
| coxa yaw | thorax-up / coxa frame | `coxaAdd` vs `coxaRem` |
| coxa roll | coxa long axis | `coxaRotA` vs `coxaRotP` |
| trochanterfemur pitch | femur-plane lateral | `trExt` vs `trFlex` |
| trochanterfemur roll | femur long axis | `feRed` (unipolar) |
| tibia pitch | tibia-plane lateral | `tiExt` vs `tiFlex` |
| tarsus1 pitch | same as tibia | `taLev` vs `taDep` |

L/R pitch axes are mirrored. T1 limits are smaller than T3 (foreleg reach vs hind stance). Empty male T2/T3 `coxaProm` / `taDep` / `taLev` stay **0 in motEma**; walking may couple those *hinges* only.

Tarsus tip is the distal claw (tarsus4→5), not the tarsus5 mesh origin.

## Ground contact

When MNs mark a leg **stance**, tibia/tarsus IK plants that claw on `GROUND_Y` (moss). Swing legs may leave the floor. Thorax `standSettle` eases so the median stance foot sits on the moss. This is contact, not a walk thruster.

## Proprioception (closed loop)

| Organ | Joint / load | Pools |
|---|---|---|
| Hair plates | coxa yaw/pitch/roll | `hpT*` |
| Chordotonal | femur + tibia (+ tarsus) | `choT*` |
| Campaniform | stance load, tarsus, slip | `csaT*` |
| Aggregate proprio | blend | `propT*` + residual `proprio` / `campaniform` |

Neck → `hpT1`. Abdomen → `propT3` / `choT3`. Yaw / wings → `csaT3`. Same IDs as before — no invented sensors.

## OG kinematic vs remaining plant limits

| Piece | Pages kinematic (OG mesh) | MuJoCo plant (`?plant=`) |
|---|---|---|
| 42 leg DoFs | Anatomical axes + NMF-like half-ranges around rest | Real MJCF joint ranges + position actuators |
| Ground | Tarsus-Y plant IK + thorax settle | Contacts, friction, adhesion |
| Thorax free joint | Yaw + planted Y; XY from stance-slip | Full 6-DoF physics |
| Neck / abdomen 3–6 / wings / mouth / antennae | Visual FK from existing MNs / JO | **STRUCTURAL** — plant has no neck; soft parts stay visual |
| T2/T3 coxaProm, Ta* | Empty IDs; hinge couple while walking | Same empty IDs |
| Haltere MN | None — gyro + wing MNs | Same |
| Flight translation | Off unless `?flight=1` | Same gate |

Exact MJCF `range=` numbers live in the flygym XML. The browser cannot read them without shipping the plant; `NMF_JOINT_LIMIT` is the documented NMF-like clamp for the kinematic path.

## What we will not add

- Invented T2/T3 promotor / tarsus MN cell IDs
- CPG / tripod clock
- Walk/turn thrusters that bypass MN foot slip
- Fake neck joint on the plant
- Female BANC on Pages
