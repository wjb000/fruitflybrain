#!/usr/bin/env node
/**
 * Lesion sweep runner — headless LIF approach assay.
 *
 * Usage:
 *   node tools/sweep_lesions.mjs
 *   node tools/sweep_lesions.mjs --out sweeps/run.jsonl --ticks 120
 *   node tools/sweep_lesions.mjs --lesion 'silence:HS' --lesion 'cut:HS,VS>DNa'
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  LifEngine, loadBins, mergePools, expandLesionOps,
} from "./lib/lif_engine.mjs";
import { parseLesionFlag, lesionSummary, DEFAULT_SWEEP } from "./lib/lesion_schema.mjs";

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

function soft(hz) {
  if (hz <= 0) return 0;
  return Math.min(1, 1 - Math.exp(-hz / 18));
}

function runAssay(engine, poolMap, lesionCfg, opts) {
  const stepsPerTick = opts.stepsPerTick || 8;
  const ticks = opts.ticks || 120;
  const rotateAt = opts.rotateAt ?? 40;
  const dtBody = opts.dtBody || 0.05;

  const ops = expandLesionOps(lesionCfg, poolMap);
  engine.reset();
  engine.applyLesion(ops);

  const vision = poolMap.vision || poolMap.R16 || [];
  engine.bindChannels({
    vision,
    HS: poolMap.HS || [],
    VS: poolMap.VS || [],
    foodORN: poolMap.foodORN || [],
  });
  const effectorNames = [
    "T1L", "T1R", "T2L", "T2R", "T3L", "T3R",
    "HS", "VS", "DNa", "DNp", "DLM", "DVM", "ADMN", "DAN", "OA",
  ];
  const pools = {};
  for (const k of effectorNames) pools[k] = poolMap[k] || [];
  engine.bindEffectors(pools);

  let targetAng = Math.PI * 0.35;
  let targetR = 7.5;
  let tx = Math.sin(targetAng) * targetR;
  let tz = Math.cos(targetAng) * targetR;
  let x = -Math.sin(targetAng) * 2.5;
  let z = -Math.cos(targetAng) * 2.5;
  let heading = targetAng + Math.PI;
  let opticPeak = 0;
  let displacement = 0;
  let lx = x, lz = z;
  const samples = [];

  for (let tick = 0; tick < ticks; tick++) {
    if (tick === rotateAt) {
      const rad = Math.PI;
      const c = Math.cos(rad), s = Math.sin(rad);
      const nx = tx * c - tz * s;
      const nz = tx * s + tz * c;
      tx = nx; tz = nz;
    }
    const dx = tx - x, dz = tz - z;
    const dist = Math.hypot(dx, dz) + 1e-6;
    const c = Math.cos(heading), s = Math.sin(heading);
    const bearing = Math.atan2(dx * c - dz * s, dx * s + dz * c);
    const loom = Math.max(0, 1.2 - dist / 10);
    const vis = 40 + loom * 50;
    const hs = Math.abs(bearing) < 1.2 ? 35 + (1 - Math.abs(bearing)) * 40 : 8;
    engine.setRates({
      vision: vis,
      HS: hs,
      VS: 12 + loom * 20,
      foodORN: 10 + loom * 15,
    });

    for (let si = 0; si < stepsPerTick; si++) engine.step();
    const hz = engine.effectorHz(stepsPerTick);
    const legsL = soft(((hz.T1L || 0) + (hz.T2L || 0) + (hz.T3L || 0)) / 3);
    const legsR = soft(((hz.T1R || 0) + (hz.T2R || 0) + (hz.T3R || 0)) / 3);
    const legs = (legsL + legsR) / 2;
    const walk = Math.tanh(legs * 2.9);
    const turn = Math.tanh((legsR - legsL) * 2.0);
    const optic = soft(hz.HS || 0) + soft(hz.VS || 0);
    if (optic > opticPeak) opticPeak = optic;
    const steer = turn + Math.tanh(-bearing) * soft(hz.HS || 0) * 0.35;
    heading += steer * 1.1 * dtBody;
    const step = walk * 2.8 * dtBody;
    x += Math.sin(heading) * step;
    z += Math.cos(heading) * step;
    displacement += Math.hypot(x - lx, z - lz);
    lx = x; lz = z;
    samples.push({ t: tick * dtBody, dist: Math.hypot(tx - x, tz - z), legs, optic, walk, turn });
  }

  const after = samples.filter((_, i) => i >= rotateAt);
  const startPost = after[0]?.dist ?? samples[0].dist;
  const endPost = after.at(-1)?.dist ?? samples.at(-1).dist;
  const approachFrac = startPost > 1e-3 ? Math.max(0, (startPost - endPost) / startPost) : 0;
  const chanceApproach = 0.22;
  const reached = endPost <= 2.4;
  const motorOK = displacement >= 1.0 || (samples.at(-1)?.legs ?? 0) >= 0.04;
  const sensoryOK = opticPeak >= 0.02;
  const taskOK = approachFrac > chanceApproach || reached;
  const interesting = sensoryOK && motorOK && !taskOK;
  let failure = null;
  if (!sensoryOK) failure = "blindness";
  else if (!motorOK) failure = "motor";
  else if (!taskOK) failure = "memory_heading";

  return {
    id: lesionCfg.id,
    lesion: lesionCfg,
    lesionSummary: lesionSummary(lesionCfg),
    metrics: {
      finalDist: endPost,
      postRotateStartDist: startPost,
      postRotateEndDist: endPost,
      approachFrac,
      chanceApproach,
      displacement,
      opticPeak,
      reached,
      motorOK,
      sensoryOK,
      taskOK,
      betterThanChance: taskOK,
    },
    failure,
    interesting,
    portable: {
      steering: { forward: samples.at(-1)?.walk ?? 0, yawRate: samples.at(-1)?.turn ?? 0 },
      vision: { opticPeak },
    },
    ticks,
    rotateAt,
  };
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

function main() {
  if (has("--help") || has("-h")) {
    console.log("Usage: node tools/sweep_lesions.mjs [--out FILE] [--ticks N] [--lesion FLAG] [--config JSON]");
    process.exit(0);
  }

  console.log("Loading male CNS bins from", DATA);
  const { neu, csr, effectors, stim } = loadBins(DATA);
  const poolMap = mergePools(effectors, stim);
  const engine = new LifEngine(neu, csr);
  const configs = loadConfigs();
  const outPath = arg("--out", path.join(ROOT, "sweeps", "lesion_" + Date.now() + ".jsonl"));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const ticks = Number(arg("--ticks", "80"));
  const rotateAt = Number(arg("--rotate-at", "28"));

  const rows = [];
  const fd = fs.openSync(outPath, "w");
  for (const cfg of configs) {
    const t0 = Date.now();
    const row = runAssay(engine, poolMap, cfg, { ticks, rotateAt });
    row.elapsedMs = Date.now() - t0;
    rows.push(row);
    fs.writeSync(fd, JSON.stringify(row) + "\n");
    const mark = row.interesting ? "*" : " ";
    console.log(
      mark + " " + String(row.id).padEnd(16) +
      " fail=" + String(row.failure).padEnd(16) +
      " approach=" + row.metrics.approachFrac.toFixed(2) +
      " motor=" + row.metrics.motorOK +
      " sens=" + row.metrics.sensoryOK +
      " (" + row.elapsedMs + "ms)"
    );
  }
  fs.closeSync(fd);

  const ranked = [...rows].sort((a, b) => {
    const ia = a.interesting ? 1 : 0, ib = b.interesting ? 1 : 0;
    if (ib !== ia) return ib - ia;
    return (a.metrics.approachFrac || 0) - (b.metrics.approachFrac || 0);
  });
  const rankPath = outPath.replace(/\.jsonl$/, "") + ".ranked.json";
  fs.writeFileSync(rankPath, JSON.stringify(ranked, null, 2));
  console.log("\nWrote " + rows.length + " rows -> " + outPath);
  console.log("Ranked -> " + rankPath);
  console.log("Interesting: " + ranked.filter((r) => r.interesting).length + "/" + rows.length);
}

main();
