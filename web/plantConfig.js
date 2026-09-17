/** Remote MuJoCo plant origin — OPTIONAL lab override.
 *
 * The public full animal runs **in the browser** (MuJoCo WASM or JS contact
 * plant). GitHub Pages does not host Python/flygym. Do not require a Mac,
 * Fly.io, or any user-owned compute.
 *
 * Remote `/physics` is opt-in only:
 *   1. `?plant=` absolute URL (lab Mac / local tunnel)
 *   2. localhost `serve.py` same-origin `/physics` (optional real flygym)
 *
 * Empty DEFAULT_PLANT: never auto-hit a dead Cloudflare tunnel.
 * Static hosts never fetch `/physics/health` on github.io itself.
 */
export const DEFAULT_PLANT = "";

const STATIC_HOST_RE = /(\.github\.io|\.gitlab\.io|\.netlify\.app|\.pages\.dev|\.vercel\.app|\.surge\.sh)$/i;

export function currentLocation() {
  try {
    if (typeof location === "undefined") {
      return { hostname: "", search: "", protocol: "http:" };
    }
    return {
      hostname: String(location.hostname || ""),
      search: String(location.search || ""),
      protocol: String(location.protocol || "http:"),
    };
  } catch {
    return { hostname: "", search: "", protocol: "http:" };
  }
}

export function isLocalPlantHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
}

export function isStaticHost(hostname, protocol) {
  const loc = currentLocation();
  const h = String(hostname ?? loc.hostname ?? "").toLowerCase();
  const p = String(protocol ?? loc.protocol ?? "");
  if (p === "file:") return true;
  if (isLocalPlantHost(h)) return false;
  if (!h) return true;
  return STATIC_HOST_RE.test(h);
}

export function isPagesHost(hostname) {
  const loc = currentLocation();
  const h = String(hostname ?? loc.hostname ?? "").toLowerCase();
  return h.endsWith(".github.io");
}

function readStoredPlant() {
  try {
    if (typeof localStorage === "undefined") return "";
    const ls = localStorage.getItem("ffbPlant");
    return ls != null ? String(ls).trim() : "";
  } catch {
    return "";
  }
}

export function persistPlant(url) {
  try {
    if (typeof localStorage === "undefined") return;
    if (!url) localStorage.removeItem("ffbPlant");
    else localStorage.setItem("ffbPlant", url);
  } catch (_) {}
}

export function clearStoredPlant() {
  persistPlant("");
}

/** Resolve a *remote* plant origin ("" if none). Browser plant is separate. */
export function resolvePlantBase({
  hostname,
  search,
  protocol,
  storedPlant,
} = {}) {
  const loc = currentLocation();
  const host = hostname ?? loc.hostname;
  const qstr = search ?? loc.search;
  const proto = protocol ?? loc.protocol;

  try {
    const raw = qstr && qstr.startsWith("?") ? qstr.slice(1) : (qstr || "");
    const q = new URLSearchParams(raw).get("plant");
    if (q != null && String(q).trim() !== "") {
      const u = String(q).trim().replace(/\/$/, "");
      persistPlant(u);
      return u;
    }
  } catch (_) {}

  // Static hosts: ignore stale ffbPlant (dead tunnel seized the fly).
  if (isStaticHost(host, proto)) return "";

  const stored = storedPlant === undefined ? readStoredPlant() : storedPlant;
  if (stored != null && String(stored).trim() !== "") {
    return String(stored).trim().replace(/\/$/, "");
  }
  return "";
}

export function plantBase() {
  return resolvePlantBase();
}

/**
 * Remote origins to health-check. `""` means same-origin `/physics`.
 * Does **not** include the in-browser plant.
 */
export function plantProbeOrigins(env = {}) {
  const loc = currentLocation();
  const hostname = env.hostname ?? loc.hostname;
  const protocol = env.protocol ?? loc.protocol;
  const base = env.base !== undefined ? env.base : resolvePlantBase(env);
  const origins = [];
  if (base) origins.push(base);
  if (isStaticHost(hostname, protocol)) return origins;
  if (isLocalPlantHost(hostname) && protocol !== "file:") {
    if (!origins.includes("")) origins.push("");
  }
  return origins;
}

export function plantConfigured(env) {
  return plantProbeOrigins(env).length > 0;
}

export function plantUrl(path, env) {
  const p = path.startsWith("/") ? path : ("/" + path);
  const loc = currentLocation();
  const hostname = env?.hostname ?? loc.hostname;
  const protocol = env?.protocol ?? loc.protocol;
  const base = env && env.base !== undefined ? env.base : resolvePlantBase(env || {});
  if (base) return base + p;
  if (isLocalPlantHost(hostname) && protocol !== "file:") return p;
  return "";
}

export function plantHealthUrl(origin) {
  if (origin) return String(origin).replace(/\/$/, "") + "/physics/health";
  return "/physics/health";
}

/** Flesh label for HUD. */
export function plantHudLabel(physics) {
  if (!physics || !physics.ok) {
    return "kinematic NMF (full animal plant failed)";
  }
  const k = physics.kind || "";
  if (k === "mujoco-wasm") return "full MuJoCo animal";
  if (k === "browser-contact") return "full animal (browser plant)";
  if (k === "remote-mujoco" || physics.source === "remote") {
    const o = physics.plantOrigin || "";
    if (o && o !== "(same-origin)") return "full MuJoCo animal (remote)";
    return "full MuJoCo animal";
  }
  return "full animal";
}
