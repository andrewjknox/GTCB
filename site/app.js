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
const fmtKm = (m) => (num(m) / 1000).toFixed(1);

function fmtHM(totalS) {
  const s = Math.max(0, Math.round(num(totalS)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h + ":" + String(m).padStart(2, "0");
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

async function loadAll() {
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

/* ---------- hero panel ---------- */
function renderHero(cur) {
  const vert = cur.vert || {};
  const actual = num(vert.actual_m);
  const target = num(vert.target_m);
  const prorated = num(vert.prorated_target_m);
  const pctPro = num(vert.pct_of_prorated);
  const pctFull = num(vert.pct_of_target);

  $("hero-title").textContent = "WEEK " + num(cur.training_week) + " · " + (cur.iso_week || "");
  const badge = $("hero-badge");
  badge.textContent = cur.phase || "?";
  badge.style.background = PHASE_COLORS[cur.phase] || C.gray;

  $("hero-actual").textContent = fmtInt(actual);
  $("hero-prorated").textContent = fmtInt(target);

  const cls = statusClass(pctPro);
  $("hero-pct").innerHTML =
    '<span class="' + cls + '">' + fmtInt(pctFull) + "% OF WEEK TARGET</span>";

  // chunky segmented progress bar vs full-week target (20 segments = 5% each),
  // colour-coded by pace status (pro-rated)
  const bar = $("progress-bar");
  bar.innerHTML = "";
  bar.setAttribute("aria-label",
    "Week-to-date vert " + fmtInt(actual) + " m, " + fmtInt(pctFull) + "% of week target");
  const filled = Math.min(20, Math.round(Math.min(pctFull, 100) / 5));
  for (let i = 0; i < 20; i++) {
    const seg = document.createElement("span");
    seg.className = "seg" + (i < filled ? " fill-" + (pctFull >= 100 ? "over" : cls) : "");
    bar.appendChild(seg);
  }

  const remaining = Math.max(0, target - actual);
  const daysLeft = Math.max(0, 7 - num(cur.days_elapsed));
  $("hero-secondary").innerHTML = remaining > 0
    ? "<strong>" + fmtInt(remaining) + "m</strong> TO GO · " + daysLeft + (daysLeft === 1 ? " DAY" : " DAYS") + " LEFT"
    : "TARGET HIT ▲ · <strong>+" + fmtInt(actual - target) + "m</strong> OVER";

  const tof = cur.time_on_feet || {};
  const dist = cur.distance || {};
  const sess = cur.sessions || {};
  $("stat-time").innerHTML = fmtHM(tof.actual_s) + " <small>h:mm</small>";
  $("stat-dist").innerHTML = fmtKm(dist.actual_m) + " <small>km</small>";
  $("stat-sessions").innerHTML =
    num(sess.on_foot_count) + "/" + num(sess.count) + " <small>on foot</small>";
  $("stat-days").innerHTML = num(cur.days_elapsed) + " <small>of 7</small>";

  $("hero").classList.remove("hidden");
}

/* ---------- tooltip plumbing (shared by both canvases) ---------- */
const tooltip = { el: null };

function attachTooltip(canvas, hitRegions) {
  const show = (evt) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((evt.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((evt.clientY - rect.top) / rect.height) * canvas.height;
    const hit = hitRegions.find(
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
      tooltip.el.style.left = tx + "px";
      tooltip.el.style.top = ty + "px";
    } else {
      tooltip.el.classList.add("hidden");
    }
  };
  canvas.addEventListener("mousemove", show);
  canvas.addEventListener("mouseleave", () => tooltip.el.classList.add("hidden"));
}

/* ---------- build chart (23 weeks, actual vs target outline) ---------- */
function drawBuildChart(state) {
  const canvas = $("build-chart");
  const cssW = canvas.parentElement.clientWidth;
  canvas.width = Math.max(320, cssW);
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext("2d");

  const weeks = state.plan.weeks;
  const curTW = num(state.current.training_week);

  const mL = 46, mR = 8, mT = 12, mB = 40;
  const plotW = W - mL - mR;
  const plotH = H - mT - mB;

  let maxY = 0;
  for (const wk of weeks) {
    maxY = Math.max(maxY, num(wk.vert_target_m));
    const s = state.byIso[wk.iso_week];
    if (s && s.vert) maxY = Math.max(maxY, num(s.vert.actual_m));
  }
  maxY = Math.max(500, Math.ceil(maxY / 500) * 500);
  const yOf = (v) => mT + plotH - (num(v) / maxY) * plotH;

  ctx.fillStyle = C.black;
  ctx.fillRect(0, 0, W, H);

  // gridlines every 500 m
  ctx.font = FONT;
  ctx.textBaseline = "middle";
  for (let v = 0; v <= maxY; v += 500) {
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
    const target = num(wk.vert_target_m);
    const s = state.byIso[wk.iso_week];
    const actual = s && s.vert ? num(s.vert.actual_m) : null;
    const color = PHASE_COLORS[wk.phase] || C.gray;
    const isCur = wk.week === curTW;

    // actual: solid phase-colored fill
    if (actual !== null && actual > 0) {
      ctx.fillStyle = color;
      const yA = yOf(actual);
      ctx.fillRect(Math.round(x), Math.round(yA), barW, Math.round(yOf(0) - yA));
    }

    // target: hollow outline drawn on top so it stays visible when exceeded
    ctx.strokeStyle = isCur ? C.white : C.gray;
    ctx.lineWidth = 1;
    const yT = Math.round(yOf(target)) + 0.5;
    ctx.strokeRect(Math.round(x) + 0.5, yT, barW - 1, Math.round(yOf(0)) - yT);

    // current week: pro-rated pace tick in cyan + white marker above
    if (isCur && s && s.vert) {
      const yP = Math.round(yOf(num(s.vert.prorated_target_m))) + 0.5;
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
      ctx.fillText("▼", x + barW / 2, Math.min(yOf(target), yOf(actual)) - 10);
      ctx.font = FONT;
    }

    // x labels
    if (wk.week % labelStep === 0 || wk.week === 1 || isCur) {
      ctx.fillStyle = isCur ? C.white : C.gray;
      ctx.textAlign = "center";
      ctx.fillText(String(wk.week), x + barW / 2, H - mB + 10);
    }

    let text = "W" + wk.week + " · " + wk.phase.toUpperCase() + " · " + wk.iso_week;
    if (actual !== null) {
      const pct = s.vert ? num(s.vert.pct_of_target) : 0;
      text += "\nVERT " + fmtInt(actual) + " / " + fmtInt(target) + " m (" + pct + "%)";
      if (isCur) text += "\nIN PROGRESS · PACE LINE " + fmtInt(s.vert.prorated_target_m) + " m";
    } else {
      text += "\nTARGET " + fmtInt(target) + " m · NO DATA YET";
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
  const tbody = $("build-table").querySelector("tbody");
  tbody.innerHTML = "";
  for (const wk of state.plan.weeks) {
    const s = state.byIso[wk.iso_week];
    const tr = document.createElement("tr");
    if (wk.week === num(state.current.training_week)) tr.className = "current";
    const actual = s && s.vert ? fmtInt(s.vert.actual_m) : "—";
    const pct = s && s.vert ? fmtInt(s.vert.pct_of_target) + "%" : "—";
    tr.innerHTML =
      "<td>" + wk.week + "</td>" +
      '<td class="left">' + wk.iso_week + "</td>" +
      '<td class="left">' + wk.phase + "</td>" +
      "<td>" + fmtInt(wk.vert_target_m) + "</td>" +
      "<td>" + actual + "</td>" +
      "<td>" + pct + "</td>";
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

  const cur = state.current;
  const days = Array.isArray(cur.daily) ? cur.daily : [];
  const elapsed = num(cur.days_elapsed);
  const color = PHASE_COLORS[cur.phase] || C.gray;
  const names = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

  const mL = 8, mR = 8, mT = 22, mB = 24;
  const plotH = H - mT - mB;
  const slotW = (W - mL - mR) / 7;
  const barW = Math.max(6, Math.floor(slotW * 0.55));

  let maxY = 100;
  for (const d of days) maxY = Math.max(maxY, num(d.vert_m));
  maxY = Math.ceil(maxY / 100) * 100;
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
    const v = num(d.vert_m);
    const x = mL + i * slotW + (slotW - barW) / 2;
    const isFuture = i >= elapsed;

    if (v > 0) {
      ctx.fillStyle = color;
      const yV = yOf(v);
      ctx.fillRect(Math.round(x), Math.round(yV), barW, Math.round(yOf(0) - yV));
      ctx.fillStyle = C.white;
      ctx.textAlign = "center";
      ctx.font = FONT_BOLD;
      ctx.fillText(fmtInt(v), x + barW / 2, yV - 9);
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
    else if (v <= 0 && num(d.time_s) <= 0) text += "\nREST DAY";
    else {
      text += "\nVERT " + fmtInt(v) + " m";
      text += "\n" + fmtHM(d.time_s) + " h:mm · " + fmtKm(d.distance_m) + " km";
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
  renderHero(state.current);
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
}

main();
