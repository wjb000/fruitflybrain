/**
 * Connectome chemical-synapse helpers — NT-aware signed weights +
 * Tsodyks–Markram short-term plasticity (depression / facilitation).
 *
 * Canonical formulas used by sim.worker.js (inlined) and tools/lib/lif_engine.mjs.
 * Real FlyEM edge weights (synapse counts, min 5). No invented neurons.
 */

export const NT_NAMES = [
  "unknown", "acetylcholine", "gaba", "glutamate", "histamine",
  "dopamine", "serotonin", "octopamine",
];

/**
 * TM parameters by NT id.
 * Depressing: high U, short tau_f, long tau_d (ACh / GABA / GluCl).
 * Facilitating: low U, long tau_f (OA). Histamine (photoreceptors) is near-tonic.
 */
export const NT_STP = [
  { U: 0.22, tauD: 260, tauF: 90, kind: "mixed" },       // 0 unknown
  { U: 0.40, tauD: 420, tauF: 48, kind: "depress" },     // 1 ACh
  { U: 0.30, tauD: 320, tauF: 70, kind: "depress" },     // 2 GABA
  { U: 0.34, tauD: 360, tauF: 60, kind: "depress" },     // 3 Glu (GluCl)
  { U: 0.10, tauD: 90, tauF: 40, kind: "tonic" },        // 4 histamine
  { U: 0.16, tauD: 400, tauF: 180, kind: "slow" },       // 5 DA (modulator)
  { U: 0.14, tauD: 480, tauF: 220, kind: "slow" },       // 6 5HT
  { U: 0.10, tauD: 200, tauF: 520, kind: "facilitate" }, // 7 OA
];

/** Traced hDeltaH/A/I/G indices (Berg Male CNS v1.0). Optional mid-run Δw only. */
export const HDELTA_PLASTIC_IDS = [
  3174, 5649, 11289, 11642, 13750, 126639, 127063, 128356,
  7130, 7298, 9992, 18088, 29457, 39405, 44068, 50044, 126152, 126209, 127219, 130937,
  3480, 28809, 35856, 52103, 55439, 60280, 62526, 69971, 91932, 92982, 93868, 96852,
  103154, 126207, 129884, 132376, 135244,
  8910, 9588, 16474, 28994, 34418, 35536, 42084, 126635,
];

/**
 * Effective chemical weight from a connectome synapse count.
 * Mix of √w (hubs don't explode) and linear (strong MN edges stay strong).
 * Not a unit hit: w=5 vs w=80 still differ by ~5× (sqrt-only was ~4×; linear 16×).
 */
export function chemWeight(w) {
  const x = w > 0 ? w : 0;
  return 0.68 * Math.sqrt(x) + 0.040 * x;
}

/** Fast chemical sign: ACh +, GABA/Glu/histamine −, DA/5HT/OA slow (0). */
export function ntSign(nt, inhibGain) {
  if (nt === 5 || nt === 6 || nt === 7) return 0;
  if (nt === 2 || nt === 3 || nt === 4) return -inhibGain;
  return 1;
}

/** Recover utilization toward 0 over dt (ms). */
export function recoverU(u, dt, tauF) {
  return u * Math.exp(-Math.max(0, dt) / Math.max(1e-3, tauF));
}

/** Recover vesicular resource toward 1 over dt (ms). */
export function recoverX(x, dt, tauD) {
  const a = Math.exp(-Math.max(0, dt) / Math.max(1e-3, tauD));
  return 1 - (1 - x) * a;
}

/**
 * Tsodyks–Markram spike: u↑, transmit uOn·x, then depress x.
 * Returns { uOn, xNext, eff } without allocating in hot paths when inlined.
 */
export function tmTransmit(u, x, U) {
  const uOn = u + U * (1 - u);
  const eff = uOn * x;
  const xNext = Math.max(0.06, x * (1 - uOn));
  return { uOn, xNext, eff };
}

/** Steady-state efficacy after many spikes at interval isiMs (analytic TM). */
export function tmSteadyEff(U, tauD, tauF, isiMs) {
  const aD = Math.exp(-isiMs / tauD);
  const aF = Math.exp(-isiMs / tauF);
  // u recovers to 0 then jumps: u_ss = U / (1 - (1-U)*aF) * (1-aF) wait:
  // u_pre = u_post * aF; u_post = u_pre + U*(1-u_pre) = U + (1-U)*u_pre
  // u_post = U + (1-U)*aF*u_post  => u_post = U / (1 - (1-U)*aF)
  const uOn = U / (1 - (1 - U) * aF);
  const beta = 1 - uOn;
  // x_pre = 1 - (1-x_post)*aD; x_post = max(0.06, x_pre*beta)
  // ignore floor for analytic:
  // x_post = (1 - (1-x_post)*aD)*beta
  // x_post = (1-aD)*beta + x_post*aD*beta
  // x_post * (1 - aD*beta) = (1-aD)*beta
  const denom = 1 - aD * beta;
  const xPost = denom > 1e-6 ? ((1 - aD) * beta) / denom : 0.06;
  const xPre = 1 - (1 - xPost) * aD;
  return uOn * xPre;
}
