#!/usr/bin/env node
/**
 * fullfly1: idle planted (no tarsus tap / abdomen twitch); walk MNs → stance/swing;
 * empty Ta* / coxaProm stay 0 in MN readout; kinematic couple only while walking.
 */
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const m = await import(pathToFileURL(path.join(ROOT, "web/poseMap.js")).href);
  const {
    muscleFromEma, embodyMuscle, abdomenFromEma, antennaFromJo, walkDriveFromEma,
    wingFromEma, feedFromEma, effectorMapStats, EMPTY_MALE_MUSCLE_POOLS,
    ABD_SEG_KEYS, MUSCLE_SPAN, IDLE_WALK_GATE, ABD_POSE_GATE, WING_FLAP_GATE,
  } = m;

  console.log("--- idle: embodyMuscle zeros all six legs (no toe-tap) ---");
  const noisy = (muscle) => ({
    coxaProm: 0.22, coxaRem: 0.18, coxaRotA: 0.12, coxaRotP: 0.10,
    coxaAdd: 0.10, trFlex: 0.20, trExt: 0.18, feRed: 0.15,
    tiFlex: 0.22, tiExt: 0.16, taDep: 0.35, taLev: 0.28,
  }[muscle]);
  const idleWalk = walkDriveFromEma({ T1L: 0.4, T1R: 0.4, T2L: 0.04, T2R: 0.04, T3L: 0.03, T3R: 0.03, DNa: 0.02 });
  assert(idleWalk < IDLE_WALK_GATE, "T1 twitch must not walk");
  for (const leg of ["L1", "R1", "L2", "R2", "L3", "R3"]) {
    const raw = muscleFromEma(leg, noisy);
    const body = embodyMuscle(leg, raw, { walkDrive: idleWalk });
    assert(body.taDep === 0 && body.taLev === 0, `${leg} idle tarsus must be 0`);
    assert(body.trFlex === 0 && body.tiFlex === 0, `${leg} idle proximal must be 0`);
    assert(body._stance === true && body._swing === false, `${leg} idle planted`);
  }

  console.log("--- walk: T2/T3 flex vs ext → swing vs stance; empty Ta coupled ---");
  const walk = walkDriveFromEma({ T1L: 0.12, T1R: 0.10, T2L: 0.42, T2R: 0.40, T3L: 0.38, T3R: 0.36, DNa: 0.28 });
  assert(walk >= IDLE_WALK_GATE, "T2/T3 + DNa must walk");
  const flexEma = (muscle) => ({ trFlex: 0.55, tiFlex: 0.50, trExt: 0.08, tiExt: 0.06, coxaRem: 0.12 }[muscle] || 0);
  const extEma = (muscle) => ({ trFlex: 0.08, tiFlex: 0.06, trExt: 0.55, tiExt: 0.50, coxaRem: 0.20 }[muscle] || 0);
  const l2raw = muscleFromEma("L2", flexEma);
  assert(l2raw.taDep === 0 && l2raw.taLev === 0, "must not invent Ta* IDs on T2");
  assert(l2raw.coxaProm === 0, "must not invent coxaProm IDs on T2");
  const l2 = embodyMuscle("L2", l2raw, { walkDrive: walk });
  assert(l2._swing === true, "flex-dominant T2 is swing");
  assert(l2.taLev > 0, "empty Ta kinematically follows tibia flex while walking");
  const r3raw = muscleFromEma("R3", extEma);
  const r3 = embodyMuscle("R3", r3raw, { walkDrive: walk });
  assert(r3._stance === true && r3._swing === false, "ext-dominant T3 is stance");
  assert(r3.taDep > 0, "empty Ta kinematically follows tibia ext while walking");

  console.log("--- abdomen dead-zone (207-cell Poisson is not a butt twitch) ---");
  const qAbd = abdomenFromEma({ abdomen: 0.12, abdomen12: 0.10, abdomen3: 0.09 }, 0.05);
  const hotAbd = abdomenFromEma({ abdomen: 0.62, abdomen12: 0.40, abdomen3: 0.48, abdomen4: 0.55 }, 0.1);
  const courtAbd = abdomenFromEma({ abdomen: 0.10 }, 0.85);
  console.log("quiet/hot/court abd", qAbd.curl, hotAbd.curl, courtAbd.curl);
  assert(qAbd.curl === 0 && qAbd.segs.every((s) => s === 0), "idle abdomen still");
  assert(hotAbd.curl > ABD_POSE_GATE * 0.5, "driven abdomen may curl");
  assert(hotAbd.segs.length === ABD_SEG_KEYS.length, "five NMF abdomen segments");
  assert(courtAbd.curl > 0, "sustained courtship may still curl");

  console.log("--- antenna JO reflex is calm ---");
  assert(antennaFromJo(6) === 0, "baseline JO must not twitch antennae");
  assert(antennaFromJo(12) === 0 || antennaFromJo(12) < 0.1, "mild JO stays tiny");
  assert(antennaFromJo(90) > 0.2 && antennaFromJo(90) < 0.85, "strong wind may deflect, not thrash");

  console.log("--- wings/mouth gates kept (cns4) ---");
  assert(wingFromEma({ DLM: 0.18, DVM: 0.16, ADMN: 0.14 }).power === 0, "idle wings folded");
  assert(feedFromEma({ MN9: 0.40, proboscis: 0.12 }) === 0, "idle MN9 does not mouth");
  assert(MUSCLE_SPAN["tarsus1-pitch"][2] <= 0.18, "tarsus span reduced (was oversensitive)");
  assert(EMPTY_MALE_MUSCLE_POOLS.length === 12, "twelve empty male muscle pools");
  assert(WING_FLAP_GATE >= 0.45, "wing flap gate stays high");

  console.log("--- effector map stats ---");
  const stats = effectorMapStats({
    T1L: 87, abdomen: 207, L2_coxaProm: 0, L2_taDep: 0, L2_taLev: 0,
    L1_taDep: 5, DLM: 10,
  });
  assert(stats.emptyN >= 3, "empty pools counted");
  assert(stats.muscleEmpty.includes("L2_coxaProm"), "empty coxaProm listed");
  assert(stats.mappedN >= 3, "mapped pools counted");

  console.log("fullfly1 pose sanity OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
