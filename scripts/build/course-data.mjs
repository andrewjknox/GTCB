#!/usr/bin/env node
// course-data — generates site/course-data.js from the official GTCB 102K
// GPS track (docs/source/wikiloc_102k_track.json, saved from the Wikiloc embed
// on costablancatrails.com/102k, trail id 163001042 "GTCB 102K 2024").
//
// Decodes Wikiloc's geom encoding (base64 → zigzag varints: 3-value header,
// then absolute first point + deltas in groups of 4: lng*1e6, lat*1e6,
// ele*10 (m), timestamp ms), smooths GPS elevation noise, simplifies the
// profile to <~900 points by max-vertical-deviation, and bakes in the
// aid-station rutometro + summit labels.
//
// Aid-station table transcribed from the official rutometro
// (docs/source/aid_stations_102K_2026.jpg); crew/evac semantics match regs.html.
// Elevation trace is for shape — official totals (101.7 km, +6,280 m) are canonical.

import { readFileSync, writeFileSync } from "node:fs";

const SRC = "docs/source/wikiloc_102k_track.json";
const OUT = "site/course-data.js";

// ---------- hand-maintained: rutometro + summits ----------

// aid: "L" = liquid only, "LS" = liquid + solid. closes: official cut-off.
// evac = punto de retirada, crew = asistencia externa, med = asistencia sanitaria.
const STATIONS = [
  { n: "S",  name: "Finestrat (Plaza Unión Europea)", km: 0,     alt: 250,  seg: null, dplus: null, dminus: null, aid: null, closes: "23:00 FRI (start)", hard: true,  evac: false, crew: false, bag: false, med: true },
  { n: "1",  name: "Coll del Pouet",                       km: 7.4,   alt: 900,  seg: 7.4,  dplus: 1150, dminus: 520,  aid: "L",  closes: null,                hard: false, evac: false, crew: false, bag: false, med: false },
  { n: "2",  name: "Helipuerto Polop",                     km: 12,    alt: 415,  seg: 4.6,  dplus: 120,  dminus: 590,  aid: "LS", closes: "03:00 SAT",         hard: true,  evac: true,  crew: true,  bag: false, med: true },
  { n: "3",  name: "Casa de Dios",                         km: 16.4,  alt: 650,  seg: 4.4,  dplus: 340,  dminus: 100,  aid: "L",  closes: null,                hard: false, evac: false, crew: false, bag: false, med: false },
  { n: "4",  name: "Font del Pi",                          km: 26.8,  alt: 805,  seg: 10.4, dplus: 635,  dminus: 505,  aid: "LS", closes: null,                hard: false, evac: true,  crew: false, bag: false, med: false },
  { n: "5",  name: "Benimantell",                          km: 33.3,  alt: 560,  seg: 6.5,  dplus: 215,  dminus: 445,  aid: "LS", closes: "06:30 SAT",         hard: true,  evac: true,  crew: true,  bag: false, med: true },
  { n: "6",  name: "Barranc de les Mates",                 km: 37.2,  alt: 530,  seg: 3.9,  dplus: 210,  dminus: 230,  aid: "L",  closes: null,                hard: false, evac: false, crew: false, bag: false, med: false },
  { n: "7",  name: "Recingle Alt",                         km: 48.9,  alt: 1350, seg: 11.7, dplus: 1375, dminus: 580,  aid: "LS", closes: null,                hard: false, evac: false, crew: false, bag: false, med: false },
  { n: "8",  name: "Confrides",                            km: 58.5,  alt: 760,  seg: 9.6,  dplus: 230,  dminus: 800,  aid: "LS", closes: "13:30 SAT",         hard: true,  evac: true,  crew: true,  bag: true,  med: true },
  { n: "9",  name: "Font de Partagat",                     km: 67.4,  alt: 1030, seg: 8.9,  dplus: 595,  dminus: 290,  aid: "LS", closes: "15:30 SAT",         hard: true,  evac: true,  crew: true,  bag: false, med: true },
  { n: "10", name: "Font de l'Alemany",                    km: 78.2,  alt: 1010, seg: 10.8, dplus: 585,  dminus: 655,  aid: "LS", closes: null,                hard: false, evac: false, crew: false, bag: false, med: false },
  { n: "11", name: "Sella",                                km: 83.6,  alt: 410,  seg: 5.4,  dplus: 120,  dminus: 695,  aid: "LS", closes: "19:00 SAT",         hard: true,  evac: true,  crew: true,  bag: false, med: true },
  { n: "12", name: "Mas de l'Oficial",                     km: 96.1,  alt: 690,  seg: 12.5, dplus: 565,  dminus: 375,  aid: "LS", closes: "22:00 SAT",         hard: true,  evac: false, crew: false, bag: false, med: false },
  { n: "F",  name: "Finestrat (Plaza Unión Europea)", km: 101.7, alt: 250,  seg: 5.6,  dplus: 140,  dminus: 495,  aid: "LS", closes: "23:00 SAT (finish)", hard: true, evac: false, crew: false, bag: false, med: true },
];

// Summit labels (km from the Wikiloc waypoint list); ele resolved to the
// local max of the track so labels sit on the drawn terrain.
const PEAKS = [
  { name: "Puig Campana",     km: 5.0 },
  { name: "Mallà del Llop",   km: 41.4 },
  { name: "Pla de la Casa",   km: 47.5 },
  { name: "Aitana",           km: 70.2 },
];

// ---------- decode ----------

const src = JSON.parse(readFileSync(SRC, "utf8"));
const buf = Buffer.from(src.mapData.geom, "base64");

function decodeVarints(buf) {
  const vals = [];
  let i = 0;
  while (i < buf.length) {
    let shift = 0n, acc = 0n, b;
    do {
      b = buf[i++];
      acc |= BigInt(b & 0x7f) << shift;
      shift += 7n;
    } while (b & 0x80);
    vals.push(Number((acc & 1n) ? -((acc + 1n) / 2n) : acc / 2n));
  }
  return vals;
}

const body = decodeVarints(buf).slice(3); // 3-value header
let lng = 0, lat = 0, ele = 0;
const pts = [];
for (let i = 0; i + 3 < body.length; i += 4) {
  lng += body[i]; lat += body[i + 1]; ele += body[i + 2]; // [i+3] = time, unused
  pts.push({ lat: lat / 1e6, lng: lng / 1e6, ele: ele / 10 });
}
if (pts.length < 1000) throw new Error(`decode produced only ${pts.length} points`);

// ---------- cumulative distance (haversine) ----------

const R = 6371000;
function hav(a, b) {
  const dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
let dist = 0;
const prof = [{ km: 0, ele: pts[0].ele }];
for (let i = 1; i < pts.length; i++) {
  dist += hav(pts[i - 1], pts[i]);
  prof.push({ km: dist / 1000, ele: pts[i].ele });
}

// ---------- smooth (moving average, ~±20 m of trail) ----------

const smoothed = prof.map((p, i) => {
  let sum = 0, n = 0;
  for (let j = Math.max(0, i - 2); j <= Math.min(prof.length - 1, i + 2); j++) {
    sum += prof[j].ele; n++;
  }
  return { km: p.km, ele: sum / n };
});

// ---------- simplify (max vertical deviation from chord) ----------

function simplify(pts, tol) {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    let worst = -1, worstDev = tol;
    for (let i = a + 1; i < b; i++) {
      const t = (pts[i].km - pts[a].km) / (pts[b].km - pts[a].km || 1);
      const dev = Math.abs(pts[i].ele - (pts[a].ele + t * (pts[b].ele - pts[a].ele)));
      if (dev > worstDev) { worstDev = dev; worst = i; }
    }
    if (worst >= 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

let tol = 2, track;
do {
  track = simplify(smoothed, tol);
  tol += 1;
} while (track.length > 900);

// ---------- snap stations & peaks onto the drawn track ----------

// GPS km drifts ~0.5 km from the official rutometro kms; anchor each marker to
// the track point near the official km whose elevation best matches, so
// markers sit on the terrain shape rather than floating beside it.
function snap(km, alt, windowKm) {
  let best = null, bestScore = Infinity;
  for (const p of smoothed) {
    if (Math.abs(p.km - km) > windowKm) continue;
    const score = Math.abs(p.ele - alt) + Math.abs(p.km - km) * 20; // 20 m per km of drift
    if (score < bestScore) { bestScore = score; best = p; }
  }
  return best;
}

const stations = STATIONS.map((s) => {
  const p = snap(s.km, s.alt, 1.6) ?? { km: s.km, ele: s.alt };
  return { ...s, x_km: +p.km.toFixed(2), y_ele: Math.round(p.ele) };
});

const peaks = PEAKS.map((pk) => {
  let best = null;
  for (const p of smoothed) {
    if (Math.abs(p.km - pk.km) > 2.2) continue;
    if (!best || p.ele > best.ele) best = p;
  }
  return { name: pk.name, x_km: +best.km.toFixed(2), y_ele: Math.round(best.ele) };
});

// ---------- emit ----------

const eles = smoothed.map((p) => p.ele);
const course = {
  source: src.source,
  official: { distance_km: 101.7, gain_m: 6280, loss_m: 6280, start: "FRI 13 NOV 2026 23:00", limit_h: 24 },
  track_km: +(dist / 1000).toFixed(2),
  ele_min_m: Math.round(Math.min(...eles)),
  ele_max_m: Math.round(Math.max(...eles)),
  track: track.map((p) => [+p.km.toFixed(2), Math.round(p.ele)]),
  stations,
  peaks,
};

const banner =
  "/* GENERATED by scripts/build/course-data.mjs — do not edit.\n" +
  "   Official GTCB 102K course: profile trace from the Wikiloc track embedded\n" +
  "   on costablancatrails.com/102k; rutometro data from the official images. */\n";
writeFileSync(OUT, banner + "window.GTCB_COURSE = " + JSON.stringify(course) + ";\n");

console.log(`course-data: ${track.length} profile points (tol ${tol - 1} m) from ${pts.length} GPS points`);
console.log(`course-data: track ${course.track_km} km, ele ${course.ele_min_m}-${course.ele_max_m} m`);
for (const s of stations) {
  const d = Math.abs(s.y_ele - s.alt);
  if (d > 60) console.warn(`course-data: WARN ${s.name} snapped ele ${s.y_ele} vs official ${s.alt} (Δ${d} m)`);
}
console.log(`course-data: wrote ${OUT}`);
