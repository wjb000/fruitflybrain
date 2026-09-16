/** Remote MuJoCo plant origin.
 *
 * Pages serves UI + connectome data. Local `serve.py` hosts `/physics`.
 * Thrive default on GitHub Pages is kinematic NeuroMechFly (no remote plant)
 * so a dead/vaulting tunnel cannot seize the fly. Opt in with `?plant=` only.
 *
 * Resolution order:
 *   1. ?plant= query (absolute URL)
 *   2. localStorage.ffbPlant — local/dev only, never on github.io
 *   3. empty = same-origin /physics (local serve.py) or kinematic on Pages
 *
 * `DEFAULT_PLANT` is a documented lab example only — pass it via `?plant=` to opt in.
 */
export const DEFAULT_PLANT = "https://candidate-however-bishop-promoted.trycloudflare.com";

export function isPagesHost() {
  try {
    const h = String(location.hostname || "");
    return h.endsWith("github.io") || h === "wjb000.github.io";
  } catch {
    return false;
  }
}

export function plantBase() {
  try {
    const q = new URLSearchParams(location.search).get("plant");
    if (q != null && String(q).trim() !== "") {
      const u = String(q).trim().replace(/\/$/, "");
      try { localStorage.setItem("ffbPlant", u); } catch (_) {}
      return u;
    }
  } catch (_) {}
  // Pages: ignore a stale ffbPlant (dead tunnel → vault/seize). Local serve may use it.
  if (isPagesHost()) return "";
  try {
    const ls = localStorage.getItem("ffbPlant");
    if (ls != null && String(ls).trim() !== "") return String(ls).trim().replace(/\/$/, "");
  } catch (_) {}
  return "";
}

/** Build a plant API URL. path like "/physics/health". */
export function plantUrl(path) {
  const base = plantBase();
  const p = path.startsWith("/") ? path : ("/" + path);
  return base ? (base + p) : p;
}
