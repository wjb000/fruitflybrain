/** Client for the Python MuJoCo plant. Brain fires MNs; this is the flesh. */

import { plantUrl, plantBase, DEFAULT_PLANT } from "./plantConfig.js";

export const physics = {
  ok: false,
  err: "",
  pending: new Map(),
  poses: new Map(),
  last: null,
  plantOrigin: "",
};

let busy = false;
let reconnectAt = 0;

async function probe(url) {
  const r = await fetch(url + "/physics/health", { mode: "cors" });
  if (!r.ok) throw new Error("health " + r.status);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || "plant not ok");
  return j;
}

export async function connectPhysics() {
  const tried = [];
  const candidates = [];
  const base = plantBase();
  if (base) candidates.push(base);
  if (DEFAULT_PLANT) {
    const d = DEFAULT_PLANT.replace(/\/$/, "");
    if (!candidates.includes(d)) candidates.push(d);
  }
  // same-origin last (Pages has no /physics)
  candidates.push("");

  for (const c of candidates) {
    const origin = c || "(same-origin)";
    tried.push(origin);
    try {
      const healthUrl = c ? (c + "/physics/health") : "/physics/health";
      const r = await fetch(healthUrl, { mode: "cors" });
      const j = await r.json();
      if (!j.ok) continue;
      physics.ok = true;
      physics.err = "";
      physics.last = j;
      physics.plantOrigin = origin;
      // Persist working tunnel so next load skips a dead localStorage value.
      if (c) {
        try { localStorage.setItem("ffbPlant", c); } catch (_) {}
      }
      return true;
    } catch (e) {
      physics.err = String(e);
    }
  }
  physics.ok = false;
  physics.plantOrigin = tried[0] || "";
  physics.err = physics.err || ("no plant among " + tried.join(", "));
  reconnectAt = performance.now() + 4000;
  return false;
}

/** If plant dropped (tunnel blip), retry without reloading the page. */
export function maybeReconnectPhysics() {
  if (physics.ok) return;
  if (performance.now() < reconnectAt) return;
  reconnectAt = performance.now() + 8000;
  connectPhysics().catch(() => {});
}

export async function spawnPhysics(id, x, z, yaw) {
  if (!physics.ok) return null;
  try {
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
      reconnectAt = performance.now() + 3000;
    }
    return j.pose || null;
  } catch (e) {
    physics.ok = false;
    physics.err = String(e);
    reconnectAt = performance.now() + 3000;
    return null;
  }
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
  try {
    const r = await fetch(plantUrl("/physics/reset"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, x, z, yaw }),
    });
    const j = await r.json();
    if (j.pose) physics.poses.set(id, j.pose);
    return j.pose || null;
  } catch (e) {
    physics.ok = false;
    physics.err = String(e);
    reconnectAt = performance.now() + 3000;
    return null;
  }
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
  maybeReconnectPhysics();
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
        reconnectAt = performance.now() + 3000;
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
      reconnectAt = performance.now() + 3000;
    })
    .finally(() => { busy = false; });
}
