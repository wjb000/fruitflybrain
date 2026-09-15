#!/usr/bin/env node
/**
 * CVA-SST closed-loop assay (headless).
 * female_swap loads results/sex_swap/connectome_female_swap.bin (LifEngine + alternate CSR).
 * iso_only / shuffle_sex edit the male CSR via edgeScale / shuffled indices.
 *
 *   node tools/sex_swap/run_cva_assay.mjs              # default --n 16
 *   node tools/sex_swap/run_cva_assay.mjs --smoke
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
const SWAP_BIN = path.join(OUT, "connectome_female_swap.bin");

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

function loadCsr(p) {
  const buf = fs.readFileSync(p);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
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

function applyController(engine, manifest, controller, seed, indices0) {
  engine.clearLesion();
  if (indices0) engine.indices.set(indices0);
  const dim = manifest.dimorphic_idx;
  const zeroOut = (ids) => {
    for (const i of ids) {
      engine.gainOut[i] = 0;
      const a = engine.indptr[i], b = engine.indptr[i + 1];
      for (let k = a; k < b; k++) engine.edgeScale[k] = 0;
    }
  };
  if (controller === "male" || controller === "female_swap") return;
  if (controller === "iso_only") {
    zeroOut(dim);
    return;
  }
  if (controller === "shuffle_sex") {
    const rng = mulberry32(seed >>> 0);
    const slots = [];
    const posts = [];
    for (const i of dim) {
      const a = engine.indptr[i], b = engine.indptr[i + 1];
      for (let k = a; k < b; k++) {
        slots.push(k);
        posts.push(engine.indices[k]);
      }
    }
    for (let i = posts.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = posts[i];
      posts[i] = posts[j];
      posts[j] = t;
    }
    for (let i = 0; i < slots.length; i++) engine.indices[slots[i]] = posts[i];
  }
}

function runTrial(engine, poolMap, manifest, controller, seed, scene, drive, ticks, steps, indices0) {
  engine.rngs = mulberry32(seed >>> 0);
  engine.reset();
  applyController(engine, manifest, controller, seed, indices0);
  bindEngine(engine, poolMap);

  const fem = scene.femaleCue, mal = scene.maleCue;
  let x = scene.spawn.x, z = scene.spawn.z, heading = scene.spawn.heading + ((seed % 17) - 8) * 0.02;
  let orientF = 0, orientM = 0, prefF = 0, disp = 0, lx = x, lz = z;
  const court = [], agr = [], wing = [], visHz = [], smellHz = [];

  for (let tick = 0; tick < ticks; tick++) {
    const eyeF = cueEye(x, z, heading, fem);
    const eyeM = cueEye(x, z, heading, mal);
    const vis = drive.vision * (0.45 + 0.55 * Math.max(eyeF.loom, eyeM.loom));
    const smell = drive.smell * Math.exp(-eyeM.dist / 4); // cVA from male cue
    const courtHzIn = drive.courtship * Math.exp(-eyeF.dist / 3.5);
    const touch = drive.touch * Math.exp(-eyeF.dist / 3.2);
    engine.setRates({ vision: vis, smell, courtship: courtHzIn, touch });
    for (let s = 0; s < steps; s++) engine.step();
    const hz = engine.effectorHz(steps);
    // Second-order: cue → sensory write-in → graph → courtship_core / aIPg rates.
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
    if (Math.abs(eyeF.bearing) < Math.PI / 4) orientF++;
    if (Math.abs(eyeM.bearing) < Math.PI / 4) orientM++;
    if (Math.abs(eyeF.bearing) < Math.abs(eyeM.bearing)) prefF++;
    court.push(court2);
    agr.push(aipg2);
    wing.push(hz.ADMN || 0);
    visHz.push(hz.vision || 0);
    smellHz.push(hz.smell || 0);
  }
  const fracF = orientF / ticks, fracM = orientM / ticks, fracPrefF = prefF / ticks;
  const wingHz = mean(wing), aipgHz = mean(agr), courtHz = mean(court);
  const CI = 0.35 * fracF + 0.65 * Math.tanh(courtHz);
  const AI = 0.35 * fracM + 0.65 * Math.tanh(aipgHz);
  return {
    controller, seed, CI, AI, delta: CI - AI,
    fracOrientFemale: fracF, fracOrientMale: fracM, fracPrefFemale: fracPrefF,
    wingHz, aIPgHz: aipgHz, courtshipHz: courtHz,
    visionHz: mean(visHz), smellHz: mean(smellHz),
    displacement: disp, finalX: x,
  };
}

function summarize(rows, controller) {
  const sub = rows.filter((r) => r.controller === controller);
  const ci = sub.map((r) => r.CI), ai = sub.map((r) => r.AI), d = sub.map((r) => r.delta);
  return {
    controller, n: sub.length,
    meanCI: mean(ci), sdCI: sd(ci), meanAI: mean(ai), sdAI: sd(ai),
    meanDelta: mean(d), sdDelta: sd(d),
    meanWingHz: mean(sub.map((r) => r.wingHz)),
    meanAipgHz: mean(sub.map((r) => r.aIPgHz)),
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
  const manifest = JSON.parse(fs.readFileSync(path.join(OUT, "graph_edit_manifest.json"), "utf8"));
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
  if (!fs.existsSync(SWAP_BIN)) {
    console.error(`missing ${SWAP_BIN} — run python3 tools/sex_swap/build_banc_transplant.py`);
    process.exit(1);
  }
  const maleEngine = new LifEngine(neu, csr);
  const swapEngine = new LifEngine(neu, loadCsr(SWAP_BIN));
  const indices0 = new Uint32Array(maleEngine.indices);
  const controllers = PARAMS.controllers;
  const rows = [];
  console.log(`CVA-SST BANC transplant v2  seeds=${seeds.length} ticks=${ticks} steps=${steps} smoke=${smoke}`);
  for (const ctl of controllers) {
    process.stdout.write(`${ctl}: `);
    const engine = ctl === "female_swap" ? swapEngine : maleEngine;
    const idx0 = ctl === "female_swap" ? null : indices0;
    for (const seed of seeds) {
      const row = runTrial(engine, poolMap, manifest, ctl, seed, PARAMS.scene, PARAMS.drive_hz, ticks, steps, idx0);
      rows.push(row);
      process.stdout.write(row.delta >= 0 ? "C" : "A");
    }
    process.stdout.write("\n");
  }
  const summaries = controllers.map((c) => summarize(rows, c));
  const male = summaries.find((s) => s.controller === "male");
  const swap = summaries.find((s) => s.controller === "female_swap");
  const iso = summaries.find((s) => s.controller === "iso_only");
  const shuf = summaries.find((s) => s.controller === "shuffle_sex");
  const signFlip = male && swap && Math.sign(male.meanDelta) !== 0 && Math.sign(swap.meanDelta) !== 0
    && Math.sign(male.meanDelta) !== Math.sign(swap.meanDelta);
  const claim_status = signFlip ? "PASS_SIGN_FLIP" : "FAILED";
  const out = {
    experiment: "CVA-SST",
    smoke,
    nSeeds: seeds.length,
    seeds,
    ticks,
    stepsPerTick: steps,
    claim: PARAMS.claim,
    claim_status,
    banc_transplant: true,
    compressed_swap: false,
    summaries,
    flip: {
      signFlip: Boolean(signFlip),
      maleDelta: male?.meanDelta,
      femaleSwapDelta: swap?.meanDelta,
      isoDelta: iso?.meanDelta,
      shuffleDelta: shuf?.meanDelta,
      honest: signFlip
        ? "CI↔AI sign flipped under BANC transplant v2."
        : "No CI↔AI sign flip under BANC transplant v2 (claim failed).",
      secondary_finding: iso && swap
        ? `iso_only collapses aIPg ${male?.meanAipgHz?.toFixed(2)}→${iso.meanAipgHz.toFixed(3)}; transplant restores ~${swap.meanAipgHz.toFixed(2)} without flip`
        : "",
    },
    rows,
  };
  fs.mkdirSync(OUT, { recursive: true });
  const tag = smoke ? "smoke" : "full";
  const summaryOut = { ...out };
  delete summaryOut.rows;
  fs.writeFileSync(path.join(OUT, "cva_assay_summary.json"), JSON.stringify(summaryOut, null, 2));
  fs.writeFileSync(path.join(OUT, `cva_assay_${tag}.json`), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, `cva_assay_${tag}.csv`), [
    "controller,seed,CI,AI,delta,fracF,fracM,wingHz,aIPgHz,disp,finalX",
    ...rows.map((r) => [r.controller, r.seed, r.CI, r.AI, r.delta, r.fracOrientFemale, r.fracOrientMale, r.wingHz, r.aIPgHz, r.displacement, r.finalX].join(",")),
  ].join("\n"));
  console.log(JSON.stringify({ summaries, flip: out.flip, claim_status }, null, 2));
  console.log("wrote", path.join(OUT, "cva_assay_summary.json"));
}

main();
