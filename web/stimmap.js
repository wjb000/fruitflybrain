/**
 * Stim-map mode — causal pool activation → chassis forward/yaw.
 *
 * Path stays honest: button → Hz inject (and optional lesion boost) on named
 * pools → LIF spikes → MN / descending effectors → portable steering → cube.
 * Never calls cube.setVelocity / thrusters from the UI.
 *
 * Enable: default on cube, or ?stim=1 / ?map=1. Disable: ?stim=0.
 */

import { portableControls, chassisSetpoints } from "./controller/portable.js?v=stimmap1";
import { STIM_MAP_POOLS, DEFAULT_STIM_HZ } from "./agent.js?v=stimmap1";

export function stimMapWanted(bodyMode = "cube") {
  try {
    const q = new URLSearchParams(location.search);
    if (q.get("stim") === "0" || q.get("map") === "0") return false;
    if (q.get("stim") === "1" || q.get("map") === "1") return true;
    return bodyMode === "cube";
  } catch {
    return bodyMode === "cube";
  }
}

export function stimMapUrl(on = true) {
  const u = new URL(location.href);
  if (on) {
    u.searchParams.set("stim", "1");
    u.searchParams.delete("map");
  } else {
    u.searchParams.set("stim", "0");
  }
  u.searchParams.set("v", "stimmap1");
  return u.pathname + u.search + u.hash;
}

/**
 * @param {{ getFly: () => any, root?: HTMLElement }} opts
 */
export function mountStimMapPanel({ getFly, root } = {}) {
  const el = root || document.createElement("div");
  el.id = "stimMapPanel";
  el.className = "panel stim-map-panel";
  el.innerHTML = `
    <button class="collapse" type="button" title="collapse">–</button>
    <div class="kicker">stim map · causal</div>
    <div class="panel-body">
      <div class="hint">Boost named pools (Hz inject through LIF). Watch chassis <b>fwd</b> / <b>yaw</b>. T1L vs T1R should yaw opposite. Path: stim → spikes → MNs → portable → cube.</div>
      <div class="stim-readouts" id="stimReadouts">
        <div><b id="stimFwd">—</b><span>forward</span></div>
        <div><b id="stimYaw">—</b><span>yawRate</span></div>
        <div><b id="stimTurn">—</b><span>turn hint</span></div>
        <div><b id="stimActive">off</b><span>active</span></div>
      </div>
      <label class="hint stim-slider">inject Hz
        <input type="range" id="stimHz" min="20" max="160" step="5" value="${DEFAULT_STIM_HZ}" />
        <span id="stimHzVal">${DEFAULT_STIM_HZ}</span>
      </label>
      <label class="hint stim-slider">lesion boost ×
        <input type="range" id="stimBoost" min="1" max="4" step="0.25" value="1" />
        <span id="stimBoostVal">1</span>
      </label>
      <div class="row" id="stimPoolBtns" style="margin-top:8px"></div>
      <div class="row" style="margin-top:8px">
        <button type="button" id="stimClear">clear</button>
        <button type="button" id="stimPulseOne" title="Pulse active/selected 1.5s">pulse 1.5s</button>
        <button type="button" id="stimPulseAll" class="pink">pulse all → table</button>
      </div>
      <div class="hint" id="stimLog">ready — hold a pool button or click to toggle</div>
      <div class="stim-table-wrap">
        <table class="stim-table" id="stimTable">
          <thead><tr><th>pool</th><th>peak fwd</th><th>peak yaw</th><th>hint</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  `;

  const poolBtns = el.querySelector("#stimPoolBtns");
  const logEl = el.querySelector("#stimLog");
  const hzIn = el.querySelector("#stimHz");
  const hzVal = el.querySelector("#stimHzVal");
  const boostIn = el.querySelector("#stimBoost");
  const boostVal = el.querySelector("#stimBoostVal");
  const tbody = el.querySelector("#stimTable tbody");
  let active = null;
  let holdPool = null;
  let pulsing = false;
  const btnByPool = {};

  function hz() {
    return Number(hzIn.value) || DEFAULT_STIM_HZ;
  }
  function boostG() {
    return Number(boostIn.value) || 1;
  }
  function fly() {
    return getFly?.() || null;
  }
  function log(msg) {
    if (logEl) logEl.textContent = msg;
  }
  function setBtnOn(pool, on) {
    const b = btnByPool[pool];
    if (b) b.classList.toggle("on", !!on);
  }
  function applyBoost(pool) {
    const f = fly();
    if (!f?.applyLesion) return;
    const g = boostG();
    if (g <= 1.01) {
      f.clearLesion?.();
      return;
    }
    f.applyLesion({
      id: `stimmap-boost:${pool}`,
      ops: [{ op: "boost", pools: [pool], gain: g }],
    });
  }
  function inject(pool, rate) {
    const f = fly();
    if (!f?.setRates) {
      log("fly not ready");
      return false;
    }
    const ok = f.setRates({ [pool]: rate });
    if (ok === false) {
      log(`pool missing: ${pool}`);
      return false;
    }
    return true;
  }
  function clearAll() {
    const f = fly();
    if (f?.clearStimInject) f.clearStimInject();
    else if (f?.setRates && active) f.setRates({ [active]: 0 });
    f?.clearLesion?.();
    if (active) setBtnOn(active, false);
    active = null;
    holdPool = null;
    log("cleared inject + lesion boost");
  }
  function activate(pool, { hold = false } = {}) {
    const f = fly();
    if (!f?.ready) {
      log("waiting for CNS…");
      return;
    }
    if (active && active !== pool) {
      inject(active, 0);
      setBtnOn(active, false);
    }
    if (!hold && active === pool) {
      clearAll();
      return;
    }
    if (!inject(pool, hz())) return;
    applyBoost(pool);
    active = pool;
    setBtnOn(pool, true);
    const g = boostG();
    log(`inject ${pool} @ ${hz()} Hz${g > 1.01 ? ` · boost×${g}` : ""} → LIF → MNs → cube`);
  }

  for (const pool of STIM_MAP_POOLS) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = pool;
    b.dataset.pool = pool;
    b.title = `Inject ${pool} (hold or toggle)`;
    b.addEventListener("pointerdown", (ev) => {
      if (pulsing) return;
      ev.preventDefault();
      holdPool = pool;
      activate(pool, { hold: true });
      try { b.setPointerCapture(ev.pointerId); } catch (_) {}
    });
    b.addEventListener("pointerup", () => {
      if (pulsing) return;
      if (holdPool === pool) {
        // release → keep toggled on (causal observation); click again to clear
        holdPool = null;
      }
    });
    b.addEventListener("pointercancel", () => {
      if (holdPool === pool) {
        inject(pool, 0);
        setBtnOn(pool, false);
        if (active === pool) active = null;
        holdPool = null;
        fly()?.clearLesion?.();
        log(`released ${pool}`);
      }
    });
    // secondary: click without hold still toggles via pointerdown path
    poolBtns.appendChild(b);
    btnByPool[pool] = b;
  }

  hzIn.oninput = () => {
    hzVal.textContent = String(hz());
    if (active) inject(active, hz());
  };
  boostIn.oninput = () => {
    boostVal.textContent = String(boostG());
    if (active) applyBoost(active);
  };
  el.querySelector("#stimClear").onclick = () => clearAll();
  el.querySelector("#stimPulseOne").onclick = async () => {
    const pool = active || STIM_MAP_POOLS[0];
    await pulsePool(pool);
  };
  el.querySelector("#stimPulseAll").onclick = async () => {
    if (pulsing) return;
    pulsing = true;
    tbody.innerHTML = "";
    log("pulsing all pools…");
    for (const pool of STIM_MAP_POOLS) {
      const row = await pulsePool(pool, { silent: true });
      appendRow(row);
    }
    pulsing = false;
    clearAll();
    log("pulse-all done — compare peak fwd vs yaw (L/R)");
  };

  function classify(peakFwd, peakYaw, signedYaw) {
    const ay = Math.abs(peakYaw);
    if (ay >= 0.18 && ay >= peakFwd * 0.55) {
      return signedYaw >= 0 ? "RIGHT" : "LEFT";
    }
    if (peakFwd >= 0.12) return "FORWARD";
    if (ay >= 0.08) return signedYaw >= 0 ? "right?" : "left?";
    return "weak";
  }

  function sampleChassis(f) {
    const snap = portableControls(f);
    const set = chassisSetpoints(snap, { vGain: 2.35, yawGain: 9.4 });
    return {
      forward: snap.steering?.forward ?? 0,
      yawRate: snap.steering?.yawRate ?? 0,
      v: set.v ?? 0,
      omega: set.omega ?? 0,
    };
  }

  async function pulsePool(pool, { silent = false, ms = 1500 } = {}) {
    const f = fly();
    if (!f?.ready) {
      log("fly not ready");
      return { pool, peakFwd: 0, peakYaw: 0, signedYaw: 0, hint: "n/a" };
    }
    clearAll();
    await sleep(180);
    if (!inject(pool, hz())) {
      return { pool, peakFwd: 0, peakYaw: 0, signedYaw: 0, hint: "missing" };
    }
    applyBoost(pool);
    active = pool;
    setBtnOn(pool, true);
    let peakFwd = 0;
    let peakYaw = 0;
    let signedYaw = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      const s = sampleChassis(f);
      if (s.forward > peakFwd) peakFwd = s.forward;
      if (Math.abs(s.yawRate) > peakYaw) {
        peakYaw = Math.abs(s.yawRate);
        signedYaw = s.yawRate;
      }
      await sleep(40);
    }
    inject(pool, 0);
    setBtnOn(pool, false);
    active = null;
    f.clearLesion?.();
    const hint = classify(peakFwd, peakYaw, signedYaw);
    const row = { pool, peakFwd, peakYaw, signedYaw, hint };
    if (!silent) {
      appendRow(row);
      log(`pulse ${pool}: fwd=${peakFwd.toFixed(2)} yaw=${signedYaw.toFixed(2)} → ${hint}`);
    }
    return row;
  }

  function appendRow(row) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${row.pool}</td><td>${row.peakFwd.toFixed(2)}</td><td>${row.signedYaw.toFixed(2)}</td><td>${row.hint}</td>`;
    tbody.appendChild(tr);
  }

  // live readouts
  let raf = 0;
  function tick() {
    raf = requestAnimationFrame(tick);
    const f = fly();
    if (!f?.ready) return;
    const s = sampleChassis(f);
    const fwd = el.querySelector("#stimFwd");
    const yaw = el.querySelector("#stimYaw");
    const turn = el.querySelector("#stimTurn");
    const act = el.querySelector("#stimActive");
    if (fwd) fwd.textContent = s.forward.toFixed(2);
    if (yaw) yaw.textContent = s.yawRate.toFixed(2);
    if (turn) {
      const ay = Math.abs(s.yawRate);
      turn.textContent = ay < 0.06 ? "—" : s.yawRate > 0 ? "RIGHT" : "LEFT";
    }
    if (act) act.textContent = active || "off";
    if (active) {
      const ay = Math.abs(s.yawRate);
      const hint = ay < 0.06 ? (s.forward > 0.08 ? "forward" : "quiet") : s.yawRate > 0 ? "yaw RIGHT" : "yaw LEFT";
      // keep log fresh but don't thrash during pulse-all
      if (!pulsing && logEl && !logEl.textContent.startsWith("pulse")) {
        logEl.textContent = `${active} → fwd ${s.forward.toFixed(2)} · yaw ${s.yawRate.toFixed(2)} (${hint})`;
      }
    }
  }
  tick();

  const collapseBtn = el.querySelector(".collapse");
  if (collapseBtn) {
    collapseBtn.onclick = () => {
      el.classList.toggle("collapsed");
      collapseBtn.textContent = el.classList.contains("collapsed") ? "+" : "–";
    };
  }

  el._dispose = () => {
    cancelAnimationFrame(raf);
    clearAll();
  };
  return { el, clearAll, activate, pulsePool };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
