#!/usr/bin/env node
// Gate R — validates every data/reports/*.json (except index.json) against the
// report schema (see CLAUDE.md). Reports are narrative-only: numbers render
// live from data/summary/, so this gate checks shape and completeness, not
// figures. Absence of data/reports/ is fine (reports are generated on demand).
// Dependency-free Node. Exit 0 = pass, exit 2 = block.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPORTS_DIR = "data/reports";
const SUMMARY_DIR = "data/summary";
const PLAN_PATH = "data/plan.json";

const SCHEMA_KEYS = ["iso_week", "training_week", "generated_at", "headline", "narrative"];

if (!existsSync(REPORTS_DIR)) {
  console.log("gate-r: no data/reports/ — nothing to validate");
  process.exit(0);
}

let plan;
try {
  plan = JSON.parse(readFileSync(PLAN_PATH, "utf8"));
} catch (e) {
  console.error(`gate-r: cannot read ${PLAN_PATH}: ${e.message}`);
  process.exit(2);
}
const planByIso = new Map((plan.weeks ?? []).map((w) => [w.iso_week, w]));

let files;
try {
  files = readdirSync(REPORTS_DIR)
    .filter((f) => f.endsWith(".json") && f !== "index.json")
    .sort();
} catch (e) {
  console.error(`gate-r: cannot read ${REPORTS_DIR}/: ${e.message}`);
  process.exit(2);
}

let failed = false;

function validate(file) {
  const errs = [];
  let doc;

  // parses
  try {
    doc = JSON.parse(readFileSync(join(REPORTS_DIR, file), "utf8"));
  } catch (e) {
    return [`does not parse as JSON: ${e.message}`];
  }

  // filename pattern + iso_week match
  if (!/^\d{4}-W\d{2}\.json$/.test(file)) {
    errs.push(`filename is not YYYY-Www.json`);
  }
  const expectedIsoWeek = file.replace(/\.json$/, "");
  if (doc.iso_week !== expectedIsoWeek) {
    errs.push(`iso_week ${JSON.stringify(doc.iso_week)} does not match filename (expected "${expectedIsoWeek}")`);
  }

  // exact key set — narrative-only artifact, no stats allowed to creep in
  const keys = Object.keys(doc ?? {});
  for (const k of keys) {
    if (!SCHEMA_KEYS.includes(k)) errs.push(`unknown key "${k}"`);
  }
  for (const k of SCHEMA_KEYS) {
    if (!keys.includes(k)) errs.push(`missing key "${k}"`);
  }

  // training_week agrees with plan.json
  const planWeek = planByIso.get(expectedIsoWeek);
  if (!planWeek) {
    errs.push(`iso_week ${expectedIsoWeek} not found in plan.json`);
  } else if (doc.training_week !== planWeek.week) {
    errs.push(`training_week ${JSON.stringify(doc.training_week)} disagrees with plan.json (${planWeek.week})`);
  }

  // only completed weeks get reports: matching summary must exist, days_elapsed 7
  const summaryPath = join(SUMMARY_DIR, file);
  if (!existsSync(summaryPath)) {
    errs.push(`no matching summary ${summaryPath} — week not in pipeline`);
  } else {
    try {
      const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
      if (summary.days_elapsed !== 7) {
        errs.push(`summary days_elapsed is ${JSON.stringify(summary.days_elapsed)} — reports are for completed weeks only`);
      }
    } catch (e) {
      errs.push(`cannot parse ${summaryPath}: ${e.message}`);
    }
  }

  // generated_at parses
  if (typeof doc.generated_at !== "string" || Number.isNaN(Date.parse(doc.generated_at))) {
    errs.push(`generated_at ${JSON.stringify(doc.generated_at)} does not parse as a date`);
  }

  // headline: non-empty string, sane length
  if (typeof doc.headline !== "string" || doc.headline.trim().length === 0) {
    errs.push(`headline is not a non-empty string`);
  } else if (doc.headline.length > 80) {
    errs.push(`headline is ${doc.headline.length} chars (max 80)`);
  }

  // narrative: 1-3 non-empty paragraph strings, 40-250 words total
  if (!Array.isArray(doc.narrative) || doc.narrative.length < 1 || doc.narrative.length > 3) {
    errs.push(`narrative has ${Array.isArray(doc.narrative) ? doc.narrative.length : "no"} paragraphs, expected 1-3`);
  } else if (doc.narrative.some((p) => typeof p !== "string" || p.trim().length === 0)) {
    errs.push(`narrative contains a non-string or empty paragraph`);
  } else {
    const words = doc.narrative.join(" ").split(/\s+/).filter(Boolean).length;
    if (words < 40 || words > 250) {
      errs.push(`narrative is ${words} words, expected 40-250`);
    }
  }

  return errs;
}

for (const file of files) {
  const errs = validate(file);
  if (errs.length) {
    failed = true;
    console.error(`gate-r: ${file} FAIL — ${errs.join("; ")}`);
  } else {
    console.log(`gate-r: ${file} OK`);
  }
}

// index.json lists exactly the report files present (sorted) — mirror of Gate B check 7
const expectedWeeks = files.map((f) => f.replace(/\.json$/, "")); // already sorted
const indexPath = join(REPORTS_DIR, "index.json");
if (!existsSync(indexPath)) {
  failed = true;
  console.error(`gate-r: index.json FAIL — ${indexPath} does not exist (run scripts/report.mjs)`);
} else {
  try {
    const idx = JSON.parse(readFileSync(indexPath, "utf8"));
    const weeks = Array.isArray(idx.weeks) ? idx.weeks : null;
    if (!weeks || weeks.length !== expectedWeeks.length || weeks.some((w, i) => w !== expectedWeeks[i])) {
      failed = true;
      console.error(
        `gate-r: index.json FAIL — weeks ${JSON.stringify(weeks)} != report files present ${JSON.stringify(expectedWeeks)}`
      );
    } else {
      console.log(`gate-r: index.json OK (${weeks.length} reports)`);
    }
  } catch (e) {
    failed = true;
    console.error(`gate-r: index.json FAIL — does not parse as JSON: ${e.message}`);
  }
}

process.exit(failed ? 2 : 0);
