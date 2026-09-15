#!/usr/bin/env node
/**
 * Exp1 — intact male CNS, isolated Scene F vs Scene M.
 *
 * Does not load female_swap. Does not retune LIF / drive weights.
 * Same pools, drive_hz, ticks/steps, and CI/AI formula as Exp0 (CVA-SST).
 *
 *   Scene F: female silhouette + courtship/touch. No male cue, no cVA/smell.
 *   Scene M: male silhouette + cVA/smell. No female cue, no courtship/touch.
 *
 * PASS: courtship_core Hz Scene F > Scene M AND aIPg Hz Scene M > Scene F
 *       (intact male: female scene gates courtship; male/cVA scene gates aggression).
 * FAIL: pool rates not scene-gated in those directions. CI−AI sign that merely
 *       tracks the single remaining cue (orientation) is not sufficient.
 *
 *   node tools/sex_swap/run_exp1_male_scenes.mjs
 *   node tools/sex_swap/run_exp1_male_scenes.mjs --smoke
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { LifEngine, loadBins, mergePools } from "../lib/lif_engine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA = path.join(ROOT, "web", "data");
const OUT = path.join(ROOT, "results", "sex_swap");
const PARAMS = JSON.parse(fs.readFileSync(path.join(ROOT, "params/sex_swap_v1.json"), "utf8"));

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  if (v == null || v.startsWith("--")) return true;
  return v;
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadSeeds(n) {
  const p = path.join(ROOT, "params/sex_swap_seeds.txt");
  const lines = fs.readFileSync(p, "utf8").split(/\s+/).filter(Boolean).map(Number);
  return lines.slice(0, n);
}

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
}

function sd(xs) {
  const mu = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - mu) ** 2)));
}

function cueEye(x, z, heading, cue) {
  const dx = cue.x - x, dz = cue.z - z;
  const dist = Math.hypot(dx, dz) + 1e-6;
  const c = Math.cos(heading), s = Math.sin(heading);
  const bearing = Math.atan2(dx * c - dz * s, dx * s + dz * c);
  const on = Math.abs(bearing) < 1.45;
  return { bearing, dist, on, loom: Math.max(0, 1.2 - dist / 9) };
}

function bindEngine(engine, poolMap) {
  engine.bindChannels({
    vision: poolMap.vision || [],
    smell: poolMap.smell || poolMap.pherORN || [],
    courtship: poolMap.courtship || [],
    touch: poolMap.touch || poolMap.ppk23 || [],
  });
  engine.bindEffectors({
    T1L: poolMap.T1L || [],
    T1R: poolMap.T1R || [],
    T2L: poolMap.T2L || [],
    T2R: poolMap.T2R || [],
    T3L: poolMap.T3L || [],
    T3R: poolMap.T3R || [],
    ADMN: poolMap.ADMN || [],
    aIPg: poolMap.aIPg || poolMap.aggression_core || [],
    courtship_core: poolMap.courtship_core || [],
    pC1: poolMap.pC1 || [],
    pIP1: poolMap.pIP1 || [],
    vision: poolMap.vision || [],
    smell: poolMap.smell || [],
    courtship: poolMap.courtship || [],
    touch: poolMap.touch || [],
  });
}

function isolatedScenes(base) {
  return {
    F: {
      name: "F",
      ticks: base.ticks,
      stepsPerTick: base.stepsPerTick,
      dtBody: base.dtBody,
      arenaR: base.arenaR,
      spawn: { ...base.spawn },
      femaleCue: { ...base.femaleCue },
      maleCue: null,
      enableFemale: true,
      enableMale: false,
    },
    M: {
      name: "M",
      ticks: base.ticks,
      stepsPerTick: base.stepsPerTick,
      dtBody: base.dtBody,
      arenaR: base.arenaR,
      spawn: { ...base.spawn },
      femaleCue: null,
      maleCue: { ...base.maleCue },
      enableFemale: false,
      enableMale: true,
    },
  };
}

function runTrial(engine, poolMap, seed, scene, drive, ticks, steps) {
  engine.rngs = mulberry32(seed >>> 0);
  engine.reset();
  engine.clearLesion();
  bindEngine(engine, poolMap);

  const fem = scene.femaleCue;
  const mal = scene.maleCue;
  let x = scene.spawn.x, z = scene.spawn.z, heading = scene.spawn.heading + ((seed % 17) - 8) * 0.02;
  let orientF = 0, orientM = 0, disp = 0, lx = x, lz = z;
  const court = [], agr = [], wing = [], visHz = [], smellHz = [];

  for (let tick = 0; tick < ticks; tick++) {
    const eyeF = fem ? cueEye(x, z, heading, fem) : { bearing: Math.PI, dist: 1e9, on: false, loom: 0 };
    const eyeM = mal ? cueEye(x, z, heading, mal) : { bearing: Math.PI, dist: 1e9, on: false, loom: 0 };
    const visF = scene.enableFemale ? drive.vision * (0.45 + 0.55 * eyeF.loom) : 0;
    const visM = scene.enableMale ? drive.vision * (0.45 + 0.55 * eyeM.loom) : 0;
    const vis = visF + visM;
    const smell = scene.enableMale ? drive.smell * Math.exp(-eyeM.dist / 4) : 0;
    const courtHzIn = scene.enableFemale ? drive.courtship * Math.exp(-eyeF.dist / 3.5) : 0;
    const touch = scene.enableFemale ? drive.touch * Math.exp(-eyeF.dist / 3.2) : 0;
    engine.setRates({ vision: vis, smell, courtship: courtHzIn, touch });
    for (let s = 0; s < steps; s++) engine.step();
    const hz = engine.effectorHz(steps);
    const court2 = hz.courtship_core || hz.pC1 || 0;
    const aipg2 = hz.aIPg || 0;
    const legsL = ((hz.T1L || 0) + (hz.T2L || 0) + (hz.T3L || 0)) / 3;
    const legsR = ((hz.T1R || 0) + (hz.T2R || 0) + (hz.T3R || 0)) / 3;
    const walk = Math.tanh((legsL + legsR) / 30);
    const turn = Math.tanh((legsR - legsL) / 12);
    heading += turn * 1.1 * scene.dtBody;
    const step = walk * 2.8 * scene.dtBody;
    x += Math.sin(heading) * step;
    z += Math.cos(heading) * step;
    const r = Math.hypot(x, z);
    if (r > scene.arenaR) {
      x *= scene.arenaR / r;
      z *= scene.arenaR / r;
    }
    disp += Math.hypot(x - lx, z - lz);
    lx = x; lz = z;
    if (scene.enableFemale && Math.abs(eyeF.bearing) < Math.PI / 4) orientF++;
    if (scene.enableMale && Math.abs(eyeM.bearing) < Math.PI / 4) orientM++;
    court.push(court2);
    agr.push(aipg2);
    wing.push(hz.ADMN || 0);
    visHz.push(hz.vision || 0);
    smellHz.push(hz.smell || 0);
  }
  const fracF = orientF / ticks, fracM = orientM / ticks;
  const wingHz = mean(wing), aipgHz = mean(agr), courtHz = mean(court);
  // Same CI/AI mix as Exp0 (run_cva_assay.mjs): 0.35 orient + 0.65 tanh(pool Hz).
  const CI = 0.35 * fracF + 0.65 * Math.tanh(courtHz);
  const AI = 0.35 * fracM + 0.65 * Math.tanh(aipgHz);
  return {
    controller: "male",
    scene: scene.name,
    seed, CI, AI, delta: CI - AI,
    fracOrientFemale: fracF, fracOrientMale: fracM,
    wingHz, aIPgHz: aipgHz, courtshipHz: courtHz,
    visionHz: mean(visHz), smellHz: mean(smellHz),
    displacement: disp, finalX: x, finalZ: z,
  };
}

function summarize(rows, sceneName) {
  const sub = rows.filter((r) => r.scene === sceneName);
  const ci = sub.map((r) => r.CI), ai = sub.map((r) => r.AI), d = sub.map((r) => r.delta);
  return {
    scene: sceneName,
    controller: "male",
    n: sub.length,
    meanCI: mean(ci), sdCI: sd(ci), meanAI: mean(ai), sdAI: sd(ai),
    meanDelta: mean(d), sdDelta: sd(d),
    meanWingHz: mean(sub.map((r) => r.wingHz)),
    meanAipgHz: mean(sub.map((r) => r.aIPgHz)),
    meanCourtshipHz: mean(sub.map((r) => r.courtshipHz)),
    meanVisionHz: mean(sub.map((r) => r.visionHz || 0)),
    meanSmellHz: mean(sub.map((r) => r.smellHz || 0)),
    meanDisp: mean(sub.map((r) => r.displacement)),
  };
}

function main() {
  const smoke = Boolean(arg("--smoke", false));
  const nSeeds = Number(arg("--n", smoke ? 4 : (PARAMS.n_seeds_default || 16)));
  const ticks = Number(arg("--ticks", smoke ? 12 : PARAMS.scene.ticks));
  const steps = Number(arg("--steps", smoke ? 3 : PARAMS.scene.stepsPerTick));
  const seeds = loadSeeds(nSeeds);
  const extra = JSON.parse(fs.readFileSync(path.join(OUT, "cva_assay_pools.json"), "utf8"));
  const { neu, csr, effectors, stim } = loadBins(DATA);
  const poolMap = mergePools({ pools: { ...(effectors.pools || {}), ...(extra.pools || {}) } }, stim);
  console.log("pools", {
    vision: (poolMap.vision || []).length,
    smell: (poolMap.smell || []).length,
    courtship: (poolMap.courtship || []).length,
    touch: (poolMap.touch || []).length,
    aIPg: (poolMap.aIPg || []).length,
    courtship_core: (poolMap.courtship_core || []).length,
    T1L: (poolMap.T1L || []).length,
  });
  const engine = new LifEngine(neu, csr);
  const scenes = isolatedScenes(PARAMS.scene);
  const rows = [];
  console.log(`Exp1 male Scene F vs M  seeds=${seeds.length} ticks=${ticks} steps=${steps} smoke=${smoke}`);
  for (const scene of [scenes.F, scenes.M]) {
    process.stdout.write(`scene ${scene.name}: `);
    for (const seed of seeds) {
      const row = runTrial(engine, poolMap, seed, scene, PARAMS.drive_hz, ticks, steps);
      rows.push(row);
      process.stdout.write(row.delta >= 0 ? "C" : "A");
    }
    process.stdout.write("\n");
  }
  const sceneF = summarize(rows, "F");
  const sceneM = summarize(rows, "M");
  const orientSignFlip = sceneF.meanDelta > 0 && sceneM.meanDelta < 0;
  const courtshipGated = sceneF.meanCourtshipHz > sceneM.meanCourtshipHz;
  const aipgGated = sceneM.meanAipgHz > sceneF.meanAipgHz;
  const poolFlip = courtshipGated && aipgGated;
  const claim_status = poolFlip ? "PASS_POOL_GATE" : "FAILED";
  const out = {
    experiment: "Exp1",
    name: "male_scene_F_vs_M",
    controller: "male",
    smoke,
    nSeeds: seeds.length,
    seeds,
    ticks,
    stepsPerTick: steps,
    female_swap_run: false,
    weights_retuned: false,
    lif: PARAMS.lif,
    drive_hz: PARAMS.drive_hz,
    scenes: {
      F: "female silhouette + courtship/touch; no male cue; no cVA/smell",
      M: "male silhouette + cVA/smell; no female cue; no courtship/touch",
    },
    pass_rule: "courtship_core Hz Scene F > Scene M AND aIPg Hz Scene M > Scene F (orientation-only CI−AI sign is not sufficient)",
    claim_status,
    summaries: [sceneF, sceneM],
    flip: {
      poolFlip: Boolean(poolFlip),
      courtshipGated: Boolean(courtshipGated),
      aipgGated: Boolean(aipgGated),
      orientSignFlip: Boolean(orientSignFlip),
      sceneFDelta: sceneF.meanDelta,
      sceneMDelta: sceneM.meanDelta,
      sceneFCourtshipHz: sceneF.meanCourtshipHz,
      sceneMCourtshipHz: sceneM.meanCourtshipHz,
      sceneFAipgHz: sceneF.meanAipgHz,
      sceneMAipgHz: sceneM.meanAipgHz,
      honest: poolFlip
        ? "Intact male: female scene gates courtship_core and male/cVA scene gates aIPg."
        : "FAIL: intact male Scene F vs M does not gate aggression. aIPg is not higher in Scene M than Scene F; CI−AI sign that tracks the only visible cue is an orientation artifact.",
    },
    rows,
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "exp1_male_scenes.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ summaries: out.summaries, flip: out.flip, claim_status }, null, 2));
  console.log("wrote", path.join(OUT, "exp1_male_scenes.json"));
}

main();
