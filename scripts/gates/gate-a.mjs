#!/usr/bin/env node
// Gate A — validates every data/raw/*.json against the raw schema (see CLAUDE.md).
// Dependency-free Node. Exit 0 = pass, exit 2 = block.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const RAW_DIR = "data/raw";
const PLAN_PATH = "data/plan.json";

// ---------- helpers ----------

// Parse "YYYY-MM-DDTHH:MM:SS" (optionally with trailing Z/offset, which we strip —
// all pipeline datetimes are wall-clock Europe/London). Returns parts or null.
function parseLocalIso(s) {
  if (typeof s !== "string") return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null;
  const utc = Date.UTC(y, mo - 1, d, h, mi, se);
  const dt = new Date(utc);
  // reject invalid dates like Feb 30 (Date.UTC rolls them over)
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, mo, d, h, mi, se, utc, key: s.slice(0, 19) };
}

// ISO 8601 week of a calendar date, e.g. "2026-W28".
function isoWeekOf(y, mo, d) {
  const date = new Date(Date.UTC(y, mo - 1, d));
  const dayNum = date.getUTCDay() || 7; // Mon=1..Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum); // nearest Thursday
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function dayOfWeek(y, mo, d) {
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay() || 7; // Mon=1..Sun=7
}

function isNonNegNumber(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

// ---------- load plan ----------

let plan;
try {
  plan = JSON.parse(readFileSync(PLAN_PATH, "utf8"));
} catch (e) {
  console.error(`gate-a: cannot read ${PLAN_PATH}: ${e.message}`);
  process.exit(2);
}
const planByWeek = new Map((plan.weeks ?? []).map((w) => [w.week, w.iso_week]));

// ---------- collect files ----------

let files;
try {
  files = readdirSync(RAW_DIR).filter((f) => f.endsWith(".json")).sort();
} catch (e) {
  console.error(`gate-a: cannot read ${RAW_DIR}/: ${e.message}`);
  process.exit(2);
}
if (files.length === 0) {
  console.error("gate-a: no raw files found");
  process.exit(2);
}

// ---------- validate each file ----------

let failed = false;

function validate(file) {
  const errs = [];
  let doc;

  // 1. parses as JSON
  try {
    doc = JSON.parse(readFileSync(join(RAW_DIR, file), "utf8"));
  } catch (e) {
    return [`does not parse as JSON: ${e.message}`];
  }

  // 2. iso_week matches filename
  const expectedIsoWeek = file.replace(/\.json$/, "");
  if (doc.iso_week !== expectedIsoWeek) {
    errs.push(`iso_week "${doc.iso_week}" does not match filename (expected "${expectedIsoWeek}")`);
  }

  // 3. window: Monday 00:00:00 → following Sunday 23:59:59, tz Europe/London, ISO week matches
  const win = doc.window ?? {};
  const start = parseLocalIso(win.start);
  const end = parseLocalIso(win.end);
  if (!start) {
    errs.push(`window.start "${win.start}" does not parse`);
  } else {
    if (dayOfWeek(start.y, start.mo, start.d) !== 1) errs.push(`window.start ${win.start} is not a Monday`);
    if (start.h !== 0 || start.mi !== 0 || start.se !== 0) errs.push(`window.start ${win.start} is not 00:00:00`);
    const startIsoWeek = isoWeekOf(start.y, start.mo, start.d);
    if (startIsoWeek !== doc.iso_week) {
      errs.push(`ISO week of window.start (${startIsoWeek}) does not equal iso_week (${doc.iso_week})`);
    }
  }
  if (!end) {
    errs.push(`window.end "${win.end}" does not parse`);
  } else {
    if (dayOfWeek(end.y, end.mo, end.d) !== 7) errs.push(`window.end ${win.end} is not a Sunday`);
    if (end.h !== 23 || end.mi !== 59 || end.se !== 59) errs.push(`window.end ${win.end} is not 23:59:59`);
  }
  if (start && end) {
    const expectedEndUtc = start.utc + 6 * 86400000 + (23 * 3600 + 59 * 60 + 59) * 1000;
    if (end.utc !== expectedEndUtc) errs.push(`window.end is not the Sunday 23:59:59 following window.start`);
  }
  if (win.tz !== "Europe/London") errs.push(`window.tz "${win.tz}" !== "Europe/London"`);

  // 4. training_week integer 1–23, consistent with plan.json
  const tw = doc.training_week;
  if (!Number.isInteger(tw) || tw < 1 || tw > 23) {
    errs.push(`training_week ${JSON.stringify(tw)} is not an integer 1-23`);
  } else if (planByWeek.get(tw) !== doc.iso_week) {
    errs.push(`training_week ${tw} maps to ${planByWeek.get(tw) ?? "nothing"} in plan.json, not ${doc.iso_week}`);
  }

  // 5. fetched_at parses as a date
  if (typeof doc.fetched_at !== "string" || Number.isNaN(Date.parse(doc.fetched_at))) {
    errs.push(`fetched_at ${JSON.stringify(doc.fetched_at)} does not parse as a date`);
  }

  // 6. activities array + per-activity fields
  if (!Array.isArray(doc.activities)) {
    errs.push(`activities is not an array`);
  } else {
    doc.activities.forEach((a, i) => {
      const where = `activities[${i}]`;
      if (typeof a?.id !== "number") errs.push(`${where}.id is not a number`);
      if (typeof a?.name !== "string") errs.push(`${where}.name is not a string`);
      if (typeof a?.sport_type !== "string") errs.push(`${where}.sport_type is not a string`);
      const sdl = parseLocalIso(a?.start_date_local);
      if (!sdl) {
        errs.push(`${where}.start_date_local ${JSON.stringify(a?.start_date_local)} does not parse`);
      } else if (start && end && (sdl.key < start.key || sdl.key > end.key)) {
        errs.push(`${where}.start_date_local ${a.start_date_local} lies outside [${win.start}, ${win.end}]`);
      }
      for (const f of ["distance_m", "moving_time_s", "elapsed_time_s", "elevation_gain_m"]) {
        if (!isNonNegNumber(a?.[f])) errs.push(`${where}.${f} ${JSON.stringify(a?.[f])} is not a number >= 0`);
      }
      if (a?.description !== null && typeof a?.description !== "string") {
        errs.push(`${where}.description is neither string nor null`);
      }
    });
  }

  return errs.length ? errs : { count: doc.activities?.length ?? 0 };
}

for (const file of files) {
  const result = validate(file);
  if (Array.isArray(result)) {
    failed = true;
    console.error(`gate-a: ${file} FAIL — ${result.join("; ")}`);
  } else {
    console.log(`gate-a: ${file} OK (${result.count} activities)`);
  }
}

process.exit(failed ? 2 : 0);
