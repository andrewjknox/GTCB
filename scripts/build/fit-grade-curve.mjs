#!/usr/bin/env node
// Build step — fits a pace-vs-grade curve from the checked-in CB Trails 46K
// (2022) stream reference and writes data/refs/pace-model.json for the course
// page's PREDICTED planner mode. Deterministic: same input, same output.
// Dependency-free like minify.mjs / inline-data.mjs. Exit 0 = built, 2 = failed.
//
// Model shape (all knobs live in the JSON so the site treats them as data):
//   curve      [{g, v}]  moving speed (m/s) by grade (%), calibrated so that
//                        walking the 46K's own samples reproduces its actual
//                        moving time exactly
//   stop_ratio           elapsed/moving from the 46K — aid stops, faff
//   fade                 flat ultra-fade multiplier: Riegel k=1.08 over the
//                        equivalent-distance ratio (102K ~164 eq-km vs 46K
//                        ~79 eq-km): 2.08^0.08 ≈ 1.06
//   night                slowdown while the race clock is in darkness
//                        (mid-Nov Alicante: sunrise ~07:45, sunset ~17:45)
//   readiness            maps recent training vert attainment (0..1) to a
//                        speed factor: floor + span * attainment

import { readFileSync, writeFileSync } from "node:fs";

const SRC = "data/refs/cb46k-2022-streams.json";
const OUT = "data/refs/pace-model.json";

let ref;
try {
  ref = JSON.parse(readFileSync(SRC, "utf8"));
} catch (e) {
  console.error(`fit-grade-curve: cannot read ${SRC}: ${e.message}`);
  process.exit(2);
}

const { time, distance, altitude, moving } = ref.streams;
const n = time.length;
if (!n || distance.length !== n || altitude.length !== n || moving.length !== n) {
  console.error("fit-grade-curve: stream arrays missing or mismatched");
  process.exit(2);
}

// ---- chunk the run into ~100 m moving windows: grade + speed per chunk ----
// Sample pairs are ~16 m / ~11 s; single-pair grades are altitude-noise, so
// aggregate before measuring. Pairs flagged not-moving or with dt > 60 s
// (auto-pause gaps) are dropped and close the current chunk.
const CHUNK_M = 100;
const chunks = [];
let ds = 0, dt = 0, dele = 0;
for (let i = 1; i < n; i++) {
  const pd = distance[i] - distance[i - 1];
  const pt = time[i] - time[i - 1];
  if (!moving[i] || pd <= 0 || pt <= 0 || pt > 60) {
    ds = dt = dele = 0; // discard partial chunk spanning a pause
    continue;
  }
  ds += pd; dt += pt; dele += altitude[i] - altitude[i - 1];
  if (ds >= CHUNK_M) {
    chunks.push({ g: (dele / ds) * 100, v: ds / dt, ds, dt });
    ds = dt = dele = 0;
  }
}

// ---- median speed per 4 % grade bin, thin bins dropped ----
const BIN_W = 4, MIN_CHUNKS = 6;
const byBin = new Map();
for (const c of chunks) {
  const centre = Math.round(c.g / BIN_W) * BIN_W;
  if (!byBin.has(centre)) byBin.set(centre, []);
  byBin.get(centre).push(c.v);
}
function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
let curve = [...byBin.entries()]
  .filter(([, vs]) => vs.length >= MIN_CHUNKS)
  .map(([g, vs]) => ({ g, v: median(vs), n: vs.length }))
  .sort((a, b) => a.g - b.g);

if (curve.length < 5) {
  console.error(`fit-grade-curve: only ${curve.length} usable grade bins`);
  process.exit(2);
}

// ---- light 1-2-1 smoothing (medians of adjacent bins can still zigzag) ----
curve = curve.map((p, i) => {
  const lo = curve[i - 1], hi = curve[i + 1];
  if (!lo || !hi) return { g: p.g, v: p.v, n: p.n };
  return { g: p.g, v: (lo.v + 2 * p.v + hi.v) / 4, n: p.n };
});

// ---- calibrate: walking the 46K's own chunks must reproduce its moving time ----
// Beyond the end bins, speed is extended at constant vertical rate (climb and
// descent metres/hour plateau on very steep ground) rather than clamped —
// site/course.js interpolates the published curve with the same rule.
function speedAt(g) {
  const lo = curve[0], hi = curve[curve.length - 1];
  if (g < lo.g) return (lo.v * Math.abs(lo.g)) / Math.abs(g);
  if (g > hi.g) return (hi.v * hi.g) / g;
  for (let i = 1; i < curve.length; i++) {
    if (g <= curve[i].g) {
      const a = curve[i - 1], b = curve[i];
      return a.v + ((g - a.g) / (b.g - a.g)) * (b.v - a.v);
    }
  }
  return hi.v;
}
let predT = 0, actT = 0;
for (const c of chunks) { predT += c.ds / speedAt(c.g); actT += c.dt; }
const calib = predT / actT; // >1 means the curve runs slow; scale speeds up
curve = curve.map((p) => ({ g: p.g, v: +(p.v * calib).toFixed(4), n: p.n }));

const model = {
  generated_by: "scripts/build/fit-grade-curve.mjs",
  source: {
    activity_id: ref.source.activity_id,
    name: ref.source.name,
    date: ref.source.start_date_local.slice(0, 10),
    chunks: chunks.length,
    calibration: +calib.toFixed(4),
  },
  curve,
  stop_ratio: +(ref.source.elapsed_time_s / ref.source.moving_time_s).toFixed(4),
  fade: 1.06,
  night: { mult: 1.05, sunrise_min: 465, sunset_min: 1065 },
  readiness: { weeks: 4, floor: 0.9, span: 0.1 },
};

writeFileSync(OUT, JSON.stringify(model, null, 2) + "\n");
console.log(`fit-grade-curve: ${OUT} — ${chunks.length} chunks, ${curve.length} bins, calib ${calib.toFixed(4)}`);
for (const p of curve) console.log(`  ${String(p.g).padStart(4)}%  ${p.v.toFixed(2)} m/s  (${p.n})`);
