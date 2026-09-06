/** Shared lesion flag parser for Node CLI (mirrors web/lesion.js). */

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
  return { id: parts.join("|") || "lesion", ops };
}

export function lesionSummary(cfg) {
  const ops = cfg?.ops || [];
  return ops.map((o) => {
    if (o.op === "silence") return `silence(${(o.pools || []).join(",")})`;
    if (o.op === "boost") return `boost(${(o.pools || []).join(",")}×${o.gain ?? 2})`;
    if (o.op === "cut") return `cut(${(o.from || []).join(",")}→${(o.to || []).join(",")})`;
    if (o.op === "swapLR") return `swapLR(${(o.pools || []).join(",")})`;
    if (o.op === "delay") return `delay(${(o.pools || []).join(",")},${o.ms ?? 40}ms)`;
    if (o.op === "hunger") return `hunger(${o.level ?? 1})`;
    return o.op;
  }).join(" · ") || "none";
}

export const DEFAULT_SWEEP = [
  { id: "control", ops: [] },
  { id: "silence-HS", ops: [{ op: "silence", pools: ["HS"] }] },
  { id: "silence-VS", ops: [{ op: "silence", pools: ["VS"] }] },
  { id: "silence-DAN", ops: [{ op: "silence", pools: ["DAN"] }] },
  { id: "boost-OA", ops: [{ op: "boost", pools: ["OA"], gain: 2.5 }] },
  { id: "cut-HS-DNa", ops: [{ op: "cut", from: ["HS", "VS"], to: ["DNa", "DNp"] }] },
  { id: "swapLR-HS", ops: [{ op: "swapLR", pools: ["HS", "VS"] }] },
  { id: "delay-HS", ops: [{ op: "delay", pools: ["HS"], ms: 40 }] },
  { id: "hunger-high", ops: [{ op: "hunger", level: 1.2 }] },
  { id: "silence-T1-MN", ops: [{ op: "silence", pools: ["T1L", "T1R"] }] },
];
