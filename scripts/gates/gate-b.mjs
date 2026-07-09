#!/usr/bin/env node
// Gate B — validates every data/summary/*.json (except index.json) against the
// summary schema (see CLAUDE.md) and reconciles totals against data/raw/.
// Dependency-free Node. Exit 0 = pass, exit 2 = block.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  reconcileWeek, parseLocalIso, isoWeekOf, dayOfWeek, nowLondonKey,
} from "../reconcile.mjs";

const SUMMARY_DIR = "data/summary";
const RAW_DIR = "data/raw";
const PLAN_PATH = "data/plan.json";

// Numeric tolerance: both 0, or |a-b| <= 1% of the larger magnitude.
function ok(a, b) {
  if (a === 0 && b === 0) return true;
  return Math.abs(a - b) <= 0.01 * Math.max(Math.abs(a), Math.abs(b));
}

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

// ---------- load plan ----------

let plan;
try {
  plan = JSON.parse(readFileSync(PLAN_PATH, "utf8"));
} catch (e) {
  console.error(`gate-b: cannot read ${PLAN_PATH}: ${e.message}`);
  process.exit(2);
}
const planByIso = new Map((plan.weeks ?? []).map((w) => [w.iso_week, w]));

// ---------- collect files ----------

let files;
try {
  files = readdirSync(SUMMARY_DIR)
    .filter((f) => f.endsWith(".json") && f !== "index.json")
    .sort();
} catch (e) {
  console.error(`gate-b: cannot read ${SUMMARY_DIR}/: ${e.message}`);
  process.exit(2);
}
if (files.length === 0) {
  console.error("gate-b: no summary files found");
  process.exit(2);
}

let failed = false;
const nowKey = nowLondonKey();

// ---------- validate each summary file ----------

function validate(file) {
  const errs = [];
  let doc;

  // 1a. parses
  try {
    doc = JSON.parse(readFileSync(join(SUMMARY_DIR, file), "utf8"));
  } catch (e) {
    return [`does not parse as JSON: ${e.message}`];
  }

  // 1b. iso_week matches filename
  const expectedIsoWeek = file.replace(/\.json$/, "");
  if (doc.iso_week !== expectedIsoWeek) {
    errs.push(`iso_week "${doc.iso_week}" does not match filename (expected "${expectedIsoWeek}")`);
  }

  // 1c. window rules identical to Gate A
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

  // 1d. training_week / phase / vert.target_m agree with plan.json
  const planWeek = planByIso.get(doc.iso_week);
  if (!planWeek) {
    errs.push(`iso_week ${doc.iso_week} not found in plan.json`);
  } else {
    if (doc.training_week !== planWeek.week) {
      errs.push(`training_week ${JSON.stringify(doc.training_week)} disagrees with plan.json (${planWeek.week})`);
    }
    if (doc.phase !== planWeek.phase) {
      errs.push(`phase ${JSON.stringify(doc.phase)} disagrees with plan.json (${planWeek.phase})`);
    }
    if (doc.vert?.target_m !== planWeek.vert_target_m) {
      errs.push(`vert.target_m ${JSON.stringify(doc.vert?.target_m)} disagrees with plan.json (${planWeek.vert_target_m})`);
    }
  }

  // 1e. generated_at parses
  if (typeof doc.generated_at !== "string" || Number.isNaN(Date.parse(doc.generated_at))) {
    errs.push(`generated_at ${JSON.stringify(doc.generated_at)} does not parse as a date`);
  }

  // 3. reconciliation vs matching raw file
  const rawPath = join(RAW_DIR, file);
  if (!existsSync(rawPath)) {
    errs.push(`no matching raw file ${rawPath}`);
  } else {
    let rec = null;
    try {
      rec = reconcileWeek(JSON.parse(readFileSync(rawPath, "utf8")), plan);
    } catch (e) {
      errs.push(`reconciliation failed: ${e.message}`);
    }
    if (rec) {
      if (!isNum(doc.vert?.actual_m) || !ok(doc.vert.actual_m, rec.vert_actual_m)) {
        errs.push(`vert.actual_m ${JSON.stringify(doc.vert?.actual_m)} not within 1% of recomputed ${rec.vert_actual_m}`);
      }
      if (!isNum(doc.time_on_feet?.actual_s) || !ok(doc.time_on_feet.actual_s, rec.time_on_feet_s)) {
        errs.push(`time_on_feet.actual_s ${JSON.stringify(doc.time_on_feet?.actual_s)} not within 1% of recomputed ${rec.time_on_feet_s}`);
      }
      if (!isNum(doc.distance?.actual_m) || !ok(doc.distance.actual_m, rec.distance_m)) {
        errs.push(`distance.actual_m ${JSON.stringify(doc.distance?.actual_m)} not within 1% of recomputed ${rec.distance_m}`);
      }
      if (doc.sessions?.count !== rec.sessions_count) {
        errs.push(`sessions.count ${JSON.stringify(doc.sessions?.count)} !== recomputed ${rec.sessions_count}`);
      }
      if (doc.sessions?.on_foot_count !== rec.on_foot_count) {
        errs.push(`sessions.on_foot_count ${JSON.stringify(doc.sessions?.on_foot_count)} !== recomputed ${rec.on_foot_count}`);
      }
    }
  }

  // 4. days_elapsed + derived numbers
  const de = doc.days_elapsed;
  if (!Number.isInteger(de) || de < 1 || de > 7) {
    errs.push(`days_elapsed ${JSON.stringify(de)} is not an integer 1-7`);
  } else {
    if (end && end.key < nowKey && de !== 7) {
      errs.push(`window.end is in the past but days_elapsed is ${de}, expected 7`);
    }
    const target = planWeek?.vert_target_m;
    if (isNum(target)) {
      const expectedProrated = Math.round((target * de) / 7);
      if (!isNum(doc.vert?.prorated_target_m) || Math.abs(doc.vert.prorated_target_m - expectedProrated) > 1) {
        errs.push(`vert.prorated_target_m ${JSON.stringify(doc.vert?.prorated_target_m)} != round(${target}*${de}/7)=${expectedProrated} (±1)`);
      }
      if (isNum(doc.vert?.actual_m)) {
        const expectedPct = target === 0 ? 0 : Math.round((100 * doc.vert.actual_m) / target);
        if (!isNum(doc.vert?.pct_of_target) || Math.abs(doc.vert.pct_of_target - expectedPct) > 1) {
          errs.push(`vert.pct_of_target ${JSON.stringify(doc.vert?.pct_of_target)} != ${expectedPct} (±1)`);
        }
        const prorated = doc.vert?.prorated_target_m;
        if (isNum(prorated)) {
          const expectedPctPro = prorated === 0 ? 0 : Math.round((100 * doc.vert.actual_m) / prorated);
          if (!isNum(doc.vert?.pct_of_prorated) || Math.abs(doc.vert.pct_of_prorated - expectedPctPro) > 1) {
            errs.push(`vert.pct_of_prorated ${JSON.stringify(doc.vert?.pct_of_prorated)} != ${expectedPctPro} (±1)`);
          }
        }
      }
    }
  }

  // 5. daily: exactly 7 entries, Mon..Sun dates in order, sums reconcile with totals
  if (!Array.isArray(doc.daily) || doc.daily.length !== 7) {
    errs.push(`daily has ${Array.isArray(doc.daily) ? doc.daily.length : "no"} entries, expected exactly 7`);
  } else if (start) {
    let sumV = 0, sumT = 0, sumD = 0;
    doc.daily.forEach((day, i) => {
      const expectedDate = new Date(start.utc + i * 86400000).toISOString().slice(0, 10);
      if (day?.date !== expectedDate) {
        errs.push(`daily[${i}].date ${JSON.stringify(day?.date)} expected ${expectedDate}`);
      }
      sumV += day?.vert_m ?? 0;
      sumT += day?.time_s ?? 0;
      sumD += day?.distance_m ?? 0;
    });
    if (isNum(doc.vert?.actual_m) && !ok(sumV, doc.vert.actual_m)) {
      errs.push(`daily vert sum ${sumV} not within 1% of vert.actual_m ${doc.vert.actual_m}`);
    }
    if (isNum(doc.time_on_feet?.actual_s) && !ok(sumT, doc.time_on_feet.actual_s)) {
      errs.push(`daily time sum ${sumT} not within 1% of time_on_feet.actual_s ${doc.time_on_feet.actual_s}`);
    }
    if (isNum(doc.distance?.actual_m) && !ok(sumD, doc.distance.actual_m)) {
      errs.push(`daily distance sum ${sumD} not within 1% of distance.actual_m ${doc.distance.actual_m}`);
    }
  }

  // 6. flags
  if (!Array.isArray(doc.flags)) {
    errs.push(`flags is not an array`);
  } else {
    doc.flags.forEach((f, i) => {
      if (typeof f?.type !== "string") errs.push(`flags[${i}].type is not a string`);
      if (typeof f?.detail !== "string") errs.push(`flags[${i}].detail is not a string`);
    });
  }

  return errs;
}

for (const file of files) {
  const errs = validate(file);
  if (errs.length) {
    failed = true;
    console.error(`gate-b: ${file} FAIL — ${errs.join("; ")}`);
  } else {
    console.log(`gate-b: ${file} OK`);
  }
}

// 7. index.json lists exactly the summary files present (sorted)
const expectedWeeks = files.map((f) => f.replace(/\.json$/, "")); // already sorted
const indexPath = join(SUMMARY_DIR, "index.json");
if (!existsSync(indexPath)) {
  failed = true;
  console.error(`gate-b: index.json FAIL — ${indexPath} does not exist`);
} else {
  try {
    const idx = JSON.parse(readFileSync(indexPath, "utf8"));
    const weeks = Array.isArray(idx.weeks) ? idx.weeks : null;
    if (!weeks || weeks.length !== expectedWeeks.length || weeks.some((w, i) => w !== expectedWeeks[i])) {
      failed = true;
      console.error(
        `gate-b: index.json FAIL — weeks ${JSON.stringify(weeks)} != summary files present ${JSON.stringify(expectedWeeks)}`
      );
    } else {
      console.log(`gate-b: index.json OK (${weeks.length} weeks)`);
    }
  } catch (e) {
    failed = true;
    console.error(`gate-b: index.json FAIL — does not parse as JSON: ${e.message}`);
  }
}

process.exit(failed ? 2 : 0);
