#!/usr/bin/env node
/**
 * Intact male CNS baseline on dish_v2 (see→remember→dark/reorient→dark-retrieve).
 * Reports success vs chance under DARK retrieve (memory required, not reacquisition).
 * Honest: headless LIF+MN proxy unless --note says otherwise; not full browser eye.
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
  console.log(`Intact baseline ×${N} on dish_v2 DARK-retrieve (male CNS LIF, MN tank-steer, animal yaw, no bearing cheat)`);
  const { neu, csr, effectors, stim } = loadBins(DATA);
  const poolMap = mergePools(effectors, stim);
  const engine = new LifEngine(neu, csr);

  const chance = runChanceProbe(engine, poolMap, expandLesionOps, lesionSummary, {});
  const chanceFloor = Math.max(DISH.chanceApproach, Math.min(0.22, chance.metrics.approachFrac || 0));
  console.log(`chance probe (dark retrieve) approach=${(chance.metrics.approachFrac||0).toFixed(3)} → floor=${chanceFloor.toFixed(3)}`);

  const rows = [];
  for (let i = 0; i < N; i++) {
    const hunger = 0.9 + (i % 5) * 0.05;
    const cfg = { id: `intact-${i}`, ops: [{ op: "hunger", level: hunger }] };
    const use = i % 2 === 0 ? { id: `intact-${i}`, ops: [] } : cfg;
    const row = runDishAssay(engine, poolMap, use, expandLesionOps, lesionSummary, {
      chanceApproach: chanceFloor,
      darkRetrieve: true,
    });
    rows.push(row);
    const mark = row.metrics.taskOK ? "+" : (row.failure === "motor" ? "m" : (row.metrics.encodeLocked ? "e" : "."));
    process.stdout.write(mark);
  }
  console.log("");

  const motorOK = rows.filter((r) => r.metrics.motorOK);
  const sensOK = rows.filter((r) => r.metrics.sensoryOK || r.metrics.seeOK);
  const taskOK = rows.filter((r) => r.metrics.taskOK);
  const both = rows.filter((r) => r.metrics.motorOK && (r.metrics.sensoryOK || r.metrics.seeOK));
  const successAmongAble = both.length
    ? taskOK.filter((r) => r.metrics.motorOK && (r.metrics.sensoryOK || r.metrics.seeOK)).length / both.length
    : 0;
  const apps = rows.map((r) => r.metrics.postRotateApproach ?? r.metrics.approachFrac);
  const mean = apps.reduce((a, b) => a + b, 0) / (apps.length || 1);
  const enc = rows.map((r) => r.metrics.encodeApproach || 0);
  const meanEnc = enc.reduce((a, b) => a + b, 0) / (enc.length || 1);
  const nEncLock = rows.filter((r) => r.metrics.encodeLocked || (r.metrics.encodeApproach || 0) > 0.05).length;
  const disp = rows.map((r) => r.metrics.displacement);
  const meanDisp = disp.reduce((a, b) => a + b, 0) / (disp.length || 1);

  const aboveChance = mean > chanceFloor + 0.04;
  const readyForWireHunt =
    successAmongAble >= 0.35 &&
    aboveChance &&
    motorOK.length / N >= 0.5 &&
    meanEnc > 0.02;

  let readyReason;
  if (readyForWireHunt) {
    readyReason = "Intact dark-retrieve above chance with encode lock-on — candidate for selective lesion sweeps.";
  } else if (meanEnc > 0.05 && sensOK.length / N >= 0.8 && motorOK.length / N >= 0.8 && !aboveChance) {
    readyReason = "Encode lock-on works (see→approach) but dark-retrieve ≈ chance — no allocentric memory in headless MN/HS proxy. Not ready for wire-hunting until dark post-yaw approach beats chance (browser/MuJoCo or a real memory path).";
  } else if (meanEnc <= 0.05) {
    readyReason = "encodeApproach still too weak for a lock-on baseline; fix vision→MN approach before memory wires.";
  } else {
    readyReason = "Dark-retrieve not clearly above chance — not ready to claim memory wires.";
  }

  const summary = {
    dish: "dish_v2_dark_retrieve",
    n: N,
    darkRetrieve: true,
    yawMode: "animal_heading",
    chanceFloor,
    chanceProbeApproach: chance.metrics.approachFrac,
    nMotorOK: motorOK.length,
    nSensoryOK: sensOK.length,
    nSeeOK: sensOK.length,
    nTaskOK: taskOK.length,
    nEncodeLocked: nEncLock,
    successRate: taskOK.length / N,
    successRateAmongWalkAndSee: successAmongAble,
    meanApproachFrac: mean,
    meanPostRotateApproach: mean,
    meanEncodeApproach: meanEnc,
    meanDisplacement: meanDisp,
    aboveChance,
    readyForWireHunt,
    readyReason,
    caveat: "Headless LIF dish proxy — not full browser eye/MuJoCo. Dark retrieve forbids visual reacquisition.",
    honestVerdict: readyForWireHunt
      ? "intact_dark_retrieve_candidate"
      : "encode_ok_dark_retrieve_at_chance",
    failures: {
      blindness: rows.filter((r) => r.failure === "blindness").length,
      motor: rows.filter((r) => r.failure === "motor").length,
      memory_heading: rows.filter((r) => r.failure === "memory_heading").length,
      ok: rows.filter((r) => r.failure == null).length,
    },
  };

  const outDir = path.join(ROOT, "results", "lesion_sweeps");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "baseline_intact_dish_v2_dark.json");
  fs.writeFileSync(outPath, JSON.stringify({ summary, rows }, null, 2));
  // Also refresh the legacy filename pointer for docs that still cite v1 path.
  fs.writeFileSync(path.join(outDir, "baseline_intact_dish_v1.json"), JSON.stringify({
    note: "Superseded by dish_v2 dark-retrieve — see baseline_intact_dish_v2_dark.json",
    summary,
  }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log("Wrote", outPath);
}

main();
