/**
 * Drosophila compound eye: hexagonal ommatidia, R1–R6 luminance, R7 UV,
 * L1 ON / L2 OFF, T4/T5 Hassenstein–Reichardt motion (A/B/C/D).
 *
 * Each ommatidium is a Gaussian-acceptance ray into the real dish
 * (sky, checker floor, food, water, the other fly, arena wall).
 */

const DA = 4.6 * Math.PI / 180;
const FOV = 1.35;
const RINGS = 16;
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
      let t4a = 0, t4b = 0, t4c = 0, t4d = 0;
      let t5a = 0, t5b = 0, t5c = 0, t5d = 0;
      const secL = [0, 0, 0, 0], secN = [0, 0, 0, 0];
      const secUV = [0, 0, 0, 0];
      const onArr = new Float32Array(N);
      const offArr = new Float32Array(N);

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
        const perch = world.perch;
        if (perch) {
          const tP = rayCylY(ox, oy, oz, dx, dy, dz, perch.x, perch.z, perch.r || 0.2, perch.h || 2.2);
          if (tP < best) { best = tP; hit = "perch"; }
        }
        for (const fb of balls) {
          const t = raySphere(ox, oy, oz, dx, dy, dz, fb.x, fb.y, fb.z, fb.r);
          if (t < best) { best = t; hit = "fly"; hitCol = fb.col || hitCol; }
        }

        let r, g, b, uv;
        if (hit === "sky") {
          const el = Math.max(0, dy);
          const sky = (0.22 + 0.78 * day) * (0.35 + 0.65 * el);
          r = sky * 0.40; g = sky * 0.52; b = sky * 0.95;
          uv = sky * (0.55 + 0.7 * el);
        } else if (hit === "floor") {
          const px = ox + dx * best, pz = oz + dz * best;
          const chk = ((Math.floor(px * 0.55) + Math.floor(pz * 0.55)) & 1);
          const fl = (chk ? 0.16 : 0.07) * (0.35 + 0.65 * day);
          r = fl; g = fl * 0.95; b = fl * 0.85;
          uv = fl * 0.15;
        } else if (hit === "wall") {
          const w = 0.18 * day;
          r = w * 0.9; g = w; b = w * 1.1;
          uv = w * 0.2;
        } else if (hit === "food") {
          r = 0.95 * day; g = 0.72 * day; b = 0.16 * day;
          uv = 0.08 * day;
        } else if (hit === "bitter") {
          r = 0.22 * day; g = 0.42 * day; b = 0.12 * day;
          uv = 0.18 * day;
        } else if (hit === "perch") {
          r = 0.42 * day; g = 0.28 * day; b = 0.12 * day;
          uv = 0.06 * day;
        } else if (hit === "water") {
          r = 0.18 * day; g = 0.52 * day; b = 0.95 * day;
          uv = 0.35 * day;
        } else {
          r = hitCol[0] * day; g = hitCol[1] * day; b = hitCol[2] * day;
          uv = 0.12 * day;
        }

        const L = 0.30 * r + 0.59 * g + 0.11 * b;
        lum[i] = L;
        uvA[i] = uv;
        const dL = L - prev[i];
        const on = dL > 0 ? dL : 0;
        const off = dL < 0 ? -dL : 0;
        onArr[i] = on;
        offArr[i] = off;
        sumL += L;
        sumUV += uv;
        sumOn += on;
        sumOff += off;

        const sec = Math.max(0, Math.min(3, (om.az / FOV + 1) * 2 | 0));
        secL[sec] += L;
        secUV[sec] += uv;
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
      const mot = 1 / Math.max(1, N * 0.08);
      const sectors = secL.map((v, i) => (secN[i] ? v / secN[i] : 0));
      const sectorsUV = secUV.map((v, i) => (secN[i] ? v / secN[i] : 0));
      out[sideName] = {
        lum: sumL * inv,
        uv: sumUV * inv,
        on: sumOn * inv,
        off: sumOff * inv,
        t4a: t4a * mot,
        t4b: t4b * mot,
        t4c: t4c * mot,
        t4d: t4d * mot,
        t5a: t5a * mot,
        t5b: t5b * mot,
        t5c: t5c * mot,
        t5d: t5d * mot,
        hs: (t4a - t4b) * mot,
        vs: (t4c - t4d) * mot,
        sectors,
        sectorsUV,
        map: lum,
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
  ctx.fillStyle = "#0b0d12";
  ctx.fillRect(0, 0, w, h);
  const lum = eye.lum[side];
  if (!lum) return;
  const cx = w * 0.5, cy = h * 0.52;
  const sc = Math.min(w, h) * 0.42;
  for (let i = 0; i < N; i++) {
    const om = OMM[i];
    const v = Math.min(1, lum[i] * 2.8);
    const g = (v * 220) | 0;
    const b = (40 + v * 180) | 0;
    ctx.fillStyle = `rgb(${(g * 0.7) | 0},${g},${b})`;
    const x = cx + om.az / FOV * sc * (side === "L" ? -1 : 1);
    const y = cy - om.el / FOV * sc;
    ctx.beginPath();
    ctx.arc(x, y, 1.85, 0, Math.PI * 2);
    ctx.fill();
  }
}

export const OMMATIDIA = OMM;
