# 01_SCAFFOLD — Phase 1 delegation prompt

> Prompt issued by the orchestrator to a general-purpose subagent (sonnet).
> Orchestrator verifies output and commits `phase-1: scaffold`.

You are the scaffold agent for the GTCB dashboard pipeline (repo root: `E:\Projects\GTCB`). Create the following files exactly as specified. Do not modify `00_HANDOVER.md` or any `NN_*.md` prompt files. Do not run git commands.

## Context you need

- Project: static dashboard (HTML/JS/Canvas + JSON, no framework) tracking a 23-week ultra build to Gran Trail Costa Blanca 102K / 6,280m on Fri 2026-11-13. Weekly on-foot vertical gain vs plan is the primary metric.
- Week numbering: training W1 = Mon 2026-06-08 (= ISO 2026-W24); W23 = race week (Mon 2026-11-09). Phases: Base W1–8, Build W9–16, Peak W17–19, Taper W20–22, Race W23 (W20 relabelled Peak → Taper 2026-07-09, DECISIONS.md #13). All dates Europe/London; week = Mon 00:00 → Sun 23:59:59. Data files are named by ISO week (`2026-W28.json`).
- Pipeline: data-agent → Gate A → analyst-agent → Gate B → builder-agent → Gate C → reviewer-agent → Gate D → publish. Gates are deterministic scripts (Node.js — python and jq are unavailable on this machine).

## Files to create

### 1. `CLAUDE.md`

Project memory for all agents. Must contain these sections:

**Invariants** (verbatim, numbered):
1. Main thread orchestrates only: no coding, no analysis, no file edits by the orchestrator.
2. Data flows one direction: raw → summary → site. Builder never reads Strava; analyst never writes HTML.
3. TMS9918 palette only in site/ styling (hex values below).
3a. Site is served at a subpath (target: knoxy.com/gtcb/), never at root. All URLs in site/ must be relative — `/app.js` is a bug; `./app.js` or `app.js` is correct. Gate C greps for `href="/` and `src="/` and blocks on any hit.
4. All dates/windows computed Europe/London; week = Mon 00:00 → Sun 23:59.
5. Plan targets live in `data/plan.json` (per-week vert targets, phase labels W1–23) — hand-maintained, agents read-only.
6. No secrets in repo. Strava auth via MCP; OpenAI key via env.
7. Every pipeline run is one commit with a conventional message: `refresh: 2026-W28 (mid-week)` etc.

**TMS9918 palette** (the only colors permitted in site/ styling):
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

**Week numbering & race context** (as in Context above), including: on-foot sport types = Run, TrailRun, VirtualRun, Hike (Walk excluded — owner decision 2026-07-13); left-calf rehab is active — activity descriptions mentioning calf issues must be surfaced as flags.

**Data shapes** — document these JSON shapes:

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

**Pipeline & gates** — one-paragraph summary of the agent chain and that gates live in `.claude/hooks/` and are deterministic Node/bash scripts; never rely on an agent checking its own work.

### 2. `.claude/agents/` — four agent definitions

Exact frontmatter as given; write a concise body for each stating role, allowed write paths, and hard prohibitions.

`data-agent.md`:
```yaml
---
name: data-agent
description: Fetches Strava activities for a given Mon-Sun window and writes raw JSON to data/raw/. No analysis, no opinions.
model: haiku
tools: mcp__claude_ai_Strava__health, mcp__claude_ai_Strava__list_activities, Read, Write
---
```
Body: fetch ALL activities in the requested window via Strava MCP (`list_activities` with range filters; paginate if needed); write `data/raw/<ISO-week>.json` per the raw schema in CLAUDE.md; convert nothing, filter nothing, compute nothing beyond mapping fields; write ONLY under `data/raw/`; never touch summary, site, or config files.

`analyst-agent.md`:
```yaml
---
name: analyst-agent
description: Computes weekly summary (vert vs plan, time on feet, flags) from raw data. Writes data/summary/ only.
model: sonnet
tools: Read, Write
---
```
Body: read `data/raw/<week>.json` + `data/plan.json`; on-foot types Run/TrailRun/VirtualRun/Walk/Hike; compute summary per CLAUDE.md schema incl. pro-rated target (target × days_elapsed/7, where days_elapsed counts Mon..today in Europe/London, capped at 7); flag calf-related descriptions and likely missed sessions; update `data/summary/index.json`; write ONLY under `data/summary/`; never read Strava, never write HTML.

`builder-agent.md`:
```yaml
---
name: builder-agent
description: Regenerates the static dashboard in site/ from data/summary + data/plan.json. TMS9918 palette, Canvas charts, relative URLs only.
model: claude-fable-5
tools: Read, Write, Edit, Bash, Glob, Grep
---
```
Body: read summaries/plan; regenerate `site/` (index.html, app.js, styles); TMS9918 palette only; retro MSX1 aesthetic; Canvas rendering for charts; all URLs relative (site serves from a subpath); midweek view shows week-to-date vs pro-rated target; write ONLY under `site/`; never call Strava, never modify data/ or config.

`reviewer-agent.md`:
```yaml
---
name: reviewer-agent
description: Read-only auditor. Checks pipeline output against CLAUDE.md invariants and returns a structured verdict JSON.
model: sonnet
tools: Read, Grep, Glob
---
```
Body: audit data/ and site/ against every CLAUDE.md invariant; output (as final message, and this is the ONLY agent that does not write files — the orchestrator saves the verdict) a JSON verdict: `{ "verdict": "pass" | "block", "checks": [ { "invariant": "", "result": "pass|fail", "detail": "" } ], "reasons": [] }`. Never use Write/Edit/Bash.

### 3. `.claude/settings.json`

```json
{
  "hooks": {
    "SubagentStop": [
      { "matcher": "data-agent",     "hooks": [ { "type": "command", "command": "bash .claude/hooks/gate-a-raw.sh" } ] },
      { "matcher": "analyst-agent",  "hooks": [ { "type": "command", "command": "bash .claude/hooks/gate-b-summary.sh" } ] },
      { "matcher": "builder-agent",  "hooks": [ { "type": "command", "command": "bash .claude/hooks/gate-c-build.sh" } ] },
      { "matcher": "reviewer-agent", "hooks": [ { "type": "command", "command": "bash .claude/hooks/gate-d-review.sh" } ] }
    ]
  }
}
```

### 4. `.claude/hooks/` — four stub gates

`gate-a-raw.sh`, `gate-b-summary.sh`, `gate-c-build.sh`, `gate-d-review.sh` — each a bash stub for now:
```bash
#!/usr/bin/env bash
# Gate X — implemented in phase N. Stub passes.
echo "gate-X: stub (not yet implemented)"
exit 0
```
(Adjust letter/phase per file: A→2, B→3, C→4, D→5.)

### 5. `data/plan.json`

Hand-maintained plan (placeholder targets — owner will tune; keep this exact data). *(Since superseded: the owner hand-tuned all targets and added `tof_target_h` + `focus` fields — the live file is the truth.)*
```json
{
  "race": { "name": "Gran Trail Costa Blanca 102K", "date": "2026-11-13", "distance_km": 102, "vert_m": 6280 },
  "timezone": "Europe/London",
  "week1_start": "2026-06-08",
  "weeks": [
    { "week": 1,  "iso_week": "2026-W24", "start": "2026-06-08", "phase": "Base",  "vert_target_m": 800 },
    { "week": 2,  "iso_week": "2026-W25", "start": "2026-06-15", "phase": "Base",  "vert_target_m": 900 },
    { "week": 3,  "iso_week": "2026-W26", "start": "2026-06-22", "phase": "Base",  "vert_target_m": 1000 },
    { "week": 4,  "iso_week": "2026-W27", "start": "2026-06-29", "phase": "Base",  "vert_target_m": 700, "notes": "recovery" },
    { "week": 5,  "iso_week": "2026-W28", "start": "2026-07-06", "phase": "Base",  "vert_target_m": 1100 },
    { "week": 6,  "iso_week": "2026-W29", "start": "2026-07-13", "phase": "Base",  "vert_target_m": 1200 },
    { "week": 7,  "iso_week": "2026-W30", "start": "2026-07-20", "phase": "Base",  "vert_target_m": 1300 },
    { "week": 8,  "iso_week": "2026-W31", "start": "2026-07-27", "phase": "Base",  "vert_target_m": 900, "notes": "recovery" },
    { "week": 9,  "iso_week": "2026-W32", "start": "2026-08-03", "phase": "Build", "vert_target_m": 1400 },
    { "week": 10, "iso_week": "2026-W33", "start": "2026-08-10", "phase": "Build", "vert_target_m": 1500 },
    { "week": 11, "iso_week": "2026-W34", "start": "2026-08-17", "phase": "Build", "vert_target_m": 1600 },
    { "week": 12, "iso_week": "2026-W35", "start": "2026-08-24", "phase": "Build", "vert_target_m": 1100, "notes": "recovery" },
    { "week": 13, "iso_week": "2026-W36", "start": "2026-08-31", "phase": "Build", "vert_target_m": 1800 },
    { "week": 14, "iso_week": "2026-W37", "start": "2026-09-07", "phase": "Build", "vert_target_m": 2000 },
    { "week": 15, "iso_week": "2026-W38", "start": "2026-09-14", "phase": "Build", "vert_target_m": 2200 },
    { "week": 16, "iso_week": "2026-W39", "start": "2026-09-21", "phase": "Build", "vert_target_m": 1400, "notes": "recovery" },
    { "week": 17, "iso_week": "2026-W40", "start": "2026-09-28", "phase": "Peak",  "vert_target_m": 2400 },
    { "week": 18, "iso_week": "2026-W41", "start": "2026-10-05", "phase": "Peak",  "vert_target_m": 2600 },
    { "week": 19, "iso_week": "2026-W42", "start": "2026-10-12", "phase": "Peak",  "vert_target_m": 2800 },
    { "week": 20, "iso_week": "2026-W43", "start": "2026-10-19", "phase": "Peak",  "vert_target_m": 1800, "notes": "recovery" },
    { "week": 21, "iso_week": "2026-W44", "start": "2026-10-26", "phase": "Taper", "vert_target_m": 1200 },
    { "week": 22, "iso_week": "2026-W45", "start": "2026-11-02", "phase": "Taper", "vert_target_m": 700 },
    { "week": 23, "iso_week": "2026-W46", "start": "2026-11-09", "phase": "Race",  "vert_target_m": 500, "notes": "pre-race only; GTCB 102K Fri 2026-11-13" }
  ]
}
```

### 6. Housekeeping

- Empty dirs kept with `.gitkeep`: `data/raw/`, `data/summary/`, `data/review/`, `site/`, `scripts/`.
- `.gitignore`: `node_modules/`, `.env`, `*.local.json` exception: keep `.claude/settings.json` tracked (do NOT ignore `.claude/`).
- Append a short "GTCB Dashboard" section to `README.md` (one paragraph + pipeline diagram from CLAUDE.md).

## Definition of done
All files exist with the exact frontmatter/tool lists above; `data/plan.json` and `.claude/settings.json` parse as JSON; hooks are executable. Report back a list of created files.
