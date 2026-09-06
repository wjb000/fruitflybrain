# Lesion assay — take the fly apart on purpose

**North star:** not "make a smarter fly." First animal we can take apart on purpose. Real male CNS → NeuroMechFly, sensory in / muscles out, no hand-coded walk. Hard job: see a thing, remember where it is, go get it after lights/world rotate (tiny thought, not a twitch).

Grok (or any worker) runs mass virtual surgeries on the **LIF connectome path** — silence a cell type, boost, cut a bundle, swap L/R, add synaptic delay, hunger via neuromod. Keep only **weird specific deficits** (still walks + sees but lost memory/heading), not "falls over."

Encore = **robot controller** (`web/controller/portable.js`): vision→steering → `{v, omega}` for cube or hardware. **Now:** assay + lesion harness + that API.

Constraints for this scaffolding: **male-only, MN-only body drive, calm gains, no thrusters / cosmetics / invented MNs.**

## Philosophy

| Do | Don't |
|---|---|
| Lesion named pools / edges in `sim.worker.js` | Zero joint torques or fake walk thrusters |
| Score approach after reorientation vs chance | Call "task fail" when the fly is blind or paralyzed |
| Export HS/VS / descending / MN turn·walk for robots | Invent motor neurons for empty annotation pools |

Failure labels from the assay:

- **blindness** — optic readout never responds
- **motor** — leg MN / displacement dead
- **memory_heading** — senses + walks, but post-rotate approach ≈ chance ← *interesting*

## One browser trial + one silence lesion

```bash
python serve.py
# open:
#   http://127.0.0.1:8787/?assay=1&lesion=silence:HS
```

Or with the sim already open: `?dev=1` shows the assay panel → **silence HS** → **run trial**.

Programmatic (console):

```js
ffbPortable.applyLesion("silence:HS");
ffbPortable.snapshot(); // vision → steering
ffbPortable.stub();     // chassis { v, omega } placeholder
```

Lesion flag grammar (combine with `|`):

| Flag | Effect on LIF |
|---|---|
| `silence:HS,VS` | Named pools cannot spike / transmit |
| `boost:OA:2.5` | Outgoing gain ×2.5 |
| `cut:HS,VS>DNa,DNp` | Zero weights from → to |
| `swapLR:HS,VS` | Pair opposite-x homologs; swap outgoing wiring |
| `delay:HS:40` | +40 ms synaptic delay |
| `hunger:1.2` | Neuromod dial (DA/OA deposit scale) |

## One headless sweep (CLI)

```bash
node tools/sweep_lesions.mjs
node tools/sweep_lesions.mjs --lesion 'silence:HS' --lesion 'none'
node tools/sweep_lesions.mjs --out sweeps/run.jsonl --ticks 80
```

Writes JSONL scores + a `.ranked.json` (interesting first). Full overnight grids can reuse the same schema.

## Robot controller (portable API)

Module: `web/controller/portable.js` — the clean robot-facing surface.

| Signal | Meaning |
|---|---|
| `vision.HS_L/R`, `VS_L/R` | Lobula-plate wide-field pools (eye→LIF) |
| `vision.salTarget` / `asymFood` | Beacon salience diagnostics (not actuators) |
| `descending.DNa/DNp/…` | Descending EMAs |
| `motor.walk/turn/fly` | MN-derived labels (not thrusters) |
| `steering.forward` / `yawRate` | Clean chassis commands (−1…1 yaw) |
| `neuromod.hunger/OA/DAN` | Slow dials |

```js
ffbPortable.snapshot(); // full vision + MN snapshot
ffbPortable.stub();     // conservative { v, omega } for hardware
ffbPortable.chassis();  // same mapping the cube plant uses
ffbPortable.howto;      // control-law text
```

`stubRobotDriver(snapshot)` / `chassisSetpoints(snapshot)` return
`{ v, omega, forward, yawRate, salTarget, source, t }`. A real robot publishes
`v` / `omega` to its base; quiet MNs ⇒ near-zero command.

## Files

| Path | Role |
|---|---|
| `web/lesion.js` | Config parse / pool resolve |
| `web/sim.worker.js` | LIF lesion ops |
| `web/agent.js` | `applyLesion` / `getPortableControls` |
| `web/assay/*` | Approach assay + dev panel |
| `web/controller/portable.js` | Robot interface |
| `tools/sweep_lesions.mjs` | Headless sweep CLI |
| `tools/lib/lif_engine.mjs` | Node LIF port |

## Worker message (agents)

```js
fly.applyLesion({
  id: "silence-HS",
  ops: [{ op: "silence", pools: ["HS"] }],
});
fly.clearLesion();
```

Worker accepts `{ type: "lesion", lesion: { id, ops }, clear: true }` with ops already resolved to `ids` / `fromIds` / `toIds` (the agent does name→id resolution).


## Dish v2 — see → dark → yaw animal → dark-retrieve

Headless: `tools/lib/assay_dish.mjs` + `tools/sweep_lesions.mjs`  
Browser: `web/assay/assay.js` (stable spawn, bright beacon, landmark hidden after encode)

Phases: **encode** (lights on, long enough to lock-on) → **dark** → **yaw** (π **animal** heading; landmark fixed) → **retrieve** (**lights out / landmark hidden**).

Scoring: `blindness` | `motor` | `memory_heading` (walk+see, post-yaw dark approach ≤ chance) | ok.

Metrics: `encodeApproach`, `postRotateApproach`, `chanceFloor`, `motorOK`, `seeOK`, `taskOK` under dark retrieve.

Baseline: `node tools/baseline_intact.mjs [N]` → `results/lesion_sweeps/baseline_intact_dish_v2_dark.json`

**Why yaw the animal (not the food):** rotating the landmark past the fly used to shrink distance without locomotion and let lights-on retrieve succeed by reacquisition. Fixed landmark + dark retrieve requires memory of bearing/place.

**Honest limit:** headless LIF+MN tank-steer is still not full browser eye + MuJoCo. Wire-hunting waits until intact dark-retrieve is clearly above chance with non-zero encode lock-on.
