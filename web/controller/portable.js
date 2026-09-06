/**
 * Portable vision→steering control interface for a future robot driver.
 *
 * Exposes HS/VS / descending / MN-derived turn+walk as a clean snapshot a
 * robot (or stub) can consume. Does not invent actuators — values come from
 * the same EmbodiedFly cmd + effector EMAs as the dish sim.
 *
 * Robot driver is stubbed: see stubRobotDriver() / chassisSetpoints().
 */

/**
 * Build a robot-facing snapshot from an EmbodiedFly (or compatible object).
 */
export function portableControls(fly) {
  const e = fly?.motEma || {};
  const cmd = fly?.cmd || {};
  const eye = fly?.eye;
  const hsL = num(fly?.opticEma?.HS_L, e.HS);
  const hsR = num(fly?.opticEma?.HS_R, e.HS);
  const vsL = num(fly?.opticEma?.VS_L, e.VS);
  const vsR = num(fly?.opticEma?.VS_R, e.VS);
  const legsL = mean([e.T1L, e.T2L, e.T3L]);
  const legsR = mean([e.T1R, e.T2R, e.T3R]);
  // Prefer agent cmd (already MN→softDrive from T1–T3 + DNa); fall back to pools.
  const walk = clamp01(cmd.walk ?? soft(legsL * 0.5 + legsR * 0.5));
  const turn = clamp(cmd.turn ?? Math.tanh((legsR - legsL) * 2), -1, 1);
  const dna = e.DNa || 0;
  const dnp = e.DNp || 0;
  const dng = e.DNg02 || 0;
  // Chassis commands = MN-derived walk/turn only (no vision bypass, no invented thrust).
  const forward = walk;
  const yawRate = turn;
  return {
    t: fly?.clock ?? 0,
    heading: fly?.heading ?? 0,
    position: {
      x: fly?.body?.position?.x ?? 0,
      y: fly?.y ?? fly?.body?.position?.y ?? 0,
      z: fly?.body?.position?.z ?? 0,
    },
    vision: {
      HS_L: hsL,
      HS_R: hsR,
      VS_L: vsL,
      VS_R: vsR,
      opticMean: mean([hsL, hsR, vsL, vsR, e.T4a, e.T5a]),
      eyeHint: eye
        ? { ready: true, sectors: eye.lastSummary || null }
        : { ready: false },
    },
    descending: {
      DNa: dna,
      DNp: dnp,
      DNp01: e.DNp01 || 0,
      DNg02: dng,
    },
    motor: {
      walk,
      turn,
      fly: clamp01(cmd.fly || 0),
      legsL,
      legsR,
      wing: {
        dlm: cmd.wing?.dlm ?? e.DLM ?? 0,
        dvm: cmd.wing?.dvm ?? e.DVM ?? 0,
        admn: cmd.wing?.admn ?? e.ADMN ?? 0,
      },
    },
    steering: {
      forward,
      yawRate,
      mode: fly?.life?.mode || "rest",
    },
    neuromod: {
      hunger: fly?.life?.hunger ?? 0,
      arousal: fly?.life?.arousal ?? 0,
      OA: e.OA || 0,
      DAN: e.DAN || 0,
    },
  };
}

/** Thin stub — returns chassis setpoints; no hardware. Conservative gains. */
export function stubRobotDriver(controls) {
  return chassisSetpoints(controls, { vGain: 0.12, yawGain: 0.8 });
}

/**
 * Map MN-derived steering → kinematic chassis velocities.
 * Gains are readability only; source is always portableControls (connectome MNs).
 */
export function chassisSetpoints(controls, { vGain = 2.6, yawGain = 2.4 } = {}) {
  const c = controls || {};
  const forward = c.steering?.forward ?? 0;
  const yawRate = c.steering?.yawRate ?? 0;
  return {
    forward,
    yawRate,
    v: forward * vGain,
    omega: yawRate * yawGain,
    source: "fruitflybrain.portable",
    t: c.t ?? 0,
  };
}

export const PORTABLE_SIGNAL_DOC = {
  "vision.HS_L/R": "Horizontal system pool rates (L/R)",
  "vision.VS_L/R": "Vertical system pool rates (L/R)",
  "descending.*": "Descending neuron pool EMAs",
  "motor.walk/turn/fly": "MN-derived body labels (not free-joint thrusters)",
  "steering.forward/yawRate": "Clean chassis commands for a robot driver",
  "neuromod.hunger/OA/DAN": "Slow state / modulator dials",
};

function num(a, b) {
  if (a != null && Number.isFinite(a)) return a;
  return b || 0;
}
function mean(arr) {
  let s = 0, n = 0;
  for (const v of arr) {
    if (v == null) continue;
    s += v;
    n++;
  }
  return n ? s / n : 0;
}
function clamp01(v) {
  return Math.max(0, Math.min(1, v || 0));
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function soft(v) {
  return Math.tanh(Math.max(0, v || 0) * 2.8);
}
