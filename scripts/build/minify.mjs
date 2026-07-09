#!/usr/bin/env node
// Build step — minifies site/app.js -> site/app.min.js via esbuild (spawned through npx,
// same dependency-free pattern as gate-c's html-validate). app.js stays the source of
// truth; app.min.js is the generated artifact index.html actually loads.
//
// esbuild is chosen over terser deliberately: it does NOT rename property accesses on
// external JSON data (d.actual_m, .flags, ...), so gate-c check-5 (metric field names must
// appear in site JS) still passes on the minified output. Exit 0 = built, 2 = failed.

import { existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";

const SRC = "site/app.js";
const OUT = "site/app.min.js";

if (!existsSync(SRC)) {
  console.error(`minify: ${SRC} does not exist — nothing to build`);
  process.exit(2);
}

const cmd = `npx --yes esbuild ${JSON.stringify(SRC)} --minify --outfile=${JSON.stringify(OUT)}`;
const res = spawnSync(cmd, { shell: true, encoding: "utf8", timeout: 180000 });

if (res.error) {
  console.error(`minify: could not run esbuild: ${res.error.message}`);
  process.exit(2);
}
if (res.status !== 0) {
  const detail = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
  console.error(`minify: esbuild exit ${res.status}: ${detail}`);
  process.exit(2);
}
if (!existsSync(OUT)) {
  console.error(`minify: esbuild reported success but ${OUT} was not written`);
  process.exit(2);
}

const before = statSync(SRC).size;
const after = statSync(OUT).size;
if (after >= before) {
  console.error(`minify: ${OUT} (${after} B) is not smaller than ${SRC} (${before} B)`);
  process.exit(2);
}

const pct = ((1 - after / before) * 100).toFixed(1);
console.log(`minify: ${SRC} ${before} B -> ${OUT} ${after} B (-${pct}%)`);
process.exit(0);
