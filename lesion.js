/**
 * Lesion config helpers — resolve named pools → neuron IDs for the LIF path.
 * Ops apply in sim.worker.js (silence/boost/cut/swapLR/delay/hunger), never by
 * hacking joints or inventing MNs.
 *
 * Schema:
 * {
 *   id?: string,
 *   ops: [
 *     { op: "silence", pools: ["HS", ...] },
 *     { op: "boost", pools: ["OA"], gain: 2 },
 *     { op: "cut", from: ["HS","VS"], to: ["DNa","DNp"] },
 *     { op: "swapLR", pools: ["HS","VS"] },
 *     { op: "delay", pools: ["HS"], ms: 40 },
 *     { op: "hunger", level: 0.0..1.5 }   // neuromod dial (DAN/OA path)
 *   ]
 * }
 */

export function mergePoolMaps(effectors, stim) {
  const pools = {};
  const src = [];
  if (effectors?.pools) src.push(effectors.pools);
  if (stim && typeof stim === "object") src.push(stim);
  for (const map of src) {
    for (const [k, v] of Object.entries(map)) {
      if (!Array.isArray(v) || !v.length) continue;
      if (!pools[k]) pools[k] = [...v];
    }
  }
  return pools;
}

export function resolvePools(poolMap, names) {
  const ids = new Set();
  const missing = [];
  for (const name of names || []) {
    const arr = poolMap[name];
    if (!arr || !arr.length) {
      missing.push(name);
      continue;
    }
    for (const i of arr) ids.add(i >>> 0);
  }
  return { ids: Uint32Array.from(ids), missing };
}

export function normalizeLesion(cfg) {
  if (!cfg) return { id: "none", ops: [] };
  if (Array.isArray(cfg)) return { id: "anon", ops: cfg };
  const ops = Array.isArray(cfg.ops) ? cfg.ops : [];
  return {
    id: cfg.id || cfg.name || "lesion",
    ops: ops.map((op) => ({ ...op })),
  };
}

/** Parse compact URL / CLI forms:
 *   silence:HS,VS
 *   boost:OA:2
 *   cut:HS>DNa,DNp
 *   swapLR:HS,VS
 *   delay:HS:40
 *   hunger:0.9
 *   (combine with |)
 */
export function parseLesionFlag(str) {
  if (!str || str === "none") return { id: "none", ops: [] };
  const ops = [];
  const parts = String(str).split("|").map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const [head, ...rest] = part.split(":");
    const op = head.trim();
    if (op === "silence") {
      ops.push({ op: "silence", pools: (rest[0] || "").split(",").filter(Boolean) });
    } else if (op === "boost") {
      ops.push({
        op: "boost",
        pools: (rest[0] || "").split(",").filter(Boolean),
        gain: rest[1] != null ? Number(rest[1]) : 2,
      });
    } else if (op === "cut") {
      const body = rest.join(":");
      const [fr, to] = body.split(">");
      ops.push({
        op: "cut",
        from: (fr || "").split(",").filter(Boolean),
        to: (to || "").split(",").filter(Boolean),
      });
    } else if (op === "swapLR") {
      ops.push({ op: "swapLR", pools: (rest[0] || "").split(",").filter(Boolean) });
    } else if (op === "delay") {
      ops.push({
        op: "delay",
        pools: (rest[0] || "").split(",").filter(Boolean),
        ms: rest[1] != null ? Number(rest[1]) : 40,
      });
    } else if (op === "hunger") {
      ops.push({ op: "hunger", level: Number(rest[0] ?? 1) });
    }
  }
  return {
    id: parts.join("|") || "lesion",
    ops,
  };
}

export function lesionSummary(cfg) {
  const n = normalizeLesion(cfg);
  return n.ops.map((o) => {
    if (o.op === "silence") return `silence(${(o.pools || []).join(",")})`;
    if (o.op === "boost") return `boost(${(o.pools || []).join(",")}×${o.gain ?? 2})`;
    if (o.op === "cut") return `cut(${(o.from || []).join(",")}→${(o.to || []).join(",")})`;
    if (o.op === "swapLR") return `swapLR(${(o.pools || []).join(",")})`;
    if (o.op === "delay") return `delay(${(o.pools || []).join(",")},${o.ms ?? 40}ms)`;
    if (o.op === "hunger") return `hunger(${o.level ?? 1})`;
    return o.op;
  }).join(" · ") || "none";
}
