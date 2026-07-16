/* GTCB course page — responsive SVG elevation profile + rutometro table.
   Data: window.GTCB_COURSE (generated course-data.js). TMS9918 palette only.
   Re-renders on resize and on the nav unit toggle ("gtcb:units" event). */
(function () {
  "use strict";

  var C = window.GTCB_COURSE;
  var chartHost = document.getElementById("profile-chart");
  var tableHost = document.getElementById("ruto-table");
  if (!C || !chartHost) return;

  var SVGNS = "http://www.w3.org/2000/svg";

  /* palette (TMS9918) */
  var LINE = "#3EB849";      // medium green — elevation trace
  var AID = "#65DBEF";       // cyan — any station without a cut-off
  var CUTOFF = "#FF897D";    // light red — hard cut-off control
  var GRID = "#5955E0";      // dark blue — structural, matches panel borders
  var INK = "#CCCCCC";
  var INK_DIM = "#8076F1";
  var SURFACE = "#000000";

  var MI = 0.621371, FT = 3.28084;

  function imperial() {
    return window.GTCBUnits && window.GTCBUnits.get() === "imperial";
  }

  function fmtInt(n) { return Math.round(n).toLocaleString("en-GB"); }

  function fmtDist(km) {
    var v = imperial() ? km * MI : km;
    var s = v.toFixed(1);
    return (s.slice(-2) === ".0" ? s.slice(0, -2) : s) + (imperial() ? " mi" : " km");
  }

  function fmtEle(m) {
    return imperial() ? fmtInt(m * FT) + " ft" : fmtInt(m) + " m";
  }

  function el(name, attrs, parent) {
    var node = document.createElementNS(SVGNS, name);
    for (var k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  /* ---------- tooltip (shared fixed div, textContent only) ---------- */

  var tip = document.createElement("div");
  tip.className = "tooltip hidden";
  document.body.appendChild(tip);

  function tipShow(lines, clientX, clientY) {
    tip.textContent = "";
    for (var i = 0; i < lines.length; i++) {
      var row = document.createElement("div");
      if (lines[i].strong) {
        var b = document.createElement("strong");
        b.textContent = lines[i].text;
        row.appendChild(b);
      } else {
        row.textContent = lines[i].text;
        if (lines[i].dim) row.className = "tip-dim";
      }
      tip.appendChild(row);
    }
    tip.classList.remove("hidden");
    var pad = 14;
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var x = clientX + pad, y = clientY - h - pad;
    if (x + w > window.innerWidth - 4) x = clientX - w - pad;
    if (y < 4) y = clientY + pad;
    /* clamp fully on-screen — narrow viewports can otherwise push it off either edge */
    x = Math.max(4, Math.min(x, window.innerWidth - w - 4));
    y = Math.max(4, Math.min(y, window.innerHeight - h - 4));
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }

  function tipHide() { tip.classList.add("hidden"); }

  /* reassigned per-render so it also hides the crosshair — touch taps leave
     both showing until a scroll or a tap outside the chart */
  var clearHover = tipHide;

  /* ---------- profile chart ---------- */

  var track = C.track; // [[km, ele], ...] ascending km
  var maxKm = track[track.length - 1][0];
  var Y_MIN = 200, Y_MAX = 1600; // metres, clean bounds around 257–1520

  /* binary search over any ascending indexed sequence: [lo, hi] adjacent
     indices spanning v — the one bracketing loop for track and cumEff alike */
  function bracket(get, len, v) {
    var lo = 0, hi = len - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (get(mid) < v) lo = mid; else hi = mid;
    }
    return [lo, hi];
  }
  function trackKmAt(i) { return track[i][0]; }
  function cumEffAt(i) { return cumEff[i]; }

  function nearestIdx(km) {
    var b = bracket(trackKmAt, track.length, km);
    return (km - track[b[0]][0] < track[b[1]][0] - km) ? b[0] : b[1];
  }

  /* ---------- pace / cut-off planner model ---------- */
  /* Cumulative Naismith/Langmuir "effort" (km-equivalents) along the track,
     then anchored through the official hard cut-offs so a 24 h finish
     reproduces the organiser's schedule exactly; any other finish time just
     scales the same normalised curve. */

  var chartAPI = null;    // { setYou, refreshLabels } — rebound on every renderChart

  var cumEff = [0];
  (function () {
    var e = 0;
    for (var i = 1; i < track.length; i++) {
      var dkm = track[i][0] - track[i - 1][0];
      var dele = track[i][1] - track[i - 1][1];
      e += dkm;                                  // flat distance (km)
      if (dele > 0) {
        e += dele / 120;                         // Naismith: 600 m climb = 5 km flat
      } else {
        var desc = -dele;
        var grade = dkm > 0 ? desc / (dkm * 1000) : 0;
        if (grade > 0.20) e += desc / 400;       // steep-descent penalty (> ~20%)
      }
      cumEff[i] = e;
    }
  })();
  var totalEff = cumEff[cumEff.length - 1];

  /* interpolate along the track: col 0 = cumulative effort, col 1 = elevation */
  function interpTrack(km, col) {
    if (km <= track[0][0]) return col ? track[0][1] : 0;
    if (km >= maxKm) return col ? track[track.length - 1][1] : totalEff;
    var b = bracket(trackKmAt, track.length, km), lo = b[0], hi = b[1];
    var span = track[hi][0] - track[lo][0];
    var t = span > 0 ? (km - track[lo][0]) / span : 0;
    if (col) return track[lo][1] + t * (track[hi][1] - track[lo][1]);
    return cumEff[lo] + t * (cumEff[hi] - cumEff[lo]);
  }
  function effortAtKm(km) { return interpTrack(km, 0); }
  function eleAtKm(km) { return interpTrack(km, 1); }

  function kmAtEffort(e) {
    if (e <= 0) return track[0][0];
    if (e >= totalEff) return maxKm;
    var b = bracket(cumEffAt, cumEff.length, e), lo = b[0], hi = b[1];
    var span = cumEff[hi] - cumEff[lo];
    var t = span > 0 ? (e - cumEff[lo]) / span : 0;
    return track[lo][0] + t * (track[hi][0] - track[lo][0]);
  }

  var LIMIT_MIN = (C.official && C.official.limit_h ? C.official.limit_h : 24) * 60;

  /* race epoch — single source: C.official.start ("FRI 13 NOV 2026 23:00").
     START_MIN is absolute minutes from 00:00 on DAYS[0]. */
  var DAYS = ["FRI", "SAT", "SUN"];
  var startMtch = /^([A-Z]{3})\b.*?(\d{1,2}):(\d{2})\s*$/.exec((C.official && C.official.start) || "");
  var START_MIN = startMtch
    ? Math.max(0, DAYS.indexOf(startMtch[1])) * 1440 + (+startMtch[2]) * 60 + (+startMtch[3])
    : 1380; // Fri 23:00
  var closesRe = new RegExp("(\\d{1,2}):(\\d{2})\\s*(" + DAYS.join("|") + ")");

  /* "HH:MM DAY" -> elapsed minutes from the start */
  function closesToMin(str) {
    var mtch = closesRe.exec(str || "");
    if (!mtch) return null;
    return DAYS.indexOf(mtch[3]) * 1440 + (+mtch[1]) * 60 + (+mtch[2]) - START_MIN;
  }

  /* hard controls are the anchors: frac = closes / 24 h, rawEff = effort at km.
     The start (frac 0) and finish (frac 1) anchors are explicit, not read from
     the station rows — anchors always has ≥2 entries bounding [0,1], so the
     model degrades to the pure effort curve if no closes string parses. */
  var anchors = [{ km: track[0][0], rawEff: 0, frac: 0 }];
  (function () {
    for (var i = 0; i < C.stations.length; i++) {
      var st = C.stations[i];
      if (!st.hard || !st.closes) continue;
      var cm = closesToMin(st.closes);
      if (cm === null || cm <= 0 || cm > LIMIT_MIN) continue;
      anchors.push({ km: st.x_km, rawEff: effortAtKm(st.x_km), frac: cm / LIMIT_MIN });
    }
    anchors.push({ km: maxKm, rawEff: totalEff, frac: 1 });
  })();

  /* normalised effort-fraction at a km: piecewise-linear rescale of the raw
     effort curve so each hard-control km lands exactly on its official frac */
  function fracAtKm(km) {
    var re = effortAtKm(km);
    if (re <= anchors[0].rawEff) return anchors[0].frac;
    for (var i = 1; i < anchors.length; i++) {
      if (re <= anchors[i].rawEff) {
        var a = anchors[i - 1], b = anchors[i], sp = b.rawEff - a.rawEff;
        return a.frac + (sp > 0 ? (re - a.rawEff) / sp : 0) * (b.frac - a.frac);
      }
    }
    return anchors[anchors.length - 1].frac;
  }
  /* invert: km for a normalised effort fraction (drives the "you are here" mark) */
  function kmAtFrac(f) {
    f = Math.max(0, Math.min(1, f));
    var i = 1;
    while (i < anchors.length && f > anchors[i].frac) i++;
    if (i >= anchors.length) return maxKm;
    var a = anchors[i - 1], b = anchors[i], sp = b.frac - a.frac;
    var eff = a.rawEff + (sp > 0 ? (f - a.frac) / sp : 0) * (b.rawEff - a.rawEff);
    return kmAtEffort(eff);
  }
  function pad2(n) { n = Math.round(n); return (n < 10 ? "0" : "") + n; }
  /* elapsed minutes from the start -> "HH:MM DAY" clock time */
  function fmtClock(elapsedMin) {
    var abs = START_MIN + Math.round(elapsedMin);
    var day = Math.floor(abs / 1440);
    var mday = ((abs % 1440) + 1440) % 1440;
    var lbl = DAYS[Math.max(0, Math.min(DAYS.length - 1, day))];
    return pad2(Math.floor(mday / 60)) + ":" + pad2(mday % 60) + " " + lbl;
  }
  function fmtDur(h) {
    var H = Math.floor(h + 1e-9), M = Math.round((h - H) * 60);
    if (M === 60) { H++; M = 0; }
    return H + ":" + pad2(M);
  }
  /* both round to whole minutes first so sign and colour always agree */
  function fmtBuf(min) {
    min = Math.round(min);
    var s = min < 0 ? "−" : "+", a = Math.abs(min);
    if (a >= 60) return s + Math.floor(a / 60) + "h" + pad2(a % 60);
    return s + a + "m";
  }
  function bufClass(min) {
    min = Math.round(min);
    if (min < 0) return "buf-neg";
    if (min < 15) return "buf-bad";
    if (min < 60) return "buf-tight";
    return "buf-ok";
  }

  /* arrival + buffer for a station at the current target pace — the single
     source both the tooltip and the planner table render from */
  function planFor(s) {
    var arriveMin = fracAtKm(s.x_km) * targetH() * 60;
    var closeMin = s.hard && s.closes && s.n !== "S" ? closesToMin(s.closes) : null;
    return {
      arrive: fmtClock(arriveMin),
      closeMin: closeMin,
      bufMin: closeMin === null ? null : Math.round(closeMin - arriveMin),
    };
  }

  function gradientAt(idx) {
    var km = track[idx][0];
    var a = idx, b = idx;
    while (a > 0 && km - track[a - 1][0] < 0.25) a--;
    while (b < track.length - 1 && track[b + 1][0] - km < 0.25) b++;
    var run = (track[b][0] - track[a][0]) * 1000;
    if (run < 50) return null;
    return (track[b][1] - track[a][1]) / run * 100;
  }

  function stationLines(s) {
    var lines = [
      { text: s.name.toUpperCase() + (s.n === "S" ? " — START" : s.n === "F" ? " — FINISH" : " — CTRL " + s.n), strong: true },
      { text: fmtDist(s.km) + " · " + fmtEle(s.alt) },
    ];
    if (s.aid) lines.push({ text: "Aid: " + (s.aid === "LS" ? "liquid + solid" : "liquid only") });
    if (s.closes) lines.push({ text: "Closes " + s.closes });
    /* pace-planner arrival at the chosen finish time */
    var plan = planFor(s);
    lines.push({ text: "Arrive ~" + plan.arrive + " (" + fmtDur(targetH()) + " pace)" });
    if (plan.bufMin !== null) lines.push({ text: "Buffer " + fmtBuf(plan.bufMin) });
    var sup = [];
    if (s.crew) sup.push("crew");
    if (s.bag) sup.push("drop-bag");
    if (s.evac) sup.push("evac");
    if (s.med) sup.push("medical");
    if (sup.length) lines.push({ text: sup.join(" · "), dim: true });
    return lines;
  }

  function renderChart() {
    chartHost.textContent = "";

    var W = chartHost.clientWidth || 600;
    var H = Math.max(240, Math.min(400, Math.round(W * 0.36)));
    var narrow = W < 560;
    /* left margin sized to the widest y label ("1,600 m" / "5,000 ft") at ~6.2px/char */
    var topLabel = imperial() ? "5,000 ft" : "1,600 m";
    var m = { top: narrow ? 16 : 44, right: 12, bottom: 26, left: Math.ceil(10 + topLabel.length * 6.2) };
    var pw = W - m.left - m.right, ph = H - m.top - m.bottom;

    var svg = el("svg", {
      viewBox: "0 0 " + W + " " + H,
      width: "100%",
      role: "img",
      "aria-label": "Elevation profile of the GTCB 102K: " + fmtDist(101.7) +
        ", " + fmtEle(6280) + " of climbing, between " + fmtEle(C.ele_min_m) +
        " and " + fmtEle(C.ele_max_m) + ". Full data in the table below.",
    }, chartHost);
    svg.setAttribute("class", "profile-svg");

    function X(km) { return m.left + (km / maxKm) * pw; }
    function Y(ele) { return m.top + (1 - (ele - Y_MIN) / (Y_MAX - Y_MIN)) * ph; }

    /* gridlines + ticks (clean numbers in the active unit) */
    var g = el("g", { "shape-rendering": "crispEdges" }, svg);
    var yStep = imperial() ? 1000 : (ph < 220 ? 400 : 200); // ft or m
    var yv, ym, i;
    var yTicks = [];
    for (yv = yStep; ; yv += yStep) {
      ym = imperial() ? yv / FT : yv;
      if (ym > Y_MAX) break;
      if (ym <= Y_MIN) continue; // Y_MIN coincides with the baseline axis
      yTicks.push([yv, ym]);
    }
    for (i = 0; i < yTicks.length; i++) {
      var yy = Y(yTicks[i][1]);
      el("line", { x1: m.left, x2: m.left + pw, y1: yy, y2: yy, stroke: GRID, "stroke-opacity": "0.45", "stroke-width": "1" }, g);
      var lastY = i === yTicks.length - 1;
      var t = el("text", { x: m.left - 5, y: yy + 3.5, "text-anchor": "end", class: "ax" }, svg);
      t.textContent = fmtInt(yTicks[i][0]) + (lastY ? (imperial() ? " ft" : " m") : "");
    }

    var xUnitMax = imperial() ? maxKm * MI : maxKm;
    var xStep = narrow ? 20 : 10;
    for (var xv = 0; xv <= xUnitMax; xv += xStep) {
      var xkm = imperial() ? xv / MI : xv;
      var xx = X(xkm);
      el("line", { x1: xx, x2: xx, y1: m.top + ph, y2: m.top + ph + 4, stroke: GRID, "stroke-width": "1" }, g);
      var lastX = xv + xStep > xUnitMax;
      var tx = el("text", { x: xx, y: m.top + ph + 16, "text-anchor": lastX ? "end" : "middle", class: "ax" }, svg);
      tx.textContent = xv + (lastX ? (imperial() ? " mi" : " km") : "");
    }
    el("line", { x1: m.left, x2: m.left + pw, y1: m.top + ph, y2: m.top + ph, stroke: GRID, "stroke-width": "1" }, g);

    /* area wash + 2px trace */
    var d = "";
    for (i = 0; i < track.length; i++) {
      d += (i ? "L" : "M") + X(track[i][0]).toFixed(1) + " " + Y(track[i][1]).toFixed(1);
    }
    el("path", {
      d: d + "L" + X(maxKm).toFixed(1) + " " + (m.top + ph) + "L" + m.left + " " + (m.top + ph) + "Z",
      fill: LINE, "fill-opacity": "0.13", stroke: "none",
    }, svg);
    el("path", { d: d, fill: "none", stroke: LINE, "stroke-width": "2", "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);

    /* sparse summit labels (wide layouts; tooltip + table carry them elsewhere).
       Overlapping neighbours step up a level rather than colliding. */
    if (!narrow) {
      var placed = [];
      for (i = 0; i < C.peaks.length; i++) {
        var pk = C.peaks[i];
        var px = X(pk.x_km), py = Y(pk.y_ele);
        var lw = pk.name.length * 6.5;
        var lx = Math.max(m.left + lw / 2, Math.min(px, m.left + pw - lw / 2));
        var level = 0;
        for (var q = 0; q < placed.length; q++) {
          if (placed[q].level === level && Math.abs(placed[q].x - lx) < (placed[q].w + lw) / 2 + 10) {
            level++;
            q = -1; // recheck all against the new level
          }
        }
        placed.push({ x: lx, w: lw, level: level });
        var ly = py - 18 - level * 13;
        el("line", { x1: px, x2: px, y1: py - 4, y2: ly + 4, stroke: INK_DIM, "stroke-width": "1" }, svg);
        var pt = el("text", { x: lx, y: ly, "text-anchor": "middle", class: "peak" }, svg);
        pt.textContent = pk.name.toUpperCase();
      }
    }

    /* crosshair (hidden until hover) */
    var cross = el("g", { visibility: "hidden" }, svg);
    var crossLine = el("line", { y1: m.top, y2: m.top + ph, stroke: INK, "stroke-opacity": "0.55", "stroke-width": "1" }, cross);
    var crossDot = el("circle", { r: 4.5, fill: "#FFFFFF", stroke: SURFACE, "stroke-width": "2" }, cross);

    /* hover layer: crosshair snaps to the nearest trace point.
       Added before the markers so their hit targets stay on top. */
    var overlay = el("rect", { x: m.left, y: m.top, width: pw, height: ph, fill: SURFACE, "fill-opacity": "0" }, svg);
    function overlayPoint(e) {
      var box = svg.getBoundingClientRect();
      var km = ((e.clientX - box.left) * (W / box.width) - m.left) / pw * maxKm;
      if (km < 0 || km > maxKm) { cross.setAttribute("visibility", "hidden"); tipHide(); return; }
      var idx = nearestIdx(km);
      var p = track[idx];
      var xx = X(p[0]), yy = Y(p[1]);
      crossLine.setAttribute("x1", xx);
      crossLine.setAttribute("x2", xx);
      crossDot.setAttribute("cx", xx);
      crossDot.setAttribute("cy", yy);
      cross.setAttribute("visibility", "visible");

      var lines = [{ text: fmtDist(p[0]) + " · " + fmtEle(p[1]), strong: true }];
      var gr = gradientAt(idx);
      if (gr !== null) lines.push({ text: "gradient " + (gr >= 0 ? "+" : "") + gr.toFixed(1) + "%" });
      for (var j = 0; j < C.stations.length; j++) {
        if (C.stations[j].x_km > p[0] + 0.05 && C.stations[j].aid) {
          lines.push({ text: "next aid " + C.stations[j].name + " in " + fmtDist(C.stations[j].x_km - p[0]), dim: true });
          break;
        }
      }
      tipShow(lines, e.clientX, e.clientY);
    }
    overlay.addEventListener("pointermove", overlayPoint);
    overlay.addEventListener("pointerdown", overlayPoint); // touch tap = desktop hover
    function overlayClear() {
      cross.setAttribute("visibility", "hidden");
      tipHide();
    }
    clearHover = overlayClear;
    /* touch fires pointerleave on finger-up, which would kill the tap popup
       immediately — for touch only scroll/tap-outside/cancel dismiss it */
    overlay.addEventListener("pointerleave", function (e) {
      if (e.pointerType !== "touch") overlayClear();
    });
    overlay.addEventListener("pointercancel", overlayClear);

    /* station markers — square = food + water (red when it's also a hard
       cut-off), circle = liquid only. Every cut-off serves food + water, so
       a red circle never occurs. The start carries no marker. */
    var mk = el("g", {}, svg);
    var R = narrow ? 4 : 5;
    var labelRefreshers = []; // aria-labels bake in the target pace — re-run on planner change
    for (i = 0; i < C.stations.length; i++) {
      (function (s) {
        if (s.n === "S") return;
        var sx = X(s.x_km), sy = Y(s.y_ele);
        if (s.aid === "LS") {
          el("rect", { x: sx - R, y: sy - R, width: 2 * R, height: 2 * R, fill: s.hard ? CUTOFF : AID, stroke: SURFACE, "stroke-width": "2" }, mk);
        } else {
          el("circle", { cx: sx, cy: sy, r: R, fill: AID, stroke: SURFACE, "stroke-width": "2" }, mk);
        }
        /* oversized invisible hit target, keyboard-reachable */
        var hit = el("circle", { cx: sx, cy: sy, r: 14, fill: SURFACE, "fill-opacity": "0", tabindex: "0", role: "img", class: "station-hit" }, mk);
        function refreshLabel() {
          hit.setAttribute("aria-label", stationLines(s).map(function (l) { return l.text; }).join(", "));
        }
        refreshLabel();
        labelRefreshers.push(refreshLabel);
        hit.addEventListener("pointerenter", function (e) {
          cross.setAttribute("visibility", "hidden");
          tipShow(stationLines(s), e.clientX, e.clientY);
        });
        hit.addEventListener("pointerleave", function (e) {
          if (e.pointerType !== "touch") tipHide(); // keep the tap popup up
        });
        hit.addEventListener("pointercancel", tipHide);
        hit.addEventListener("focus", function () {
          var r = hit.getBoundingClientRect();
          tipShow(stationLines(s), r.left + r.width / 2, r.top);
        });
        hit.addEventListener("blur", tipHide);
      })(C.stations[i]);
    }

    /* ---------- you-are-here marker (pace planner) ---------- */
    var youG = el("g", { visibility: "hidden", "aria-hidden": "true" }, svg);
    var youLine = el("line", { stroke: "#DED087", "stroke-width": "1.5", "stroke-dasharray": "4 3", "stroke-opacity": "0.9" }, youG);
    var youBg = el("rect", { fill: SURFACE, stroke: "#DED087", "stroke-width": "1" }, youG);
    var youTxt = el("text", { class: "you-label", "text-anchor": "middle" }, youG);
    var youDot = el("circle", { r: narrow ? 4.5 : 5.5, fill: "#DED087", stroke: SURFACE, "stroke-width": "2" }, youG);

    chartAPI = {
      setYou: function (km) {
        var ele = eleAtKm(km);
        var xx = X(km), yy = Y(Math.max(Y_MIN, Math.min(Y_MAX, ele)));
        var topY = m.top + 11;
        youLine.setAttribute("x1", xx); youLine.setAttribute("x2", xx);
        youLine.setAttribute("y1", topY + 3); youLine.setAttribute("y2", yy - 5);
        youDot.setAttribute("cx", xx); youDot.setAttribute("cy", yy);
        var label = fmtDist(km) + " · " + fmtEle(ele);
        youTxt.textContent = label;
        var w = label.length * 6.4 + 12, hh = 15;
        var lx = Math.max(m.left + w / 2, Math.min(xx, m.left + pw - w / 2));
        youTxt.setAttribute("x", lx); youTxt.setAttribute("y", topY);
        youBg.setAttribute("x", lx - w / 2); youBg.setAttribute("y", topY - 11);
        youBg.setAttribute("width", w); youBg.setAttribute("height", hh);
        youG.setAttribute("visibility", "visible");
      },
      refreshLabels: function () {
        for (var j = 0; j < labelRefreshers.length; j++) labelRefreshers[j]();
      },
    };
    updateYou();
  }

  /* ---------- rutometro table (same data as the chart) ---------- */

  function td(tr, text, cls) {
    var c = document.createElement("td");
    if (cls) c.className = cls;
    c.textContent = text;
    tr.appendChild(c);
    return c;
  }

  function buildHead(host, cols, isNum) {
    var thead = document.createElement("thead");
    var hr = document.createElement("tr");
    for (var i = 0; i < cols.length; i++) {
      var th = document.createElement("th");
      th.scope = "col";
      th.textContent = cols[i];
      th.className = isNum(i) ? "num" : "left";
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    host.appendChild(thead);
  }

  function badge(cell, cls, text) {
    var b = document.createElement("span");
    b.className = "tier-badge " + cls;
    b.textContent = text;
    cell.appendChild(b);
    cell.appendChild(document.createTextNode(" "));
  }

  function renderTable() {
    if (!tableHost) return;
    tableHost.textContent = "";
    buildHead(tableHost, ["CTRL", "STATION", "DIST", "ALT", "LEG", "LEG D+", "LEG D−", "AID", "CLOSES", "SUPPORT"],
      function (i) { return i >= 2 && i <= 6; });

    var tbody = document.createElement("tbody");
    for (var i = 0; i < C.stations.length; i++) {
      var s = C.stations[i];
      var tr = document.createElement("tr");
      if (s.hard) tr.className = "hard";
      td(tr, s.n, "left");
      td(tr, s.name, "left");
      td(tr, fmtDist(s.km), "num");
      td(tr, fmtEle(s.alt), "num");
      td(tr, s.seg === null ? "—" : fmtDist(s.seg), "num");
      td(tr, s.dplus === null ? "—" : "+" + fmtEle(s.dplus), "num");
      td(tr, s.dminus === null ? "—" : "−" + fmtEle(s.dminus), "num");
      td(tr, s.aid ? (s.aid === "LS" ? "liquid + solid" : "liquid") : "—", "left");
      td(tr, s.closes || "—", "left");
      var sup = td(tr, "", "left support-cell");
      if (s.crew) badge(sup, "tag-crew", "Crew");
      if (s.bag) badge(sup, "tag-bag", "Bag");
      if (s.evac) badge(sup, "tag-evac", "Evac");
      if (s.med) badge(sup, "tag-med", "Med");
      if (!s.crew && !s.bag && !s.evac && !s.med) sup.textContent = "—";
      tbody.appendChild(tr);
    }
    tableHost.appendChild(tbody);
  }

  /* ---------- pace planner UI ---------- */

  var targetSlider = document.getElementById("target-slider");
  var raceSlider = document.getElementById("raceclock-slider");
  var targetOut = document.getElementById("target-readout");
  var raceOut = document.getElementById("raceclock-readout");
  var plannerHost = document.getElementById("planner-table");
  var cutoffBtn = document.getElementById("cutoff-preset");

  /* the sliders are the single source of truth for the planner state */
  function targetH() { return (targetSlider && parseFloat(targetSlider.value)) || 22; }
  function raceMin() { return raceSlider ? parseFloat(raceSlider.value) || 0 : 0; }
  function raceFrac() { return (raceMin() / 60) / targetH(); }

  function updateYou() {
    if (!chartAPI) return;
    chartAPI.setYou(kmAtFrac(raceFrac()));
  }

  function outSpan(parent, cls, text) {
    var s = document.createElement("span");
    if (cls) s.className = cls;
    s.textContent = text;
    parent.appendChild(s);
  }

  function renderReadouts() {
    if (targetOut) {
      targetOut.textContent = "";
      outSpan(targetOut, null, "TARGET " + fmtDur(targetH()) + " ");
      outSpan(targetOut, "finish", "→ FINISH " + fmtClock(targetH() * 60));
    }
    if (raceOut) {
      raceOut.textContent = "";
      var pinned = raceMin() > targetH() * 60;
      outSpan(raceOut, null, fmtClock(raceMin()) + " ");
      outSpan(raceOut, "finish", "@ " + fmtDist(kmAtFrac(raceFrac())) + (pinned ? " (FIN)" : ""));
    }
  }

  function renderPlannerTable() {
    if (!plannerHost) return;
    plannerHost.textContent = "";
    buildHead(plannerHost, ["CTRL", "STATION", "DIST", "ARRIVAL", "CLOSES", "BUFFER"],
      function (i) { return i >= 2; });

    var tbody = document.createElement("tbody");
    for (var i = 0; i < C.stations.length; i++) {
      var s = C.stations[i];
      var plan = planFor(s);
      var tr = document.createElement("tr");
      if (s.hard && s.closes) tr.className = "hard";
      td(tr, s.n, "left");
      td(tr, s.name, "left");
      td(tr, fmtDist(s.km), "num");
      td(tr, plan.arrive, "num");
      if (plan.bufMin !== null) {
        td(tr, fmtClock(plan.closeMin), "num");
        td(tr, fmtBuf(plan.bufMin), "num " + bufClass(plan.bufMin));
      } else {
        td(tr, "—", "num");
        td(tr, "—", "num");
      }
      tbody.appendChild(tr);
    }
    plannerHost.appendChild(tbody);
  }

  function renderPlanner() {
    renderReadouts();
    renderPlannerTable();
    if (chartAPI) chartAPI.refreshLabels();
  }

  /* collapse event bursts (slider drags, resize) to one run per frame */
  function coalesce(fn) {
    var pending = false;
    return function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; fn(); });
    };
  }

  if (targetSlider) {
    targetSlider.addEventListener("input", coalesce(function () {
      renderPlanner();
      updateYou();
    }));
  }
  if (raceSlider) {
    raceSlider.addEventListener("input", coalesce(function () {
      renderReadouts();
      updateYou();
    }));
  }
  if (cutoffBtn && targetSlider) {
    cutoffBtn.addEventListener("click", function () {
      targetSlider.value = "24";
      renderPlanner();
      updateYou();
    });
  }

  /* ---------- wire up ---------- */

  function renderAll() { renderChart(); renderTable(); renderPlanner(); }

  window.addEventListener("resize", coalesce(renderChart));
  window.addEventListener("gtcb:units", renderAll);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") clearHover();
  });
  /* the fixed-position tip would otherwise stay glued to the viewport while
     the page scrolls away underneath it */
  window.addEventListener("scroll", function () { clearHover(); }, { passive: true, capture: true });
  document.addEventListener("pointerdown", function (e) {
    if (!chartHost.contains(e.target)) clearHover();
  });

  renderAll();
})();
