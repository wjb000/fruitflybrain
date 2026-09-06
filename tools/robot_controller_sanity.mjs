#!/usr/bin/env node
/**
 * Robot-controller sanity (headless):
 * 1) portable chassisSetpoints maps MN walk/turn → v/omega (no bearing cheat).
 * 2) dish assay: intact encode approach should beat silence:HS / silence optic.
 *
 * Honest: headless uses LIF+MN tank-steer proxy (same as lesion sweeps), not full
 * browser compound eye — still a useful wire check that optic lesions hurt steering.
 */
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { LifEngine, loadBins, mergePools, expandLesionOps } from "./lib/lif_engine.mjs";
import { lesionSummary } from "./lib/lesion_schema.mjs";
import { runDishAssay, runChanceProbe, DISH } from "./lib/assay_dish.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "web", "data");

async function loadPortable() {
  const mod = await import(pathToFileURL(path.join(ROOT, "web/controller/portable.js")).href);
  return mod;
}

function fakeFly({ walk = 0.4, turn = 0.25, salTarget = 0.3, asymFood = 0.1 } = {}) {
  return {
    clock: 1.2,
    heading: 0.3,
    body: { position: { x: 1, y: 0.42, z: -0.5 } },
    y: 0.42,
    cmd: { walk, turn, fly: 0 },
    motEma: { T1L: 0.2, T1R: 0.35, T2L: 0.2, T2R: 0.3, T3L: 0.15, T3R: 0.28, DNa: 0.2, HS: 0.1, VS: 0.1 },
    opticEma: { HS_L: 0.2, HS_R: 0.45, VS_L: 0.1, VS_R: 0.12 },
    lastVisionSal: { salFoodL: 0.2, salFoodR: 0.4, salTarget, asymFood },
    life: { mode: "walk", hunger: 0.6, arousal: 0.3 },
  };
}

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
}

async function main() {
  const { portableControls, chassisSetpoints, stubRobotDriver, ROBOT_HOWTO } = await loadPortable();
  console.log("--- portable control law ---");
  const snap = portableControls(fakeFly());
  const drive = chassisSetpoints(snap);
  const stub = stubRobotDriver(snap);
  console.log("steering", snap.steering);
  console.log("vision sal", { salTarget: snap.vision.salTarget, asymFood: snap.vision.asymFood });
  console.log("chassis", { v: drive.v, omega: drive.omega, source: drive.source });
  console.log("stub   ", { v: stub.v, omega: stub.omega });
  if (!(drive.v > 0 && Math.abs(drive.omega) > 0)) {
    throw new Error("expected nonzero v/omega from MN walk/turn");
  }
  // Quiet MNs → near-zero
  const quiet = chassisSetpoints(portableControls(fakeFly({ walk: 0, turn: 0 })));
  if (Math.abs(quiet.v) > 1e-9 || Math.abs(quiet.omega) > 1e-9) {
    throw new Error("quiet MNs must not invent thrust");
  }
  console.log("quiet OK (v=omega=0)");
  console.log(ROBOT_HOWTO.split("\n")[0]);

  console.log("\n--- headless dish: intact vs silence:HS ---");
  const { neu, csr, effectors, stim } = loadBins(DATA);
  const poolMap = mergePools(effectors, stim);
  const engine = new LifEngine(neu, csr);
  const N = Number(process.argv[2] || 8);
  const chance = runChanceProbe(engine, poolMap, expandLesionOps, lesionSummary, {});
  const floor = Math.max(DISH.chanceApproach, Math.min(0.22, chance.metrics.approachFrac || 0));

  function run(label, ops) {
    const rows = [];
    for (let i = 0; i < N; i++) {
      rows.push(
        runDishAssay(engine, poolMap, { id: `${label}-${i}`, ops }, expandLesionOps, lesionSummary, {
          chanceApproach: floor,
          darkRetrieve: false, // lights-on encode/approach — robot beacon tracking
        })
      );
    }
    const enc = rows.map((r) => r.metrics.encodeApproach || r.metrics.approachFrac || 0);
    const disp = rows.map((r) => r.metrics.displacement || 0);
    const see = rows.filter((r) => r.metrics.seeOK || r.metrics.sensoryOK).length / N;
    const motor = rows.filter((r) => r.metrics.motorOK).length / N;
    return { label, meanEnc: mean(enc), meanDisp: mean(disp), see, motor, n: N };
  }

  const intact = run("intact", []);
  const silenceHS = run("silenceHS", [{ op: "silence", pools: ["HS"] }]);
  const silenceOptic = run("silenceOptic", [{ op: "silence", pools: ["HS", "VS", "L1", "L2"] }]);

  for (const r of [intact, silenceHS, silenceOptic]) {
    console.log(
      `${r.label.padEnd(12)} encode≈${r.meanEnc.toFixed(3)} disp≈${r.meanDisp.toFixed(2)} see=${r.see.toFixed(2)} motor=${r.motor.toFixed(2)}`
    );
  }

  const hsHurt = silenceHS.meanEnc < intact.meanEnc * 0.92 || silenceHS.meanDisp < intact.meanDisp * 0.95;
  const opticHurt = silenceOptic.meanEnc < intact.meanEnc * 0.9 || silenceOptic.meanDisp < intact.meanDisp * 0.95;
  const aboveChance = intact.meanEnc > floor;
  console.log(`\nchanceFloor=${floor.toFixed(3)} intactAboveChance=${aboveChance} hsHurt=${hsHurt} opticHurt=${opticHurt}`);
  if (!aboveChance) {
    console.warn("WARN: intact encode not above chance floor (headless proxy may be weak).");
  }
  if (!hsHurt && !opticHurt) {
    console.warn("WARN: optic lesions did not clearly hurt encode/disp — check write-in / tank-steer.");
  } else {
    console.log("OK: silencing HS/optic hurts steering/approach relative to intact (sanity).");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
