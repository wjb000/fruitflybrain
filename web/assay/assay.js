/**
 * Visual approach assay — see a thing, optional world/light rotate, go get it.
 *
 * Scores distinguish:
 *   - blindness (optic pools never respond)
 *   - motor failure (leg MNs / displacement dead)
 *   - memory/heading failure (senses + walks but approach after rotate ~ chance)
 *
 * North star: tiny thought, not a twitch. Lesions apply on LIF path only.
 */

import { lesionSummary, normalizeLesion } from "../lesion.js";
import { portableControls } from "../controller/portable.js";

export const ASSAY_DEFAULTS = {
  durationSec: 18,
  rotateAtSec: 6,
  rotateRad: Math.PI, // 180° world/light reorientation
  targetR: 7.5,
  approachRadius: 2.4,
  motorDispMin: 1.2,
  motorLegMin: 0.04,
  sensoryOpticMin: 0.03,
  chanceApproach: 0.22, // random-walk baseline-ish
};

/**
 * Place a bright visual target in the dish (uses arena food marker + odor-optional).
 */
export function placeVisualTarget(arena, odors, angle = 0, r = ASSAY_DEFAULTS.targetR) {
  const x = Math.sin(angle) * r;
  const z = Math.cos(angle) * r;
  if (arena?.userData?.food?.position) {
    arena.userData.food.position.set(x, arena.userData.food.position.y, z);
  }
  return { x, z, angle, r };
}

export function rotateWorld(arena, cameraKey, rad, target) {
  // Rotate target around origin (allocentric world rotate).
  if (target) {
    const c = Math.cos(rad), s = Math.sin(rad);
    const x = target.x * c - target.z * s;
    const z = target.x * s + target.z * c;
    target.x = x;
    target.z = z;
    if (arena?.userData?.food?.position) {
      arena.userData.food.position.x = x;
      arena.userData.food.position.z = z;
    }
  }
  // Optional light swing to reinforce reorientation cue.
  if (cameraKey?.position) {
    const c = Math.cos(rad), s = Math.sin(rad);
    const lx = cameraKey.position.x, lz = cameraKey.position.z;
    cameraKey.position.x = lx * c - lz * s;
    cameraKey.position.z = lx * s + lz * c;
  }
  return target;
}

export function distToTarget(fly, target) {
  const x = fly.body.position.x, z = fly.body.position.z;
  return Math.hypot(target.x - x, target.z - z);
}

export function bearingToTarget(fly, target) {
  const x = fly.body.position.x, z = fly.body.position.z;
  const dx = target.x - x, dz = target.z - z;
  const c = Math.cos(fly.heading), s = Math.sin(fly.heading);
  return Math.atan2(dx * c - dz * s, dx * s + dz * c);
}

/**
 * Live trial controller. Call tick(dt) from the app loop while active.
 */
export class ApproachAssay {
  constructor(opts = {}) {
    this.opts = { ...ASSAY_DEFAULTS, ...opts };
    this.active = false;
    this.phase = "idle";
    this.t = 0;
    this.target = null;
    this.rotated = false;
    this.samples = [];
    this.opticPeak = 0;
    const fly0 = 0;
    this.startPos = { x: fly0, z: fly0 };
    this.preRotateDist = null;
    this.postRotateDist = null;
    this.displacement = 0;
    this._lastPos = null;
    this.lesion = normalizeLesion(opts.lesion);
    this.result = null;
    this.onComplete = opts.onComplete || null;
    this.arena = opts.arena || null;
    this.keyLight = opts.keyLight || null;
    this.fly = opts.fly || null;
  }

  start(fly, arena, keyLight, lesionCfg) {
    this.fly = fly || this.fly;
    this.arena = arena || this.arena;
    this.keyLight = keyLight || this.keyLight;
    if (lesionCfg) this.lesion = normalizeLesion(lesionCfg);
    this.active = true;
    this.phase = "encode";
    this.t = 0;
    this.rotated = false;
    this.samples = [];
    this.opticPeak = 0;
    this.displacement = 0;
    this.result = null;
    const ang = Math.random() * Math.PI * 2;
    this.target = placeVisualTarget(this.arena, null, ang, this.opts.targetR);
    // Park fly opposite-ish so approach is meaningful.
    if (this.fly?.resetPose) {
      const sx = -Math.sin(ang) * 2.5;
      const sz = -Math.cos(ang) * 2.5;
      this.fly.resetPose(sx, sz, ang + Math.PI);
    }
    this.startPos = {
      x: this.fly.body.position.x,
      z: this.fly.body.position.z,
    };
    this._lastPos = { ...this.startPos };
    this.preRotateDist = distToTarget(this.fly, this.target);
    this.postRotateDist = null;
    return this;
  }

  stop() {
    this.active = false;
    this.phase = "idle";
  }

  tick(dt) {
    if (!this.active || !this.fly) return null;
    this.t += dt;
    const fly = this.fly;
    const d = distToTarget(fly, this.target);
    const e = fly.motEma || {};
    const optic = mean([e.HS, e.VS, e.T4a, e.T5a, e.L1, e.R16]);
    if (optic > this.opticPeak) this.opticPeak = optic;
    const px = fly.body.position.x, pz = fly.body.position.z;
    if (this._lastPos) {
      this.displacement += Math.hypot(px - this._lastPos.x, pz - this._lastPos.z);
    }
    this._lastPos = { x: px, z: pz };
    const legs = mean([e.T1L, e.T1R, e.T2L, e.T2R, e.T3L, e.T3R]);

    if (!this.rotated && this.t >= this.opts.rotateAtSec) {
      this.preRotateDist = d;
      rotateWorld(this.arena, this.keyLight, this.opts.rotateRad, this.target);
      this.rotated = true;
      this.phase = "seek";
      this.postRotateDist = distToTarget(fly, this.target);
    }

    this.samples.push({
      t: this.t,
      dist: d,
      bearing: bearingToTarget(fly, this.target),
      optic,
      legs,
      walk: fly.cmd?.walk || 0,
      turn: fly.cmd?.turn || 0,
      x: px,
      z: pz,
      heading: fly.heading,
    });

    if (this.t >= this.opts.durationSec) {
      this.result = this.score();
      this.active = false;
      this.phase = "done";
      if (this.onComplete) this.onComplete(this.result);
      return this.result;
    }
    return null;
  }

  score() {
    const o = this.opts;
    const final = this.samples.length
      ? this.samples[this.samples.length - 1]
      : { dist: 99 };
    const after = this.samples.filter((s) => s.t >= o.rotateAtSec);
    const startPost = after[0]?.dist ?? this.postRotateDist ?? final.dist;
    const endPost = after.length ? after[after.length - 1].dist : final.dist;
    const approachFrac = startPost > 1e-3
      ? Math.max(0, (startPost - endPost) / startPost)
      : 0;
    const reached = final.dist <= o.approachRadius;
    const motorOK =
      this.displacement >= o.motorDispMin ||
      (final.legs ?? 0) >= o.motorLegMin ||
      mean(after.map((s) => s.legs)) >= o.motorLegMin;
    const sensoryOK = this.opticPeak >= o.sensoryOpticMin;
    const betterThanChance = approachFrac > o.chanceApproach || reached;
    const taskOK = betterThanChance;
    let failure = null;
    if (!sensoryOK) failure = "blindness";
    else if (!motorOK) failure = "motor";
    else if (!taskOK) failure = "memory_heading";
    const interesting = sensoryOK && motorOK && !taskOK;
    const ctrl = portableControls(this.fly);
    return {
      id: `assay-${Date.now().toString(36)}`,
      lesion: this.lesion,
      lesionSummary: lesionSummary(this.lesion),
      durationSec: this.t,
      rotateAtSec: o.rotateAtSec,
      rotateRad: o.rotateRad,
      target: { ...this.target },
      metrics: {
        finalDist: final.dist,
        preRotateDist: this.preRotateDist,
        postRotateStartDist: startPost,
        postRotateEndDist: endPost,
        approachFrac,
        chanceApproach: o.chanceApproach,
        displacement: this.displacement,
        opticPeak: this.opticPeak,
        reached,
        motorOK,
        sensoryOK,
        taskOK,
        betterThanChance,
      },
      failure,
      interesting,
      portable: {
        steering: ctrl.steering,
        vision: ctrl.vision,
        descending: ctrl.descending,
      },
      nSamples: this.samples.length,
    };
  }
}

function mean(arr) {
  let s = 0, n = 0;
  for (const v of arr) {
    if (v == null || Number.isNaN(v)) continue;
    s += v;
    n++;
  }
  return n ? s / n : 0;
}

/** Rank assay JSONL rows: interesting first, then by approachFrac ascending. */
export function rankInteresting(rows) {
  return [...rows].sort((a, b) => {
    const ia = a.interesting ? 1 : 0;
    const ib = b.interesting ? 1 : 0;
    if (ib !== ia) return ib - ia;
    const aa = a.metrics?.approachFrac ?? 0;
    const bb = b.metrics?.approachFrac ?? 0;
    return aa - bb;
  });
}
