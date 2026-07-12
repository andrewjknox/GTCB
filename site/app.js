/* GTCB dashboard — retro MSX1/TMS9918 static app.
   Loads ./data/plan.json + ./data/summary/* at runtime (all URLs relative).
   Canvas charts, TMS9918 palette only. */
"use strict";

/* ---------- palette (TMS9918 only) ---------- */
const C = {
  black: "#000000",
  medGreen: "#3EB849",
  ltGreen: "#74D07D",
  dkBlue: "#5955E0",
  ltBlue: "#8076F1",
  dkRed: "#B95E51",
  cyan: "#65DBEF",
  medRed: "#DB6559",
  ltRed: "#FF897D",
  dkYellow: "#CCC35E",
  ltYellow: "#DED087",
  dkGreen: "#3AA241",
  magenta: "#B766B5",
  gray: "#CCCCCC",
  white: "#FFFFFF"
};

const PHASE_COLORS = {
  Base: C.medGreen,
  Build: C.ltBlue,
  Peak: C.medRed,
  Taper: C.dkYellow,
  Race: C.magenta
};

/* Race day: Fri 2026-11-13, Europe/London. London is on GMT (UTC+0) in
   November, so midnight local == midnight UTC. */
const RACE_START_UTC_MS = Date.UTC(2026, 10, 13, 0, 0, 0);

const FONT = '11px "Consolas", "Courier New", Courier, monospace';
const FONT_BOLD = 'bold 11px "Consolas", "Courier New", Courier, monospace';

/* ---------- tiny helpers ---------- */
const $ = (id) => document.getElementById(id);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const fmtInt = (v) => Math.round(num(v)).toLocaleString("en-GB");

/* ---------- units (nav.js owns the toggle + persistence) ---------- */
const M_PER_FT = 0.3048;
const M_PER_MI = 1609.344;
const isImperial = () => window.GTCBUnits && window.GTCBUnits.get() === "imperial";
/* vertical: metres or feet */
const vertVal = (m) => (isImperial() ? num(m) / M_PER_FT : num(m));
const fmtVert = (m) => fmtInt(vertVal(m));
const vertUnit = () => (isImperial() ? "ft" : "m");
/* distance: km or miles */
const fmtDist = (m) => (num(m) / (isImperial() ? M_PER_MI : 1000)).toFixed(1);
const distUnit = () => (isImperial() ? "mi" : "km");

function fmtHM(totalS) {
  const s = Math.max(0, Math.round(num(totalS)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h + ":" + String(m).padStart(2, "0");
}

/* ---------- chart metric (vert | time), persisted like the unit toggle ---------- */
const METRIC_KEY = "gtcb-metric";
let metric = (() => {
  try {
    return localStorage.getItem(METRIC_KEY) === "time" ? "time" : "vert";
  } catch (e) {
    return "vert";
  }
})();
const isTime = () => metric === "time";
function setMetric(m) {
  metric = m;
  try { localStorage.setItem(METRIC_KEY, m); } catch (e) { /* in-memory only */ }
}

/* ToF target: plan.json keeps a [min,max] hours range, but THE target is the
   upper bound — collapse to a single value at display time ("7h", "2.5h") */
function fmtTofTarget(t) {
  return num(t[1]) + "h";
}

function statusClass(pct) {
  if (pct >= 100) return "ok";
  if (pct >= 70) return "warn";
  return "bad";
}

/* ---------- data loading (relative fetch, index-driven) ---------- */
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + " -> HTTP " + res.status);
  return res.json();
}

async function loadAllFetch() {
  const [plan, index] = await Promise.all([
    fetchJSON("./data/plan.json"),
    fetchJSON("./data/summary/index.json")
  ]);
  const weekIds = Array.isArray(index.weeks) ? index.weeks.slice().sort() : [];
  const summaries = await Promise.all(
    weekIds.map((w) => fetchJSON("./data/summary/" + w + ".json"))
  );
  const byIso = {};
  for (const s of summaries) byIso[s.iso_week] = s;
  return { plan, weekIds, byIso };
}

/* inline copy baked into ./data.js by the build — same shape as the fetch path */
function loadAllInline() {
  const d = window.GTCB_DATA;
  const weekIds = Array.isArray(d.index.weeks) ? d.index.weeks.slice().sort() : [];
  return { plan: d.plan, weekIds, byIso: d.summaries || {} };
}

async function loadAll() {
  const hasInline = typeof window.GTCB_DATA === "object" && window.GTCB_DATA !== null;
  /* file://: relative fetch fails, go straight to inline. Hosted: fetch first
     so fresh JSON always wins; inline is only a fallback. */
  if (location.protocol === "file:" && hasInline) return loadAllInline();
  try {
    return await loadAllFetch();
  } catch (err) {
    if (hasInline) return loadAllInline();
    throw err;
  }
}

/* ---------- countdown ---------- */
function startCountdown() {
  const el = $("countdown-value");
  const tick = () => {
    const diff = RACE_START_UTC_MS - Date.now();
    if (diff <= 0) {
      el.textContent = "RACE DAY!";
      el.classList.add("race-on");
      return;
    }
    const totalS = Math.floor(diff / 1000);
    const d = Math.floor(totalS / 86400);
    const h = Math.floor((totalS % 86400) / 3600);
    const m = Math.floor((totalS % 3600) / 60);
    const s = totalS % 60;
    el.textContent =
      d + "d " +
      String(h).padStart(2, "0") + ":" +
      String(m).padStart(2, "0") + ":" +
      String(s).padStart(2, "0");
  };
  tick();
  setInterval(tick, 1000);
}

/* ---------- hero panel (metric-aware: VERT or TIME headline) ---------- */
function renderHero(state) {
  const cur = state.current;
  const timeMode = isTime();
  const vert = cur.vert || {};
  const tofActualS = cur.time_on_feet ? num(cur.time_on_feet.actual_s) : 0;
  const daysElapsed = num(cur.days_elapsed);
  const daysLeft = Math.max(0, 7 - daysElapsed);

  /* plan week for the current summary — source of the single ToF target */
  const planWk = (state.plan.weeks || []).find(
    (w) => w.iso_week === cur.iso_week || num(w.week) === num(cur.training_week)
  );
  const tofTargetH = planWk && Array.isArray(planWk.tof_target_h)
    ? num(planWk.tof_target_h[1])
    : null;

  $("hero-title").textContent = "WEEK " + num(cur.training_week) + " · " + (cur.iso_week || "");
  const badge = $("hero-badge");
  badge.textContent = cur.phase || "?";
  badge.style.background = PHASE_COLORS[cur.phase] || C.gray;

  const vs = $("hero-vs");
  const bar = $("progress-bar");

  // chunky segmented progress bar vs full-week target (20 segments = 5% each),
  // colour-coded by pace status (pro-rated)
  const fillBar = (pctFull, cls) => {
    bar.innerHTML = "";
    const filled = Math.min(20, Math.round(Math.min(pctFull, 100) / 5));
    for (let i = 0; i < 20; i++) {
      const seg = document.createElement("span");
      seg.className = "seg" + (i < filled ? " fill-" + (pctFull >= 100 ? "over" : cls) : "");
      bar.appendChild(seg);
    }
  };

  if (timeMode && tofTargetH === null) {
    /* race week has no ToF target — actual only; no compare/pct/bar/to-go */
    $("hero-actual").textContent = fmtHM(tofActualS);
    $("hero-unit").textContent = "h:mm";
    vs.classList.add("hidden");
    $("hero-pct").innerHTML = "";
    bar.innerHTML = "";
    bar.classList.add("hidden");
    bar.setAttribute("aria-label",
      "Week-to-date time on feet " + fmtHM(tofActualS) + " h:mm, no time target this week");
    $("hero-secondary").innerHTML = "";
  } else if (timeMode) {
    const targetS = tofTargetH * 3600;
    const pctFull = targetS > 0 ? (tofActualS / targetS) * 100 : 0;
    /* pace status vs the pro-rated share of the week, like vert's pct_of_prorated */
    const proratedS = (targetS * daysElapsed) / 7;
    const pctPro = proratedS > 0 ? (tofActualS / proratedS) * 100 : 100;
    const cls = statusClass(pctPro);

    $("hero-actual").textContent = fmtHM(tofActualS);
    $("hero-unit").textContent = "h:mm";
    vs.classList.remove("hidden");
    $("hero-prorated").textContent = String(tofTargetH);
    $("hero-vs-unit").textContent = "h";

    $("hero-pct").innerHTML =
      '<span class="' + cls + '">' + fmtInt(pctFull) + "% OF WEEK TARGET</span>";

    bar.classList.remove("hidden");
    fillBar(pctFull, cls);
    bar.setAttribute("aria-label",
      "Week-to-date time on feet " + fmtHM(tofActualS) + " h:mm, " + fmtInt(pctFull) + "% of week target");

    const remainS = targetS - tofActualS;
    $("hero-secondary").innerHTML = remainS > 0
      ? "<strong>" + fmtHM(remainS) + "</strong> TO GO · " + daysLeft + (daysLeft === 1 ? " DAY" : " DAYS") + " LEFT"
      : "TARGET HIT ▲ · <strong>+" + fmtHM(tofActualS - targetS) + "</strong> OVER";
  } else {
    const actual = num(vert.actual_m);
    const target = num(vert.target_m);
    const pctPro = num(vert.pct_of_prorated);
    const pctFull = num(vert.pct_of_target);
    const cls = statusClass(pctPro);

    $("hero-actual").textContent = fmtVert(actual);
    $("hero-unit").textContent = vertUnit();
    vs.classList.remove("hidden");
    $("hero-prorated").textContent = fmtVert(target);
    $("hero-vs-unit").textContent = vertUnit();

    $("hero-pct").innerHTML =
      '<span class="' + cls + '">' + fmtInt(pctFull) + "% OF WEEK TARGET</span>";

    bar.classList.remove("hidden");
    fillBar(pctFull, cls);
    bar.setAttribute("aria-label",
      "Week-to-date vert " + fmtVert(actual) + " " + vertUnit() + ", " + fmtInt(pctFull) + "% of week target");

    const remaining = Math.max(0, target - actual);
    $("hero-secondary").innerHTML = remaining > 0
      ? "<strong>" + fmtVert(remaining) + vertUnit() + "</strong> TO GO · " + daysLeft + (daysLeft === 1 ? " DAY" : " DAYS") + " LEFT"
      : "TARGET HIT ▲ · <strong>+" + fmtVert(actual - target) + vertUnit() + "</strong> OVER";
  }

  /* stats row — the first stat swaps with the big number per mode */
  const statFirst = $("stat-time");
  const statFirstLabel = statFirst.parentElement.querySelector("dt");
  if (timeMode) {
    statFirstLabel.textContent = "VERT";
    statFirst.innerHTML = fmtVert(vert.actual_m) + " <small>" + vertUnit() + "</small>";
  } else {
    statFirstLabel.textContent = "TIME ON FEET";
    statFirst.innerHTML = fmtHM(tofActualS) + " <small>h:mm</small>";
  }
  const dist = cur.distance || {};
  const sess = cur.sessions || {};
  $("stat-dist").innerHTML = fmtDist(dist.actual_m) + " <small>" + distUnit() + "</small>";
  $("stat-sessions").innerHTML =
    num(sess.on_foot_count) + "/" + num(sess.count) + " <small>on foot</small>";
  $("stat-days").innerHTML = daysElapsed + " <small>of 7</small>";

  $("hero").classList.remove("hidden");
}

/* ---------- tooltip plumbing (shared by both canvases) ---------- */
const tooltip = { el: null };

function attachTooltip(canvas, hitRegions) {
  // hit regions are swapped on every redraw (resize, unit toggle); listeners bind once
  canvas._hits = hitRegions;
  if (canvas._tooltipBound) return;
  canvas._tooltipBound = true;
  const show = (evt) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((evt.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((evt.clientY - rect.top) / rect.height) * canvas.height;
    const hit = canvas._hits.find(
      (r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
    );
    if (hit) {
      tooltip.el.textContent = hit.text;
      tooltip.el.classList.remove("hidden");
      const pad = 14;
      let tx = evt.clientX + pad;
      let ty = evt.clientY + pad;
      const tw = tooltip.el.offsetWidth;
      const th = tooltip.el.offsetHeight;
      if (tx + tw > window.innerWidth - 8) tx = evt.clientX - tw - pad;
      if (ty + th > window.innerHeight - 8) ty = evt.clientY - th - pad;
      /* clamp fully on-screen — narrow viewports can otherwise push it off either edge */
      tx = Math.max(8, Math.min(tx, window.innerWidth - tw - 8));
      ty = Math.max(8, Math.min(ty, window.innerHeight - th - 8));
      tooltip.el.style.left = tx + "px";
      tooltip.el.style.top = ty + "px";
    } else {
      tooltip.el.classList.add("hidden");
    }
  };
  canvas.addEventListener("mousemove", show);
  canvas.addEventListener("mouseleave", () => tooltip.el.classList.add("hidden"));
}

/* touch taps show tooltips via synthetic mousemove but never fire mouseleave:
   the fixed-position tip would stay glued to the viewport while the page scrolls */
window.addEventListener(
  "scroll",
  () => { if (tooltip.el) tooltip.el.classList.add("hidden"); },
  { passive: true, capture: true }
);

/* ---------- build chart (23 weeks, actual vs target outline) ---------- */
function drawBuildChart(state) {
  const canvas = $("build-chart");
  const cssW = canvas.parentElement.clientWidth;
  canvas.width = Math.max(320, cssW);
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext("2d");
  const timeMode = isTime();
  canvas.setAttribute("aria-label", timeMode
    ? "Weekly time on feet versus target, training weeks 1 to 23"
    : "Weekly vertical gain versus target, training weeks 1 to 23");

  const weeks = state.plan.weeks;
  const curTW = num(state.current.training_week);

  const mL = 46, mR = 8, mT = 12, mB = 40;
  const plotW = W - mL - mR;
  const plotH = H - mT - mB;

  // axis works in display units (m / ft / hours) so gridlines land on round numbers
  let gridStep;
  let maxY = 0;
  if (timeMode) {
    for (const wk of weeks) {
      if (Array.isArray(wk.tof_target_h)) maxY = Math.max(maxY, num(wk.tof_target_h[1]));
      const s = state.byIso[wk.iso_week];
      if (s && s.time_on_feet) maxY = Math.max(maxY, num(s.time_on_feet.actual_s) / 3600);
    }
    // whole-hour step sized so ~4–7 gridlines show
    gridStep = 1;
    while (maxY / gridStep > 7) gridStep += 1;
  } else {
    gridStep = isImperial() ? 2000 : 500;
    for (const wk of weeks) {
      maxY = Math.max(maxY, vertVal(wk.vert_target_m));
      const s = state.byIso[wk.iso_week];
      if (s && s.vert) maxY = Math.max(maxY, vertVal(s.vert.actual_m));
    }
  }
  maxY = Math.max(gridStep, Math.ceil(maxY / gridStep) * gridStep);
  const yOf = (v) => mT + plotH - (num(v) / maxY) * plotH;

  ctx.fillStyle = C.black;
  ctx.fillRect(0, 0, W, H);

  // gridlines every 500 m / 2000 ft (vert) or every whole hours step (time)
  ctx.font = FONT;
  ctx.textBaseline = "middle";
  for (let v = 0; v <= maxY; v += gridStep) {
    const y = Math.round(yOf(v)) + 0.5;
    ctx.strokeStyle = C.dkBlue;
    ctx.globalAlpha = v === 0 ? 1 : 0.4;
    ctx.beginPath();
    ctx.moveTo(mL, y);
    ctx.lineTo(W - mR, y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.ltBlue;
    ctx.textAlign = "right";
    ctx.fillText(String(v), mL - 5, y);
  }

  const slotW = plotW / weeks.length;
  const barW = Math.max(4, Math.floor(slotW * 0.62));
  const hits = [];
  const labelStep = slotW >= 24 ? 1 : slotW >= 13 ? 2 : 4;

  weeks.forEach((wk, i) => {
    const x = mL + i * slotW + (slotW - barW) / 2;
    const s = state.byIso[wk.iso_week];
    const color = PHASE_COLORS[wk.phase] || C.gray;
    const isCur = wk.week === curTW;
    let text = "W" + wk.week + " · " + wk.phase.toUpperCase() + " · " + wk.iso_week;

    if (timeMode) {
      const tof = Array.isArray(wk.tof_target_h) ? wk.tof_target_h : null;
      const actualS = s && s.time_on_feet ? num(s.time_on_feet.actual_s) : null;
      const actualH = actualS === null ? null : actualS / 3600;

      // actual: solid phase-colored fill
      if (actualH !== null && actualH > 0) {
        ctx.fillStyle = color;
        const yA = yOf(actualH);
        ctx.fillRect(Math.round(x), Math.round(yA), barW, Math.round(yOf(0) - yA));
      }

      // target: hollow outline to the single target (upper bound of the plan range)
      if (tof) {
        ctx.strokeStyle = isCur ? C.white : C.gray;
        ctx.lineWidth = 1;
        const yT = Math.round(yOf(num(tof[1]))) + 0.5;
        ctx.strokeRect(Math.round(x) + 0.5, yT, barW - 1, Math.round(yOf(0)) - yT);
      }

      // current week: pro-rated pace tick (target × days elapsed / 7) + white marker
      if (isCur && s && tof) {
        const paceS = num(tof[1]) * 3600 * num(s.days_elapsed) / 7;
        const yP = Math.round(yOf(paceS / 3600)) + 0.5;
        ctx.strokeStyle = C.cyan;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 3, yP);
        ctx.lineTo(x + barW + 3, yP);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = C.white;
        ctx.textAlign = "center";
        ctx.font = FONT_BOLD;
        ctx.fillText("▼", x + barW / 2, Math.min(yOf(num(tof[1])), yOf(actualH || 0)) - 10);
        ctx.font = FONT;
      }

      if (actualH !== null) {
        text += "\nTOF " + fmtHM(actualS) + (tof ? " / " + fmtTofTarget(tof) : "");
        if (isCur && tof) {
          const paceS = num(tof[1]) * 3600 * num(s.days_elapsed) / 7;
          text += "\nIN PROGRESS · PACE LINE " + fmtHM(paceS) + " h:mm";
        }
      } else if (tof) {
        text += "\nTARGET " + fmtTofTarget(tof) + " · NO DATA YET";
      } else {
        text += "\nNO TOF TARGET";
      }
    } else {
      const target = num(wk.vert_target_m);
      const actual = s && s.vert ? num(s.vert.actual_m) : null;

      // actual: solid phase-colored fill
      if (actual !== null && actual > 0) {
        ctx.fillStyle = color;
        const yA = yOf(vertVal(actual));
        ctx.fillRect(Math.round(x), Math.round(yA), barW, Math.round(yOf(0) - yA));
      }

      // target: hollow outline drawn on top so it stays visible when exceeded
      ctx.strokeStyle = isCur ? C.white : C.gray;
      ctx.lineWidth = 1;
      const yT = Math.round(yOf(vertVal(target))) + 0.5;
      ctx.strokeRect(Math.round(x) + 0.5, yT, barW - 1, Math.round(yOf(0)) - yT);

      // current week: pro-rated pace tick in cyan + white marker above
      if (isCur && s && s.vert) {
        const yP = Math.round(yOf(vertVal(s.vert.prorated_target_m))) + 0.5;
        ctx.strokeStyle = C.cyan;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 3, yP);
        ctx.lineTo(x + barW + 3, yP);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = C.white;
        ctx.textAlign = "center";
        ctx.font = FONT_BOLD;
        ctx.fillText("▼", x + barW / 2, Math.min(yOf(vertVal(target)), yOf(vertVal(actual))) - 10);
        ctx.font = FONT;
      }

      if (actual !== null) {
        const pct = s.vert ? num(s.vert.pct_of_target) : 0;
        text += "\nVERT " + fmtVert(actual) + " / " + fmtVert(target) + " " + vertUnit() + " (" + pct + "%)";
        if (isCur) text += "\nIN PROGRESS · PACE LINE " + fmtVert(s.vert.prorated_target_m) + " " + vertUnit();
      } else {
        text += "\nTARGET " + fmtVert(target) + " " + vertUnit() + " · NO DATA YET";
      }
    }

    // x labels
    if (wk.week % labelStep === 0 || wk.week === 1 || isCur) {
      ctx.fillStyle = isCur ? C.white : C.gray;
      ctx.textAlign = "center";
      ctx.fillText(String(wk.week), x + barW / 2, H - mB + 10);
    }

    if (wk.notes) text += "\n[" + wk.notes.toUpperCase() + "]";
    hits.push({ x: mL + i * slotW, y: mT, w: slotW, h: plotH, text });
  });

  // phase strip along the bottom
  let i0 = 0;
  while (i0 < weeks.length) {
    let i1 = i0;
    while (i1 + 1 < weeks.length && weeks[i1 + 1].phase === weeks[i0].phase) i1++;
    const x0 = mL + i0 * slotW;
    const x1 = mL + (i1 + 1) * slotW;
    const phase = weeks[i0].phase;
    ctx.fillStyle = PHASE_COLORS[phase] || C.gray;
    ctx.fillRect(Math.round(x0), H - mB + 18, Math.round(x1 - x0) - 2, 4);
    const label = phase.toUpperCase();
    if (ctx.measureText(label).width < x1 - x0 - 4) {
      ctx.textAlign = "center";
      ctx.fillText(label, (x0 + x1) / 2, H - mB + 32);
    }
    i0 = i1 + 1;
  }

  attachTooltip(canvas, hits);
}

function renderLegend(plan) {
  const ul = $("phase-legend");
  ul.innerHTML = "";
  const seen = [];
  for (const wk of plan.weeks) {
    if (!seen.includes(wk.phase)) seen.push(wk.phase);
  }
  for (const p of seen) {
    const li = document.createElement("li");
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = PHASE_COLORS[p] || C.gray;
    li.appendChild(sw);
    li.appendChild(document.createTextNode(p.toUpperCase()));
    ul.appendChild(li);
  }
  const li = document.createElement("li");
  li.innerHTML = '<span class="swatch outline"></span>TARGET';
  ul.appendChild(li);
}

function renderBuildTable(state) {
  if (isTime()) {
    renderBuildTableTime(state);
    return;
  }
  $("th-target").textContent = "TARGET " + vertUnit();
  $("th-actual").textContent = "ACTUAL " + vertUnit();
  $("th-status").textContent = "%";
  const tbody = $("build-table").querySelector("tbody");
  tbody.innerHTML = "";
  for (const wk of state.plan.weeks) {
    const s = state.byIso[wk.iso_week];
    const tr = document.createElement("tr");
    if (wk.week === num(state.current.training_week)) tr.className = "current";
    const actual = s && s.vert ? fmtVert(s.vert.actual_m) : "—";
    const pct = s && s.vert ? fmtInt(s.vert.pct_of_target) + "%" : "—";
    tr.innerHTML =
      "<td>" + wk.week + "</td>" +
      '<td class="left">' + wk.iso_week + "</td>" +
      '<td class="left">' + wk.phase + "</td>" +
      "<td>" + fmtVert(wk.vert_target_m) + "</td>" +
      "<td>" + actual + "</td>" +
      "<td>" + pct + "</td>";
    tbody.appendChild(tr);
  }
}

/* time-on-feet table: single target ("7h" — the plan range's upper bound),
   actual h:mm, and a status glyph vs that target — no derived percentages
   (concrete units only) */
function renderBuildTableTime(state) {
  $("th-target").textContent = "TARGET";
  $("th-actual").textContent = "ACTUAL h:mm";
  $("th-status").textContent = "VS";
  const tbody = $("build-table").querySelector("tbody");
  tbody.innerHTML = "";
  const curTW = num(state.current.training_week);
  for (const wk of state.plan.weeks) {
    const s = state.byIso[wk.iso_week];
    const tr = document.createElement("tr");
    if (wk.week === curTW) tr.className = "current";
    const tof = Array.isArray(wk.tof_target_h) ? wk.tof_target_h : null;
    const target = tof ? fmtTofTarget(tof) : "—";
    const actualS = s && s.time_on_feet ? num(s.time_on_feet.actual_s) : null;
    const actual = actualS !== null ? fmtHM(actualS) : "—";
    let status = "—";
    if (actualS !== null && tof) {
      if (actualS / 3600 >= num(tof[1])) {
        status = '<span class="ok">✓</span>';
      } else {
        // in-progress week below target is expected mid-week -> warn, not bad
        status = '<span class="' + (wk.week === curTW ? "warn" : "bad") + '">▼</span>';
      }
    }
    tr.innerHTML =
      "<td>" + wk.week + "</td>" +
      '<td class="left">' + wk.iso_week + "</td>" +
      '<td class="left">' + wk.phase + "</td>" +
      "<td>" + target + "</td>" +
      "<td>" + actual + "</td>" +
      "<td>" + status + "</td>";
    tbody.appendChild(tr);
  }
}

/* ---------- daily strip (current week, Mon–Sun) ---------- */
function drawDailyChart(state) {
  const canvas = $("daily-chart");
  const cssW = canvas.parentElement.clientWidth;
  canvas.width = Math.max(280, cssW);
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext("2d");
  const timeMode = isTime();
  canvas.setAttribute("aria-label", timeMode
    ? "Time on feet per day, Monday to Sunday, current week"
    : "Vertical gain per day, Monday to Sunday, current week");

  const cur = state.current;
  const days = Array.isArray(cur.daily) ? cur.daily : [];
  const elapsed = num(cur.days_elapsed);
  const color = PHASE_COLORS[cur.phase] || C.gray;
  const names = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

  const mL = 8, mR = 8, mT = 22, mB = 24;
  const plotH = H - mT - mB;
  const slotW = (W - mL - mR) / 7;
  const barW = Math.max(6, Math.floor(slotW * 0.55));

  let maxY;
  if (timeMode) {
    maxY = 1; // hours — 1h floor so a 30-min day doesn't fill the chart
    for (const d of days) maxY = Math.max(maxY, num(d.time_s) / 3600);
    maxY = Math.ceil(maxY * 2) / 2; // half-hour headroom rounding
  } else {
    maxY = isImperial() ? 330 : 100; // same floor ≈100 m either way
    for (const d of days) maxY = Math.max(maxY, vertVal(d.vert_m));
    maxY = Math.ceil(maxY / 100) * 100;
  }
  const yOf = (v) => mT + plotH - (num(v) / maxY) * plotH;

  ctx.fillStyle = C.black;
  ctx.fillRect(0, 0, W, H);
  ctx.font = FONT;

  // baseline
  ctx.strokeStyle = C.dkBlue;
  ctx.beginPath();
  ctx.moveTo(mL, Math.round(yOf(0)) + 0.5);
  ctx.lineTo(W - mR, Math.round(yOf(0)) + 0.5);
  ctx.stroke();

  const hits = [];
  for (let i = 0; i < 7; i++) {
    const d = days[i] || { date: "", vert_m: 0, time_s: 0, distance_m: 0 };
    const v = timeMode ? num(d.time_s) : num(d.vert_m);
    const x = mL + i * slotW + (slotW - barW) / 2;
    const isFuture = i >= elapsed;

    if (v > 0) {
      ctx.fillStyle = color;
      const yV = yOf(timeMode ? v / 3600 : vertVal(v));
      ctx.fillRect(Math.round(x), Math.round(yV), barW, Math.round(yOf(0) - yV));
      ctx.fillStyle = C.white;
      ctx.textAlign = "center";
      ctx.font = FONT_BOLD;
      ctx.fillText(timeMode ? fmtHM(v) : fmtVert(v), x + barW / 2, yV - 9);
      ctx.font = FONT;
    } else if (isFuture) {
      // future day: hollow gray placeholder block on the baseline
      ctx.strokeStyle = C.gray;
      ctx.globalAlpha = 0.45;
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(yOf(0)) - 6.5, barW - 1, 6);
      ctx.globalAlpha = 1;
    } else {
      // elapsed rest day
      ctx.fillStyle = C.gray;
      ctx.textAlign = "center";
      ctx.fillText("·", x + barW / 2, yOf(0) - 8);
    }

    ctx.fillStyle = isFuture ? C.dkBlue : i >= 5 ? C.cyan : C.gray;
    ctx.textAlign = "center";
    ctx.fillText(names[i], mL + i * slotW + slotW / 2, H - 8);

    let text = names[i] + (d.date ? " " + d.date : "");
    if (isFuture) text += "\nUPCOMING";
    else if (num(d.vert_m) <= 0 && num(d.time_s) <= 0) text += "\nREST DAY";
    else {
      text += "\nVERT " + fmtVert(d.vert_m) + " " + vertUnit();
      text += "\n" + fmtHM(d.time_s) + " h:mm · " + fmtDist(d.distance_m) + " " + distUnit();
    }
    hits.push({ x: mL + i * slotW, y: mT, w: slotW, h: plotH + 4, text });
  }

  attachTooltip(canvas, hits);
}

/* ---------- flags ---------- */
function renderFlags(state) {
  const body = $("flags-body");
  body.innerHTML = "";
  const cur = state.current;
  const curFlags = Array.isArray(cur.flags) ? cur.flags : [];

  const addFlag = (flag, isoWeek, past) => {
    const type = String(flag.type || "anomaly");
    const div = document.createElement("div");
    div.className = "flag " + type.replace(/[^a-z_]/gi, "") + (past ? " past" : "");
    const badge = document.createElement("span");
    badge.className = "flag-type";
    badge.textContent = type === "calf" ? "⚠ CALF" : type.replace(/_/g, " ").toUpperCase();
    const wk = document.createElement("span");
    wk.className = "flag-week";
    wk.textContent = isoWeek;
    const detail = document.createElement("span");
    detail.className = "flag-detail";
    detail.textContent = String(flag.detail || "");
    div.appendChild(badge);
    div.appendChild(wk);
    div.appendChild(detail);
    body.appendChild(div);
  };

  if (curFlags.length === 0) {
    const clear = document.createElement("p");
    clear.className = "all-clear";
    clear.textContent = "ALL CLEAR";
    body.appendChild(clear);
  } else {
    for (const f of curFlags) addFlag(f, cur.iso_week, false);
  }

  // earlier weeks' flags, newest first (left-calf rehab must stay visible)
  const earlier = [];
  for (const wid of state.weekIds.slice().reverse()) {
    if (wid === cur.iso_week) continue;
    const s = state.byIso[wid];
    if (s && Array.isArray(s.flags)) {
      for (const f of s.flags) earlier.push([f, wid]);
    }
  }
  if (earlier.length > 0) {
    const note = document.createElement("p");
    note.className = "flags-note";
    note.textContent = "EARLIER:";
    body.appendChild(note);
    for (const [f, wid] of earlier) addFlag(f, wid, true);
  }
}

/* ---------- footer ---------- */
function renderFooter(cur) {
  const win = cur.window || {};
  $("footer-meta").textContent =
    "GENERATED " + (cur.generated_at || "?") +
    " · WINDOW " + String(win.start || "?").slice(0, 10) +
    " → " + String(win.end || "?").slice(0, 10) +
    " (" + (win.tz || "Europe/London") + ")";
  $("site-footer").classList.remove("hidden");
}

/* ---------- metric toggle (▲ VERT | ⏱ TIME) — page-level mode in the hero
   head, one shared state for hero + build chart + build table + daily strip ---------- */
function initMetricToggle(state) {
  const btnVert = $("metric-vert");
  const btnTime = $("metric-time");
  const apply = () => {
    btnVert.classList.toggle("active", !isTime());
    btnVert.setAttribute("aria-pressed", String(!isTime()));
    btnTime.classList.toggle("active", isTime());
    btnTime.setAttribute("aria-pressed", String(isTime()));
    $("daily-title").textContent = "THIS WEEK · DAILY " + (isTime() ? "TIME" : "VERT");
  };
  const flip = (m) => {
    if (m === metric) return;
    setMetric(m);
    apply();
    renderHero(state);
    drawBuildChart(state);
    renderBuildTable(state);
    drawDailyChart(state);
  };
  btnVert.addEventListener("click", () => flip("vert"));
  btnTime.addEventListener("click", () => flip("time"));
  apply();
}

/* ---------- boot ---------- */
async function main() {
  startCountdown();
  tooltip.el = $("tooltip");
  let state;
  try {
    const { plan, weekIds, byIso } = await loadAll();
    const latestId = weekIds[weekIds.length - 1];
    const current = byIso[latestId];
    if (!current) throw new Error("no summary for newest week " + latestId);
    state = { plan, weekIds, byIso, current };
  } catch (err) {
    const boot = $("boot-msg");
    boot.textContent = "DATA LOAD ERROR: " + err.message;
    boot.classList.add("error");
    return;
  }

  $("boot-msg").classList.add("hidden");
  initMetricToggle(state);
  renderHero(state);
  renderLegend(state.plan);
  drawBuildChart(state);
  renderBuildTable(state);
  drawDailyChart(state);
  renderFlags(state);
  renderFooter(state.current);
  $("build-panel").classList.remove("hidden");
  $("daily-panel").classList.remove("hidden");
  $("flags-panel").classList.remove("hidden");

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      drawBuildChart(state);
      drawDailyChart(state);
    }, 120);
  });

  // nav.js unit toggle — re-render everything that shows a number
  window.addEventListener("gtcb:units", () => {
    renderHero(state);
    drawBuildChart(state);
    renderBuildTable(state);
    drawDailyChart(state);
  });
}

main();
