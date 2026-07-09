# 02_DATA — Phase 2 delegation prompts

## Prompt A → gate-smith (general-purpose, sonnet): implement Gate A

Implement Gate A for this repo (read CLAUDE.md for context; data shapes are documented there).

- `scripts/gates/gate-a.mjs` (Node, no dependencies): validate **every** `data/raw/*.json` file (there may be several after backfill; a pipeline run must not pass on the strength of an older file):
  1. File parses as JSON.
  2. `iso_week` matches the filename (`2026-W28.json` → `"2026-W28"`).
  3. `window.start` is a Monday 00:00:00 and `window.end` the following Sunday 23:59:59, `window.tz === "Europe/London"`, and the ISO week of `window.start` equals `iso_week`.
  4. `training_week` is an integer 1–23 consistent with `data/plan.json` (`weeks[n].iso_week`).
  5. `fetched_at` parses as a date.
  6. `activities` is an array (length ≥ 0); every activity has `id` (number), `name` (string), `sport_type` (string), `start_date_local` (parses, and lies within `[window.start, window.end]`), and numbers `distance_m`, `moving_time_s`, `elapsed_time_s`, `elevation_gain_m` (each ≥ 0). `description` may be string or null.
  - Print one line per file (`gate-a: 2026-W28.json OK (n activities)` or the failure reason); on any failure `process.exit(2)`, else exit 0.
- Rewrite `.claude/hooks/gate-a-raw.sh` (replacing the stub): `#!/usr/bin/env bash`, `cd` to the repo root (the directory containing the script is `.claude/hooks/`), run `node scripts/gates/gate-a.mjs`, propagate its exit code. Hook stdin can be ignored.
- Do not touch anything else.

## Prompt B → data-agent (haiku): fetch + backfill

You are data-agent (your charter: `.claude/agents/data-agent.md`; data shape: CLAUDE.md "Data shapes"). Task:

Fetch ALL Strava activities from **2026-06-08T00:00:00 to 2026-07-12T23:59:59** using `mcp__claude_ai_Strava__list_activities` (use `range_start`/`range_end`; paginate with `after`/`pageInfo.endCursor` until exhausted). Then write **five** files, `data/raw/2026-W24.json` … `data/raw/2026-W28.json`, one per Mon–Sun week:

| file | training_week | window.start | window.end |
|---|---|---|---|
| 2026-W24.json | 1 | 2026-06-08T00:00:00 | 2026-06-14T23:59:59 |
| 2026-W25.json | 2 | 2026-06-15T00:00:00 | 2026-06-21T23:59:59 |
| 2026-W26.json | 3 | 2026-06-22T00:00:00 | 2026-06-28T23:59:59 |
| 2026-W27.json | 4 | 2026-06-29T00:00:00 | 2026-07-05T23:59:59 |
| 2026-W28.json | 5 | 2026-07-06T00:00:00 | 2026-07-12T23:59:59 |

Each file follows the raw schema exactly (`window.tz: "Europe/London"`, `fetched_at` = now, ISO). Bucket each activity by its `start_date_local`. Map API fields to schema fields (`distance`→`distance_m` etc.; the API is metric — no unit conversion). Include every activity in the window regardless of sport type; include `description` (null if absent). Do NOT filter, sum, analyse, or editorialise. Write only under `data/raw/`.

Report: activity count per week file.

## Orchestrator verification
- Feed Gate A a garbage file (bad dates/missing fields) → must exit 2. Delete garbage.
- Run Gate A on real output → exit 0. Spot-check totals against Strava.
- Commit `phase-2: data-agent + gate A`.
