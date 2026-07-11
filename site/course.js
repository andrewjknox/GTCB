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
  var AID = "#65DBEF";       // cyan — aid-only station (circle)
  var CUTOFF = "#FF897D";    // light red — hard cut-off control (square)
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
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }

  function tipHide() { tip.classList.add("hidden"); }

  /* ---------- profile chart ---------- */

  var track = C.track; // [[km, ele], ...] ascending km
  var maxKm = track[track.length - 1][0];
  var Y_MIN = 200, Y_MAX = 1600; // metres, clean bounds around 257–1520

  function nearestIdx(km) {
    var lo = 0, hi = track.length - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (track[mid][0] < km) lo = mid; else hi = mid;
    }
    return (km - track[lo][0] < track[hi][0] - km) ? lo : hi;
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
    overlay.addEventListener("pointermove", function (e) {
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
    });
    overlay.addEventListener("pointerleave", function () {
      cross.setAttribute("visibility", "hidden");
      tipHide();
    });

    /* station markers — circles = aid, squares = hard cut-off (shape + colour) */
    var mk = el("g", {}, svg);
    var R = narrow ? 4 : 5;
    for (i = 0; i < C.stations.length; i++) {
      (function (s) {
        var sx = X(s.x_km), sy = Y(s.y_ele);
        if (s.hard) {
          el("rect", { x: sx - R, y: sy - R, width: 2 * R, height: 2 * R, fill: CUTOFF, stroke: SURFACE, "stroke-width": "2" }, mk);
        } else {
          el("circle", { cx: sx, cy: sy, r: R, fill: AID, stroke: SURFACE, "stroke-width": "2" }, mk);
        }
        /* oversized invisible hit target, keyboard-reachable */
        var hit = el("circle", { cx: sx, cy: sy, r: 14, fill: SURFACE, "fill-opacity": "0", tabindex: "0", role: "img", class: "station-hit" }, mk);
        var label = stationLines(s).map(function (l) { return l.text; }).join(", ");
        hit.setAttribute("aria-label", label);
        hit.addEventListener("pointerenter", function (e) {
          cross.setAttribute("visibility", "hidden");
          tipShow(stationLines(s), e.clientX, e.clientY);
        });
        hit.addEventListener("pointerleave", tipHide);
        hit.addEventListener("focus", function () {
          var r = hit.getBoundingClientRect();
          tipShow(stationLines(s), r.left + r.width / 2, r.top);
        });
        hit.addEventListener("blur", tipHide);
      })(C.stations[i]);
    }
  }

  /* ---------- rutometro table (same data as the chart) ---------- */

  function td(tr, text, cls) {
    var c = document.createElement("td");
    if (cls) c.className = cls;
    c.textContent = text;
    tr.appendChild(c);
    return c;
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
    var head = ["CTRL", "STATION", "DIST", "ALT", "LEG", "LEG D+", "LEG D−", "AID", "CLOSES", "SUPPORT"];
    var thead = document.createElement("thead");
    var hr = document.createElement("tr");
    for (var i = 0; i < head.length; i++) {
      var th = document.createElement("th");
      th.scope = "col";
      th.textContent = head[i];
      th.className = (i >= 2 && i <= 6) ? "num" : "left";
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    tableHost.appendChild(thead);

    var tbody = document.createElement("tbody");
    for (i = 0; i < C.stations.length; i++) {
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

  /* ---------- wire up ---------- */

  function renderAll() { renderChart(); renderTable(); }

  var raf = null;
  window.addEventListener("resize", function () {
    if (raf) return;
    raf = requestAnimationFrame(function () { raf = null; renderChart(); });
  });
  window.addEventListener("gtcb:units", renderAll);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") tipHide();
  });

  renderAll();
})();
