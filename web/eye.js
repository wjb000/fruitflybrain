/**
 * Drosophila compound eye: hexagonal ommatidia, R1–R6 luminance, R7 UV,
 * L1 ON / L2 OFF, T4/T5 Hassenstein–Reichardt motion (A/B/C/D).
 *
 * Each ommatidium is a Gaussian-acceptance ray into the real dish
 * (sky, checker floor, food, water, the other fly, arena wall).
 */

const DA = 3.8 * Math.PI / 180;
const FOV = 1.42;
const RINGS = 19;
const ARENA_R = 17.4;
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

export class CompoundEye {
  constructor() {
    this.cells = OMM;
    this.n = N;
    this.prevL = { L: new Float32Array(N), R: new Float32Array(N) };
    this.prevOn = { L: new Float32Array(N), R: new Float32Array(N) };
    this.lum = { L: new Float32Array(N), R: new Float32Array(N) };
    this.uv = { L: new Float32Array(N), R: new Float32Array(N) };
    this.last = null;
  }

  sample(world) {
    const day = world.day != null ? world.day : 0.7;
    const origin = world.origin;
    const heading = world.heading;
    const food = world.food;
    const water = world.water;
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
      const prev = this.prevL[sideName];
      const prevOn = this.prevOn[sideName];
      let sumL = 0, sumUV = 0, sumOn = 0, sumOff = 0;
      let sumSal = 0, sumFood = 0, sumWater = 0, sumFly = 0, sumBitter = 0;
      let t4a = 0, t4b = 0, t4c = 0, t4d = 0;
      let t5a = 0, t5b = 0, t5c = 0, t5d = 0;
      const secL = [0, 0, 0, 0], secN = [0, 0, 0, 0];
      const secUV = [0, 0, 0, 0];
      const secFood = [0, 0, 0, 0], secWater = [0, 0, 0, 0];
      const secFly = [0, 0, 0, 0], secBitter = [0, 0, 0, 0];
      const onArr = new Float32Array(N);
      const offArr = new Float32Array(N);
      const salArr = new Float32Array(N);
      const hitKind = new Uint8Array(N);

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
          if (wy > 0 && wy < 2.4) { best = tw; hit = "wall"; }
        }
        const tFood = raySphere(ox, oy, oz, dx, dy, dz, food.x, 0.22, food.z, 0.42);
        if (tFood < best) { best = tFood; hit = "food"; }
        const bitter = world.bitter;
        if (bitter) {
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

        // Distance falloff keeps near objects punchier than far arena clutter.
        const near = Math.max(0.12, Math.min(1, 2.8 / (0.55 + best)));
        let r, g, b, uv, sal = 0;
        if (hit === "sky") {
          const el = Math.max(0, dy);
          const sky = (0.22 + 0.78 * day) * (0.35 + 0.65 * el);
          r = sky * 0.40; g = sky * 0.52; b = sky * 0.95;
          uv = sky * (0.55 + 0.7 * el);
        } else if (hit === "floor") {
          const px = ox + dx * best, pz = oz + dz * best;
          const chk = ((Math.floor(px * 0.55) + Math.floor(pz * 0.55)) & 1);
          const fl = (chk ? 0.18 : 0.06) * (0.35 + 0.65 * day);
          // Checker contrast → stronger spatial structure for R1–R6.
          r = fl; g = fl * 0.95; b = fl * 0.85;
          uv = fl * 0.15;
        } else if (hit === "wall") {
          const w = 0.20 * day;
          r = w * 0.9; g = w; b = w * 1.1;
          uv = w * 0.2;
          sal = 0.08 * near;
        } else if (hit === "food") {
          // Warm sugar drop — high luminance + chromatic pop.
          r = 1.15 * day * near; g = 0.78 * day * near; b = 0.10 * day * near;
          uv = 0.06 * day;
          sal = 1.15 * near;
        } else if (hit === "bitter") {
          r = 0.18 * day * near; g = 0.48 * day * near; b = 0.10 * day * near;
          uv = 0.22 * day * near;
          sal = 0.85 * near;
        } else if (hit === "perch") {
          r = 0.48 * day * near; g = 0.30 * day * near; b = 0.12 * day * near;
          uv = 0.05 * day;
          sal = 0.35 * near;
        } else if (hit === "water") {
          // Blue-UV bright water for R7 / hygrosensory visual cue.
          r = 0.14 * day * near; g = 0.58 * day * near; b = 1.15 * day * near;
          uv = 0.55 * day * near;
          sal = 1.05 * near;
        } else if (hit === "bomb") {
          // Scent orb: intense warm flicker target (visual only — odor is plume).
          const pulse = 0.85 + 0.15 * Math.sin((world.t || 0) * 9.5 + i * 0.07);
          r = 1.25 * day * near * pulse; g = 0.85 * day * near * pulse; b = 0.18 * day * near;
          uv = 0.12 * day * near;
          sal = 1.35 * near * pulse;
        } else {
          // Other fly — saturated body color + slight UV so motion pops.
          r = hitCol[0] * 1.25 * day * near;
          g = hitCol[1] * 1.15 * day * near;
          b = hitCol[2] * 1.2 * day * near;
          uv = 0.22 * day * near;
          sal = 1.25 * near;
        }

        let L = 0.30 * r + 0.59 * g + 0.11 * b;
        // Local acceptance blur: mix a touch of neighbor luminance after pass
        // (filled below). Store raw first.
        lum[i] = L;
        uvA[i] = uv;
        salArr[i] = sal;
        hitKind[i] = hit === "food" ? 1 : hit === "water" ? 2 : hit === "fly" ? 3
          : hit === "bitter" ? 4 : hit === "bomb" ? 5 : 0;
        const dL = L - prev[i];
        // Salient objects get motion gain so loom / walk-by drives T4/T5 hard.
        const salGain = 1 + sal * 1.8;
        const on = dL > 0 ? dL * salGain : 0;
        const off = dL < 0 ? -dL * salGain : 0;
        onArr[i] = on;
        offArr[i] = off;
        sumL += L;
        sumUV += uv;
        sumOn += on;
        sumOff += off;
        sumSal += sal;

        const sec = Math.max(0, Math.min(3, (om.az / FOV + 1) * 2 | 0));
        secL[sec] += L;
        secUV[sec] += uv;
        secN[sec]++;
        if (hit === "food" || hit === "bomb") { secFood[sec] += sal; sumFood += sal; }
        else if (hit === "water") { secWater[sec] += sal; sumWater += sal; }
        else if (hit === "fly") { secFly[sec] += sal; sumFly += sal; }
        else if (hit === "bitter") { secBitter[sec] += sal; sumBitter += sal; }
      }

      // Lateral contrast: boost ommatidia that differ from their hex neighbors.
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
        // Edge contrast also feeds ON/OFF if it sharpened this frame.
        const dEdge = boosted - prev[i];
        if (dEdge > 0) onArr[i] = Math.max(onArr[i], dEdge * (1 + salArr[i]));
        else if (dEdge < 0) offArr[i] = Math.max(offArr[i], -dEdge * (1 + salArr[i]));
      }
      // Recompute means after contrast pass.
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
      const inv = 1 / N;
      // Stronger Hassenstein–Reichardt gain so sparse motion still drives T4/T5 hard.
      const mot = 1 / Math.max(1, N * 0.024);
      const sectors = secL.map((v, i) => (secN[i] ? v / secN[i] : 0));
      const sectorsUV = secUV.map((v, i) => (secN[i] ? v / secN[i] : 0));
      // Opponency: preferred minus null direction (not just raw correlator sums).
      const t4A = t4a * mot, t4B = t4b * mot, t4C = t4c * mot, t4D = t4d * mot;
      const t5A = t5a * mot, t5B = t5b * mot, t5C = t5c * mot, t5D = t5d * mot;
      const invN = 1 / Math.max(1, N);
      out[sideName] = {
        lum: sumL * inv,
        uv: sumUV * inv,
        on: sumOn * inv,
        off: sumOff * inv,
        // R1–R6 luminance contrast vs R7 UV kept as separate maps for HUD / binding.
        r16: sumL * inv,
        r7: sumUV * inv,
        t4a: Math.max(0, t4A - 0.55 * t4B),
        t4b: Math.max(0, t4B - 0.55 * t4A),
        t4c: Math.max(0, t4C - 0.55 * t4D),
        t4d: Math.max(0, t4D - 0.55 * t4C),
        t5a: Math.max(0, t5A - 0.55 * t5B),
        t5b: Math.max(0, t5B - 0.55 * t5A),
        t5c: Math.max(0, t5C - 0.55 * t5D),
        t5d: Math.max(0, t5D - 0.55 * t5C),
        hs: (t4A - t4B) + 0.65 * (t5A - t5B),
        vs: (t4C - t4D) + 0.65 * (t5C - t5D),
        // World-object salience (mean over ommatidia) for stronger channel drive.
        sal: sumSal * invN,
        salFood: sumFood * invN,
        salWater: sumWater * invN,
        salFly: sumFly * invN,
        salBitter: sumBitter * invN,
        sectors,
        sectorsUV,
        sectorsFood: secFood.map((v, i) => (secN[i] ? v / secN[i] : 0)),
        sectorsWater: secWater.map((v, i) => (secN[i] ? v / secN[i] : 0)),
        sectorsFly: secFly.map((v, i) => (secN[i] ? v / secN[i] : 0)),
        map: lum,
        mapUV: uvA,
      };
    }
    this.last = out;
    return out;
  }
}

export function drawOmmatidia(canvas, eye, side) {
  if (!canvas || !eye) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = "#07090e";
  ctx.fillRect(0, 0, w, h);
  const lum = eye.lum[side];
  const uv = eye.uv[side];
  if (!lum) return;
  const cx = w * 0.5, cy = h * 0.52;
  const sc = Math.min(w, h) * 0.46;
  const rHex = Math.max(1.35, Math.min(w, h) * 0.0078);
  for (let i = 0; i < N; i++) {
    const om = OMM[i];
    // R1–R6 luminance (green-cyan) + R7 UV (magenta bloom) for richer HUD.
    const v = Math.min(1, lum[i] * 3.2);
    const u = uv ? Math.min(1, uv[i] * 2.6) : 0;
    const r = Math.min(255, (v * 140 + u * 200) | 0);
    const g = Math.min(255, (v * 230 + u * 40) | 0);
    const b = Math.min(255, (40 + v * 160 + u * 220) | 0);
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
