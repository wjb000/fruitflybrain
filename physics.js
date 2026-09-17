/** Client for the body plant. Brain fires MNs; this is the flesh.
 *
 * Default: in-browser JS contact plant (GitHub Pages, no host).
 * Opt-in: ?wasm=1 for MuJoCo WASM.
 * Optional: remote `?plant=` Python flygym plant (lab Mac).
 */

import {
  plantUrl, plantProbeOrigins, plantHealthUrl, plantHudLabel, persistPlant,
} from "./plantConfig.js?v=realfly4";
import { startBrowserPlant, browserPlant, stopBrowserPlant } from "./browserPlant.js?v=realfly4";
import { loadNmf } from "./fly.js?v=realfly4";

export const physics = {
  ok: false,
  err: "",
  pending: new Map(),
  poses: new Map(),
  last: null,
  plantOrigin: "",
  kind: "",
  source: "",
  engine: "",
};

export { plantHudLabel };

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

function remoteEndpoint(path) {
  if (physics.source !== "remote" || !physics.ok) return "";
  return plantUrl(path);
}

function markBrowser() {
  physics.ok = true;
  physics.source = "browser";
  physics.kind = browserPlant.kind;
  physics.engine = browserPlant.engine;
  physics.plantOrigin = "in-browser";
  physics.err = browserPlant.err || "";
  physics.last = browserPlant.impl?.health?.() || { ok: true, engine: physics.engine };
}

async function attachBrowser() {
  const nmf = await loadNmf();
  await startBrowserPlant(nmf);
  if (!browserPlant.ok || !browserPlant.impl) throw new Error(browserPlant.err || "browser plant failed");
  markBrowser();
  return true;
}

async function attachRemote() {
  const candidates = plantProbeOrigins();
  if (!candidates.length) return false;
  const tried = [];
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
      physics.source = "remote";
      physics.kind = "remote-mujoco";
      physics.engine = j.engine || "mujoco+neuromechfly";
      if (c) persistPlant(c);
      stopBrowserPlant();
      return true;
    } catch (e) {
      physics.err = String(e);
    }
  }
  return false;
}

export async function connectPhysics() {
  // Lab override first so `?plant=` still wins when someone has a Mac plant.
  try {
    if (await attachRemote()) return true;
  } catch (e) {
    physics.err = String(e);
  }
  try {
    return await attachBrowser();
  } catch (e) {
    physics.ok = false;
    physics.source = "";
    physics.kind = "";
    physics.err = String(e);
    physics.plantOrigin = "";
    reconnectAt = performance.now() + 4000;
    return false;
  }
}

export async function connectRemotePlant(url) {
  const u = String(url || "").trim().replace(/\/$/, "");
  if (!u) return false;
  persistPlant(u);
  try {
    const r = await fetchTimed(u + "/physics/health");
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "plant not ok");
    physics.ok = true;
    physics.err = "";
    physics.last = j;
    physics.plantOrigin = u;
    physics.source = "remote";
    physics.kind = "remote-mujoco";
    physics.engine = j.engine || "mujoco+neuromechfly";
    stopBrowserPlant();
    return true;
  } catch (e) {
    physics.err = String(e);
    return false;
  }
}

export async function useBrowserPlant() {
  persistPlant("");
  return attachBrowser();
}

export function maybeReconnectPhysics() {
  if (physics.ok) return;
  if (performance.now() < reconnectAt) return;
  reconnectAt = performance.now() + 8000;
  connectPhysics().catch(() => {});
}

function localStep(dt, flies) {
  if (!browserPlant.impl) return null;
  return browserPlant.impl.step(dt, flies);
}

export async function spawnPhysics(id, x, z, yaw) {
  if (!physics.ok) return null;
  if (physics.source === "browser") {
    try {
      const pose = browserPlant.impl.spawn(id, x, z, yaw);
      if (pose) physics.poses.set(id, pose);
      return pose || null;
    } catch (e) {
      physics.err = String(e);
      return null;
    }
  }
  const url = remoteEndpoint("/physics/spawn");
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
  if (physics.source === "browser") {
    try { browserPlant.impl?.despawn?.(id); } catch (_) {}
    return;
  }
  const url = remoteEndpoint("/physics/despawn");
  if (!url) return;
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
    keepalive: true,
  }).catch(() => {});
}

export async function clearPhysics() {
  physics.pending.clear();
  physics.poses.clear();
  if (physics.source === "browser") {
    try { return browserPlant.impl?.clear?.() || { ok: true, cleared: 0 }; } catch (e) {
      physics.err = String(e);
      return null;
    }
  }
  const url = remoteEndpoint("/physics/clear");
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
  if (!physics.ok) return null;
  if (physics.source === "browser") {
    try {
      const pose = browserPlant.impl.reset(id, x, z, yaw);
      if (pose) physics.poses.set(id, pose);
      return pose;
    } catch (e) {
      physics.err = String(e);
      return null;
    }
  }
  const url = remoteEndpoint("/physics/reset");
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
  // In-browser plant lives in this tab — hiding the page must not wipe him.
  if (physics.source === "browser") return;
  for (const id of [...physics.poses.keys()]) despawnPhysics(id);
}

function applyStepResult(j) {
  if (!j) return;
  physics.last = j;
  const flies = j.flies || j;
  if (flies && typeof flies === "object") {
    for (const [id, pose] of Object.entries(flies)) {
      if (pose && typeof pose === "object" && ("x" in pose || pose.bones)) {
        physics.poses.set(id, pose);
      }
    }
  }
}

export function heartbeatPhysics() {
  if (!physics.ok || busy) return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  if (physics.poses.size === 0 && physics.pending.size === 0) return;
  const flies = {};
  for (const id of physics.poses.keys()) flies[id] = physics.pending.get(id) || {};
  for (const [id, cmd] of physics.pending) flies[id] = cmd;
  if (physics.source === "browser") {
    try { applyStepResult({ ok: true, flies: localStep(0.016, flies) }); } catch (e) {
      physics.err = String(e);
    }
    return;
  }
  const url = remoteEndpoint("/physics/step");
  if (!url) return;
  busy = true;
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
      applyStepResult(j);
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
  const flies = {};
  for (const id of physics.poses.keys()) flies[id] = physics.pending.get(id) || {};
  for (const [id, cmd] of physics.pending) flies[id] = cmd;
  physics.pending.clear();
  if (physics.source === "browser") {
    try { applyStepResult({ ok: true, flies: localStep(dt, flies) }); } catch (e) {
      physics.err = String(e);
      physics.ok = false;
      reconnectAt = performance.now() + 3000;
    }
    return;
  }
  const url = remoteEndpoint("/physics/step");
  if (!url) return;
  busy = true;
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
      applyStepResult(j);
    })
    .catch((e) => {
      physics.ok = false;
      physics.err = String(e);
      reconnectAt = performance.now() + 3000;
    })
    .finally(() => { busy = false; });
}
