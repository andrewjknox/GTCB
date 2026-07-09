#!/usr/bin/env node
// Gate C — validates the built site/ against CLAUDE.md invariants:
// HTML validity, relative URLs only, TMS9918 palette lockdown, data fidelity,
// metric fields consumed, git diff scope, non-empty index.html, minified JS shipped.
// Dependency-free Node (html-validate is spawned via npx). Exit 0 = pass, 2 = block.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const SITE_DIR = "site";
const DATA_DIR = "data";

const TMS9918 = new Set([
  "#000000", "#3eb849", "#74d07d", "#5955e0", "#8076f1", "#b95e51", "#65dbef",
  "#db6559", "#ff897d", "#ccc35e", "#ded087", "#3aa241", "#b766b5", "#cccccc", "#ffffff",
  "#000", "#fff", // shorthand for black/white
]);

const METRIC_FIELDS = [
  "actual_m", "target_m", "prorated_target_m", "pct_of_target", "pct_of_prorated",
  "time_on_feet", "distance", "sessions", "on_foot_count", "daily", "flags",
  "phase", "training_week",
];

// ---------- helpers ----------

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function siteTextFiles(exts) {
  return walk(SITE_DIR).filter((p) => exts.some((e) => p.toLowerCase().endsWith(e)));
}

const results = [];
function report(name, errs) {
  if (errs.length) {
    results.push(false);
    console.error(`gate-c: ${name} FAIL — ${errs.join("; ")}`);
  } else {
    results.push(true);
    console.log(`gate-c: ${name} OK`);
  }
}

if (!existsSync(SITE_DIR)) {
  console.error(`gate-c: ${SITE_DIR}/ does not exist`);
  process.exit(2);
}

// ---------- check 1: HTML validity via html-validate ----------
{
  const errs = [];
  const htmlFiles = siteTextFiles([".html", ".htm"]);
  if (htmlFiles.length === 0) {
    errs.push("no HTML files found in site/");
  } else {
    const cmd = `npx --yes html-validate ${htmlFiles.map((f) => JSON.stringify(f)).join(" ")}`;
    const res = spawnSync(cmd, { shell: true, encoding: "utf8", timeout: 180000 });
    if (res.error) {
      errs.push(`could not run html-validate: ${res.error.message}`);
    } else if (res.status !== 0) {
      const detail = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim().replace(/\s*\n\s*/g, " | ");
      errs.push(`html-validate exit ${res.status}: ${detail.slice(0, 1500)}`);
    }
  }
  report("check-1 html-valid", errs);
}

// ---------- check 2: relative URLs only ----------
{
  const errs = [];
  const patterns = [`href="/`, `href='/`, `src="/`, `src='/`, `url(/`, `fetch("/`, `fetch('/`];
  for (const file of siteTextFiles([".html", ".htm", ".css", ".js", ".mjs"])) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const pat of patterns) {
        if (line.includes(pat)) errs.push(`${file}:${i + 1} contains ${pat}`);
      }
    });
  }
  report("check-2 relative-urls", errs);
}

// ---------- check 3: TMS9918 palette lockdown ----------
{
  const errs = [];
  const hexRe = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g;
  for (const file of siteTextFiles([".html", ".htm", ".css", ".js", ".mjs"])) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const m of line.matchAll(hexRe)) {
        if (!TMS9918.has(m[0].toLowerCase())) {
          errs.push(`${file}:${i + 1} off-palette color ${m[0]}`);
        }
      }
    });
  }
  report("check-3 palette", errs);
}

// ---------- check 4: data fidelity (site/data byte-identical to data/) ----------
{
  const errs = [];
  const pairs = [
    ["data/plan.json", "site/data/plan.json"],
    ["data/summary/index.json", "site/data/summary/index.json"],
  ];
  let indexWeeks = [];
  try {
    indexWeeks = JSON.parse(readFileSync("data/summary/index.json", "utf8")).weeks ?? [];
  } catch (e) {
    errs.push(`cannot read data/summary/index.json: ${e.message}`);
  }
  for (const w of indexWeeks) {
    pairs.push([`data/summary/${w}.json`, `site/data/summary/${w}.json`]);
  }
  for (const [src, copy] of pairs) {
    if (!existsSync(src)) { errs.push(`${src} missing`); continue; }
    if (!existsSync(copy)) { errs.push(`${copy} missing`); continue; }
    if (!readFileSync(src).equals(readFileSync(copy))) {
      errs.push(`${copy} is not byte-identical to ${src}`);
    }
  }
  report("check-4 data-fidelity", errs);
}

// ---------- check 5: all data points render (field names appear in site JS) ----------
{
  const errs = [];
  const jsFiles = siteTextFiles([".js", ".mjs", ".html", ".htm"]); // .html covers inline scripts
  const blob = jsFiles.map((f) => readFileSync(f, "utf8")).join("\n");
  if (jsFiles.length === 0) {
    errs.push("no JS/HTML files found in site/");
  } else {
    for (const field of METRIC_FIELDS) {
      if (!blob.includes(field)) errs.push(`field "${field}" not referenced in site JS`);
    }
  }
  report("check-5 fields-render", errs);
}

// ---------- check 6: diff scope (only site/ and data/ may change) ----------
{
  const errs = [];
  function gitLines(args) {
    const res = spawnSync("git", args, { encoding: "utf8" });
    if (res.status !== 0) {
      errs.push(`git ${args.join(" ")} failed: ${(res.stderr ?? "").trim()}`);
      return [];
    }
    return res.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  }
  const changed = [...gitLines(["diff", "--name-only", "HEAD"]),
                   ...gitLines(["ls-files", "--others", "--exclude-standard"])];
  for (const f of changed) {
    if (!f.startsWith("site/") && !f.startsWith("data/")) {
      errs.push(`out-of-scope change: ${f}`);
    }
  }
  report("check-6 diff-scope", errs);
}

// ---------- check 7: site/index.html exists and is non-empty ----------
{
  const errs = [];
  const p = join(SITE_DIR, "index.html");
  if (!existsSync(p)) errs.push(`${p} does not exist`);
  else if (statSync(p).size === 0) errs.push(`${p} is empty`);
  report("check-7 index-html", errs);
}

// ---------- check 8: minified JS shipped and wired up ----------
{
  const errs = [];
  const src = join(SITE_DIR, "app.js");
  const min = join(SITE_DIR, "app.min.js");
  const html = join(SITE_DIR, "index.html");
  if (!existsSync(min)) {
    errs.push(`${min} does not exist — run scripts/build/minify.mjs`);
  } else if (statSync(min).size === 0) {
    errs.push(`${min} is empty`);
  } else if (existsSync(src) && statSync(min).size >= statSync(src).size) {
    errs.push(`${min} is not smaller than ${src} — minify likely did not run`);
  }
  if (existsSync(html)) {
    const page = readFileSync(html, "utf8");
    if (!page.includes("app.min.js")) {
      errs.push(`${html} does not reference app.min.js`);
    }
    if (/<script[^>]+src=["']\.?\/?app\.js["']/.test(page)) {
      errs.push(`${html} still loads unminified app.js`);
    }
  }
  report("check-8 minified-js", errs);
}

process.exit(results.every(Boolean) ? 0 : 2);
