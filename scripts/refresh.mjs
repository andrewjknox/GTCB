#!/usr/bin/env node
// Routine-refresh runner — everything after the Strava fetch, as one command:
//
//   gate A  ->  summary.mjs <week>  ->  gate B  ->  copy data/ -> site/data/
//           ->  inline-data.mjs  ->  minify.mjs  ->  gate C
//
// Run from repo root after data-agent has written data/raw/<week>.json:
//   node scripts/refresh.mjs [iso-week]      (default: current week, Europe/London)
//
// This is the token-cheap path for data-only refreshes (see CLAUDE.md
// "Pipeline & gates"): the analyst/builder work is deterministic, so no LLM
// agent is spawned for it. The full agent chain still applies when site code
// itself changes. Dependency-free Node. Exit 0 = all gates pass, 2 = blocked.

import { readFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isoWeekOf, nowLondonKey, dayOfWeek } from "./reconcile.mjs";

const nowKey = nowLondonKey();
const [y, mo, d] = nowKey.slice(0, 10).split("-").map(Number);
const week = process.argv[2] ?? isoWeekOf(y, mo, d);
if (!/^\d{4}-W\d{2}$/.test(week)) {
  console.error("usage: node scripts/refresh.mjs [iso-week]   e.g. 2026-W29");
  process.exit(2);
}

function step(name, args) {
  console.log(`refresh: ${name}`);
  const res = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (res.status !== 0) {
    console.error(`refresh: BLOCKED at ${name} (exit ${res.status ?? "?"})`);
    process.exit(2);
  }
}

step("gate A (raw)", ["scripts/gates/gate-a.mjs"]);
if (existsSync(`data/raw/${week}.json`)) {
  step(`summary ${week}`, ["scripts/build/summary.mjs", week]);
} else {
  // No fetch for this week yet (e.g. CI before Monday's data-agent run) —
  // rebuild from the summaries already committed; gates still verify them.
  console.log(`refresh: no data/raw/${week}.json — skipping summary, rebuilding from committed data`);
}
step("gate B (summary)", ["scripts/gates/gate-b.mjs"]);

// Copy plan + summaries into site/data/ byte-identically (Gate C check 4).
console.log("refresh: copy data/ -> site/data/");
try {
  mkdirSync("site/data/summary", { recursive: true });
  copyFileSync("data/plan.json", "site/data/plan.json");
  copyFileSync("data/summary/index.json", "site/data/summary/index.json");
  const { weeks } = JSON.parse(readFileSync("data/summary/index.json", "utf8"));
  for (const w of weeks) {
    copyFileSync(`data/summary/${w}.json`, `site/data/summary/${w}.json`);
  }
  // Weekly debrief reports ride along when present (generated on demand by
  // scripts/report.mjs — see CLAUDE.md) so Gate C fidelity + data.js stay true.
  if (existsSync("data/reports/index.json")) {
    mkdirSync("site/data/reports", { recursive: true });
    copyFileSync("data/reports/index.json", "site/data/reports/index.json");
    const reports = JSON.parse(readFileSync("data/reports/index.json", "utf8")).weeks ?? [];
    for (const w of reports) {
      copyFileSync(`data/reports/${w}.json`, `site/data/reports/${w}.json`);
    }
  }
} catch (e) {
  console.error(`refresh: BLOCKED at copy — ${e.message}`);
  process.exit(2);
}

step("inline-data", ["scripts/build/inline-data.mjs"]);
step("minify", ["scripts/build/minify.mjs"]);
step("gate C (site)", ["scripts/gates/gate-c.mjs"]);

const midWeek = dayOfWeek(y, mo, d) !== 7 ? " (mid-week)" : "";
console.log(`refresh: OK — commit as: refresh: ${week}${midWeek}`);
