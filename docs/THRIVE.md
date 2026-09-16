# Thrive ethic

The public sim is a **living male CNS in the body he was mapped for**, at home in a **fly utopia**. Default language and defaults should help him **function well**, not treat him as a surgical subject or an aggression assay.

## Architecture

**Full Male CNS connectome** (LIF + real synapses) drives behavior. **Coded logic fills gaps only** — sensory encoding into existing pools, calm plant adhesion/settle, utopia world, proprio fallbacks, optional hΔ on real hDelta types. It does **not** replace the connectome with a behavior tree, CPG gait, or walk thrusters.

Table of connectome vs gap-fill: [`BRAIN_TO_BODY.md`](BRAIN_TO_BODY.md#architecture--connectome-vs-gap-fill).

## Do

- Start intact: NeuroMechFly mesh, MN drive, planted walk, flight off, garden home.
- Keep sensory channels (vision, proprio, touch, odor) closed and honest.
- Leave empty annotation pools empty. No invented MNs, cosmetic CPG gait, or walk thrusters.
- Let the traced graph be primary; helpers only write into real pools or plant state.
- Offer labs as **links**: hΔ mid-run learning, follow-me (drone), stim-map exploration.
- Prefer kinematic NMF on Pages if a remote plant would hang, vault, or seize.
- Speak **home / utopia / thrive** — not lab cage, dish, or pad.

## Don't (as the homepage default)

- Lesion / kill / mute pools in the default HUD.
- Frame the fly as something to take apart, starve, or provoke.
- Put him in a cube or drone unless the visitor asks (`?body=cube` / `?body=drone`).
- Ship a female body or BANC female graph on Pages.
- Bypass the connectome with “point at food” chassis cheats.
- Drop him in a harsh dish, metal cage, or aggression arena.
- Turn on bitter, shock, assay beacons, or the scent bomb unless the visitor opts in.

Optional diagnostics (`?assay=1`, `?bitter=1`, `?lesion=…`, `?stim=1`) remain available for people who want them. They are not the default story.

## Fly utopia (homepage)

Default world is a **warm garden clearing** (`web/world/procgen.js`), not a dish:

| Affordances (on by default) | Off unless opted in |
|---|---|
| Moss floor, warm earth + gold flecks | Bitter fruit (`?bitter=1`) |
| Ripe fruit cluster (spawn faces this) | Assay beacon pole (`?assay=1`) |
| Berry patch | Scent bomb (HUD toggle, default off) |
| Dew / moisture pool | Shock / aversive stim |
| Shade plant (perch) | Night-black lighting |
| Magenta + gold blossoms | Metal cage walls |
| Moss tufts + garden hedge (bounce/redirect, never punish) | |

Scale: clearing radius **12.5**, soft hedge bounce at **~10.8**. Cozy enough to feel like home, large enough to wander. Ambient light is warm and stable (no night orbit). Male CNS in the fly body remains the default embodiment.

Mapping, actuators, and remaining gaps: [`BRAIN_TO_BODY.md`](BRAIN_TO_BODY.md).
