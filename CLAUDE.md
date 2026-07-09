# CLAUDE.md — GTCB Dashboard Pipeline

Project memory for all agents working in this repo. Read this before doing any work.

## Invariants

1. Main thread orchestrates only: no coding, no analysis, no file edits by the orchestrator.
2. Data flows one direction: raw → summary → site. Builder never reads Strava; analyst never writes HTML.
3. TMS9918 palette only in site/ styling (hex values below).
3a. Site is served at a subpath (target: knoxy.com/gtcb/), never at root. All URLs in site/ must be relative — `/app.js` is a bug; `./app.js` or `app.js` is correct. Gate C greps for `href="/` and `src="/` and blocks on any hit.
3b. `site/app.js` is the source of truth; the page loads the generated `site/app.min.js` (`app.min.js` convention). The builder regenerates it via `node scripts/build/minify.mjs` (esbuild through npx) as the final build step; Gate C check-8 blocks if it is missing, stale, or if `index.html` still loads the unminified `app.js`.
4. All dates/windows computed Europe/London; week = Mon 00:00 → Sun 23:59.
5. Plan targets live in `data/plan.json` (per-week vert targets, phase labels W1–23) — hand-maintained, agents read-only.
6. No secrets in repo. Strava auth via MCP; OpenAI key via env.
7. Every pipeline run is one commit with a conventional message: `refresh: 2026-W28 (mid-week)` etc.

## TMS9918 palette

The only colors permitted in site/ styling:

| Name | Hex |
|---|---|
| black | #000000 |
| medium green | #3EB849 |
| light green | #74D07D |
| dark blue | #5955E0 |
| light blue | #8076F1 |
| dark red | #B95E51 |
| cyan | #65DBEF |
| medium red | #DB6559 |
| light red | #FF897D |
| dark yellow | #CCC35E |
| light yellow | #DED087 |
| dark green | #3AA241 |
| magenta | #B766B5 |
| gray | #CCCCCC |
| white | #FFFFFF |

## Week numbering & race context

Static dashboard (HTML/JS/Canvas + JSON, no framework) tracking a 23-week ultra build to Gran Trail Costa Blanca 102K / 6,280m on Fri 2026-11-13. Weekly on-foot vertical gain vs plan is the primary metric.

- Training W1 = Mon 2026-06-08 (= ISO 2026-W24); W23 = race week (Mon 2026-11-09).
- Phases: Base W1–8, Build W9–16, Peak W17–20, Taper W21–22, Race W23.
- All dates Europe/London; week = Mon 00:00 → Sun 23:59:59.
- Data files are named by ISO week (`2026-W28.json`).
- On-foot sport types: Run, TrailRun, VirtualRun, Walk, Hike.
- Left-calf rehab is active — activity descriptions mentioning calf issues must be surfaced as flags.

## Data shapes

`data/raw/YYYY-Www.json` (written only by data-agent; no analysis, all activities in window unfiltered):

```json
{
  "iso_week": "2026-W28",
  "training_week": 5,
  "window": { "start": "2026-07-06T00:00:00", "end": "2026-07-12T23:59:59", "tz": "Europe/London" },
  "fetched_at": "<ISO datetime>",
  "activities": [
    { "id": 0, "name": "", "sport_type": "", "start_date_local": "<ISO>", "distance_m": 0,
      "moving_time_s": 0, "elapsed_time_s": 0, "elevation_gain_m": 0, "description": null }
  ]
}
```

`data/summary/YYYY-Www.json` (written only by analyst-agent):

```json
{
  "iso_week": "2026-W28", "training_week": 5, "phase": "Base",
  "generated_at": "<ISO>", "window": { "start": "", "end": "", "tz": "Europe/London" },
  "days_elapsed": 4,
  "vert": { "actual_m": 0, "target_m": 0, "prorated_target_m": 0, "pct_of_target": 0, "pct_of_prorated": 0 },
  "time_on_feet": { "actual_s": 0 },
  "distance": { "actual_m": 0 },
  "sessions": { "count": 0, "on_foot_count": 0 },
  "daily": [ { "date": "2026-07-06", "vert_m": 0, "time_s": 0, "distance_m": 0 } ],
  "flags": [ { "type": "missed_session|calf|anomaly", "detail": "" } ]
}
```

Plus `data/summary/index.json`: `{ "weeks": ["2026-W24", "..."] }` — manifest the static site loads (it cannot list directories).

## Pipeline & gates

The pipeline runs as a sequential chain of scoped subagents: `data-agent` fetches raw Strava activities for the requested window, then **Gate A** validates the output before `analyst-agent` computes the weekly summary, then **Gate B** validates before `builder-agent` regenerates the static site, then **Gate C** validates before `reviewer-agent` audits the whole run against these invariants, then **Gate D** checks the verdict before publish. Gates live in `.claude/hooks/` as deterministic Node.js/bash scripts (python and jq are unavailable on this machine) wired via `SubagentStop` hooks in `.claude/settings.json` — the pipeline never relies on an agent checking its own work; every handoff is verified by a script that can block.
