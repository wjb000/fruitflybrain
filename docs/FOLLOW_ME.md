# Follow-me demo (follow1)

Simulation: the **male CNS** steers the default quadrotor toward a webcam (or synthetic) blob. This is **not** a real FPV quad in the room, and Pages has no hardware bridge.

## Control law (honest)

```
webcam / synthetic blob
  → thin encoding (centroid cx, area)
      → virtual “you” food/beacon in fly.world  (azimuth from cx, distance from area)
      → sensoryBoost Hz on visionL/R + HS/VS/optic/loom
  → compound eye → optic / visionL/R write-in
  → LIF (sim.worker.js)
  → leg + descending MNs
  → portable.js droneSetpoints (pitch / yaw / strafe / throttle)
  → stepDroneChassis
```

Steering is **not** a PID go-to-pixel on the chassis. A thin pixel→sensory encoding is the only extra; MN-derived portable axes move the drone.

## Fast weights (labeled)

Toggle **hΔ plastic ON / frozen** on `follow.html`. This is a **client teaching overlay** on real **hDeltaH / A / I / G** column prefs (same 45-cell compact set as `hdelta.html`). It biases `visionL/R` stimInject. `sim.worker.js` does **not** run `enableFastW` on the 2832 outgoing chemical edges — that pack stays in `tools/hdelta/` + the lab page. Frozen keeps the last mapping, so a **jump side** reacquires worse; plastic adapts while you move. Does not reopen CVA-SST Exp0/Exp1.

## How to use

1. Open [`follow.html?v=follow1`](https://wjb000.github.io/fruitflybrain/follow.html?v=follow1) (allow webcam or **drag** the synthetic blob).
2. Wait for male CNS load; drone hovers — **FLY IN CONTROL** when MNs drive axes.
3. Move / drag the blob; drone yaws toward it and advances when centered via the brain path.
4. Toggle fast weights ON to adapt while you move; freeze and **jump side** to see worse reacquisition.

Main sim (fly body default): `index.html?v=thrive1` (optional `?cam=1` thumbnail, same encoding). Follow-me stays on the drone chassis. Cube: `?body=cube`. Drone homepage: `index.html?body=drone&v=thrive1`.

## Files

| Path | Role |
|---|---|
| `web/follow.html` / `web/follow.js` | Follow HUD (chase/FPV/orbit, sticks, cam thumb) |
| `web/handcam.js` | getUserMedia + synthetic drag + `worldBeacon` + `sensoryBoost` |
| `web/agent.js` | `setCamBoost` merged into vision/optic Hz; `world.person` as eye food |
| `docs/FAST_WEIGHT_HDELTA.md` | Full hΔ LIF pack (unchanged) |
