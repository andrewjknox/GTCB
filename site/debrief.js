/* Weekly debrief — plan page. For every completed week that has a report in
   data/reports/ (inlined as GTCB_DATA.reports), the week-number cell becomes a
   button that opens a modal debrief: verdict, stats, daily bars, campaign
   totals, coach's notes. The report file carries ONLY the narrative — every
   number here is computed live from GTCB_DATA.summaries + plan, so later data
   corrections can never strand the prose.

   Units: nav.js's data-units-convert walker only rewrites text present when it
   first runs, so this file owns its own formatting (same helpers as app.js)
   and re-renders the open modal on the "gtcb:units" event. */
(function () {
  "use strict";

  var data = window.GTCB_DATA;
  if (!data || !data.plan || !data.plan.weeks) return;
  var reports = data.reports || {};
  var summaries = data.summaries || {};
  if (Object.keys(reports).length === 0) return;

  var planByIso = {};
  data.plan.weeks.forEach(function (w) { planByIso[w.iso_week] = w; });

  /* ---------- formatting (mirrors app.js; plan.html doesn't load app.js) ---------- */
  var M_PER_FT = 0.3048;
  var M_PER_MI = 1609.344;
  function isImperial() { return window.GTCBUnits && window.GTCBUnits.get() === "imperial"; }
  function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
  function fmtInt(v) { return Math.round(num(v)).toLocaleString("en-GB"); }
  function fmtVert(m) { return fmtInt(isImperial() ? num(m) / M_PER_FT : num(m)); }
  function vertUnit() { return isImperial() ? "ft" : "m"; }
  function fmtDist(m) { return (num(m) / (isImperial() ? M_PER_MI : 1000)).toFixed(1); }
  function distUnit() { return isImperial() ? "mi" : "km"; }
  function fmtHM(totalS) {
    var s = Math.max(0, Math.round(num(totalS)));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    return h + ":" + String(m).padStart(2, "0");
  }
  /* signed vert delta, e.g. "+138 m" / "-240 ft" */
  function fmtDelta(m) {
    return (m < 0 ? "-" : "+") + fmtVert(Math.abs(m)) + " " + vertUnit();
  }
  /* ToF target: bare number, [n], or legacy [min,max] — last value wins */
  function tofTargetH(wk) {
    var raw = wk ? wk.tof_target_h : undefined;
    if (raw === null || raw === undefined) return null;
    var v = Array.isArray(raw) ? (raw.length ? Number(raw[raw.length - 1]) : NaN) : Number(raw);
    return Number.isFinite(v) ? v : null;
  }

  var MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  function dayMon(iso) {
    return parseInt(iso.slice(8, 10), 10) + " " + MONTHS[parseInt(iso.slice(5, 7), 10) - 1];
  }
  /* "6–12 JUL" or "29 JUN – 5 JUL" from window start/end dates */
  function fmtRange(startIso, endIso) {
    if (startIso.slice(5, 7) === endIso.slice(5, 7)) {
      return parseInt(startIso.slice(8, 10), 10) + "–" + dayMon(endIso);
    }
    return dayMon(startIso) + " – " + dayMon(endIso);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /* ---------- verdict (deload-aware: on recovery weeks overshooting is the miss) ---------- */
  function verdictOf(summary, planWeek) {
    var delta = summary.vert.actual_m - summary.vert.target_m;
    var deload = !!(planWeek && planWeek.notes === "recovery");
    if (deload) {
      return delta <= 0
        ? { cls: "deload-ok", label: "DELOAD RESPECTED" }
        : { cls: "bad", label: "DELOAD OVERSHOT " + fmtDelta(delta) };
    }
    return delta >= 0
      ? { cls: "ok", label: "TARGET MET " + fmtDelta(delta) }
      : { cls: "bad", label: "SHORT " + fmtDelta(delta) };
  }

  /* ---------- campaign totals: W1..N cumulative, from data already in the page ---------- */
  function campaignOf(throughWeek) {
    var vertActual = 0, vertTarget = 0, tofActual = 0, tofTargetHrs = 0;
    data.plan.weeks.forEach(function (w) {
      if (w.week > throughWeek) return;
      vertTarget += num(w.vert_target_m);
      var t = tofTargetH(w);
      if (t !== null) tofTargetHrs += t;
      var s = summaries[w.iso_week];
      if (s) {
        vertActual += num(s.vert && s.vert.actual_m);
        tofActual += num(s.time_on_feet && s.time_on_feet.actual_s);
      }
    });
    return {
      vertActual: vertActual, vertTarget: vertTarget,
      tofActualS: tofActual, tofTargetH: tofTargetHrs,
      weeksToRace: 23 - throughWeek,
    };
  }

  /* ---------- modal shell (built once) ---------- */
  var backdrop = el("div", "debrief-backdrop");
  backdrop.hidden = true;
  var dialog = el("div", "debrief");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "debrief-title");
  var head = el("div", "debrief-head");
  var title = el("h2", "debrief-title", "");
  title.id = "debrief-title";
  var closeBtn = el("button", "debrief-close", "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close debrief");
  head.appendChild(title);
  head.appendChild(closeBtn);
  var body = el("div", "debrief-body");
  dialog.appendChild(head);
  dialog.appendChild(body);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  var openIso = null;
  var returnFocusTo = null;

  function renderBody(iso) {
    var report = reports[iso];
    var summary = summaries[iso];
    var planWeek = planByIso[iso];
    body.textContent = "";
    if (!report || !summary || !planWeek) return;

    title.textContent = "WEEK " + planWeek.week + " DEBRIEF";
    var deload = planWeek.notes === "recovery";
    body.appendChild(el("p", "debrief-sub",
      planWeek.phase.toUpperCase() + (deload ? " · DELOAD" : "") + " · " +
      fmtRange(summary.window.start.slice(0, 10), summary.window.end.slice(0, 10))));

    /* verdict stamp */
    var v = verdictOf(summary, planWeek);
    body.appendChild(el("p", "debrief-verdict " + v.cls, "★ " + v.label));

    /* stats — concrete units, no derived percentages */
    var stats = el("dl", "debrief-stats");
    function stat(k, val) {
      stats.appendChild(el("dt", null, k));
      stats.appendChild(el("dd", null, val));
    }
    stat("VERT", fmtVert(summary.vert.actual_m) + " " + vertUnit() +
      " vs " + fmtVert(summary.vert.target_m) + " " + vertUnit() +
      " (" + fmtDelta(summary.vert.actual_m - summary.vert.target_m) + ")");
    var tofT = tofTargetH(planWeek);
    stat("TOF", fmtHM(summary.time_on_feet.actual_s) +
      (tofT !== null ? " vs " + tofT + "h target" : ""));
    stat("DIST", fmtDist(summary.distance.actual_m) + " " + distUnit());
    stat("SESSIONS", summary.sessions.on_foot_count + " on foot (" + summary.sessions.count + " total)");
    body.appendChild(stats);

    /* daily vert bars, Mon..Sun */
    var days = el("div", "debrief-days");
    days.setAttribute("role", "img");
    days.setAttribute("aria-label", "Daily vertical gain, Monday to Sunday");
    var max = 0;
    summary.daily.forEach(function (d) { if (num(d.vert_m) > max) max = num(d.vert_m); });
    var LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
    summary.daily.forEach(function (d, i) {
      var col = el("div", "debrief-day");
      var barBox = el("div", "debrief-bar-box");
      var bar = el("div", "debrief-bar");
      var vm = num(d.vert_m);
      bar.style.height = max > 0 && vm > 0 ? Math.max(4, Math.round((vm / max) * 100)) + "%" : "2px";
      if (vm === 0) bar.className += " zero";
      barBox.appendChild(bar);
      col.appendChild(barBox);
      col.appendChild(el("div", "debrief-day-label", LETTERS[i]));
      col.title = d.date + " · " + fmtVert(vm) + " " + vertUnit();
      days.appendChild(col);
    });
    body.appendChild(days);

    /* campaign strip — cumulative W1..N + countdown */
    var c = campaignOf(planWeek.week);
    var camp = el("div", "debrief-campaign");
    camp.appendChild(el("h3", "debrief-h", "CAMPAIGN · W1–" + planWeek.week));
    camp.appendChild(el("p", null,
      fmtVert(c.vertActual) + " " + vertUnit() + " climbed vs " +
      fmtVert(c.vertTarget) + " " + vertUnit() + " planned (" +
      fmtDelta(c.vertActual - c.vertTarget) + ")"));
    camp.appendChild(el("p", null,
      fmtHM(c.tofActualS) + " on feet vs " + c.tofTargetH + "h planned"));
    camp.appendChild(el("p", null,
      c.weeksToRace + " week" + (c.weeksToRace === 1 ? "" : "s") + " to GTCB"));
    body.appendChild(camp);

    /* coach's notes — the generated narrative */
    var notes = el("div", "debrief-notes");
    notes.appendChild(el("h3", "debrief-h", "COACH'S NOTES"));
    notes.appendChild(el("p", "debrief-headline", report.headline));
    report.narrative.forEach(function (para) {
      notes.appendChild(el("p", null, para));
    });
    body.appendChild(notes);

    /* flags (calf / anomalies) — omitted when none */
    if (Array.isArray(summary.flags) && summary.flags.length) {
      var flags = el("div", "debrief-flags");
      flags.appendChild(el("h3", "debrief-h", "FLAGS"));
      summary.flags.forEach(function (f) {
        flags.appendChild(el("p", null, "⚑ " + f.type + ": " + f.detail));
      });
      body.appendChild(flags);
    }

    body.appendChild(el("p", "debrief-footer",
      "REPORT GENERATED " + dayMon(report.generated_at.slice(0, 10)) + " " +
      report.generated_at.slice(0, 4)));
  }

  function openDebrief(iso, trigger) {
    openIso = iso;
    returnFocusTo = trigger || null;
    renderBody(iso);
    backdrop.hidden = false;
    document.documentElement.classList.add("debrief-lock");
    dialog.scrollTop = 0;
    closeBtn.focus();
  }

  function closeDebrief() {
    if (openIso === null) return;
    openIso = null;
    backdrop.hidden = true;
    document.documentElement.classList.remove("debrief-lock");
    if (returnFocusTo) returnFocusTo.focus();
    returnFocusTo = null;
  }

  closeBtn.addEventListener("click", closeDebrief);
  backdrop.addEventListener("click", function (e) {
    if (e.target === backdrop) closeDebrief();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && openIso !== null) closeDebrief();
  });
  window.addEventListener("gtcb:units", function () {
    if (openIso !== null) renderBody(openIso);
  });

  /* ---------- entry points: week-number cell becomes a button ---------- */
  var rows = document.querySelectorAll(".plan-table tbody tr");
  Object.keys(reports).sort().forEach(function (iso) {
    var planWeek = planByIso[iso];
    if (!planWeek) return;
    var row = rows[planWeek.week - 1];
    if (!row || parseInt(row.cells[0].textContent, 10) !== planWeek.week) return;
    if (!summaries[iso]) return; // stats are computed from the summary
    var cell = row.cells[0];
    var btn = el("button", "wk-report-btn");
    btn.type = "button";
    btn.setAttribute("aria-label", "Week " + planWeek.week + " debrief");
    btn.appendChild(document.createTextNode(planWeek.week));
    btn.appendChild(el("span", "wk-report-mark", "▸"));
    btn.addEventListener("click", function () { openDebrief(iso, btn); });
    cell.textContent = "";
    cell.appendChild(btn);
  });
})();
