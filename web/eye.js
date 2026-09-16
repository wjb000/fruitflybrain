/**
 * Drosophila compound eye: hexagonal ommatidia, R1–R6 achromatic, R7 UV,
 * R8 blue–green, L1 ON / L2 OFF, T4/T5 Hassenstein–Reichardt, HS/VS wide-field.
 *
 * Gap-fill: 3D garden rays → receptor catches → Hz on *real* optic pools
 * (R16 / R7 / R8 / L1–L3 / T4* / T5* / HS / VS). Not a camera frame dump,
 * not a food-salience blob into motion cells, not a bearing thruster.
 *
 * Ethology: ommatidial lattice samples the utopia as a fly would — luminance
 * contrast, UV, motion parallax from ego-motion × depth, looming from
 * approaching surfaces. Object identity (fruit vs dew) stays in HUD summaries
 * only; it does not ride into T4/T5/HS.
 */

const DA = 3.8 * Math.PI / 180;
const FOV = 1.42;
const RINGS = 19;
const ARENA_R = 12.5;
const ARENA_R2 = ARENA_R * ARENA_R;

function hexLattice(rings, da, fov) {
  const cells = [];
  const map = new Map();
  const key = (q, r) => q + "," + r;
  function add(q, r) {
    const x = da * (q + r * 0.5);
    const y = da * (r * 0.86602540378);
    if (Math.hypot(x, y) > fov) return;
    const i = cells.length;
    const ca = Math.cos(x), sa = Math.sin(x);
    const ce = Math.cos(y), se = Math.sin(y);
    cells.push({
      q, r, i, az: x, el: y,
      lx: sa * ce,
      ly: se,
      lz: ca * ce,
    });
    map.set(key(q, r), i);
  }
  add(0, 0);
  for (let ring = 1; ring <= rings; ring++) {
    let q = ring, r = 0;
    const steps = [[-1, 1], [-1, 0], [0, -1], [1, -1], [1, 0], [0, 1]];
    for (const [dq, dr] of steps) {
      for (let s = 0; s < ring; s++) {
        add(q, r);
        q += dq;
        r += dr;
      }
    }
  }
  for (const c of cells) {
    c.azP = map.get(key(c.q + 1, c.r));
    c.azM = map.get(key(c.q - 1, c.r));
    c.elP = map.get(key(c.q, c.r + 1));
    c.elM = map.get(key(c.q, c.r - 1));
  }
  return cells;
}

const OMM = hexLattice(RINGS, DA, FOV);
const N = OMM.length;

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const sx = ox - cx, sy = oy - cy, sz = oz - cz;
  const b = sx * dx + sy * dy + sz * dz;
  const c = sx * sx + sy * sy + sz * sz - r * r;
  const disc = b * b - c;
  if (disc < 0) return 1e9;
  const t = -b - Math.sqrt(disc);
  return t > 0.04 ? t : 1e9;
}

function rayFloor(oy, dy) {
  if (dy >= -1e-5) return 1e9;
  const t = -oy / dy;
  return t > 0.04 ? t : 1e9;
}

function rayCylY(ox, oy, oz, dx, dy, dz, cx, cz, r, h) {
  const ex = ox - cx, ez = oz - cz;
  const a = dx * dx + dz * dz;
  if (a < 1e-8) return 1e9;
  const b = 2 * (ex * dx + ez * dz);
  const c = ex * ex + ez * ez - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return 1e9;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0.04) return 1e9;
  const y = oy + dy * t;
  if (y < 0 || y > h) return 1e9;
  return t;
}

function rayWall(ox, oz, dx, dz) {
  const a = dx * dx + dz * dz;
  if (a < 1e-8) return 1e9;
  const b = 2 * (ox * dx + oz * dz);
  const c = ox * ox + oz * oz - ARENA_R2;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return 1e9;
  const t = (-b + Math.sqrt(disc)) / (2 * a);
  return t > 0.04 ? t : 1e9;
}

function eyeToWorld(lx, ly, lz, heading, side) {
  const yaw = heading + side * 0.50;
  const pitch = 0.14;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const x1 = lx;
  const y1 = cp * ly + sp * lz;
  const z1 = -sp * ly + cp * lz;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  return {
    x: cy * x1 + sy * z1,
    y: y1,
    z: -sy * x1 + cy * z1,
  };
}

function flyBalls(pos, heading) {
  const s = Math.sin(heading), c = Math.cos(heading);
  const x = pos.x, y = pos.y, z = pos.z;
  return [
    { x, y, z, r: 0.45 },
    { x: x + s * 0.55, y: y + 0.02, z: z + c * 0.55, r: 0.32 },
    { x: x - s * 0.85, y: y - 0.04, z: z - c * 0.85, r: 0.38 },
  ];
}

/** Fly-relevant spectral sketch (UV / blue / green / yellow) — not sRGB. */
function hitSpectra(hit, day, near, dy, extra) {
  const d = Math.max(0.25, day);
  if (hit === "sky") {
    const el = Math.max(0, dy);
    const sky = (0.42 + 0.58 * d) * (0.38 + 0.62 * el);
    return { uv: sky * 0.85, blue: sky * 0.72, green: sky * 0.40, yellow: sky * 0.18 };
  }
  if (hit === "floor") {
    const moss = extra.moss ?? 0.5;
    const fl = (0.12 + 0.10 * moss) * (0.52 + 0.48 * d);
    return { uv: fl * 0.10, blue: fl * 0.22, green: fl * 0.78, yellow: fl * 0.42 };
  }
  if (hit === "wall") {
    const w = 0.20 * d;
    return { uv: w * 0.12, blue: w * 0.35, green: w * 0.70, yellow: w * 0.30 };
  }
  if (hit === "food") {
    const f = d * near;
    return { uv: 0.05 * f, blue: 0.12 * f, green: 0.68 * f, yellow: 1.15 * f };
  }
  if (hit === "flower") {
    const f = d * near;
    return { uv: 0.55 * f, blue: 0.70 * f, green: 0.38 * f, yellow: 0.48 * f };
  }
  if (hit === "bitter") {
    const f = d * near;
    return { uv: 0.28 * f, blue: 0.18 * f, green: 0.62 * f, yellow: 0.22 * f };
  }
  if (hit === "perch") {
    const f = d * near;
    return { uv: 0.06 * f, blue: 0.16 * f, green: 0.48 * f, yellow: 0.32 * f };
  }
  if (hit === "water") {
    const f = d * near;
    return { uv: 0.95 * f, blue: 1.05 * f, green: 0.32 * f, yellow: 0.08 * f };
  }
  if (hit === "bomb") {
    const pulse = extra.pulse ?? 1;
    const f = d * near * pulse;
    return { uv: 0.10 * f, blue: 0.18 * f, green: 0.70 * f, yellow: 0.95 * f };
  }
  // Other fly — body albedo, slight UV.
  const col = extra.col || [0.3, 0.5, 0.9];
  const f = d * near;
  return {
    uv: 0.20 * f,
    blue: col[2] * 0.85 * f,
    green: col[1] * 0.80 * f,
    yellow: col[0] * 0.55 * f,
  };
}

/** R1–R6 / Rh1 broadband (achromatic). Not human photopic 0.30R+0.59G+0.11B. */
function r16Catch(s) {
  return 0.08 * s.uv + 0.28 * s.blue + 0.42 * s.green + 0.22 * s.yellow;
}
/** R7: UV. */
function r7Catch(s) {
  return s.uv;
}
/** R8 pale/yellow (Rh5 blue + Rh6 green). */
function r8Catch(s) {
  return 0.55 * s.blue + 0.45 * s.green;
}

function hzVis(v, gain = 70, base = 3) {
  return Math.max(0, Math.min(110, base + v * gain));
}

function lrMild(hzL, hzR, gain = 0.18) {
  const mid = 0.5 * (hzL + hzR);
  const d = hzL - hzR;
  const g = 0.5 + gain;
  return {
    L: Math.max(0, Math.min(140, mid + d * g)),
    R: Math.max(0, Math.min(140, mid - d * g)),
  };
}

export class CompoundEye {
  constructor() {
    this.cells = OMM;
    this.n = N;
    this.prevL = { L: new Float32Array(N), R: new Float32Array(N) };
    this.prevOn = { L: new Float32Array(N), R: new Float32Array(N) };
    this.prevDepth = { L: new Float32Array(N), R: new Float32Array(N) };
    this.prevDepth.L.fill(1e9);
    this.prevDepth.R.fill(1e9);
    this.lum = { L: new Float32Array(N), R: new Float32Array(N) };
    this.uv = { L: new Float32Array(N), R: new Float32Array(N) };
    this.r8 = { L: new Float32Array(N), R: new Float32Array(N) };
    this.depth = { L: new Float32Array(N), R: new Float32Array(N) };
    this.last = null;
  }

  sample(world) {
    const day = world.day != null ? world.day : 0.7;
    const origin = world.origin;
    const heading = world.heading;
    const food = world.food;
    const water = world.water;
    const ego = world.ego || { vx: 0, vy: 0, vz: 0, yawRate: 0, dt: 0.032 };
    const evx = ego.vx || 0, evy = ego.vy || 0, evz = ego.vz || 0;
    const yawRate = ego.yawRate || 0;
    const others = world.others || (world.other
      ? [{ pos: world.other.pos || world.other.body?.position, heading: world.other.heading, color: world.otherColor }]
      : []);
    const balls = [];
    for (const o of others.slice(0, 7)) {
      if (!o || !o.pos) continue;
      const col = o.color || [0.3, 0.5, 0.9];
      for (const b of flyBalls(o.pos, o.heading || 0)) balls.push({ ...b, col });
    }
    const ox = origin.x, oy = origin.y, oz = origin.z;
    const out = {};

    for (const sideName of ["L", "R"]) {
      const side = sideName === "L" ? -1 : 1;
      const lum = this.lum[sideName];
      const uvA = this.uv[sideName];
      const r8A = this.r8[sideName];
      const depA = this.depth[sideName];
      const prev = this.prevL[sideName];
      const prevOn = this.prevOn[sideName];
      const prevZ = this.prevDepth[sideName];
      const ex = eyeToWorld(1, 0, 0, heading, side);
      const ey = eyeToWorld(0, 1, 0, heading, side);
      const ez = eyeToWorld(0, 0, 1, heading, side);
      let sumL = 0, sumUV = 0, sumR8 = 0, sumOn = 0, sumOff = 0;
      let sumSal = 0, sumFood = 0, sumWater = 0, sumFly = 0, sumBitter = 0;
      let sumLoom = 0, sumFlowH = 0, sumFlowV = 0, sumNear = 0;
      let t4a = 0, t4b = 0, t4c = 0, t4d = 0;
      let t5a = 0, t5b = 0, t5c = 0, t5d = 0;
      let geoA = 0, geoB = 0, geoC = 0, geoD = 0;
      const secL = [0, 0, 0, 0], secN = [0, 0, 0, 0];
      const secUV = [0, 0, 0, 0], secR8 = [0, 0, 0, 0];
      const secFood = [0, 0, 0, 0], secWater = [0, 0, 0, 0];
      const secFly = [0, 0, 0, 0], secBitter = [0, 0, 0, 0];
      const onArr = new Float32Array(N);
      const offArr = new Float32Array(N);
      const salArr = new Float32Array(N);

      for (let i = 0; i < N; i++) {
        const om = OMM[i];
        const d = eyeToWorld(om.lx, om.ly, om.lz, heading, side);
        const dx = d.x, dy = d.y, dz = d.z;

        let best = 1e9, hit = "sky", hitCol = [0.3, 0.5, 0.9];
        const tf = rayFloor(oy, dy);
        if (tf < best) { best = tf; hit = "floor"; }
        const tw = rayWall(ox, oz, dx, dz);
        if (tw < best) {
          const wy = oy + dy * tw;
          if (wy > 0 && wy < 0.42) { best = tw; hit = "wall"; }
        }
        const tFood = raySphere(ox, oy, oz, dx, dy, dz, food.x, 0.28, food.z, 0.72);
        if (tFood < best) { best = tFood; hit = "food"; }
        if (world.assayBeacon) {
          const tBeacon = raySphere(ox, oy, oz, dx, dy, dz, food.x, 1.7, food.z, 0.4);
          if (tBeacon < best) { best = tBeacon; hit = "food"; }
        }
        const extras = world.landmarks || [];
        for (let li = 0; li < extras.length && li < 12; li++) {
          const Lmk = extras[li];
          if (!Lmk) continue;
          const tL = raySphere(ox, oy, oz, dx, dy, dz, Lmk.x, Lmk.y || 0.35, Lmk.z, Lmk.r || 0.5);
          if (tL < best) {
            best = tL;
            hit = Lmk.kind === "water" ? "water" : Lmk.kind === "bitter" ? "bitter"
              : Lmk.kind === "perch" ? "perch" : Lmk.kind === "flower" ? "flower" : "food";
          }
        }
        const bitter = world.bitter;
        if (bitter && (bitter.x * bitter.x + bitter.z * bitter.z) < 400) {
          const tB = raySphere(ox, oy, oz, dx, dy, dz, bitter.x, 0.22, bitter.z, 0.42);
          if (tB < best) { best = tB; hit = "bitter"; }
        }
        const tWat = raySphere(ox, oy, oz, dx, dy, dz, water.x, 0.22, water.z, 0.42);
        if (tWat < best) { best = tWat; hit = "water"; }
        const bomb = world.bomb;
        if (bomb) {
          const tBomb = raySphere(ox, oy, oz, dx, dy, dz, bomb.x, bomb.y || 0.7, bomb.z, bomb.r || 0.55);
          if (tBomb < best) { best = tBomb; hit = "bomb"; }
        }
        const perch = world.perch;
        if (perch) {
          const tP = rayCylY(ox, oy, oz, dx, dy, dz, perch.x, perch.z, perch.r || 0.2, perch.h || 2.2);
          if (tP < best) { best = tP; hit = "perch"; }
        }
        for (const fb of balls) {
          const t = raySphere(ox, oy, oz, dx, dy, dz, fb.x, fb.y, fb.z, fb.r);
          if (t < best) { best = t; hit = "fly"; hitCol = fb.col || hitCol; }
        }

        const Z = Math.max(0.12, Math.min(40, best));
        const near = Math.max(0.18, Math.min(1, 2.6 / (0.55 + Z)));
        let moss = 0.5, pulse = 1;
        if (hit === "floor") {
          const px = ox + dx * best, pz = oz + dz * best;
          moss = 0.5 + 0.5 * Math.sin(px * 0.65) * Math.cos(pz * 0.5);
        } else if (hit === "bomb") {
          pulse = 0.85 + 0.15 * Math.sin((world.t || 0) * 9.5 + i * 0.07);
        }
        const spec = hitSpectra(hit, day, near, dy, { moss, pulse, col: hitCol });
        const L = r16Catch(spec);
        const uv = r7Catch(spec);
        const r8v = r8Catch(spec);
        // HUD-only object tags — never mixed into T4/T5/HS write-in.
        const sal = (hit === "food" || hit === "bomb") ? 1.1 * near
          : hit === "water" ? 0.7 * near
          : hit === "fly" ? 0.9 * near
          : hit === "flower" ? 0.55 * near
          : hit === "bitter" ? 0.6 * near
          : 0;

        lum[i] = L;
        uvA[i] = uv;
        r8A[i] = r8v;
        depA[i] = Z;
        salArr[i] = sal;
        const dL = L - prev[i];
        const on = dL > 0 ? dL : 0;
        const off = dL < 0 ? -dL : 0;
        onArr[i] = on;
        offArr[i] = off;
        sumL += L;
        sumUV += uv;
        sumR8 += r8v;
        sumOn += on;
        sumOff += off;
        sumSal += sal;
        sumNear += near;

        const sec = Math.max(0, Math.min(3, (om.az / FOV + 1) * 2 | 0));
        secL[sec] += L;
        secUV[sec] += uv;
        secR8[sec] += r8v;
        secN[sec]++;
        if (hit === "food" || hit === "bomb") { secFood[sec] += sal; sumFood += sal; }
        else if (hit === "flower") { secFood[sec] += sal * 0.45; sumFood += sal * 0.45; }
        else if (hit === "water") { secWater[sec] += sal; sumWater += sal; }
        else if (hit === "fly") { secFly[sec] += sal; sumFly += sal; }
        else if (hit === "bitter") { secBitter[sec] += sal; sumBitter += sal; }

        // Geometric optic flow: ego-velocity × 1/depth (motion parallax) + yaw.
        const vwx = -evx - yawRate * dz * Z;
        const vwy = -evy;
        const vwz = -evz + yawRate * dx * Z;
        const vlx = vwx * ex.x + vwy * ex.y + vwz * ex.z;
        const vly = vwx * ey.x + vwy * ey.y + vwz * ey.z;
        const vlz = vwx * ez.x + vwy * ez.y + vwz * ez.z;
        const u = om.lx / Math.max(0.22, om.lz);
        const v = om.ly / Math.max(0.22, om.lz);
        const uDot = (vlx - u * vlz) / Z;
        const vDot = (vly - v * vlz) / Z;
        sumFlowH += uDot;
        sumFlowV += vDot;
        geoA += Math.max(0, uDot);
        geoB += Math.max(0, -uDot);
        geoC += Math.max(0, vDot);
        geoD += Math.max(0, -vDot);
        // Looming: approach along the ray (v_rel · d < 0) and shrinking depth.
        const vAlong = vwx * dx + vwy * dy + vwz * dz;
        let loom = Math.max(0, -vAlong / Z);
        if (prevZ[i] < 50 && Z < 50) {
          const dZ = prevZ[i] - Z;
          if (dZ > 0) loom += (dZ / Z) * 6.5;
        }
        const front = om.lz > 0.28 ? 1.25 : 0.45;
        sumLoom += loom * front;
      }

      // Lamina-like center–surround on R1–R6 (edge contrast, not object ID).
      for (let i = 0; i < N; i++) {
        const om = OMM[i];
        let surr = 0, nS = 0;
        for (const nb of [om.azP, om.azM, om.elP, om.elM]) {
          if (nb == null) continue;
          surr += lum[nb];
          nS++;
        }
        if (!nS) continue;
        const c = lum[i] - surr / nS;
        const boosted = Math.max(0, lum[i] + c * 0.55);
        lum[i] = boosted;
        const dEdge = boosted - prev[i];
        if (dEdge > 0) onArr[i] = Math.max(onArr[i], dEdge);
        else if (dEdge < 0) offArr[i] = Math.max(offArr[i], -dEdge);
      }
      sumL = 0; sumOn = 0; sumOff = 0;
      for (let i = 0; i < N; i++) {
        sumL += lum[i];
        sumOn += onArr[i];
        sumOff += offArr[i];
      }
      for (let s = 0; s < 4; s++) { secL[s] = 0; secN[s] = 0; }
      for (let i = 0; i < N; i++) {
        const om = OMM[i];
        const sec = Math.max(0, Math.min(3, (om.az / FOV + 1) * 2 | 0));
        secL[sec] += lum[i];
        secN[sec]++;
      }

      // Hassenstein–Reichardt correlators on ON (T4) / OFF (T5) — texture motion.
      for (let i = 0; i < N; i++) {
        const om = OMM[i];
        const on = onArr[i], off = offArr[i];
        const pOn = prevOn[i];
        if (om.azP != null) {
          t4a += pOn * onArr[om.azP];
          t5a += off * (offArr[om.azP] || 0);
        }
        if (om.azM != null) {
          t4b += pOn * onArr[om.azM];
          t5b += off * (offArr[om.azM] || 0);
        }
        if (om.elP != null) {
          t4c += pOn * onArr[om.elP];
          t5c += off * (offArr[om.elP] || 0);
        }
        if (om.elM != null) {
          t4d += pOn * onArr[om.elM];
          t5d += off * (offArr[om.elM] || 0);
        }
      }

      this.prevL[sideName].set(lum);
      this.prevOn[sideName].set(onArr);
      this.prevDepth[sideName].set(depA);
      const inv = 1 / N;
      const mot = 1 / Math.max(1, N * 0.024);
      const geoScale = 0.14;
      const sectors = secL.map((v, i) => (secN[i] ? v / secN[i] : 0));
      const sectorsUV = secUV.map((v, i) => (secN[i] ? v / secN[i] : 0));
      const sectorsR8 = secR8.map((v, i) => (secN[i] ? v / secN[i] : 0));
      const t4A = t4a * mot + geoA * inv * geoScale;
      const t4B = t4b * mot + geoB * inv * geoScale;
      const t4C = t4c * mot + geoC * inv * geoScale;
      const t4D = t4d * mot + geoD * inv * geoScale;
      const t5A = t5a * mot + geoA * inv * geoScale * 0.7;
      const t5B = t5b * mot + geoB * inv * geoScale * 0.7;
      const t5C = t5c * mot + geoC * inv * geoScale * 0.7;
      const t5D = t5d * mot + geoD * inv * geoScale * 0.7;
      const loom = sumLoom * inv;
      // Expansion after opponency so loom raises both T4a and T4b (not a yaw cheat).
      const exp = loom * 0.55;
      const t4Ao = Math.max(0, t4A - 0.55 * t4B) + exp;
      const t4Bo = Math.max(0, t4B - 0.55 * t4A) + exp;
      const t4Co = Math.max(0, t4C - 0.55 * t4D) + exp * 0.7;
      const t4Do = Math.max(0, t4D - 0.55 * t4C) + exp * 0.7;
      const t5Ao = Math.max(0, t5A - 0.55 * t5B) + exp * 0.5;
      const t5Bo = Math.max(0, t5B - 0.55 * t5A) + exp * 0.5;
      const t5Co = Math.max(0, t5C - 0.55 * t5D) + exp * 0.35;
      const t5Do = Math.max(0, t5D - 0.55 * t5C) + exp * 0.35;
      out[sideName] = {
        lum: sumL * inv,
        uv: sumUV * inv,
        r8: sumR8 * inv,
        on: sumOn * inv,
        off: sumOff * inv,
        r16: sumL * inv,
        r7: sumUV * inv,
        t4a: t4Ao,
        t4b: t4Bo,
        t4c: t4Co,
        t4d: t4Do,
        t5a: t5Ao,
        t5b: t5Bo,
        t5c: t5Co,
        t5d: t5Do,
        hs: (t4A - t4B) + 0.65 * (t5A - t5B),
        vs: (t4C - t4D) + 0.65 * (t5C - t5D),
        loom,
        flowH: sumFlowH * inv,
        flowV: sumFlowV * inv,
        depth: (() => {
          let s = 0;
          for (let i = 0; i < N; i++) s += depA[i];
          return s * inv;
        })(),
        // HUD / portable diagnostics — not written into motion pools.
        sal: sumSal * inv,
        salFood: sumFood * inv,
        salWater: sumWater * inv,
        salFly: sumFly * inv,
        salBitter: sumBitter * inv,
        sectors,
        sectorsUV,
        sectorsR8,
        sectorsFood: secFood.map((v, i) => (secN[i] ? v / secN[i] : 0)),
        sectorsWater: secWater.map((v, i) => (secN[i] ? v / secN[i] : 0)),
        sectorsFly: secFly.map((v, i) => (secN[i] ? v / secN[i] : 0)),
        map: lum,
        mapUV: uvA,
        mapR8: r8A,
        mapDepth: depA,
      };
    }
    this.last = out;
    this.lastSummary = {
      salL: out.L?.sal || 0,
      salR: out.R?.sal || 0,
      salFoodL: out.L?.salFood || 0,
      salFoodR: out.R?.salFood || 0,
      salTarget: 0.5 * ((out.L?.salFood || 0) + (out.R?.salFood || 0)),
      asymFood: (out.R?.salFood || 0) - (out.L?.salFood || 0),
      lumL: out.L?.lum || 0,
      lumR: out.R?.lum || 0,
      r16L: out.L?.r16 || 0,
      r16R: out.R?.r16 || 0,
      r7L: out.L?.r7 || 0,
      r7R: out.R?.r7 || 0,
      r8L: out.L?.r8 || 0,
      r8R: out.R?.r8 || 0,
      loomL: out.L?.loom || 0,
      loomR: out.R?.loom || 0,
      hsL: out.L?.hs || 0,
      hsR: out.R?.hs || 0,
      vsL: out.L?.vs || 0,
      vsR: out.R?.vs || 0,
    };
    return out;
  }
}

/**
 * Map one compound-eye sample onto annotated Male CNS optic pool Hz.
 * L1/L2 = ON/OFF contrast; T4/T5 = HR + geometric flow; HS/VS = wide-field.
 * Does not dump object salience into motion cells.
 */
export function encodeOpticRates(eye, extraV = 0) {
  const r = {};
  for (const side of ["L", "R"]) {
    const e = eye[side] || {};
    const meanL = e.r16 || e.lum || 0.001;
    const meanU = e.r7 || e.uv || 0.001;
    const mean8 = e.r8 || 0.001;
    const secR8 = e.sectorsR8 || e.sectors || [0, 0, 0, 0];
    for (let s = 0; s < 4; s++) {
      const cL = ((e.sectors?.[s] || 0) - meanL) / (meanL + 0.06);
      const cU = ((e.sectorsUV?.[s] || 0) - meanU) / (meanU + 0.06);
      const c8 = ((secR8[s] || 0) - mean8) / (mean8 + 0.06);
      const contrast = Math.max(0, Math.abs(cL));
      const uvContrast = Math.max(0, Math.abs(cU));
      const r8Contrast = Math.max(0, Math.abs(c8));
      r["R16" + side + s] = hzVis((e.sectors?.[s] || 0) + contrast * 0.45, 115, 4) + extraV * 0.45;
      r["R7" + side + s] = hzVis((e.sectorsUV?.[s] || 0) + uvContrast * 0.4, 110, 3) + extraV * 0.25;
      r["R8" + side + s] = hzVis((secR8[s] || 0) + r8Contrast * 0.35, 105, 3) + extraV * 0.2;
    }
    r["L1" + side] = hzVis((e.on || 0) * 2.8, 120, 3);
    r["L2" + side] = hzVis((e.off || 0) * 2.8, 120, 3);
    r["L3" + side] = hzVis((e.r7 || 0) * 0.95 + (e.r8 || 0) * 0.7 + (e.r16 || 0) * 0.30, 100, 3);
    r["T4a" + side] = hzVis(e.t4a || 0, 125, 2);
    r["T4b" + side] = hzVis(e.t4b || 0, 125, 2);
    r["T4c" + side] = hzVis(e.t4c || 0, 125, 2);
    r["T4d" + side] = hzVis(e.t4d || 0, 125, 2);
    r["T5a" + side] = hzVis(e.t5a || 0, 125, 2);
    r["T5b" + side] = hzVis(e.t5b || 0, 125, 2);
    r["T5c" + side] = hzVis(e.t5c || 0, 125, 2);
    r["T5d" + side] = hzVis(e.t5d || 0, 125, 2);
    r["HS" + side] = hzVis(
      Math.abs(e.hs || 0) * 1.55 + ((e.t4a || 0) + (e.t4b || 0)) * 0.22,
      120, 4
    );
    r["VS" + side] = hzVis(
      Math.abs(e.vs || 0) * 1.45 + ((e.t4c || 0) + (e.t4d || 0)) * 0.22 + (e.loom || 0) * 0.28,
      115, 4
    );
  }
  // Mild L/R from the two eyes themselves — not food-blob klinotaxis.
  for (const base of ["L1", "L2", "L3"]) {
    const pair = lrMild(r[base + "L"] || 0, r[base + "R"] || 0, 0.18);
    r[base + "L"] = pair.L;
    r[base + "R"] = pair.R;
  }
  return r;
}

export function drawOmmatidia(canvas, eye, side) {
  if (!canvas || !eye) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = "#07090e";
  ctx.fillRect(0, 0, w, h);
  const lum = eye.lum[side];
  const uv = eye.uv[side];
  const r8m = eye.r8 && eye.r8[side];
  if (!lum) return;
  const cx = w * 0.5, cy = h * 0.52;
  const sc = Math.min(w, h) * 0.46;
  const rHex = Math.max(1.35, Math.min(w, h) * 0.0078);
  for (let i = 0; i < N; i++) {
    const om = OMM[i];
    // R1–R6 luminance (green-cyan) + R7 UV (magenta) + R8 blue–green.
    const v = Math.min(1, lum[i] * 3.2);
    const u = uv ? Math.min(1, uv[i] * 2.6) : 0;
    const b8 = r8m ? Math.min(1, r8m[i] * 2.4) : 0;
    const r = Math.min(255, (v * 140 + u * 200) | 0);
    const g = Math.min(255, (v * 230 + u * 40 + b8 * 90) | 0);
    const b = Math.min(255, (40 + v * 120 + u * 200 + b8 * 180) | 0);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    const x = cx + om.az / FOV * sc * (side === "L" ? -1 : 1);
    const y = cy - om.el / FOV * sc;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 3) * k + Math.PI / 6;
      const px = x + Math.cos(a) * rHex;
      const py = y + Math.sin(a) * rHex;
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
}

export const OMMATIDIA = OMM;
export const OMMATIDIA_N = N;
