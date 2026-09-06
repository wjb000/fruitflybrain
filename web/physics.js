/** Client for the Python MuJoCo plant. Brain fires MNs; this is the flesh. */

import { plantUrl, plantBase } from "./plantConfig.js";

export const physics = {
  ok: false,
  err: "",
  pending: new Map(),
  poses: new Map(),
  last: null,
  plantOrigin: "",
};

let busy = false;

export async function connectPhysics() {
  physics.plantOrigin = plantBase() || "(same-origin)";
  try {
    const r = await fetch(plantUrl("/physics/health"));
    const j = await r.json();
    physics.ok = !!j.ok;
    physics.err = j.error || "";
    physics.last = j;
    return physics.ok;
  } catch (e) {
    physics.ok = false;
    physics.err = String(e);
    return false;
  }
}

export async function spawnPhysics(id, x, z, yaw) {
  if (!physics.ok) return null;
  const r = await fetch(plantUrl("/physics/spawn"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, x, z, yaw }),
  });
  const j = await r.json();
  if (j.pose) physics.poses.set(id, j.pose);
  if (j.ok === false) {
    physics.ok = false;
    physics.err = j.error || "spawn failed";
  }
  return j.pose || null;
}

export function despawnPhysics(id) {
  physics.pending.delete(id);
  physics.poses.delete(id);
  if (!physics.ok) return;
  fetch(plantUrl("/physics/despawn"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  }).catch(() => {});
}

export async function resetPhysics(id, x, z, yaw) {
  if (!physics.ok) return null;
  const r = await fetch(plantUrl("/physics/reset"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, x, z, yaw }),
  });
  const j = await r.json();
  if (j.pose) physics.poses.set(id, j.pose);
  return j.pose || null;
}

export function setCommand(id, cmd) {
  physics.pending.set(id, cmd);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    for (const id of [...physics.poses.keys()]) despawnPhysics(id);
  });
}

export function flushPhysics(dt) {
  if (busy || !physics.ok) return;
  if (physics.pending.size === 0 && physics.poses.size === 0) return;
  busy = true;
  const flies = {};
  for (const id of physics.poses.keys()) flies[id] = physics.pending.get(id) || {};
  for (const [id, cmd] of physics.pending) flies[id] = cmd;
  physics.pending.clear();
  fetch(plantUrl("/physics/step"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dt, flies }),
  })
    .then((r) => r.json())
    .then((j) => {
      if (j.ok === false) {
        physics.ok = false;
        physics.err = j.error || "step failed";
        return;
      }
      physics.last = j;
      if (j.flies) {
        for (const [id, pose] of Object.entries(j.flies)) physics.poses.set(id, pose);
      }
    })
    .catch((e) => {
      physics.ok = false;
      physics.err = String(e);
    })
    .finally(() => { busy = false; });
}
