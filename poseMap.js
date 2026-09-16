/**
 * MN EMA → muscle / neck / walk-drive mapping (gap-fill readout).
 *
 * Connectome LIF stays primary. This file only turns *existing* annotated
 * pool EMAs into antagonist DoFs. Empty pools stay 0 — no invented MN IDs,
 * no CPG gait, no walk thruster.
 *
 * cns3: T1 (foreleg) and neck* pools are small and were saturating through
 * softDrive×span, which looked like head-twitch + arm-flail. Walk legs
 * (T2/T3) keep more authority so planted slip can still translate.
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
  "tarsus1-pitch": ["taLev", "taDep", 0.32],
};

/** Visual neck spans (rad). Plant has no neck joint. */
export const NECK_SPAN = { yaw: 0.26, pitch: 0.20, roll: 0.09 };

export const POSE_EMA_ALPHA = 0.38; // slower muscle/neck EMA (was 0.85)
export const MUSCLE_TAU = 0.14;     // hinge follow (was 0.05 — twitchy)
export const NECK_TAU = 0.18;

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
  return isForeleg(legName) ? 0.32 : 1.0;
}
