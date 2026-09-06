#!/usr/bin/env node
/**
 * Intact male CNS baseline on dish_v1 (see→remember→reorient→retrieve).
 * Reports success rate vs chance. Honest: headless LIF+MN proxy, not full browser/MuJoCo.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { LifEngine, loadBins, mergePools, expandLesionOps } from "./lib/lif_engine.mjs";
import { lesionSummary } from "./lib/lesion_schema.mjs";
import { runDishAssay, runChanceProbe, DISH } from "./lib/assay_dish.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "web", "data");
const N = Number(process.argv[2] || 24);

function main() {
  console.log(`Intact baseline ×${N} on dish_v1 (male CNS LIF, MN tank-steer, no bearing cheat)`);
  const { neu, csr, effectors, stim } = loadBins(DATA);
  const poolMap = mergePools(effectors, stim);
  const engine = new LifEngine(neu, csr);

  const chance = runChanceProbe(engine, poolMap, expandLesionOps, lesionSummary, {});
  const chanceFloor = Math.max(DISH.chanceApproach, Math.min(0.22, chance.metrics.approachFrac || 0));
  console.log(`chance probe approach=${(chance.metrics.approachFrac||0).toFixed(3)} → floor=${chanceFloor.toFixed(3)}`);

  const rows = [];
  for (let i = 0; i < N; i++) {
    // Tiny hunger jitter across trials (not lesions) — life-state variability
    const hunger = 0.9 + (i % 5) * 0.05;
    const cfg = { id: `intact-${i}`, ops: [{ op: "hunger", level: hunger }] };
    // For pure intact, use empty ops on even trials
    const use = i % 2 === 0 ? { id: `intact-${i}`, ops: [] } : cfg;
    const row = runDishAssay(engine, poolMap, use, expandLesionOps, lesionSummary, {
      chanceApproach: chanceFloor,
    });
    rows.push(row);
    const mark = row.metrics.taskOK ? "+" : (row.failure === "motor" ? "m" : ".");
    process.stdout.write(mark);
  }
  console.log("");

  const motorOK = rows.filter((r) => r.metrics.motorOK);
  const sensOK = rows.filter((r) => r.metrics.sensoryOK);
  const taskOK = rows.filter((r) => r.metrics.taskOK);
  const both = rows.filter((r) => r.metrics.motorOK && r.metrics.sensoryOK);
  const successAmongAble = both.length
    ? taskOK.filter((r) => r.metrics.motorOK && r.metrics.sensoryOK).length / both.length
    : 0;
  const apps = rows.map((r) => r.metrics.approachFrac);
  const mean = apps.reduce((a, b) => a + b, 0) / apps.length;
  const enc = rows.map((r) => r.metrics.encodeApproach || 0);
  const meanEnc = enc.reduce((a, b) => a + b, 0) / enc.length;
  const disp = rows.map((r) => r.metrics.displacement);
  const meanDisp = disp.reduce((a, b) => a + b, 0) / disp.length;

  const summary = {
    dish: "dish_v1_see_remember_reorient_retrieve",
    n: N,
    chanceFloor,
    chanceProbeApproach: chance.metrics.approachFrac,
    nMotorOK: motorOK.length,
    nSensoryOK: sensOK.length,
    nTaskOK: taskOK.length,
    successRate: taskOK.length / N,
    successRateAmongWalkAndSee: successAmongAble,
    meanApproachFrac: mean,
    meanEncodeApproach: meanEnc,
    meanDisplacement: meanDisp,
    aboveChance: mean > chanceFloor + 0.04,
    readyForWireHunt: successAmongAble >= 0.35 && mean > chanceFloor + 0.04 && motorOK.length / N >= 0.5,
    caveat: "Headless LIF dish proxy — not full browser eye/MuJoCo. Candidate readiness only.",
    failures: {
      blindness: rows.filter((r) => r.failure === "blindness").length,
      motor: rows.filter((r) => r.failure === "motor").length,
      memory_heading: rows.filter((r) => r.failure === "memory_heading").length,
      ok: rows.filter((r) => r.failure == null).length,
    },
  };

  const outDir = path.join(ROOT, "results", "lesion_sweeps");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "baseline_intact_dish_v1.json");
  fs.writeFileSync(outPath, JSON.stringify({ summary, rows }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log("Wrote", outPath);
}

main();
