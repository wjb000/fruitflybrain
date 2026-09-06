/** Remote MuJoCo plant origin.
 *
 * Pages UI + connectome data stay on GitHub Pages.
 * Physics runs on the lab Mac and is exposed via Cloudflare tunnel.
 *
 * Resolution order:
 *   1.  query (absolute URL)
 *   2. localStorage.ffbPlant
 *   3. DEFAULT_PLANT (Mac tunnel)
 *   4. "" → same-origin  (local serve.py)
 */
export const DEFAULT_PLANT = "https://targeted-hebrew-chapter-forgotten.trycloudflare.com";

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
