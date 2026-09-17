#!/usr/bin/env node
/**
 * utopia2: happier garden + leftover sensor coverage on existing IDs.
 * Residual campaniform/proprio, nearest fruit, floral residual smell,
 * l-LNv from R7, calmer slip. No invented MNs / CPG / thrusters.
 */
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const pose = await import(pathToFileURL(path.join(ROOT, "web/poseMap.js")).href);
  const {
    residualIds, nearestXZ, underCanopy, smoothSlip, closeLoopProprio,
    walkDriveFromEma, abdomenFromEma, wingFromEma, embodyMuscle, muscleFromEma,
    EMPTY_MALE_MUSCLE_POOLS, BODY_YAW_CLAMP, MUSCLE_TAU,
  } = pose;

  const stim = JSON.parse(fs.readFileSync(path.join(ROOT, "web/data/stim.json"), "utf8"));
  const eff = JSON.parse(fs.readFileSync(path.join(ROOT, "web/data/effectors.json"), "utf8"));
  const counts = eff.counts || {};
  const gardenSrc = fs.readFileSync(path.join(ROOT, "web/world/procgen.js"), "utf8");

  console.log("--- residual campaniform / proprio (untyped leftover IDs) ---");
  const csaRes = residualIds(
    stim.campaniform || [],
    stim.csaT1, stim.csaT2, stim.csaT3,
    stim.csaT1L, stim.csaT1R, stim.csaT2L, stim.csaT2R, stim.csaT3L, stim.csaT3R,
  );
  const propRes = residualIds(
    stim.proprio || [],
    stim.propT1, stim.propT2, stim.propT3,
    stim.propT1L, stim.propT1R, stim.propT2L, stim.propT2R, stim.propT3L, stim.propT3R,
  );
  console.log({ campaniform: (stim.campaniform || []).length, csaResidual: csaRes.length, proprioResidual: propRes.length });
  assert(csaRes.length > 100, "untyped campaniform cells must be driven as residual");
  assert(propRes.length > 100, "untyped proprio cells must be driven as residual");
  const csaT3 = new Set(stim.csaT3 || []);
  assert(!csaRes.some((i) => csaT3.has(i)), "typed csaT3 must not sit in residual campaniform");

  console.log("--- nearest fruit / shade helpers ---");
  const foods = [
    { x: 1.85, z: 1.35 },
    { x: 2.85, z: -0.95 },
    { x: -0.35, z: 2.35 },
  ];
  const nearBerry = nearestXZ(2.7, -0.9, foods, foods[0]);
  assert(nearBerry.dist < 0.3, "berries must be the nearest fruit when standing on them");
  assert(nearBerry.pt.x !== foods[0].x, "must not always pick spawn fruit");
  const perch = { x: -1.45, z: -1.85, r: 0.72 };
  assert(underCanopy(perch.x, perch.z, perch), "under own canopy");
  assert(!underCanopy(0.12, 0.18, perch), "home clearing is not shade");

  console.log("--- calmer slip: successive MN jitter is low-passed ---");
  const st = {};
  const a = smoothSlip(st, 0.08, 0.00, 0.09, 0.032);
  const b = smoothSlip(st, -0.08, 0.00, -0.09, 0.032);
  console.log({ first: a.sx.toFixed(3), second: b.sx.toFixed(3), yaw: b.dyaw.toFixed(3) });
  assert(Math.abs(b.sx) < Math.abs(a.sx) + 0.02, "slip EMA must not slam opposite");
  assert(Math.abs(b.dyaw) <= BODY_YAW_CLAMP + 1e-6, "yaw clamp holds");
  assert(MUSCLE_TAU >= 0.16, "hinges stay slower than the old twitch tau");

  console.log("--- kept: empty MNs, idle abdomen/wings, no CPG ---");
  assert(EMPTY_MALE_MUSCLE_POOLS.length === 12, "twelve empty T2/T3 pools");
  for (const k of EMPTY_MALE_MUSCLE_POOLS) {
    assert((counts[k] || 0) === 0, `${k} must stay annotation-empty`);
  }
  const idleWalk = walkDriveFromEma({ T1L: 0.4, T2L: 0.04, T2R: 0.04, T3L: 0.03, T3R: 0.03, DNa: 0.02 });
  const l2 = embodyMuscle("L2", muscleFromEma("L2", (m) => ({ trFlex: 0.2 }[m] || 0)), { walkDrive: idleWalk });
  assert(l2.trFlex === 0 && l2._stance === true, "idle stay planted");
  assert(abdomenFromEma({ abdomen: 0.10 }, 0).curl === 0, "idle abdomen still");
  assert(wingFromEma({ DLM: 0.18, DVM: 0.16, ADMN: 0.14 }).power === 0, "idle wings folded");
  assert(!("haltere" in counts) && !("antennaMN" in counts), "do not invent halt/ant MN pools");

  console.log("--- garden is a home, not a pad ---");
  const flowerN = (gardenSrc.match(/kind: "flower"/g) || []).length;
  const foodN = (gardenSrc.match(/kind: "food"/g) || []).length;
  const waterN = (gardenSrc.match(/kind: "water"/g) || []).length;
  console.log({ flowerN, foodN, waterN });
  assert(flowerN >= 6, "more blossoms than linked1");
  assert(foodN >= 3, "more than one fruit cluster");
  assert(waterN >= 2, "dew plus a second puddle");
  assert(gardenSrc.includes("ARENA_R = 12.5"), "soft garden radius unchanged");
  assert(gardenSrc.includes("makeSkyTexture") && gardenSrc.includes("addGrassField"), "richer sky + grass");

  const looped = closeLoopProprio({ csaT3: 10, campaniform: 4 }, { yawRate: 1.1, wingP: 0 });
  assert(looped.campaniform > 4, "residual campaniform still sees gyro strain");

  console.log("utopia2 linkage sanity OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
