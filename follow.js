/**
 * Follow-me demo: webcam/synthetic blob → vision pools → LIF → drone.
 * Honest: simulation of a cam blob on the pad, not a real FPV quad.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createDroneChassis } from "./chassis.js?v=realfly3";
import { createOpenWorld } from "./world/procgen.js?v=realfly3";
import { EmbodiedFly } from "./agent.js?v=realfly3";
import { portableControls, droneSetpoints } from "./controller/portable.js?v=realfly3";
import { createHandCam, applyCamToFly } from "./handcam.js?v=realfly3";
import { fetchBufProgress, fetchJson, CONNECTOME_BYTES, connectomeWaitMsg } from "./loadutil.js?v=realfly3";

const $ = (id) => document.getElementById(id);
const loaderEl = $("loader");
const barEl = $("bar");
const loadmsg = $("loadmsg");

function setLoad(p, msg) {
  if (barEl) barEl.style.width = Math.round(Math.min(1, Math.max(0, p)) * 100) + "%";
  if (msg && loadmsg) loadmsg.textContent = msg;
}

setLoad(0.04, connectomeWaitMsg());

const [mNeu, mCsr, mBrain, mVnc, mStim, mEff, mMeta] = await Promise.all([
  fetchBufProgress("data/neurons.bin"),
  fetchBufProgress("data/connectome.bin", (got, tot) => {
    const t = tot || CONNECTOME_BYTES;
    const frac = t ? Math.min(1, got / t) : 0;
    setLoad(0.04 + 0.50 * frac, connectomeWaitMsg(got, t));
  }, CONNECTOME_BYTES),
  fetchBufProgress("data/brain.mesh"),
  fetchBufProgress("data/vnc.mesh"),
  fetchJson("data/stim.json"),
  fetchJson("data/effectors.json"),
  fetchJson("data/meta.json"),
]);

if ($("nNeurons")) $("nNeurons").textContent = mMeta.n.toLocaleString();
setLoad(0.55, "drone chassis");

const renderer = new THREE.WebGLRenderer({ canvas: $("c"), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x0b0d12, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const chaseCam = new THREE.PerspectiveCamera(55, 1, 0.05, 120);
chaseCam.position.set(0, 4.2, 8.5);
const fpvCam = new THREE.PerspectiveCamera(70, 1, 0.08, 80);
const controls = new OrbitControls(chaseCam, $("c"));
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 1.2;
controls.maxDistance = 28;
controls.target.set(0, 1.2, 0);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  const a = innerWidth / innerHeight;
  chaseCam.aspect = a; chaseCam.updateProjectionMatrix();
  fpvCam.aspect = a; fpvCam.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

scene.add(new THREE.HemisphereLight(0xb8c4d8, 0x1a120c, 1.05));
const key = new THREE.DirectionalLight(0xfff2dc, 1.35);
key.position.set(8, 16, 10);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
scene.add(key);

const procWorld = createOpenWorld();
scene.add(procWorld.root);
const foodMesh = procWorld._allFeatures?.find((f) => f.kind === "food")?.object;
if (foodMesh) foodMesh.visible = false;

const you = makeYouMarker();
scene.add(you);

const handCam = createHandCam({ canvas: $("camThumb"), forceOn: true });
await handCam.start();

const body = createDroneChassis();
body.add(fpvCam);
fpvCam.position.set(0, 0.12, 0.18);
fpvCam.rotation.set(0, Math.PI, 0); // local +Z is drone nose; camera looks -Z by default

let fly = null;
let paused = false;
let viewMode = "chase";
let plastic = true;

const teach = makeHDeltaTeach();

fly = new EmbodiedFly({
  sex: "male",
  body,
  neuBuf: mNeu,
  csrBuf: mCsr,
  stim: mStim,
  effectors: mEff,
  brainBuf: mBrain,
  vncBuf: mVnc,
  scene,
  x: 0,
  z: -2.4,
  yaw: 0,
  onReady: () => {
    document.body.dataset.ready = "1";
    loaderEl.classList.add("hidden");
  },
  onFrame: onFlyFrame,
});
fly.name = "♂1";
fly.world.water = procWorld.water.position;
fly.world.bitter = procWorld.bitter.position;
fly.world.perch = procWorld.perch.userData;
fly.world.landmarks = [];
fly.setRun(true);

function makeYouMarker() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffc040, emissive: 0xff9900, emissiveIntensity: 0.85, roughness: 0.4,
  });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.7, 4, 8), mat);
  torso.position.y = 0.85;
  torso.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), mat);
  head.position.y = 1.48;
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.06, 1.6, 8),
    new THREE.MeshStandardMaterial({ color: 0xffaa22, emissive: 0xff7700, emissiveIntensity: 1 }),
  );
  pole.position.y = 1.0;
  g.add(torso, head, pole);
  const light = new THREE.PointLight(0xffaa33, 1.6, 9);
  light.position.y = 1.6;
  g.add(light);
  return g;
}

/** Client overlay on real hDeltaH/A/I/G column prefs (not worker enableFastW). */
function makeHDeltaTeach() {
  const spec = { H: 8, A: 12, I: 17, G: 8 };
  const cells = [];
  for (const [typ, n] of Object.entries(spec)) {
    const nCol = typ === "A" || typ === "I" ? 12 : 8;
    for (let i = 0; i < n; i++) {
      cells.push({ typ, col: (i % nCol) + 1, nCol, wL: 0, wR: 0 });
    }
  }
  return { cells, eta: 0.10, decay: 0.998, clip: 1.6, meanAbs: 0, nUp: 0 };
}

function bump(cells, heading) {
  const r = [];
  for (const c of cells) {
    const pref = ((c.col - 1) / c.nCol) * Math.PI * 2;
    let d = heading - pref;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const w = Math.max(0, Math.cos(d));
    r.push(w * w);
  }
  return r;
}

function stepTeach(teach, heading, az, plasticOn) {
  const rates = bump(teach.cells, heading);
  const goal = az < 0 ? -1 : 1; // left / right person
  const tL = goal < 0 ? 1 : -1;
  const tR = goal > 0 ? 1 : -1;
  let nUp = 0, abs = 0;
  for (let i = 0; i < teach.cells.length; i++) {
    const c = teach.cells[i];
    if (plasticOn) {
      const pre = 0.35 + 0.65 * rates[i];
      c.wL = Math.max(-teach.clip, Math.min(teach.clip, c.wL * teach.decay + teach.eta * pre * tL));
      c.wR = Math.max(-teach.clip, Math.min(teach.clip, c.wR * teach.decay + teach.eta * pre * tR));
      nUp += 2;
    }
    abs += Math.abs(c.wL) + Math.abs(c.wR);
    c._pre = rates[i];
  }
  teach.nUp = nUp;
  teach.meanAbs = abs / (teach.cells.length * 2);
  let L = 0, R = 0;
  for (const c of teach.cells) {
    L += c.wL * (0.35 + 0.65 * (c._pre || 0));
    R += c.wR * (0.35 + 0.65 * (c._pre || 0));
  }
  const dec = Math.tanh((R - L) * 0.15);
  return {
    visionL: Math.max(0, 28 * Math.max(0, -dec)),
    visionR: Math.max(0, 28 * Math.max(0, dec)),
    dec, meanAbs: teach.meanAbs, nUp,
  };
}

function onFlyFrame() {
  if (paused) return;
  const got = applyCamToFly(handCam, fly);
  const beacon = got?.beacon;
  if (beacon) {
    you.position.set(beacon.x, 0, beacon.z);
    const az = Math.atan2(beacon.x - fly.body.position.x, beacon.z - fly.body.position.z) - fly.heading;
    let wrap = az;
    while (wrap > Math.PI) wrap -= Math.PI * 2;
    while (wrap < -Math.PI) wrap += Math.PI * 2;
    const bias = stepTeach(teach, fly.heading, wrap, plastic);
    const boost = fly.camBoost || {};
    fly.setCamBoost({
      ...boost,
      visionL: (boost.visionL || 0) + bias.visionL,
      visionR: (boost.visionR || 0) + bias.visionR,
    });
    // Teaching overlay also lands on visionL/R stimInject (additive in agent).
    fly.setRates({ visionL: bias.visionL, visionR: bias.visionR });
    if ($("dwHint")) $("dwHint").textContent = bias.meanAbs.toFixed(3);
  }
  fly.pushWorldDrive();
  paintHud();
}

function paintHud() {
  const snap = portableControls(fly);
  const drive = droneSetpoints(snap);
  const inCtrl = fly.ready && (
    Math.abs(drive.yawRate) > 0.035 || drive.forward > 0.04
    || Math.abs((drive.throttle ?? 1.45) - 1.45) > 0.05
  );
  const banner = $("flyBanner");
  if (banner) {
    banner.textContent = fly.ready ? (inCtrl ? "FLY IN CONTROL" : "hover · waiting on MNs") : "loading male CNS";
    banner.classList.toggle("on", !!(fly.ready && inCtrl));
  }
  const setW = (id, v) => {
    const el = $(id);
    if (el) el.style.width = (Math.min(1, Math.abs(v)) * 100).toFixed(1) + "%";
  };
  setW("st-fwd", drive.forward || 0);
  setW("st-yaw", drive.yawRate || 0);
  setW("st-str", drive.strafe || 0);
  setW("st-clb", drive.climb || 0);
  if ($("gait")) $("gait").textContent = "♂ " + (fly.life?.mode || "…");
  if ($("steerHint")) {
    $("steerHint").textContent =
      "thr " + (drive.throttle ?? 1.45).toFixed(2) +
      "  yaw " + (drive.yawRate ?? 0).toFixed(2) +
      "  pitch " + (drive.pitch ?? 0).toFixed(2);
  }
  if ($("fwHint")) $("fwHint").textContent = plastic ? "plastic" : "frozen";
  if ($("camSrc")) $("camSrc").textContent = handCam.last?.source || "synthetic";
}

$("btnPlastic").onclick = () => {
  plastic = !plastic;
  $("btnPlastic").classList.toggle("on", plastic);
  $("btnPlastic").textContent = plastic ? "hΔ plastic ON" : "hΔ frozen";
  $("btnPlastic").classList.toggle("warn", !plastic);
};
$("btnJump").onclick = () => {
  handCam.jumpSyntheticSide();
  you.visible = true;
};
$("pause").onclick = () => {
  paused = !paused;
  fly.setRun(!paused);
  $("pause").classList.toggle("on", paused);
  $("pause").textContent = paused ? "resume" : "pause";
};

function setView(mode) {
  viewMode = mode;
  $("camChase").classList.toggle("on", mode === "chase");
  $("camFpv").classList.toggle("on", mode === "fpv");
  $("camOrbit").classList.toggle("on", mode === "orbit");
  controls.enabled = mode === "orbit";
}
$("camChase").onclick = () => setView("chase");
$("camFpv").onclick = () => setView("fpv");
$("camOrbit").onclick = () => setView("orbit");
setView("chase");

const panel = $("panelL");
panel.querySelector(".collapse").onclick = () => {
  panel.classList.toggle("collapsed");
  panel.querySelector(".collapse").textContent = panel.classList.contains("collapsed") ? "+" : "–";
};

const _tgt = new THREE.Vector3();
let lastT = performance.now();
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (viewMode === "chase" && fly) {
    const h = fly.heading, px = fly.body.position.x, pz = fly.body.position.z, py = fly.y;
    _tgt.set(px + Math.sin(h) * 0.4, py + 0.2, pz + Math.cos(h) * 0.4);
    controls.target.lerp(_tgt, 0.14);
    const desired = new THREE.Vector3(
      px - Math.sin(h) * 5.2,
      py + 2.4,
      pz - Math.cos(h) * 5.2,
    );
    chaseCam.position.lerp(desired, 0.08);
  }
  if (viewMode === "orbit") controls.update();
  const cam = viewMode === "fpv" ? fpvCam : chaseCam;
  renderer.render(scene, cam);
}
loop();

window.ffbFollow = {
  fly: () => fly,
  cam: () => handCam,
  drone: () => fly ? droneSetpoints(portableControls(fly)) : null,
  jump: () => handCam.jumpSyntheticSide(),
  setPlastic: (on) => { plastic = !!on; },
};
