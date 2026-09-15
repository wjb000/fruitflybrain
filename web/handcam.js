/**
 * Webcam / synthetic “you” blob — thin pixel→sensory encoding for follow-me.
 *
 * Not a PID go-to-pixel. Cue (cx, area, asym) becomes:
 *   1. a virtual food/beacon in fly.world (compound eye → optic/visionL/R)
 *   2. sensoryBoost Hz on visionL/R + HS/VS/optic/loom
 * Steering stays LIF → MN → portable droneSetpoints → stepDroneChassis.
 *
 * Force-on for follow.html; optional on the main sim via ?cam=1.
 * No webcam → draggable synthetic blob (same encoding path).
 */
const ANAL_W = 160;
const ANAL_H = 120;

export function camWanted() {
  try {
    const path = location.pathname || "";
    if (/(?:^|\/)follow\.html$/i.test(path)) return true;
    const q = new URLSearchParams(location.search);
    if (q.get("cam") === "0" || q.get("cam") === "off") return false;
    return q.get("cam") === "1" || q.get("cam") === "true" || q.get("follow") === "1";
  } catch {
    return false;
  }
}

export function isFollowPage() {
  try {
    return /(?:^|\/)follow\.html$/i.test(location.pathname || "");
  } catch {
    return false;
  }
}

export function createHandCam(opts = {}) {
  return new HandCam(opts);
}

export class HandCam {
  constructor(opts = {}) {
    this.view = opts.canvas || opts.view || null;
    this.overlay = opts.overlay || null;
    this.forceOn = opts.forceOn != null ? !!opts.forceOn : isFollowPage();
    this.onCue = typeof opts.onCue === "function" ? opts.onCue : null;
    this.stream = null;
    this.video = document.createElement("video");
    this.video.setAttribute("playsinline", "");
    this.video.muted = true;
    this.video.autoplay = true;
    this.anal = document.createElement("canvas");
    this.anal.width = ANAL_W;
    this.anal.height = ANAL_H;
    this.actx = this.anal.getContext("2d", { willReadFrequently: true });
    this.prevGray = null;
    this.source = "synthetic";
    this.ready = false;
    this.denied = false;
    this.dragging = false;
    this.synth = { cx: 0.52, cy: 0.42, rad: 0.11 };
    this.last = {
      cx: 0.52, cy: 0.42, area: 0.09, asym: 0.04, motion: 0,
      loom: 0.35, source: "synthetic", ready: false,
    };
    this._cueX = this.synth.cx;
    this._cueY = this.synth.cy;
    this._cueA = 0.09;
    this._beacon = null;
    this._raf = 0;
    this._drawHook = () => this.draw();
    if (this.view) this.attachDrag(this.view);
    if (this.overlay) this.attachDrag(this.overlay);
  }

  async start() {
    this.ready = true;
    if (this.forceOn || camWanted()) {
      await this._tryWebcam();
    }
    this.draw();
    return this.last;
  }

  stop() {
    this.ready = false;
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    this.video.srcObject = null;
  }

  async _tryWebcam() {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.source = "synthetic";
      this.denied = true;
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play().catch(() => {});
      this.source = "webcam";
      this.denied = false;
    } catch {
      this.source = "synthetic";
      this.denied = true;
    }
  }

  attachDrag(el) {
    if (!el || el._ffbCamDrag) return;
    el._ffbCamDrag = true;
    const hit = (ev) => {
      const r = el.getBoundingClientRect();
      const cx = (ev.clientX - r.left) / Math.max(1, r.width);
      const cy = (ev.clientY - r.top) / Math.max(1, r.height);
      return {
        cx: Math.max(0.04, Math.min(0.96, cx)),
        cy: Math.max(0.06, Math.min(0.94, cy)),
      };
    };
    const onDown = (ev) => {
      ev.preventDefault();
      this.dragging = true;
      this.source = "synthetic";
      const p = hit(ev);
      this.synth.cx = p.cx;
      this.synth.cy = p.cy;
      this.sample();
      this.draw();
    };
    const onMove = (ev) => {
      if (!this.dragging) return;
      const p = hit(ev);
      this.synth.cx = p.cx;
      this.synth.cy = p.cy;
      this.sample();
      this.draw();
    };
    const onUp = () => { this.dragging = false; };
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    el.style.touchAction = "none";
    el.style.cursor = "grab";
  }

  /** Flip synthetic blob L↔R (frozen vs plastic reacquisition). */
  jumpSyntheticSide() {
    this.source = "synthetic";
    this.synth.cx = this.synth.cx < 0.5 ? 0.82 : 0.18;
    this.synth.cy = 0.40 + Math.random() * 0.08;
    this._beacon = null;
    return this.sample();
  }

  sample() {
    let cx = this.synth.cx, cy = this.synth.cy, area = Math.PI * this.synth.rad * this.synth.rad;
    let motion = 0;
    let used = "synthetic";
    if (this.source === "webcam" && this.video.readyState >= 2 && !this.dragging) {
      const blob = this._analyzeVideo();
      if (blob && blob.area > 0.004) {
        cx = blob.cx;
        cy = blob.cy;
        area = blob.area;
        motion = blob.motion;
        used = "webcam";
      }
    }
    const asym = (cx - 0.5) * 2;
    const loom = Math.max(0, Math.min(1, Math.sqrt(Math.max(0, area)) * 2.15 + motion * 0.45));
    this.last = {
      cx, cy, area, asym, motion, loom,
      source: used,
      ready: this.ready,
      denied: this.denied,
    };
    if (this.onCue) this.onCue(this.last);
    return this.last;
  }

  _analyzeVideo() {
    const ctx = this.actx;
    ctx.drawImage(this.video, 0, 0, ANAL_W, ANAL_H);
    const img = ctx.getImageData(0, 0, ANAL_W, ANAL_H);
    const data = img.data;
    const n = ANAL_W * ANAL_H;
    const gray = new Float32Array(n);
    let mx = 0, my = 0, mw = 0, mot = 0;
    let bx = 0, by = 0, bw = 0;
    const prev = this.prevGray;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const g = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      gray[i] = g;
      const x = i % ANAL_W, y = (i / ANAL_W) | 0;
      if (g > 168) { bx += x; by += y; bw++; }
      if (prev) {
        const d = Math.abs(g - prev[i]);
        if (d > 26) { mx += x * d; my += y * d; mw += d; mot += d; }
      }
    }
    this.prevGray = gray;
    let cx, cy, area;
    if (mw > 180) {
      cx = mx / mw / ANAL_W;
      cy = my / mw / ANAL_H;
      area = Math.min(0.35, (mw / 255) / n * 3.2);
    } else if (bw > 40) {
      cx = bx / bw / ANAL_W;
      cy = by / bw / ANAL_H;
      area = Math.min(0.35, bw / n);
    } else {
      return null;
    }
    return { cx, cy, area, motion: Math.min(1, mot / (n * 40)) };
  }

  /**
   * Place a food-like beacon in fly.world from blob cx (azimuth) + area (distance),
   * relative to drone heading. Hold world pose until the cue moves so the compound
   * eye can close the loop (yaw centers the beacon; not a chassis PID).
   */
  worldBeacon(fly) {
    const cue = this.last || this.sample();
    const heading = fly?.heading ?? 0;
    const px = fly?.body?.position?.x ?? 0;
    const pz = fly?.body?.position?.z ?? 0;
    const moved = !this._beacon
      || Math.abs(cue.cx - this._cueX) > 0.016
      || Math.abs(cue.cy - this._cueY) > 0.016
      || Math.abs(cue.area - this._cueA) > 0.012;
    if (moved) {
      this._cueX = cue.cx;
      this._cueY = cue.cy;
      this._cueA = cue.area;
      const az = (cue.cx - 0.5) * 1.35;
      const dist = 3.4 + (1 - Math.min(1, Math.sqrt(Math.max(0.001, cue.area)) * 2.35)) * 8.4;
      let x = px + Math.sin(heading + az) * dist;
      let z = pz + Math.cos(heading + az) * dist;
      const rad = Math.hypot(x, z);
      if (rad > 14.6 && rad > 1e-6) {
        const s = 14.6 / rad;
        x *= s; z *= s;
      }
      this._beacon = {
        x, z, y: 1.15, r: 0.48 + Math.min(0.35, cue.area * 2),
        kind: "food", az, dist, cx: cue.cx, area: cue.area,
      };
    }
    return this._beacon;
  }

  /** Hz write-in for visionL/R + HS/VS/optic/loom (merged in agent.setCamBoost). */
  sensoryBoost(cue) {
    const c = cue || this.last || this.sample();
    const asym = c.asym ?? ((c.cx - 0.5) * 2);
    const loom = c.loom ?? 0.3;
    const mag = 18 + loom * 38;
    const left = mag * Math.max(0, -asym);
    const right = mag * Math.max(0, asym);
    const both = 6 + loom * 22;
    const hs = 8 + loom * 16;
    return {
      visionL: both + left,
      visionR: both + right,
      HSL: hs + left * 0.85,
      HSR: hs + right * 0.85,
      VSL: 5 + loom * 12 + left * 0.25,
      VSR: 5 + loom * 12 + right * 0.25,
      loom: loom * 14,
      optic: {
        T4aL: loom * 8 + left * 0.3,
        T4aR: loom * 8 + right * 0.3,
        T5aL: loom * 7 + left * 0.25,
        T5aR: loom * 7 + right * 0.25,
        L1L: loom * 6 + left * 0.2,
        L1R: loom * 6 + right * 0.2,
        L2L: loom * 5 + left * 0.15,
        L2R: loom * 5 + right * 0.15,
      },
      cx: c.cx, asym, area: c.area, source: c.source,
    };
  }

  draw() {
    const canvas = this.view;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = "#07080d";
    ctx.fillRect(0, 0, w, h);
    if (this.source === "webcam" && this.video.readyState >= 2 && !this.dragging) {
      try { ctx.drawImage(this.video, 0, 0, w, h); } catch { /* ignore */ }
    } else {
      ctx.fillStyle = "#10141c";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(77,228,255,0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
      ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
      ctx.stroke();
    }
    const cue = this.last;
    const bx = cue.cx * w, by = cue.cy * h;
    const rad = Math.max(10, Math.sqrt(Math.max(0.01, cue.area)) * Math.min(w, h) * 1.15);
    ctx.beginPath();
    ctx.arc(bx, by, rad, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 196, 64, 0.28)";
    ctx.fill();
    ctx.strokeStyle = "#ffc040";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#ffe9a8";
    ctx.font = "11px 'IBM Plex Sans', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("YOU", bx, by + 4);
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(232,237,247,0.85)";
    ctx.font = "10px 'IBM Plex Sans', sans-serif";
    const tag = cue.source === "webcam" ? "webcam blob" : "synthetic · drag me";
    ctx.fillText(tag, 8, 14);
  }
}

export function applyCamToFly(handCam, fly) {
  if (!handCam || !fly) return null;
  const cue = handCam.sample();
  const beacon = handCam.worldBeacon(fly);
  if (beacon) {
    fly.world.person = beacon;
    fly.world.food = { x: beacon.x, z: beacon.z };
    const rest = (fly.world.landmarks || []).filter((L) => L.kind !== "food");
    fly.world.landmarks = [
      { x: beacon.x, y: 2.05, z: beacon.z, r: beacon.r || 0.5, kind: "food" },
      ...rest,
    ];
  }
  if (typeof fly.setCamBoost === "function") fly.setCamBoost(handCam.sensoryBoost(cue));
  handCam.draw();
  return { cue, beacon };
}
