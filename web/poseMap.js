/**
 * MN EMA → muscle / neck / walk-drive mapping (gap-fill readout).
 *
 * Connectome LIF stays primary. This file only turns *existing* annotated
 * pool EMAs into antagonist DoFs. Empty pools stay 0 — no invented MN IDs,
 * no CPG gait, no walk thruster.
 *
 * fullfly1: idle MN noise was tarsus-tap + abdomen twitch while stance-slip
 * stayed gated. Quiet T2/T3/DNa → planted rest (all six legs). Walk MNs →
 * stance/swing from those flex/ext pools; empty T2/T3 Ta* / coxaProm are
 * kinematically coupled in `embodyMuscle` (mesh/plant), not filled with fake
 * cell IDs. Abdomen is dead-zoned and split by soma-Y into NMF segments.
 */

export const LEG_NAMES = ["L1", "R1", "L2", "R2", "L3", "R3"];
export const MUSCLE_NAMES = [
  "coxaProm", "coxaRem", "coxaRotA", "coxaRotP", "coxaAdd",
  "trFlex", "trExt", "feRed", "tiFlex", "tiExt", "taDep", "taLev",
];
export const FORELEGS = new Set(["L1", "R1"]);

/** Per-leg readout. T1 is densely annotated (coxaProm + Ta*) vs T2/T3. */
export const LEG_SCALE = {
  L1: 0.40, R1: 0.40,
  L2: 0.88, R2: 0.88,
  L3: 1.00, R3: 1.00,
};

/** Extra T1 attenuation on the hinges that threw the "arms" up. */
export const T1_MUSCLE_SCALE = {
  coxaProm: 0.40, coxaRem: 0.48, coxaRotA: 0.58, coxaRotP: 0.58, coxaAdd: 0.50,
  trFlex: 0.46, trExt: 0.34, feRed: 0.36, tiFlex: 0.56, tiExt: 0.46,
  taDep: 0.40, taLev: 0.40,
};

/** Hinge spans (rad). Shared by kinematic NMF and documented for the plant. */
export const MUSCLE_SPAN = {
  "coxa-pitch": ["coxaProm", "coxaRem", 0.58],
  "coxa-yaw": ["coxaAdd", "coxaRem", 0.40],
  "coxa-roll": ["coxaRotA", "coxaRotP", 0.34],
  "trochanterfemur-pitch": ["trExt", "trFlex", 0.62],
  "trochanterfemur-roll": ["feRed", null, 0.26],
  "tibia-pitch": ["tiExt", "tiFlex", 0.60],
  "tarsus1-pitch": ["taLev", "taDep", 0.16],
};

/** Male FlyEM muscle pools that are empty (do not invent IDs). */
export const EMPTY_MALE_MUSCLE_POOLS = [
  "L2_coxaProm", "R2_coxaProm", "L3_coxaProm", "R3_coxaProm",
  "L2_taDep", "L2_taLev", "R2_taDep", "R2_taLev",
  "L3_taDep", "L3_taLev", "R3_taDep", "R3_taLev",
];

/** Abdomen MN pool split by soma Y → NMF segments (real IDs, not new cells). */
export const ABD_SEG_KEYS = ["abdomen12", "abdomen3", "abdomen4", "abdomen5", "abdomen6"];
export const ABD_SEG_WEIGHTS = [0.28, 0.48, 0.68, 0.86, 1.00];
export const ABD_POSE_GATE = 0.22;
export const IDLE_WALK_GATE = 0.04;
export const ANTENNA_JO_BASE = 8;
export const ANTENNA_SPAN = 0.16;

/** Visual neck spans (rad). Plant has no neck joint. */
export const NECK_SPAN = { yaw: 0.26, pitch: 0.20, roll: 0.09 };

export const POSE_EMA_ALPHA = 0.38; // slower muscle/neck EMA (was 0.85)
export const MUSCLE_TAU = 0.14;     // hinge follow (was 0.05 — twitchy)
export const NECK_TAU = 0.18;
export const WING_TAU = 0.16;
export const FEED_TAU = 0.18;

/** Visual wing flap. cns3 0.12 + 10 Hz sine read as tapping from idle MN noise. */
export const WING_FLAP_GATE = 0.48;
export const WING_FLAP_AMP = 0.22;
/** Mouth/proboscis. MN9 is 2 cells — a single spike was constant mouthing. */
export const FEED_POSE_GATE = 0.26;

const DEAD = 0.045;

/** Soft-saturating map from effector EMA (0–1) → drive. Quiet stays near 0. */
export function softDrive(v, gain = 2.15) {
  const x = Math.max(0, v || 0);
  return Math.tanh(x * gain);
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

/**
 * Antagonist pair from real pool EMAs.
 * - Quiet×quiet → 0 (rest).
 * - Winner-take-more so co-contraction does not cancel the DoF.
 * - Unipolar (one pool empty, e.g. male T2/T3 coxaProm) stays a modest
 *   offset from rest — not a full-span slam on the remaining remotor.
 */
export function antagPair(posEma, negEma, gain = 2.15) {
  const p0 = Math.max(0, posEma || 0);
  const n0 = Math.max(0, negEma || 0);
  if (p0 + n0 < DEAD) return { pos: 0, neg: 0 };
  const p = softDrive(p0, gain);
  const n = softDrive(n0, gain);
  const mag = p + n;
  if (mag < 1e-4) return { pos: 0, neg: 0 };
  const unipolar = (p0 < DEAD) !== (n0 < DEAD);
  const raw = (p - n) / (mag + 0.06);
  const d = Math.tanh(raw * 1.75);
  const lose = unipolar ? 0.90 : 0.74;
  const boost = unipolar ? 0.06 : 0.10;
  const uni = unipolar ? 0.52 : 1;
  return {
    pos: clamp01(uni * (p * (1 - lose * Math.max(0, -d)) + Math.max(0, d) * boost)),
    neg: clamp01(uni * (n * (1 - lose * Math.max(0, d)) + Math.max(0, -d) * boost)),
  };
}

/** Signed antagonist for hinge targeting. Quiet → 0 (anatomical rest). */
export function antagonist(pos, neg) {
  const p = pos || 0, n = neg || 0;
  const mag = p + n;
  if (mag < 0.02) return 0;
  const raw = (p - n) / (mag + 0.05);
  return Math.tanh(raw * 1.55);
}

export function isForeleg(name) {
  return FORELEGS.has(name);
}

/**
 * Honest MN→muscle for one leg. Empty annotation pools stay 0.
 * T1 (foreleg) scales down so dense coxaProm/Ta* do not flail vs planted slip.
 */
export function muscleFromEma(legName, emaFn) {
  const ema = (m) => Math.max(0, emaFn(m) || 0);
  const gain = isForeleg(legName) ? 1.85 : 2.20;
  const coxa = antagPair(ema("coxaProm"), ema("coxaRem"), gain);
  const rot = antagPair(ema("coxaRotA"), ema("coxaRotP"), gain);
  const add = antagPair(ema("coxaAdd"), ema("coxaRem") * 0.50, gain);
  const tr = antagPair(ema("trFlex"), ema("trExt"), gain);
  const ti = antagPair(ema("tiFlex"), ema("tiExt"), gain);
  const ta = antagPair(ema("taDep"), ema("taLev"), gain);
  const out = {
    coxaProm: coxa.pos,
    coxaRem: Math.max(coxa.neg, add.neg * 0.30),
    coxaRotA: rot.pos,
    coxaRotP: rot.neg,
    coxaAdd: add.pos,
    trFlex: tr.pos,
    trExt: tr.neg,
    feRed: softDrive(ema("feRed"), isForeleg(legName) ? 1.7 : 2.4),
    tiFlex: ti.pos,
    tiExt: ti.neg,
    taDep: ta.pos,
    taLev: ta.neg,
  };
  const legK = LEG_SCALE[legName] ?? 1;
  const t1 = isForeleg(legName) ? T1_MUSCLE_SCALE : null;
  for (const k of MUSCLE_NAMES) {
    const extra = t1 ? (t1[k] ?? 1) : 1;
    out[k] = (out[k] || 0) * legK * extra;
  }
  return out;
}

/**
 * Neck: CvN pool magnitude → pitch; annotated neckL/neckR → yaw/roll.
 * Dead-zone + modest gain so Poisson on 25 cells is not a head-thrash.
 */
export function neckFromEma(e) {
  const dead = 0.06;
  const nL = Math.max(0, (e.neckL || 0) - dead);
  const nR = Math.max(0, (e.neckR || 0) - dead);
  const n0 = Math.max(0, (e.neck || 0) - dead);
  const mag = Math.max(n0, 0.5 * (nL + nR));
  const pair = antagPair(nR, nL, 1.45);
  const yaw = (pair.pos - pair.neg) * 0.55;
  return {
    head: softDrive(mag, 1.25),
    headYaw: Math.max(-1, Math.min(1, yaw)),
    headRoll: Math.max(-1, Math.min(1, yaw * 0.35)),
  };
}

/**
 * Wing power from DLM/DVM/ADMN. Idle Poisson on these small pools must not
 * flap or tap the mesh. Flight translation is gated separately (?flight=1).
 * No cosmetic idle CPG — below WING_FLAP_GATE the mesh stays at rest.
 */
export function wingFromEma(e) {
  const dead = 0.12;
  const dlm = softDrive(Math.max(0, (e.DLM || 0) - dead), 1.45);
  const dvm = softDrive(Math.max(0, (e.DVM || 0) - dead), 1.45);
  const admn = softDrive(Math.max(0, (e.ADMN || 0) - dead), 1.30);
  const power = 0.42 * dlm + 0.38 * dvm + 0.22 * admn;
  if (power < WING_FLAP_GATE) {
    return { dlm: 0, dvm: 0, admn: 0, power: 0, fly: 0 };
  }
  return { dlm, dvm, admn, power, fly: power };
}

/**
 * Proboscis / MN9. MN9 n=2 saturates from one spike (cns3 softDrive×2.4).
 * Dead-zone + low gain; quiet pools → 0 mouth pose.
 */
export function feedFromEma(e) {
  const mn9 = Math.max(0, (e.MN9 || 0) - 0.28);
  const pr = Math.max(0, (e.proboscis || 0) - 0.16);
  const v = softDrive(mn9 * 0.65 + pr * 0.75, 1.20);
  return v < FEED_POSE_GATE ? 0 : v;
}

/**
 * Walk drive from walking-leg neuromeres (T2/T3) + DNa.
 * T1 twitch alone must not gate stance-slip (that froze or thrashed XY).
 */
export function walkDriveFromEma(e) {
  const t23 = ((e.T2L || 0) + (e.T2R || 0) + (e.T3L || 0) + (e.T3R || 0)) / 4;
  const t1 = ((e.T1L || 0) + (e.T1R || 0)) / 2;
  const dna = e.DNa || 0;
  // T1 (foreleg) cannot gate locomotion by itself — that was the arm-flail
  // "walk" that thrashed XY. Quiet T2/T3/DNa → idle.
  if (t23 + dna * 0.6 < 0.10) return 0;
  return softDrive(t23 * 0.92 + dna * 0.55 + t1 * 0.08, 2.15);
}

export function legsMean(e) {
  return ((e.T1L || 0) + (e.T1R || 0) + (e.T2L || 0) + (e.T2R || 0)
    + (e.T3L || 0) + (e.T3R || 0)) / 6;
}

/** Calmer proprio Hz — joint motion into existing cho/hp/csa pools, not a seizure. */
export function proprioJointHz(filt, key, c, dt = 0.032) {
  const slow = filt[key] || 0;
  const a = 1 - Math.exp(-dt / 0.20);
  filt[key] = slow + (c - slow) * a;
  const onset = Math.max(0, c - filt[key]);
  const tonic = Math.log1p(Math.max(0, c) * 3.0) * 16;
  return Math.min(85, 3 + onset * 70 + tonic + c * 9);
}

export function follow(cur, target, dt, tau = MUSCLE_TAU) {
  const a = 1 - Math.exp(-dt / Math.max(1e-4, tau));
  return cur + (target - cur) * a;
}

/** Slip weight: T2/T3 planted feet drive walk; T1 is reach/groom. */
export function slipWeight(legName) {
  return isForeleg(legName) ? 0.28 : 1.0;
}

/**
 * Abdomen posture from the 207-cell pool (and optional soma-Y segments).
 * Large-pool Poisson was a constant butt twitch — dead-zone + gate.
 */
export function abdomenFromEma(e, court = 0) {
  const dead = 0.16;
  const segs = ABD_SEG_KEYS.map((k) => Math.max(0, (e[k] || 0) - dead));
  const whole = Math.max(0, (e.abdomen || 0) - dead);
  const courtV = court > 0.28 ? (court - 0.28) * 0.32 : 0;
  const mag = Math.max(whole, segs.reduce((a, b) => Math.max(a, b), 0));
  const drive = softDrive(mag, 1.30);
  if (drive < ABD_POSE_GATE && courtV < 0.15) {
    return { curl: 0, segs: ABD_SEG_KEYS.map(() => 0), court: 0 };
  }
  const curl = Math.min(1, drive * 0.50 + courtV);
  const sum = segs.reduce((a, b) => a + b, 0);
  const outSegs = segs.map((s, i) => {
    const base = sum > 0.02 ? softDrive(s, 1.35) : curl * ABD_SEG_WEIGHTS[i];
    return Math.min(1, base);
  });
  return { curl, segs: outSegs, court: courtV };
}

/**
 * Antenna deflection from Johnston's organ Hz (sensory reflex, not fake MNs).
 * Quiet wind → 0. Calm — never thrash.
 */
export function antennaFromJo(hz) {
  const x = Math.max(0, (hz || 0) - ANTENNA_JO_BASE);
  const v = Math.tanh(x / 95);
  return v < 0.05 ? 0 : v;
}

/**
 * Gap-fill body mechanics on top of honest `muscleFromEma`.
 * - Idle (quiet T2/T3/DNa): all zeros → planted anatomical rest (no toe-tap).
 * - Walk: empty Ta* / coxaProm couple from tibia/trochanter (kinematic, not IDs).
 * - Stance vs swing from that leg's flex/ext contrast — no CPG clock.
 */
export function embodyMuscle(legName, muscle, { walkDrive = 0 } = {}) {
  const src = muscle || {};
  const out = {};
  for (const k of MUSCLE_NAMES) out[k] = src[k] || 0;
  const walking = (walkDrive || 0) >= IDLE_WALK_GATE;
  if (!walking) {
    for (const k of MUSCLE_NAMES) out[k] = 0;
    out._lift = 0;
    out._swing = false;
    out._stance = true;
    out._coupled = false;
    return out;
  }
  const emptyTa = (src.taDep || 0) + (src.taLev || 0) < 1e-4;
  const emptyProm = (src.coxaProm || 0) < 1e-4;
  if (emptyTa) {
    out.taDep = (src.tiExt || 0) * 0.40;
    out.taLev = (src.tiFlex || 0) * 0.40;
  }
  if (emptyProm) {
    out.coxaProm = (src.trFlex || 0) * 0.22;
  }
  const lift = (out.trFlex + out.tiFlex + out.taLev)
    - (out.trExt + out.tiExt + out.taDep);
  out._lift = lift;
  out._swing = lift > 0.10;
  out._stance = !out._swing;
  out._coupled = emptyTa || emptyProm;
  return out;
}

/** HUD: how many effector pools are mapped vs annotation-empty. */
export function effectorMapStats(counts = {}) {
  const entries = Object.entries(counts || {});
  const mapped = entries.filter(([, n]) => n > 0);
  const empty = entries.filter(([, n]) => n === 0).map(([k]) => k);
  const muscleKeys = LEG_NAMES.flatMap((leg) => MUSCLE_NAMES.map((m) => `${leg}_${m}`));
  const muscleMapped = muscleKeys.filter((k) => (counts[k] || 0) > 0).length;
  const muscleEmpty = muscleKeys.filter((k) => !(counts[k] > 0));
  return {
    mappedN: mapped.length,
    emptyN: empty.length,
    empty,
    muscleMapped,
    muscleEmpty,
    muscleTotal: muscleKeys.length,
    abdomen: counts.abdomen || 0,
    neck: counts.neck || 0,
    wings: (counts.DLM || 0) + (counts.DVM || 0) + (counts.ADMN || 0),
    mn9: counts.MN9 || 0,
    proboscis: counts.proboscis || 0,
  };
}
