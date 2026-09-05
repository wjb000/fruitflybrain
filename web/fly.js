import * as THREE from "three";

const LEG_NAMES = ["L1", "R1", "L2", "R2", "L3", "R3"];
const MUSCLE_SPAN = {
  "coxa-pitch": ["coxaProm", "coxaRem", 0.55],
  "coxa-yaw": ["coxaAdd", "coxaRem", 0.40],
  "coxa-roll": ["coxaRotA", "coxaRotP", 0.40],
  "trochanterfemur-pitch": ["trExt", "trFlex", 0.70],
  "trochanterfemur-roll": ["feRed", null, 0.25],
  "tibia-pitch": ["tiExt", "tiFlex", 0.55],
  "tarsus1-pitch": ["taLev", "taDep", 0.35],
};
const GROUND_Y = 0.05;
const MUSCLE_TAU = 0.05;
const _foot = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _flapQ = new THREE.Quaternion();

let nmf = null;
let nmfGeos = [];

function rgbToInt(c) {
  return ((c[0] * 255) << 16) | ((c[1] * 255) << 8) | (c[2] * 255);
}

function tintRgb(c, female) {
  if (!female) return c;
  return [
    c[0] * 0.42 + 1.0 * 0.58,
    c[1] * 0.42 + 0.43 * 0.58,
    c[2] * 0.42 + 0.71 * 0.58,
  ];
}

function parseNmfBin(buf) {
  const magic = String.fromCharCode(...new Uint8Array(buf, 0, 4));
  if (magic !== "NMF1") throw new Error("bad nmf.bin magic " + magic);
  const view = new DataView(buf);
  const n = view.getUint32(4, true);
  let off = 8;
  const geos = [];
  for (let i = 0; i < n; i++) {
    const nv = view.getUint32(off, true); off += 4;
    const nt = view.getUint32(off, true); off += 4;
    const pos = new Float32Array(buf, off, nv * 3); off += nv * 12;
    const idx = new Uint32Array(buf, off, nt * 3); off += nt * 12;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos.slice(), 3));
    geo.setIndex(new THREE.BufferAttribute(idx.slice(), 1));
    geo.computeVertexNormals();
    geos.push(geo);
  }
  return geos;
}

export async function loadNmf() {
  if (nmf) return nmf;
  const [json, buf] = await Promise.all([
    fetch("data/nmf.json").then((r) => {
      if (!r.ok) throw new Error("nmf.json " + r.status);
      return r.json();
    }),
    fetch("data/nmf.bin").then((r) => {
      if (!r.ok) throw new Error("nmf.bin " + r.status);
      return r.arrayBuffer();
    }),
  ]);
  nmf = json;
  nmfGeos = parseNmfBin(buf);
  return nmf;
}

function makeMaterials(female) {
  const mats = {};
  const specs = (nmf && nmf.materials) || {};
  for (const [name, spec] of Object.entries(specs)) {
    const keep = name === "eye" || name === "wing";
    const col = keep ? spec.color : tintRgb(spec.color, female);
    const opacity = spec.opacity ?? 1;
    mats[name] = new THREE.MeshPhysicalMaterial({
      color: rgbToInt(col),
      roughness: spec.roughness ?? 0.55,
      metalness: name === "eye" ? 0.12 : 0.06,
      transparent: opacity < 0.99,
      opacity,
      side: name === "wing" ? THREE.DoubleSide : THREE.FrontSide,
      depthWrite: opacity > 0.8,
      emissive: name === "eye" ? 0xff5a38 : 0x000000,
      emissiveIntensity: name === "eye" ? 0.12 : 0,
    });
  }
  if (!mats.headthorax) {
    mats.headthorax = new THREE.MeshPhysicalMaterial({
      color: female ? 0xff6eb4 : 0x96632e,
      roughness: 0.55,
    });
  }
  return mats;
}

function setQuatWxyz(obj, wxyz) {
  obj.quaternion.set(wxyz[1], wxyz[2], wxyz[3], wxyz[0]);
}

function setHinge(h, angle) {
  _axis.copy(h.userData.axis);
  h.setRotationFromAxisAngle(_axis, angle);
  h.userData.angle = angle;
}

function applyRest(node, seg) {
  node.position.fromArray(seg.restPos || [0, 0, 0]);
  setQuatWxyz(node, seg.restQuat || [1, 0, 0, 0]);
  node.userData.restQuat = node.quaternion.clone();
}

function buildFly({ female = false } = {}) {
  if (!nmf) throw new Error("loadNmf() first");
  const fly = new THREE.Group();
  const visual = new THREE.Group();
  fly.add(visual);

  const mats = makeMaterials(female);
  const nodes = {};

  for (const seg of nmf.segments) {
    const body = new THREE.Group();
    body.name = seg.name;
    const mesh = new THREE.Mesh(nmfGeos[seg.mesh], mats[seg.material] || mats.headthorax);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = seg.name;
    body.add(mesh);
    applyRest(body, seg);
    visual.add(body);
    nodes[seg.name] = { body, seg, mesh };
  }

  const legs = [];
  const codes = nmf.legs || { L1: "lf", R1: "rf", L2: "lm", R2: "rm", L3: "lh", R3: "rh" };
  for (const name of LEG_NAMES) {
    const code = codes[name];
    const tarsus = nodes[`${code}_tarsus5`]?.body;
    const tip = new THREE.Object3D();
    if (tarsus) tarsus.add(tip);
    legs.push({
      name,
      side: name.startsWith("L") ? -1 : 1,
      code,
      tarsusTip: tip,
      hinges: {},
      angles: {},
      foot: { x: 0, y: 0, z: 0, stance: true, vx: 0, vy: 0, vz: 0 },
    });
  }

  const antennae = [];
  for (const side of ["l", "r"]) {
    const ant = nodes[`${side}_pedicel`]?.body;
    const tipHost = nodes[`${side}_arista`]?.body || ant;
    if (ant) {
      const tip = new THREE.Object3D();
      if (tipHost) tipHost.add(tip);
      ant.userData.tip = tip;
      antennae.push(ant);
    }
  }

  const eyes = [nodes.l_eye?.mesh, nodes.r_eye?.mesh].filter(Boolean);
  const wings = [nodes.l_wing?.body, nodes.r_wing?.body].filter(Boolean);

  fly.userData = {
    female,
    body: visual,
    head: nodes.c_head?.body,
    thorax: nodes.c_thorax?.body,
    abdomen: nodes.c_abdomen12?.body,
    wings,
    legs,
    eyes,
    antennae,
    proboscis: nodes.c_rostrum?.body,
    haustellum: nodes.c_haustellum?.body,
    gait: 0,
    hinges: {},
    nodes,
    standZ: nmf.standZ || 1.3,
  };
  return fly;
}

export function createMaleFly() { return buildFly({ female: false }); }
export function createFemaleFly() { return buildFly({ female: true }); }

function antagonist(pos, neg) {
  const p = pos || 0, n = neg || 0;
  const mag = p + n;
  if (mag < 0.005) return 0;
  return (p - n) / (mag + 0.08);
}

function follow(cur, target, dt) {
  const a = 1 - Math.exp(-dt / MUSCLE_TAU);
  return cur + (target - cur) * a;
}

function poseLegFromMuscle(leg, muscle, dt) {
  const m = muscle || {};
  for (const [key, spec] of Object.entries(MUSCLE_SPAN)) {
    const h = leg.hinges[key];
    if (!h) continue;
    let pos = m[spec[0]] || 0;
    const neg = spec[1] ? (m[spec[1]] || 0) : 0;
    if (key === "trochanterfemur-pitch") pos = pos + 0.6 * (m.feRed || 0);
    const tgt = h.userData.rest + spec[2] * antagonist(pos, neg);
    const cur = h.userData.angle ?? h.userData.rest;
    setHinge(h, follow(cur, tgt, dt));
  }
}

/**
 * Pose the NeuroMechFly skeleton from connectome motor neurons.
 * cmd: {walk, turn, fly, feed, court, groom, escape, rest, head, abdomen, muscle}
 */
export function stepLife(fly, dt, t, cmd) {
  const d = fly.userData;
  const flyA = cmd.fly || 0;
  const feed = cmd.feed || 0;
  d.gait = 0;
  fly.updateMatrixWorld(true);
  for (const leg of d.legs) {
    if (leg.tarsusTip) leg.tarsusTip.getWorldPosition(_foot);
    leg.foot.x = _foot.x;
    leg.foot.y = _foot.y;
    leg.foot.z = _foot.z;
    leg.foot.stance = flyA < 0.28 && _foot.y < GROUND_Y + 0.18;
    leg.foot.vx = 0; leg.foot.vy = 0; leg.foot.vz = 0;
  }
  d.slip = { x: 0, z: 0, n: 0, yawL: 0, yawR: 0 };
  poseSoftParts(d, t, cmd, flyA, feed);
}

function poseSoftParts(d, t, cmd, flyA, feed) {
  const flapHz = 8 + flyA * 150;
  const flap = Math.sin(t * flapHz) * (0.04 + flyA * 0.85);
  for (let i = 0; i < d.wings.length; i++) {
    const w = d.wings[i];
    const rest = w.userData.restQuat;
    if (!rest) continue;
    const s = i === 0 ? -1 : 1;
    _flapQ.setFromAxisAngle(_axis.set(1, 0, 0), flap * (0.3 + flyA * 0.5));
    w.quaternion.copy(rest).multiply(_flapQ);
    w.rotateZ(s * (0.04 + flyA * 0.18));
  }
  if (d.abdomen) {
    const rest = d.abdomen.userData.restQuat;
    if (rest) {
      _flapQ.setFromAxisAngle(_axis.set(1, 0, 0), -0.06 + (cmd.abdomen || 0) * 0.35);
      d.abdomen.quaternion.copy(rest).multiply(_flapQ);
    }
  }
  if (d.head) {
    const rest = d.head.userData.restQuat;
    if (rest) {
      d.head.quaternion.copy(rest);
      d.head.rotateY(THREE.MathUtils.clamp(cmd.head || 0, -0.5, 0.5));
      d.head.rotateX(feed * 0.45 - flyA * 0.25);
    }
  }
  if (d.proboscis) {
    const pe = 1 + feed * 0.55;
    d.proboscis.scale.set(1, pe, 1);
    d.proboscis.rotation.x = feed * 0.4;
  }
  const glow = 0.08 + flyA * 0.5 + (cmd.walk || 0) * 0.25 + feed * 0.15 + (cmd.court || 0) * 0.2;
  for (const e of d.eyes) if (e.material) e.material.emissiveIntensity = glow;
}

/** Copy MuJoCo body poses onto the NeuroMechFly meshes. */
export function applyPhysicsPose(fly, pose, dt, t, cmd) {
  const d = fly.userData;
  const flyA = cmd.fly || 0;
  const feed = cmd.feed || 0;
  if (pose.bones) {
    for (const [name, b] of Object.entries(pose.bones)) {
      const node = d.nodes[name];
      if (!node || !b) continue;
      if (b.p) node.body.position.fromArray(b.p);
      if (b.q) setQuatWxyz(node.body, b.q);
      if (node.body.userData.restQuat) node.body.userData.restQuat.copy(node.body.quaternion);
    }
  }
  fly.updateMatrixWorld(true);
  for (const leg of d.legs) {
    if (leg.tarsusTip) leg.tarsusTip.getWorldPosition(_foot);
    leg.foot.x = _foot.x;
    leg.foot.y = _foot.y;
    leg.foot.z = _foot.z;
    leg.foot.stance = !!(pose.contact && pose.contact[leg.name]);
    leg.foot.vx = 0;
    leg.foot.vz = 0;
    leg.foot.vy = 0;
  }
  d.slip = { x: 0, z: 0, n: 0, yawL: 0, yawR: 0 };
  poseSoftParts(d, t, cmd, flyA, feed);
}

export function wanderFemale(female, dt, t) {
  const r = 7.5;
  const w = 0.18;
  female.position.x = Math.cos(t * w) * r;
  female.position.z = Math.sin(t * w) * r * 0.7;
  female.position.y = female.userData.standZ || 1.3;
  female.rotation.y = t * w + Math.PI / 2;
  stepLife(female, dt, t, { mode: "walk", walk: 0.35, turn: 0.15 });
}

export function createArena() {
  const g = new THREE.Group();
  const chk = document.createElement("canvas");
  chk.width = 512; chk.height = 512;
  const cx = chk.getContext("2d");
  const n = 16;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    cx.fillStyle = ((i + j) & 1) ? "#2a3140" : "#161920";
    cx.fillRect(i * 32, j * 32, 32, 32);
  }
  const floorMap = new THREE.CanvasTexture(chk);
  floorMap.wrapS = floorMap.wrapT = THREE.RepeatWrapping;
  floorMap.repeat.set(4, 4);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(18, 72),
    new THREE.MeshStandardMaterial({ map: floorMap, color: 0xc8d0dc, roughness: 0.92, metalness: 0.04 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  g.add(floor);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(18, 0.18, 8, 80),
    new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.6 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.18;
  g.add(ring);
  const grid = new THREE.GridHelper(36, 36, 0x2a3140, 0x222833);
  grid.position.y = 0.01;
  g.add(grid);

  function drop(color, emissive, x, z) {
    const grp = new THREE.Group();
    grp.position.set(x, 0.12, z);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 16, 12),
      new THREE.MeshPhysicalMaterial({
        color, roughness: 0.15, metalness: 0.05,
        transparent: true, opacity: 0.85, emissive, emissiveIntensity: 0.25,
      })
    );
    mesh.scale.set(1, 0.55, 1);
    grp.add(mesh);
    const light = new THREE.PointLight(emissive, 1.1, 7);
    light.position.y = 0.4;
    grp.add(light);
    g.add(grp);
    return grp;
  }

  const food = drop(0xf0c040, 0xffaa22, 6.5, 4.2);
  const bitter = drop(0x3d6b2e, 0x5a8f2a, -7.2, 5.8);
  const water = drop(0x4aa8ff, 0x3388ff, -5.5, -3.8);

  const perch = new THREE.Group();
  perch.position.set(4.8, 0, -7.4);
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.82, metalness: 0.05 });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x4a3218, roughness: 0.85 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 2.15, 10), wood);
  pole.position.y = 1.08;
  pole.castShadow = true;
  perch.add(pole);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 12), woodDark);
  cap.position.y = 2.18;
  cap.castShadow = true;
  perch.add(cap);
  g.add(perch);
  perch.userData = { x: 4.8, z: -7.4, r: 0.22, h: 2.18 };

  g.userData = { food, water, bitter, perch };
  return g;
}
