#!/usr/bin/env node
// Gate D — validates the newest reviewer verdict in data/review/ against the
// verdict contract (05_REVIEWER.md). Dependency-free Node.
// Exit 0 only on a well-formed "pass"; exit 2 on block or any malformation.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const REVIEW_DIR = "data/review";
const INVARIANTS = ["1", "2", "3", "3a", "4", "5", "6", "7"];

function fail(msg) {
  console.error(`gate-d: FAIL — ${msg}`);
  process.exit(2);
}

// ---------- newest review file by mtime ----------

let files;
try {
  files = readdirSync(REVIEW_DIR).filter((f) => f.endsWith(".json"));
} catch (e) {
  fail(`cannot read ${REVIEW_DIR}/: ${e.message}`);
}
if (files.length === 0) fail("no review files found");

const newest = files
  .map((f) => ({ f, mtime: statSync(join(REVIEW_DIR, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime)[0].f;
const path = join(REVIEW_DIR, newest);

// ---------- parse ----------

let doc;
try {
  doc = JSON.parse(readFileSync(path, "utf8"));
} catch (e) {
  fail(`${newest} does not parse as JSON: ${e.message}`);
}

// ---------- verdict value ----------

if (doc.verdict !== "pass" && doc.verdict !== "block") {
  fail(`${newest}: verdict ${JSON.stringify(doc.verdict)} is not "pass" or "block"`);
}

// ---------- checks: every entry well-formed, all 8 invariant ids covered ----------

if (!Array.isArray(doc.checks)) fail(`${newest}: checks is not an array`);

const covered = new Set();
for (const [i, c] of doc.checks.entries()) {
  const inv = c?.invariant;
  if (!INVARIANTS.includes(inv)) {
    fail(`${newest}: checks[${i}].invariant ${JSON.stringify(inv)} is not one of ${INVARIANTS.join(", ")}`);
  }
  if (c.result !== "pass" && c.result !== "fail") {
    fail(`${newest}: checks[${i}].result ${JSON.stringify(c.result)} is not "pass" or "fail"`);
  }
  covered.add(inv);
}
const missing = INVARIANTS.filter((id) => !covered.has(id));
if (missing.length) fail(`${newest}: checks do not cover invariant(s) ${missing.join(", ")}`);

// ---------- verdict consistent with checks (block iff >=1 fail) ----------

const failedChecks = doc.checks.filter((c) => c.result === "fail");
const expectedVerdict = failedChecks.length > 0 ? "block" : "pass";
if (doc.verdict !== expectedVerdict) {
  fail(
    `${newest}: verdict "${doc.verdict}" inconsistent with checks ` +
    `(${failedChecks.length} failed check(s) -> expected "${expectedVerdict}")`
  );
}

// ---------- reasons: array of strings, non-empty iff block ----------

if (!Array.isArray(doc.reasons) || doc.reasons.some((r) => typeof r !== "string")) {
  fail(`${newest}: reasons is not an array of strings`);
}
if (doc.verdict === "pass" && doc.reasons.length > 0) {
  fail(`${newest}: reasons must be empty when verdict is "pass" (got ${doc.reasons.length})`);
}
if (doc.verdict === "block" && doc.reasons.length === 0) {
  fail(`${newest}: reasons must be non-empty when verdict is "block"`);
}

// ---------- block verdict blocks the pipeline ----------

if (doc.verdict === "block") {
  console.error(`gate-d: ${newest} verdict is BLOCK:`);
  for (const r of doc.reasons) console.error(`gate-d:   reason: ${r}`);
  for (const c of failedChecks) console.error(`gate-d:   invariant ${c.invariant} failed: ${c.detail ?? ""}`);
  process.exit(2);
}

console.log(`gate-d: ${newest} OK (verdict: pass, ${doc.checks.length} checks, all invariants covered)`);
process.exit(0);
