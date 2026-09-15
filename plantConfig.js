/** Remote MuJoCo plant origin.
 *
 * Pages serves UI + connectome data. Physics runs on the lab Mac via Cloudflare tunnel.
 *
 * Resolution order:
 *   1. ?plant= query (absolute URL)
 *   2. localStorage.ffbPlant
 *   3. DEFAULT_PLANT (Mac tunnel)
 *   4. empty = same-origin /physics (local serve.py)
 */
export const DEFAULT_PLANT = "https://candidate-however-bishop-promoted.trycloudflare.com";

export function plantBase() {
  try {
    const q = new URLSearchParams(location.search).get("plant");
    if (q != null && String(q).trim() !== "") {
      const u = String(q).trim().replace(/\/$/, "");
      try { localStorage.setItem("ffbPlant", u); } catch (_) {}
      return u;
    }
  } catch (_) {}
  try {
    const ls = localStorage.getItem("ffbPlant");
    if (ls != null && String(ls).trim() !== "") return String(ls).trim().replace(/\/$/, "");
  } catch (_) {}
  if (DEFAULT_PLANT) return DEFAULT_PLANT.replace(/\/$/, "");
  return "";
}

/** Build a plant API URL. path like "/physics/health". */
export function plantUrl(path) {
  const base = plantBase();
  const p = path.startsWith("/") ? path : ("/" + path);
  return base ? (base + p) : p;
}
