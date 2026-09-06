#!/usr/bin/env node
/**
 * Lesion sweep runner — headless LIF see→remember→reorient→retrieve dish.
 *
 * Usage:
 *   node tools/sweep_lesions.mjs
 *   node tools/sweep_lesions.mjs --out results/lesion_sweeps/run.jsonl
 *   node tools/sweep_lesions.mjs --config tools/configs/lesion_grid_broad.json
 *   node tools/sweep_lesions.mjs --lesion 'silence:HS' --lesion 'none'
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  LifEngine, loadBins, mergePools, expandLesionOps,
} from "./lib/lif_engine.mjs";
import { parseLesionFlag, lesionSummary, DEFAULT_SWEEP } from "./lib/lesion_schema.mjs";
import { runDishAssay, runChanceProbe, DISH } from "./lib/assay_dish.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "web", "data");

function arg(name, def) {
  const i = process.argv.indexOf(name);
  if (i < 0) return def;
  return process.argv[i + 1] ?? def;
}
function has(name) {
  return process.argv.includes(name);
}

function loadConfigs() {
  const lesions = [];
  if (has("--config")) {
    const p = arg("--config");
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    const arr = Array.isArray(raw) ? raw : raw.lesions || raw.configs || [];
    for (const c of arr) lesions.push(c);
  }
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === "--lesion") {
      lesions.push(parseLesionFlag(process.argv[i + 1]));
    }
  }
  if (!lesions.length) return DEFAULT_SWEEP;
  return lesions;
}

function rankRows(rows, controlApproach) {
  return [...rows].sort((a, b) => {
    const ia = a.interesting ? 1 : 0, ib = b.interesting ? 1 : 0;
    if (ib !== ia) return ib - ia;
    // among interesting: bigger drop vs control first
    const da = (controlApproach ?? 0) - (a.metrics?.approachFrac ?? 0);
    const db = (controlApproach ?? 0) - (b.metrics?.approachFrac ?? 0);
    if (ia && ib && Math.abs(db - da) > 1e-6) return db - da;
    return (a.metrics?.approachFrac || 0) - (b.metrics?.approachFrac || 0);
  });
}

function main() {
  if (has("--help") || has("-h")) {
    console.log("Usage: node tools/sweep_lesions.mjs [--out FILE] [--config JSON] [--lesion FLAG]");
    console.log("Dish: encode → dark → yaw → retrieve (L/R landmark eyes, MN+HS steer, soft walls)");
    process.exit(0);
  }

  console.log("Loading male CNS bins from", DATA);
  const { neu, csr, effectors, stim } = loadBins(DATA);
  const poolMap = mergePools(effectors, stim);
  const engine = new LifEngine(neu, csr);
  const configs = loadConfigs();

  const stamp = new Date().toISOString().replace(/[:.]/g, "").replace("T", "T").slice(0, 16) + "Z";
  const outPath = arg("--out", path.join(ROOT, "results", "lesion_sweeps", `dish_v1_${stamp}.jsonl`));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const dishOpts = {
    encodeTicks: Number(arg("--encode", String(DISH.encodeTicks))),
    darkTicks: Number(arg("--dark", String(DISH.darkTicks))),
    retrieveTicks: Number(arg("--retrieve", String(DISH.retrieveTicks))),
  };

  // Calibrate chance floor
  console.log("Calibrating chance probe…");
  const chance = runChanceProbe(engine, poolMap, expandLesionOps, lesionSummary, dishOpts);
  const chanceFloor = Math.max(DISH.chanceApproach, Math.min(0.25, chance.metrics.approachFrac || 0));
  dishOpts.chanceApproach = chanceFloor;
  console.log(`  chanceFloor=${chanceFloor.toFixed(3)} (probe approach=${(chance.metrics.approachFrac || 0).toFixed(3)})`);

  const rows = [];
  const fd = fs.openSync(outPath, "w");
  // write chance probe first
  chance.dish = { version: "dish_v1_see_remember_reorient_retrieve", chanceFloor };
  fs.writeSync(fd, JSON.stringify(chance) + "\n");
  rows.push(chance);

  let controlApproach = null;
  for (const cfg of configs) {
    const t0 = Date.now();
    const row = runDishAssay(engine, poolMap, cfg, expandLesionOps, lesionSummary, dishOpts);
    row.elapsedMs = Date.now() - t0;
    row.metrics.controlApproach = controlApproach;
    row.metrics.deltaVsControl = controlApproach != null
      ? (controlApproach - row.metrics.approachFrac)
      : null;
    if (cfg.id === "none" || cfg.id === "control" || (cfg.ops || []).length === 0) {
      if (controlApproach == null) controlApproach = row.metrics.approachFrac;
      row.metrics.controlApproach = controlApproach;
      row.metrics.deltaVsControl = 0;
    }
    // Re-label interesting relative to control when available:
    // must be motor+sensory OK, below chance+margin (already in dish), and drop vs control.
    if (controlApproach != null && row.interesting) {
      const drop = controlApproach - row.metrics.approachFrac;
      row.metrics.dropVsControl = drop;
      // demote tiny drops (noise) — keep as interesting only if drop >= 0.05 or approach < chance
      if (drop < 0.05 && row.metrics.approachFrac > chanceFloor) {
        row.interesting = false;
        row.failure = null;
        row.metrics.taskOK = true;
        row.note = "demoted: within noise of control";
      }
    }
    rows.push(row);
    fs.writeSync(fd, JSON.stringify(row) + "\n");
    const mark = row.interesting ? "*" : " ";
    console.log(
      mark + " " + String(row.id).padEnd(28).slice(0, 28) +
      " fail=" + String(row.failure).padEnd(16) +
      " app=" + row.metrics.approachFrac.toFixed(2) +
      " enc=" + (row.metrics.encodeApproach ?? 0).toFixed(2) +
      " mot=" + row.metrics.motorOK +
      " sens=" + row.metrics.sensoryOK +
      " (" + row.elapsedMs + "ms)"
    );
  }
  fs.closeSync(fd);

  // If control ran after others, second pass isn't needed — we put none first in grids.
  // Ensure controlApproach set from any intact row:
  if (controlApproach == null) {
    const c = rows.find((r) => (r.lesion?.ops || []).length === 0 && r.id !== "chance-probe");
    if (c) controlApproach = c.metrics.approachFrac;
  }

  const ranked = rankRows(rows.filter((r) => r.id !== "chance-probe"), controlApproach);
  const interesting = ranked.filter((r) => r.interesting);
  const rankPath = outPath.replace(/\.jsonl$/, "") + ".ranked.json";
  const summaryPath = outPath.replace(/\.jsonl$/, "") + ".summary.json";
  fs.writeFileSync(rankPath, JSON.stringify(ranked, null, 2));
  const summary = {
    dish: "dish_v1_see_remember_reorient_retrieve",
    outPath,
    n: rows.length - 1,
    chanceFloor,
    controlApproach,
    nInteresting: interesting.length,
    nBlind: ranked.filter((r) => r.failure === "blindness").length,
    nMotor: ranked.filter((r) => r.failure === "motor").length,
    nMemoryHeading: ranked.filter((r) => r.failure === "memory_heading").length,
    nTaskOK: ranked.filter((r) => r.failure == null && r.id !== "chance-probe").length,
    topInteresting: interesting.slice(0, 20).map((r) => ({
      id: r.id,
      lesionSummary: r.lesionSummary,
      approachFrac: r.metrics.approachFrac,
      encodeApproach: r.metrics.encodeApproach,
      dropVsControl: r.metrics.dropVsControl ?? (controlApproach - r.metrics.approachFrac),
      displacement: r.metrics.displacement,
      opticPeak: r.metrics.opticPeak,
      failure: r.failure,
    })),
    caveat: "Candidate hits only from headless LIF dish — not claimed memory cells. Follow up in browser assay.",
  };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log("\nWrote " + (rows.length - 1) + " lesions -> " + outPath);
  console.log("Ranked -> " + rankPath);
  console.log("Summary -> " + summaryPath);
  console.log("Control approach=" + (controlApproach?.toFixed(3) ?? "?") +
    " chanceFloor=" + chanceFloor.toFixed(3) +
    " interesting=" + interesting.length + "/" + (rows.length - 1));
}

main();
