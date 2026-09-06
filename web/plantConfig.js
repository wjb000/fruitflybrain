/** Remote MuJoCo plant origin for static hosts (GitHub Pages → Fly.io, etc.).
 *
 * Resolution order:
 *   1. `?plant=` query (absolute URL, e.g. https://ffb-plant.fly.dev)
 *   2. localStorage.ffbPlant
 *   3. "" → same-origin `/physics/*` (local serve.py)
 *
 * serve.py already sends Access-Control-Allow-Origin: *.
 */
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
  return "";
}

/** Build a plant API URL. path like "/physics/health". */
export function plantUrl(path) {
  const base = plantBase();
  const p = path.startsWith("/") ? path : ("/" + path);
  return base ? (base + p) : p;
}
