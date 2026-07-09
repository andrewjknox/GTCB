#!/usr/bin/env node
// Shared reconciliation module — recomputes weekly totals from a raw week file
// and data/plan.json (see CLAUDE.md "Data shapes"). Dependency-free.
//
// Module use:   import { reconcileWeek } from "./reconcile.mjs";
// CLI use:      node scripts/reconcile.mjs 2026-W28   (from repo root)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const ON_FOOT = new Set(["Run", "TrailRun", "VirtualRun", "Walk", "Hike"]);

// ---------- shared date helpers ----------

// Parse "YYYY-MM-DDTHH:MM:SS" (optionally with trailing Z/offset, which we strip —
// all pipeline datetimes are wall-clock Europe/London). Returns parts or null.
export function parseLocalIso(s) {
  if (typeof s !== "string") return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null;
  const utc = Date.UTC(y, mo - 1, d, h, mi, se);
  const dt = new Date(utc);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, mo, d, h, mi, se, utc, key: s.slice(0, 19) };
}

// ISO 8601 week of a calendar date, e.g. "2026-W28".
export function isoWeekOf(y, mo, d) {
  const date = new Date(Date.UTC(y, mo - 1, d));
  const dayNum = date.getUTCDay() || 7; // Mon=1..Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum); // nearest Thursday
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// Day of week, Mon=1..Sun=7.
export function dayOfWeek(y, mo, d) {
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay() || 7;
}

// Current wall-clock datetime in Europe/London as a "YYYY-MM-DDTHH:MM:SS" key.
export function nowLondonKey() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}:${p.second}`;
}

// ---------- reconciliation ----------

/**
 * Recompute weekly totals and daily buckets from a raw week document + plan.
 * @param {object} raw  parsed data/raw/YYYY-Www.json
 * @param {object} plan parsed data/plan.json
 * @returns recomputed numbers (on-foot sums; sessions_count counts ALL activities)
 */
export function reconcileWeek(raw, plan) {
  const start = parseLocalIso(raw?.window?.start);
  if (!start) throw new Error(`raw window.start ${JSON.stringify(raw?.window?.start)} does not parse`);
  const activities = Array.isArray(raw?.activities) ? raw.activities : [];

  // Mon..Sun daily buckets from window.start
  const daily = [];
  const byDate = new Map();
  for (let i = 0; i < 7; i++) {
    const dt = new Date(start.utc + i * 86400000);
    const date = dt.toISOString().slice(0, 10);
    const bucket = { date, vert_m: 0, time_s: 0, distance_m: 0 };
    daily.push(bucket);
    byDate.set(date, bucket);
  }

  let vert_actual_m = 0, time_on_feet_s = 0, distance_m = 0, on_foot_count = 0;
  for (const a of activities) {
    if (!ON_FOOT.has(a?.sport_type)) continue;
    on_foot_count++;
    vert_actual_m += a.elevation_gain_m ?? 0;
    time_on_feet_s += a.moving_time_s ?? 0;
    distance_m += a.distance_m ?? 0;
    const date = typeof a.start_date_local === "string" ? a.start_date_local.slice(0, 10) : "";
    const bucket = byDate.get(date);
    if (bucket) {
      bucket.vert_m += a.elevation_gain_m ?? 0;
      bucket.time_s += a.moving_time_s ?? 0;
      bucket.distance_m += a.distance_m ?? 0;
    }
  }

  const planWeek = (plan?.weeks ?? []).find((w) => w.iso_week === raw.iso_week) ?? null;

  return {
    iso_week: raw.iso_week,
    training_week: planWeek?.week ?? null,
    phase: planWeek?.phase ?? null,
    vert_target_m: planWeek?.vert_target_m ?? null,
    vert_actual_m,
    time_on_feet_s,
    distance_m,
    sessions_count: activities.length,
    on_foot_count,
    daily,
  };
}

// ---------- CLI ----------

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const week = process.argv[2];
  if (!week) {
    console.error("usage: node scripts/reconcile.mjs <iso-week>   e.g. node scripts/reconcile.mjs 2026-W28");
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(`data/raw/${week}.json`, "utf8"));
  const plan = JSON.parse(readFileSync("data/plan.json", "utf8"));
  console.log(JSON.stringify(reconcileWeek(raw, plan), null, 2));
}
