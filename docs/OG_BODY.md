# OG body — NeuroMechFly as his native morphology

The connectome should inhabit the **same animal** the map was traced from: adult male *Drosophila*, NeuroMechFly skeleton, MANC/BANC muscle names. This is gap-fill **plant geometry**, not a second controller.

Cache: [`?v=browseranimal1`](https://wjb000.github.io/fruitflybrain/?v=browseranimal1). Pipeline: [`BRAIN_TO_BODY.md`](BRAIN_TO_BODY.md). Coverage: [`LINKAGE.md`](LINKAGE.md).

## Full animal on GitHub Pages (zero user-hosted compute)

The public fly is a **full animal in this tab**. No Mac, no Fly.io, no paid plant.

1. **Preferred:** MuJoCo **WASM** (`@mujoco/mujoco` from jsDelivr, ~9 MB, single-threaded — GitHub Pages has no COOP/COEP) loads an NMF-compatible MJCF (`web/nmfMjcf.js`) and steps gravity, contacts, adhesion, and position actuators from MN commands.
2. **Always-on fallback:** if WASM cannot start, a **browser contact plant** (`web/browserPlant.js`) still runs gravity, tarsus contact/adhesion, and NMF joint limits, and returns the same pose/contacts snapshot so the mesh syncs.
3. **Optional lab override:** `?plant=https://…` or the HUD “connect remote” box talks to a Python `serve.py` flygym plant. `DEFAULT_PLANT` is empty.

HUD: **full MuJoCo animal** when WASM is up; **full animal (browser plant)** on the JS path; **kinematic NMF (full animal plant failed)** only if both fail.

Honest vs flygym: the browser MJCF is a capsule/sphere tree from `nmf.json` rest poses (42 leg hinges + neck 3 + abdomen + wings + 6 adhesion). It is **not** byte-identical to flygym’s compiled NeuroMechFly XML (no tendon-coupled tarsi, no exact `range=` from the micro-CT MJCF). Antennae / halteres / mouth stay visual FK from existing IDs.

## What “OG body” means here

```
Annotated MN pools (effectors.json)
  → antagonist pairing (Azevedo / Soler → NMF 7 DoF)
    → hinge delta on *anatomical* axes, clamped to NMF-like limits
      → in-browser MuJoCo / contact plant  (or kinematic FK if plant failed)
        → mesh bones follow thorax + joints
          → cho / hp / csa / prop Hz from those joints + load
```

Quiet MN pools → anatomical rest (NMF neutral pose). Driven pools → coherent whole-body: head, six legs, abdomen, gated wings, JO antennae, MN9 mouth.

## Anatomical directions

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

**In-browser plant:** tarsus spheres vs a plane, friction, adhesion actuators (stance sticky, swing peels). Gravity on the thorax free joint — **9810 mm/s²** in WASM; the JS Euler plant uses a reduced *g* so explicit integration stays planted (honest: not the same integrator). Mesh root = plant thorax (XYZ + quat).

**Kinematic fallback only:** tibia/tarsus IK plants claws on `GROUND_Y`; thorax `standSettle`. Not a walk thruster.

## Proprioception (closed loop)

| Organ | Joint / load | Pools |
|---|---|---|
| Hair plates | coxa yaw/pitch/roll | `hpT*` |
| Chordotonal | femur + tibia (+ tarsus) | `choT*` |
| Campaniform | stance load, tarsus, slip | `csaT*` |
| Aggregate proprio | blend | `propT*` + residual `proprio` / `campaniform` |

Neck → `hpT1`. Abdomen → `propT3` / `choT3`. Yaw / wings → `csaT3`. Same IDs as before — no invented sensors.

## Plant DoF (browser vs flygym)

| Piece | In-browser MJCF / contact | Python flygym (`?plant=`) |
|---|---|---|
| 42 leg DoFs | Anatomical axes + `NMF_JOINT_LIMIT` position actuators | Exact MJCF `range=` + NMF position actuators |
| Ground | Contacts + adhesion (WASM) or contact/adhesion JS | Contacts, friction, adhesion |
| Thorax free joint | 6-DoF + gravity | 6-DoF + gravity |
| Neck / abdomen / wings | **Actuated** from existing MN pools (browser extra vs locomotion NMF) | **STRUCTURAL** on `make_locomotion_fly` — visual FK |
| Antennae / halteres / mouth | Visual FK (no MN pool / no extra joint) | Visual FK |
| T2/T3 coxaProm, Ta* | Empty IDs; hinge may still exist | Same empty IDs |
| Flight translation | Off unless `?flight=1` | Same gate |

## What we will not add

- Invented T2/T3 promotor / tarsus MN cell IDs
- CPG / tripod clock
- Walk/turn thrusters that bypass MN foot contact
- User-owned always-on Python host as the public default
- Female BANC on Pages
