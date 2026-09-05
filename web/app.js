import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { loadNmf, createMaleFly, createFemaleFly, createArena } from "./fly.js";
import { EmbodiedFly } from "./agent.js";
import { drawOmmatidia } from "./eye.js";
import { OdorWorld } from "./plume.js";
import { physics, connectPhysics, flushPhysics } from "./physics.js";

const $ = (id) => document.getElementById(id);
const canvas = $("c");
const loaderEl = $("loader");
const barEl = $("bar");
const loadmsg = $("loadmsg");
const MAX_FLIES = 8;

function setLoad(p, msg) {
  barEl.style.width = Math.round(p * 100) + "%";
  if (msg) loadmsg.textContent = msg;
}
async function fetchBuf(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + " " + res.status);
  return res.arrayBuffer();
}
async function fetchJson(url) { return (await fetch(url)).json(); }

setLoad(0.04, "male + female connectomes");

const [
  mNeu, mCsr, mBrain, mVnc, mStim, mEff, mMeta,
  fNeu, fCsr, fBrain, fVnc, fStim, fEff, fMeta,
] = await Promise.all([
  fetchBuf("data/neurons.bin"),
  fetchBuf("data/connectome.bin"),
  fetchBuf("data/brain.mesh"),
  fetchBuf("data/vnc.mesh"),
  fetchJson("data/stim.json"),
  fetchJson("data/effectors.json"),
  fetchJson("data/meta.json"),
  fetchBuf("data/female/neurons.bin"),
  fetchBuf("data/female/connectome.bin"),
  fetchBuf("data/female/brain.mesh"),
  fetchBuf("data/female/vnc.mesh"),
  fetchJson("data/female/stim.json"),
  fetchJson("data/female/effectors.json"),
  fetchJson("data/female/meta.json"),
]);

$("nNeurons").textContent = mMeta.n.toLocaleString();
$("nFemale").textContent = fMeta.n.toLocaleString();
if ($("nEdges")) $("nEdges").textContent = (mMeta.nEdges + fMeta.nEdges).toLocaleString();

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x0b0d12, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 220);
camera.position.set(0, 8.5, 16);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 1.4;
controls.maxDistance = 52;
controls.target.set(0, 0.7, 0);
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

scene.add(new THREE.HemisphereLight(0xb8c4d8, 0x1a120c, 1.05));
const key = new THREE.DirectionalLight(0xfff2dc, 1.35);
key.position.set(8, 16, 10);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.near = 1;
key.shadow.camera.far = 50;
key.shadow.camera.left = key.shadow.camera.bottom = -18;
key.shadow.camera.right = key.shadow.camera.top = 18;
scene.add(key);

const arena = createArena();
scene.add(arena);
const odors = new OdorWorld();
odors.group.visible = false;
scene.add(odors.group);

const worldShared = {
  food: arena.userData.food.position,
  water: arena.userData.water.position,
  bitter: arena.userData.bitter.position,
  perch: arena.userData.perch.userData,
  odors,
};

const flies = [];
let selected = null;
let followMode = "flock";
let xrayOn = false;
let paused = false;
let nMale = 0, nFemale = 0;
let readyN = 0;
let expectedReady = 2;

function spawnSpot(occupied) {
  const pts = occupied || flies.map((f) => ({ x: f.body.position.x, z: f.body.position.z }));
  const yaw = Math.random() * Math.PI * 2;
  const gap = 5.5;
  for (let k = 0; k < 24; k++) {
    const a = Math.random() * Math.PI * 2;
    const r = 3.5 + Math.random() * 10;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (pts.every((p) => Math.hypot(p.x - x, p.z - z) >= gap)) return { x, z, yaw };
  }
  return { x: (Math.random() - 0.5) * 12, z: (Math.random() - 0.5) * 12, yaw };
}

function onFlyReady() {
  readyN++;
  if (readyN >= expectedReady) {
    document.body.dataset.ready = "1";
    loaderEl.classList.add("hidden");
  }
  paintFlock();
}

function wireWorld(fly) {
  Object.assign(fly.world, worldShared);
}

function spawn(sex, x, z, yaw) {
  if (flies.length >= MAX_FLIES) return null;
  const male = sex === "male";
  if (x == null || z == null) {
    const s = spawnSpot();
    x = s.x; z = s.z; if (yaw == null) yaw = s.yaw;
  }
  if (yaw == null) yaw = Math.random() * Math.PI * 2;
  const fly = new EmbodiedFly({
    sex,
    body: male ? createMaleFly() : createFemaleFly(),
    neuBuf: male ? mNeu : fNeu,
    csrBuf: male ? mCsr : fCsr,
    stim: male ? mStim : fStim,
    effectors: male ? mEff : fEff,
    brainBuf: male ? mBrain : fBrain,
    vncBuf: male ? mVnc : fVnc,
    scene, x, z, yaw,
    onReady: onFlyReady,
    onFrame: onAny,
  });
  if (male) { nMale++; fly.name = "♂" + nMale; }
  else { nFemale++; fly.name = "♀" + nFemale; }
  fly.setRun(!paused);
  fly.setCnsVisible(xrayOn);
  wireWorld(fly);
  flies.push(fly);
  if (!selected) selected = fly;
  refreshNeighbors();
  paintFlock();
  return fly;
}

function refreshNeighbors() {
  for (const f of flies) {
    f.world.others = flies.filter((o) => o !== f);
    let best = null, bestD = 99;
    for (const o of f.world.others) {
      const d = Math.hypot(
        o.body.position.x - f.body.position.x,
        o.body.position.z - f.body.position.z
      );
      if (d < bestD) { bestD = d; best = o; }
    }
    f.world.other = best;
  }
}

function selectFly(fly) {
  selected = fly;
  paintFlock();
}

const ACT = [
  ["walk", "#3dff9a"], ["turn", "#4de4ff"], ["fly", "#b07cff"], ["feed", "#ffd166"],
  ["court", "#ff4fd8"], ["groom", "#ff9f1c"], ["escape", "#ff5c7a"], ["rest", "#8892a8"],
];
function fillActs(el, prefix) {
  if (!el) return;
  el.innerHTML = "";
  for (const [k, col] of ACT) {
    const row = document.createElement("div");
    row.className = "barline";
    row.innerHTML = `<div class="name">${k}</div><div class="track"><i id="${prefix}-${k}" style="background:${col}"></i></div>`;
    el.appendChild(row);
  }
}
fillActs($("acts"), "sact");

const JOINT_LEGS = ["L1", "R1", "L2", "R2", "L3", "R3"];
function fillJoints(el) {
  if (!el) return;
  el.innerHTML = "";
  for (const name of JOINT_LEGS) {
    const row = document.createElement("div");
    row.className = "barline";
    row.innerHTML = `<div class="name">${name}</div><div class="track"><i id="j-${name}" style="background:#7ecbff"></i></div>`;
    el.appendChild(row);
  }
}
fillJoints($("joints"));

setLoad(0.88, "NeuroMechFly body");
await loadNmf();
setLoad(0.92, "MuJoCo flesh");
await connectPhysics();
if ($("flesh")) $("flesh").textContent = physics.ok ? "MuJoCo" : "kinematic";
if ($("info") && physics.ok) {
  $("info").textContent = "Photoreceptors see the dish; L1/L2 sit on tonic and get histaminergic inhibition. Clock cells are not force-fed daylight (only l-LNv CRY). Motor neurons command NeuroMechFly actuators. MuJoCo is the flesh — no slip walk, no planted jump.";
}

spawn("male");
spawn("female");

function paintActs(fly, prefix) {
  if (!fly) return;
  const cmd = fly.cmd;
  for (const [k] of ACT) {
    const el = document.getElementById(prefix + "-" + k);
    if (!el) continue;
    const v = k === "turn" ? Math.abs(cmd.turn) : (cmd[k] || 0);
    el.style.width = (Math.min(1, v) * 100).toFixed(1) + "%";
  }
}
function paintJoints(fly) {
  if (!fly) return;
  const m = fly.cmd.muscle || {};
  for (const name of JOINT_LEGS) {
    const el = document.getElementById("j-" + name);
    if (!el) continue;
    const u = m[name] || {};
    const net = Math.abs((u.tiFlex || 0) - (u.tiExt || 0))
      + Math.abs((u.trFlex || 0) - (u.trExt || 0))
      + Math.abs((u.coxaProm || 0) - (u.coxaRem || 0));
    el.style.width = (Math.min(1, net / 2) * 100).toFixed(1) + "%";
  }
}

function paintFlock() {
  const el = $("flock");
  if (!el) return;
  el.innerHTML = "";
  for (const f of flies) {
    const b = document.createElement("button");
    b.textContent = f.name + " " + (f.life?.mode || "…");
    b.className = "flychip" + (f === selected ? " on" : "") + (f.sex === "female" ? " pink" : "");
    b.onclick = () => {
      selectFly(f);
      followMode = "selected";
      syncFollow();
    };
    el.appendChild(b);
  }
  if ($("nFlock")) $("nFlock").textContent = flies.length;
  if ($("addM")) $("addM").disabled = flies.length >= MAX_FLIES;
  if ($("addF")) $("addF").disabled = flies.length >= MAX_FLIES;
}

let worldTick = 0;
function onAny() {
  if (++worldTick % 2 === 0) {
    refreshNeighbors();
    for (const f of flies) f.pushWorldDrive();
  }
  const focus = selected || flies[0];
  if (!focus) return;
  paintActs(focus, "sact");
  paintJoints(focus);
  if (focus.eye) {
    drawOmmatidia($("eyeL"), focus.eye, "L");
    drawOmmatidia($("eyeR"), focus.eye, "R");
  }
  if (focus.day != null) {
    const day = focus.day;
    key.intensity = 0.12 + day * 1.35;
    key.position.set(Math.sin(day * Math.PI) * 14, 3 + day * 14, Math.cos(day * Math.PI) * 8);
    renderer.setClearColor(0x0b0d12, 1);
  }
  const males = flies.filter((f) => f.sex === "male");
  const fems = flies.filter((f) => f.sex === "female");
  $("gait").textContent = males[0] ? "♂ " + males[0].life.mode : "—";
  if ($("gaitF")) $("gaitF").textContent = fems[0] ? "♀ " + fems[0].life.mode : "—";
  $("hunger").textContent = Math.round(focus.life.hunger * 100) + "%";
  if ($("selName")) $("selName").textContent = focus.name;
  const flesh = physics.ok ? "MuJoCo" : "kinematic";
  if ($("flesh")) $("flesh").textContent = flesh;
  $("lifeHint").textContent = flesh + " · " + flies.map((f) => f.name + " " + f.life.mode).join(" · ");
  const e = focus.motEma || {};
  const setW = (id, v) => { const el = $(id); if (el) el.style.width = (Math.min(1, v) * 100).toFixed(1) + "%"; };
  setW("slow-sleep", focus.life.sleep);
  setW("slow-pdf", (e.sLNv || 0) * 0.65 + (e.lLNv || 0) * 0.35);
  setW("slow-da", e.DAN || 0);
  setW("slow-oa", e.OA || 0);
  const o = focus.lastOdor;
  if (o && $("odorFL")) {
    $("odorFL").style.width = Math.min(100, o.foodL).toFixed(1) + "%";
    $("odorFR").style.width = Math.min(100, o.foodR).toFixed(1) + "%";
    $("odorPL").style.width = Math.min(100, o.pherL).toFixed(1) + "%";
    $("odorPR").style.width = Math.min(100, o.pherR).toFixed(1) + "%";
  }
}

$("pause").onclick = () => {
  paused = !paused;
  for (const f of flies) f.setRun(!paused);
  $("pause").textContent = paused ? "resume" : "pause";
  $("pause").classList.toggle("on", paused);
};
$("reset").onclick = () => {
  const taken = [];
  for (const f of flies) {
    const s = spawnSpot(taken);
    taken.push(s);
    f.resetPose(s.x, s.z, s.yaw);
  }
};
function syncFollow() {
  $("followFlock").parentElement.classList.toggle("on", followMode === "flock");
  $("followSel").parentElement.classList.toggle("on", followMode === "selected");
  $("followFlock").checked = followMode === "flock";
  $("followSel").checked = followMode === "selected";
}
$("followFlock").onchange = (e) => {
  followMode = e.target.checked ? "flock" : "off";
  if (followMode === "flock") $("followSel").checked = false;
  syncFollow();
};
$("followSel").onchange = (e) => {
  followMode = e.target.checked ? "selected" : "off";
  if (followMode === "selected") $("followFlock").checked = false;
  syncFollow();
};
$("xray").onchange = (e) => {
  xrayOn = e.target.checked;
  e.target.parentElement.classList.toggle("on", xrayOn);
  for (const f of flies) f.setCnsVisible(xrayOn);
};
$("showOdor").onchange = (e) => {
  const on = e.target.checked;
  e.target.parentElement.classList.toggle("on", on);
  odors.group.visible = on;
};
$("addM").onclick = () => {
  expectedReady = readyN + 1;
  spawn("male");
};
$("addF").onclick = () => {
  expectedReady = readyN + 1;
  spawn("female");
};

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downX = 0, downY = 0;
canvas.addEventListener("pointerdown", (ev) => { downX = ev.clientX; downY = ev.clientY; });
canvas.addEventListener("pointerup", (ev) => {
  if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > 6) return;
  pointer.x = (ev.clientX / innerWidth) * 2 - 1;
  pointer.y = -(ev.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const meshes = [];
  for (const f of flies) f.body.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const hits = raycaster.intersectObjects(meshes, false);
  if (!hits.length) {
    followMode = "off";
    syncFollow();
    return;
  }
  let obj = hits[0].object;
  while (obj && !flies.some((f) => f.body === obj)) obj = obj.parent;
  const fly = flies.find((f) => f.body === obj);
  if (fly) {
    selectFly(fly);
    followMode = "selected";
    syncFollow();
  }
});

const stimBtns = [
  ["loop", "live", ""],
  ["vision", "light", ""],
  ["smell", "odor flood", ""],
  ["taste", "taste", ""],
  ["escape", "escape", "warn"],
];
const stimsEl = $("stims");
for (const [id, label, cls] of stimBtns) {
  const b = document.createElement("button");
  b.textContent = label;
  b.dataset.stim = id;
  if (cls) b.classList.add(cls);
  b.onclick = () => applyStim(id);
  stimsEl.appendChild(b);
}
function applyStim(id) {
  for (const b of stimsEl.querySelectorAll("button")) b.classList.toggle("on", b.dataset.stim === id);
  const extra = { vision: 0, smellL: 0, smellR: 0, taste: 0, touch: 0, courtship: 0, escape: 0 };
  if (id === "vision") extra.vision = 90;
  if (id === "smell") extra.smellL = extra.smellR = 90;
  if (id === "taste") extra.taste = 90;
  if (id === "escape") extra.escape = 180;
  for (const f of flies) {
    f.extra = f.sex === "female"
      ? { vision: extra.vision, smellL: extra.smellL, smellR: extra.smellR, taste: extra.taste, escape: extra.escape }
      : { ...extra };
  }
  $("stimHint").textContent = id === "loop" ? "every fly closed-loop" : id;
}

function wireCollapse(panelId, key) {
  const panel = $(panelId);
  if (!panel) return;
  const btn = panel.querySelector(".collapse");
  const apply = (on) => {
    panel.classList.toggle("collapsed", on);
    if (btn) btn.textContent = on ? "+" : "–";
    try { localStorage.setItem("ffb-" + key, on ? "1" : "0"); } catch (_) {}
  };
  let start = false;
  try { start = localStorage.getItem("ffb-" + key) === "1"; } catch (_) {}
  apply(start);
  if (btn) btn.onclick = () => apply(!panel.classList.contains("collapsed"));
}
wireCollapse("panelL", "left");
wireCollapse("panelR", "right");
wireCollapse("panelB", "bottom");

const _cam = new THREE.Vector3();
const _tgt = new THREE.Vector3();
let lastT = performance.now();
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (!paused) {
    flushPhysics(dt);
    odors.step(dt, now * 0.001, {
      food: arena.userData.food.position,
      water: arena.userData.water.position,
      bitter: arena.userData.bitter.position,
      flies,
    });
  }
  if (followMode === "selected" && selected) {
    const h = selected.heading;
    const px = selected.body.position.x, pz = selected.body.position.z, py = selected.y;
    _cam.set(px - Math.sin(h) * 6.2, 3.6 + py, pz - Math.cos(h) * 6.2);
    camera.position.lerp(_cam, 0.08);
    _tgt.set(px + Math.sin(h) * 1.4, 0.85 + py, pz + Math.cos(h) * 1.4);
    controls.target.lerp(_tgt, 0.12);
  } else if (followMode === "flock" && flies.length) {
    let cx = 0, cz = 0, cy = 0, minx = 99, maxx = -99, minz = 99, maxz = -99;
    for (const f of flies) {
      const x = f.body.position.x, z = f.body.position.z;
      cx += x; cz += z; cy += f.y;
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (z < minz) minz = z; if (z > maxz) maxz = z;
    }
    const n = flies.length;
    cx /= n; cz /= n; cy /= n;
    const span = Math.max(6, maxx - minx, maxz - minz);
    _cam.set(cx + span * 0.15, 5.5 + span * 0.42 + cy, cz + 7.5 + span * 0.38);
    camera.position.lerp(_cam, 0.06);
    _tgt.set(cx, 0.55 + cy, cz);
    controls.target.lerp(_tgt, 0.09);
  }
  controls.update();
  renderer.render(scene, camera);
}
setLoad(1, "starting brains");
paintFlock();
syncFollow();
loop();
