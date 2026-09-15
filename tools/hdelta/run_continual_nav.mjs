#!/usr/bin/env node
/**
 * hΔ fast-weight continual navigation (headless) — Exp W1.
 *
 * Context A: odor A, goal = left landmark.
 * Context B: odor B, goal = right landmark.
 * Plastic: online fast weights on hDeltaH/A/I/G outgoing edges through both contexts.
 * Frozen: learn A, then clamp those Δw — expected to fail B (still prefers A).
 *
 * Does not reopen CVA-SST Exp0/Exp1 or M1–M3.
 *
 *   node tools/hdelta/run_continual_nav.mjs
 *   node tools/hdelta/run_continual_nav.mjs --smoke
 */
import fs from "fs";
import path from "path";
import {
  PARAMS, DATA, OUT, arg, loadSeeds, loadGraph, runW1,
} from "./assay.mjs";

function main() {
  const argv = process.argv;
  const smoke = !!arg(argv, "--smoke", false);
  const n = Number(arg(argv, "--n", smoke ? 2 : PARAMS.n_seeds_default));
  const ticks = Number(arg(argv, "--ticks", smoke ? 16 : PARAMS.scene.ticks));
  const steps = Number(arg(argv, "--steps", smoke ? 2 : PARAMS.scene.stepsPerTick));
  const seeds = loadSeeds(n);
  const { hd, poolMap, engine, fwMeta } = loadGraph();
  console.log(`hΔ fastW continual nav  n=${n} ticks=${ticks} steps=${steps}  plastic cells=${fwMeta.nPre} edges=${fwMeta.nEdges}`);
  console.log(`types ${PARAMS.plastic_types.join("/")}  PFL3 L/R ${hd.PFL3_L.length}/${hd.PFL3_R.length}`);

  const summary = runW1({ engine, hd, poolMap, n, ticks, steps, smoke, seeds });

  fs.mkdirSync(OUT, { recursive: true });
  const outName = smoke ? "continual_nav_smoke.json" : "continual_nav.json";
  fs.writeFileSync(path.join(OUT, outName), JSON.stringify(summary, null, 2));
  if (!smoke) {
    const slim = {
      name: summary.name, n, ticks, steps,
      plastic: summary.plastic, frozen: summary.frozen, gapB: summary.gapB,
      frozenFailsB: summary.frozenFailsB, plasticRemaps: summary.plasticRemaps,
      pass: summary.pass, verdict: summary.verdict,
    };
    fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(slim, null, 2));
    fs.writeFileSync(path.join(DATA, "hdelta_summary.json"), JSON.stringify(slim, null, 2));
  }
  console.log(summary.verdict);
  console.log(`plastic B=${summary.plastic.meanCorrectB.toFixed(3)}  frozen B=${summary.frozen.meanCorrectB.toFixed(3)}  gap=${summary.gapB.toFixed(3)}`);
  console.log(`wrote results/hdelta/${outName}`);
  if (!summary.pass && !smoke) process.exitCode = 1;
}

main();
