#!/usr/bin/env node
/**
 * linked1: coverage bridges use existing IDs only.
 * Residual aggregates, proprio loop, antenna parts, haltere gyro, abdomen yaw.
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
    residualIds, closeLoopProprio, antennaFromJo, antennaPartsFromJo,
    haltereFromSense, abdomenFromEma, wingFromEma, embodyMuscle, muscleFromEma,
    EMPTY_MALE_MUSCLE_POOLS, ABD_SEG_KEYS, ANTENNA_PARTS, WING_FLAP_GATE,
  } = pose;

  const stim = JSON.parse(fs.readFileSync(path.join(ROOT, "web/data/stim.json"), "utf8"));
  const eff = JSON.parse(fs.readFileSync(path.join(ROOT, "web/data/effectors.json"), "utf8"));
  const counts = eff.counts || {};

  console.log("--- residual smell/taste drop typed pools ---");
  const smell = stim.smell || [];
  const food = stim.foodORN || [];
  const pher = stim.pherORN || [];
  const co2 = stim.co2ORN || [];
  const av = stim.aversiveORN || [];
  const smellRes = residualIds(smell, food, pher, co2, av);
  console.log({ smell: smell.length, residual: smellRes.length, food: food.length });
  assert(smellRes.length > 400, "untyped ORNs exist and must be driven");
  assert(smellRes.length < smell.length, "residual is smaller than all olfactory");
  const foodSet = new Set(food);
  assert(!smellRes.some((i) => foodSet.has(i)), "foodORN IDs must not sit in residual smell");
  const tasteRes = residualIds(stim.taste || [], stim.sweet || [], stim.bitter || []);
  assert(tasteRes.length > 200, "untyped taste cells remain");
  const sweetSet = new Set(stim.sweet || []);
  assert(!tasteRes.some((i) => sweetSet.has(i)), "sweet GRNs must not sit in residual taste");

  console.log("--- empty male muscle pools stay empty ---");
  assert(EMPTY_MALE_MUSCLE_POOLS.length === 12, "twelve empty T2/T3 pools");
  for (const k of EMPTY_MALE_MUSCLE_POOLS) {
    assert((counts[k] || 0) === 0, `${k} must stay annotation-empty`);
  }
  const walk = { T2L: 0.5, T2R: 0.5, T3L: 0.45, T3R: 0.45, DNa: 0.3 };
  const l2raw = muscleFromEma("L2", (m) => ({ trFlex: 0.5, tiFlex: 0.45 }[m] || 0));
  assert(l2raw.taLev === 0 && l2raw.coxaProm === 0, "must not invent T2 Ta/prom MN readout");
  const l2 = embodyMuscle("L2", l2raw, { walkDrive: 0.4 });
  assert(l2._coupled === true && l2.taLev > 0, "walk may couple empty Ta hinges");

  console.log("--- proprio loop writes existing csaT3 / hpT1 ---");
  const base = { csaT3: 10, hpT1: 8, propT3: 6, choT1L: 4 };
  const looped = closeLoopProprio(base, {
    yawRate: 1.2, neckMag: 0.4, headYaw: 0.3, abd: 0.5, antL: 0.4, antR: 0.1, wingP: 0,
  });
  assert(looped.csaT3 > base.csaT3, "yaw-rate must load metathoracic campaniform");
  assert(looped.csaT3R > (base.csaT3R || 0), "right yaw loads csaT3R");
  assert(looped.hpT1 > base.hpT1, "neck pose must load hpT1");
  assert(looped.propT3 > base.propT3, "abdomen curl must load hind proprio");
  assert(looped.choT1L > base.choT1L, "antenna pose feeds choT1");
  const quiet = closeLoopProprio({ csaT3: 10 }, { yawRate: 0, neckMag: 0, abd: 0, wingP: 0 });
  assert(quiet.csaT3 === 10, "idle must not invent campaniform drive");

  console.log("--- antenna JO denser parts; quiet stays 0 ---");
  assert(antennaFromJo(6) === 0, "baseline JO quiet");
  const parts = antennaPartsFromJo(90);
  assert(parts.mag > 0.2, "strong JO deflects");
  assert(parts.funiculus > parts.pedicel, "JO joint is funiculus-weighted");
  assert(parts.arista < parts.funiculus, "arista is a follower");
  assert(ANTENNA_PARTS.funiculus > ANTENNA_PARTS.pedicel, "funiculus share > pedicel");

  console.log("--- haltere gyro: rest 0, yaw deflects, no CPG ---");
  assert(haltereFromSense({ yawRate: 0, wingPower: 0 }, "L") === 0, "idle haltere still");
  const haltL = haltereFromSense({ yawRate: -1.4, wingPower: 0 }, "L");
  const haltR = haltereFromSense({ yawRate: -1.4, wingPower: 0 }, "R");
  assert(haltL > 0.05, "left yaw loads left haltere");
  assert(haltL >= haltR, "ipsi gyro stronger than contra");
  const beat = haltereFromSense({ yawRate: 0, wingPower: 0.7 }, "L");
  assert(beat > 0.4, "gated wing power may beat halteres");

  console.log("--- abdomen yaw from soma-X split of same 207 IDs ---");
  const qAbd = abdomenFromEma({ abdomen: 0.10, abdomen_L: 0.08, abdomen_R: 0.08 }, 0);
  assert(qAbd.curl === 0 && (qAbd.yaw || 0) === 0, "idle abdomen no curl/yaw");
  const hotAbd = abdomenFromEma({
    abdomen: 0.65, abdomen12: 0.4, abdomen3: 0.5, abdomen4: 0.55,
    abdomen_L: 0.20, abdomen_R: 0.70,
  }, 0.1);
  assert(hotAbd.segs.length === ABD_SEG_KEYS.length, "five segments");
  assert(hotAbd.curl > 0, "driven abdomen may curl");
  assert(Math.abs(hotAbd.yaw) > 0.02, "L/R abdomen MN split may yaw");

  console.log("--- wings still gated; L/R fields present ---");
  const idleW = wingFromEma({ DLM: 0.18, DVM: 0.16, ADMN: 0.14, DLM_L: 0.2, DLM_R: 0.15 });
  assert(idleW.power === 0 && idleW.dlmL === 0, "idle wings folded including L/R");
  assert(WING_FLAP_GATE >= 0.45, "wing gate stays high");

  console.log("--- no invented MN names in effectors ---");
  assert(!("haltere" in counts) && !("antennaMN" in counts), "do not invent halt/ant MN pools");
  assert((counts.abdomen || 0) === 207, "abdomen pool is the 207-cell export");
  assert((counts.csaT3 || 0) === 199, "csaT3 is the haltere-analog sense pool");
  assert((stim.courtship || []).length === 3149, "courtship sensory pool size");

  console.log("linked1 linkage sanity OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
