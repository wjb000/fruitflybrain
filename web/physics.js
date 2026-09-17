/** Client for the Python MuJoCo plant. Brain fires MNs; this is the flesh. */

import { plantUrl, plantProbeOrigins, plantHealthUrl } from "./plantConfig.js?v=linked2";

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
const PLANT_HEALTH_MS = 2200;

async function fetchTimed(url, ms = PLANT_HEALTH_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { mode: "cors", signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function plantEndpoint(path) {
  if (!physics.ok) return "";
  return plantUrl(path);
}

export async function connectPhysics() {
  const tried = [];
  const candidates = plantProbeOrigins();
  // Static host / no plant configured: kinematic fallback, no /physics/health fetch.
  if (candidates.length === 0) {
    physics.ok = false;
    physics.err = "";
    physics.plantOrigin = "";
    return false;
  }

  for (const c of candidates) {
    const origin = c || "(same-origin)";
    tried.push(origin);
    try {
      const healthUrl = plantHealthUrl(c);
      const r = await fetchTimed(healthUrl);
      if (!r.ok) continue;
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

/** If plant dropped (tunnel blip), retry without reloading the page.
 *  No plant configured (github.io kinematic default): never fetch /physics. */
export function maybeReconnectPhysics() {
  if (physics.ok) return;
  if (plantProbeOrigins().length === 0) return;
  if (performance.now() < reconnectAt) return;
  reconnectAt = performance.now() + 8000;
  connectPhysics().catch(() => {});
}

export async function spawnPhysics(id, x, z, yaw) {
  const url = plantEndpoint("/physics/spawn");
  if (!url) return null;
  try {
    const r = await fetch(url, {
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
  const url = plantEndpoint("/physics/despawn");
  if (!url) return;
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
    keepalive: true,
  }).catch(() => {});
}

/** Drop every plant body (ghost hygiene). Call on page load before spawn. */
export async function clearPhysics() {
  physics.pending.clear();
  physics.poses.clear();
  const url = plantEndpoint("/physics/clear");
  if (!url) return null;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    return await r.json();
  } catch (e) {
    physics.ok = false;
    physics.err = String(e);
    reconnectAt = performance.now() + 3000;
    return null;
  }
}

export async function resetPhysics(id, x, z, yaw) {
  const url = plantEndpoint("/physics/reset");
  if (!url) return null;
  try {
    const r = await fetch(url, {
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

function releaseClientBodies() {
  for (const id of [...physics.poses.keys()]) despawnPhysics(id);
}

/** Lightweight step so plant TTL sees our live fly ids (works while UI is paused). */
export function heartbeatPhysics() {
  if (!physics.ok || busy) return;
  if (document.visibilityState === "hidden") return;
  if (physics.poses.size === 0 && physics.pending.size === 0) return;
  const url = plantEndpoint("/physics/step");
  if (!url) return;
  busy = true;
  const flies = {};
  for (const id of physics.poses.keys()) flies[id] = physics.pending.get(id) || {};
  for (const [id, cmd] of physics.pending) flies[id] = cmd;
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dt: 0.016, flies }),
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

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", releaseClientBodies);
  // Backgrounded tabs free plant slots; on return, agents re-spawn via event.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      releaseClientBodies();
    } else if (physics.ok) {
      try { window.dispatchEvent(new CustomEvent("ffb-physics-resume")); } catch (_) {}
    }
  });
  setInterval(heartbeatPhysics, 5000);
}

export function flushPhysics(dt) {
  maybeReconnectPhysics();
  if (busy || !physics.ok) return;
  if (physics.pending.size === 0 && physics.poses.size === 0) return;
  const url = plantEndpoint("/physics/step");
  if (!url) return;
  busy = true;
  const flies = {};
  for (const id of physics.poses.keys()) flies[id] = physics.pending.get(id) || {};
  for (const [id, cmd] of physics.pending) flies[id] = cmd;
  physics.pending.clear();
  fetch(url, {
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
