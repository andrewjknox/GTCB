#!/usr/bin/env node
// Weekly-report runner — everything after report-agent has written the
// narrative, as one command:
//
//   reports index rewrite  ->  gate R  ->  copy data/reports/ -> site/data/reports/
//                          ->  inline-data.mjs  ->  minify.mjs  ->  gate C
//
// Run from repo root after report-agent has written data/reports/<week>.json:
//   node scripts/report.mjs <iso-week>
//
// Part of the on-demand weekly report flow (see CLAUDE.md "Pipeline & gates"):
// data-agent fetch -> refresh.mjs (finalizes the summary) -> report-agent
// (narrative) -> this script. Deterministic, dependency-free Node.
// Exit 0 = all gates pass, 2 = blocked.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const week = process.argv[2];
if (!/^\d{4}-W\d{2}$/.test(week ?? "")) {
  console.error("usage: node scripts/report.mjs <iso-week>   e.g. 2026-W28");
  process.exit(2);
}
if (!existsSync(`data/reports/${week}.json`)) {
  console.error(`report: data/reports/${week}.json not found — run report-agent first`);
  process.exit(2);
}

function step(name, args) {
  console.log(`report: ${name}`);
  const res = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (res.status !== 0) {
    console.error(`report: BLOCKED at ${name} (exit ${res.status ?? "?"})`);
    process.exit(2);
  }
}

// index.json = exactly the report files present, sorted (Gate R index check)
const weeks = readdirSync("data/reports")
  .filter((f) => /^\d{4}-W\d{2}\.json$/.test(f))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();
writeFileSync("data/reports/index.json", `${JSON.stringify({ weeks }, null, 2)}\n`);
console.log(`report: index.json ${weeks.length} report(s)`);

step("gate R (reports)", ["scripts/gates/gate-r.mjs"]);

// Copy reports into site/data/ byte-identically (Gate C check 4).
console.log("report: copy data/reports/ -> site/data/reports/");
try {
  mkdirSync("site/data/reports", { recursive: true });
  copyFileSync("data/reports/index.json", "site/data/reports/index.json");
  for (const w of weeks) {
    copyFileSync(`data/reports/${w}.json`, `site/data/reports/${w}.json`);
  }
} catch (e) {
  console.error(`report: BLOCKED at copy — ${e.message}`);
  process.exit(2);
}

step("inline-data", ["scripts/build/inline-data.mjs"]);
step("minify", ["scripts/build/minify.mjs"]);
step("gate C (site)", ["scripts/gates/gate-c.mjs"]);

console.log(`report: OK — commit as: report: ${week}`);
