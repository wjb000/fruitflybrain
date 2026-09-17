/** Remote MuJoCo plant origin.
 *
 * Static hosts (GitHub Pages, Netlify, …) ship UI + connectome data only.
 * Empty `plantBase` must NEVER become a same-origin `/physics/health` fetch —
 * that 404s as `https://<user>.github.io/physics/health` and clutters the
 * console. Use kinematic NeuroMechFly quietly instead.
 *
 * Probe a plant only when one is actually configured:
 *   1. `?plant=` absolute URL (opt-in, including on github.io)
 *   2. `localStorage.ffbPlant` on local/dev — never on static hosts
 *   3. `DEFAULT_PLANT` on non-static, non-localhost hosts (lab tunnel example)
 *   4. localhost / 127.0.0.1 `serve.py` same-origin `/physics`
 *
 * `DEFAULT_PLANT` is not auto-probed on github.io (dead tunnels seize the fly).
 * Pass it via `?plant=` to opt in.
 */
export const DEFAULT_PLANT = "https://candidate-however-bishop-promoted.trycloudflare.com";

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

/** github.io, other static CDNs, and file: — no plant unless ?plant= is set. */
export function isStaticHost(hostname, protocol) {
  const loc = currentLocation();
  const h = String(hostname ?? loc.hostname ?? "").toLowerCase();
  const p = String(protocol ?? loc.protocol ?? "");
  if (p === "file:") return true;
  if (isLocalPlantHost(h)) return false;
  if (!h) return true;
  return STATIC_HOST_RE.test(h);
}

/** @deprecated alias — prefer isStaticHost. True for GitHub Pages. */
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

function persistPlant(url) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem("ffbPlant", url);
  } catch (_) {}
}

/** Resolve the configured remote plant origin ("" if none). */
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

  // Static hosts: ignore a stale ffbPlant (dead tunnel → vault/seize).
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
 * Origins to health-check. `""` means same-origin `/physics` (local serve.py).
 * Static hosts with no `?plant=` → `[]` (kinematic, no fetch).
 */
export function plantProbeOrigins(env = {}) {
  const loc = currentLocation();
  const hostname = env.hostname ?? loc.hostname;
  const protocol = env.protocol ?? loc.protocol;
  const defaultPlant = env.defaultPlant === undefined ? DEFAULT_PLANT : env.defaultPlant;
  const base = env.base !== undefined ? env.base : resolvePlantBase(env);
  const origins = [];
  if (base) origins.push(base);
  if (isStaticHost(hostname, protocol)) {
    return origins;
  }
  if (isLocalPlantHost(hostname) && protocol !== "file:") {
    if (!origins.includes("")) origins.push("");
    return origins;
  }
  if (!base && defaultPlant) {
    const d = String(defaultPlant).trim().replace(/\/$/, "");
    if (d) origins.push(d);
  }
  return origins;
}

/** True when connectPhysics should hit the network. */
export function plantConfigured(env) {
  return plantProbeOrigins(env).length > 0;
}

/** Build a plant API URL. path like "/physics/health". Empty if no plant. */
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

/** Health endpoint for a probe origin (`""` = same-origin local serve). */
export function plantHealthUrl(origin) {
  if (origin) return String(origin).replace(/\/$/, "") + "/physics/health";
  return "/physics/health";
}
