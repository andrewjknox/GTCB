# 00_HANDOVER — GTCB Dashboard Pipeline

> **Historical document** — this is the original build spec, executed 2026-07-09 (see DECISIONS.md). It is kept as the record of what was asked for; **CLAUDE.md is the live source of truth** and wins wherever they differ. Known drift since the build: Walk is excluded from on-foot sport types (2026-07-13); phases are Peak W17–19 / Taper W20–22 (DECISIONS.md #13); plan.json targets have been hand-tuned and gained `tof_target_h` + `focus`; a fifth agent (report-agent + Gate R, weekly debriefs) and a deterministic zero-token routine-refresh path (`scripts/refresh.mjs`, 2026-07-16) were added; the site is live at andrewjknox.github.io/gtcb (knoxy.com wiring still pending, see PUBLISHING.md); invariants 3b/3c (minified JS, inline data) were added.

## ⚡ Bootstrap instruction (read this first, Claude)

This file is a complete build spec. On receiving the instruction *"Read 00_HANDOVER.md and build the project"*, work through **all phases sequentially and autonomously** in this session. Rules of engagement:

1. Run on **Fable 5** as the main thread (`/model claude-fable-5` if not already active). You are the orchestrator — plan, delegate, verify. Do no implementation work yourself.
2. Complete each phase's **Definition of done before starting the next**. Test every gate by feeding it a deliberately-bad input and confirming it blocks.
3. **Stop and ask** only if: Strava MCP is unreachable, a gate fails twice on real data, or a decision isn't covered by this spec. Everything else, decide and proceed — note decisions in a running `DECISIONS.md`.
4. Commit at each phase boundary with a conventional message (`phase-1: scaffold`, etc.).
5. Phase 7 (cross-model gate) is stretch — skip if the OpenAI key env var is absent, note it in DECISIONS.md.

## Project brief

Automate the weekly refresh of the GTCB training dashboard (currently knoxy-gtcb.tiiny.site, manually updated from Strava data). Rebuild as a static dashboard in this repo, published via GitHub Pages, refreshed by an orchestrated Claude Code subagent pipeline that can run **any day of the week** (rolling Mon–Sun week-to-date window, not Sunday-only).

Secondary goal: this project is a learning vehicle for gated subagent orchestration — sequential handover, tool scoping, SubagentStop hook gates, per-agent models. Getting the orchestration patterns right matters as much as the dashboard.

## Context

- Owner: Andrew — senior .NET/C# dev, prefers minimal/simple architectures. This project is deliberately **static HTML/JS/Canvas + JSON data files** — no backend, no framework.
- Training context: 23-week build to Gran Trail Costa Blanca 102K / 6,280m, 13 Nov 2026. Currently Base phase (W1–8). Primary metric: **weekly on-foot vertical gain** vs plan. Secondary: session completion, time on feet, anomaly flags (missed sessions, calf-relevant notes — left calf rehab is active, managed by physio).
- Styling: retro aesthetic, TMS9918 (MSX1) palette. Preserve this. Canvas rendering for charts is encouraged.
- Data source: Strava via Strava MCP server (must be configured in Claude Code: `claude mcp add` — verify connectivity in Phase 1 before anything else).

## Architecture

```
[main thread = ORCHESTRATOR ONLY — does no work itself]
        │
        ├─▶ data-agent      → data/raw/YYYY-WW.json
        │      GATE A: schema valid, activity count ≥ 0, dates within window
        │
        ├─▶ analyst-agent   → data/summary/YYYY-WW.json
        │      GATE B: schema valid, totals reconcile against raw ±1%
        │
        ├─▶ builder-agent   → site/ (index.html, app.js, styles)
        │      GATE C: HTML validates, diff touches only site/ + data/, all data points render
        │
        └─▶ reviewer-agent  → verdict (pass/block + reasons)
               GATE D: invariants in CLAUDE.md upheld, no regressions
        │
        └─▶ publish (commit → push → GitHub Pages)
```

## Agent definitions (`.claude/agents/`)

| Agent | Model | Tools | Role |
|---|---|---|---|
| *(orchestrator)* | `claude-fable-5` | — (delegation only) | Main thread. Plans phases, delegates, verifies gates. Does no work itself. |
| `data-agent` | `haiku` | Strava MCP tools, Read, Write (data/raw only) | Fetch current Mon–Sun window activities. No analysis, no opinions. Output raw JSON per schema. |
| `analyst-agent` | `sonnet` | Read, Write (data/summary only) | Compute weekly vert total, vert vs plan target for current build week, time on feet, session flags. No file access outside data/. |
| `builder-agent` | `claude-fable-5` | Read, Write, Edit (site/ only), Bash | Regenerate dashboard from summary JSON. Preserve TMS9918 palette and layout invariants. All code-writing goes here. |
| `reviewer-agent` | `sonnet` | Read, Grep, Glob (read-only — NO Write/Edit/Bash) | Audit output against CLAUDE.md invariants. Return structured verdict. Blocks the pipeline on failure. |

**Model rationale:** Fable 5 on the orchestrator (long-horizon planning/delegation is its core strength) and the builder (best code quality + self-verification). Reviewer is **deliberately not Fable** — a same-model reviewer shares the builder's blind spots; Sonnet reviewing Fable output gives genuine diversity, and the optional cross-model OpenAI gate adds a third perspective. Data/analyst stay cheap — fetch-and-sum doesn't need frontier tokens.

**Footgun reminder:** omitting `tools` in frontmatter grants ALL tools. Every agent must declare an explicit tool list.

## Gates (SubagentStop hooks, `.claude/hooks/`)

- `gate-a-raw.sh` — jq schema check on newest data/raw file; dates within expected window; exit non-zero to block.
- `gate-b-summary.sh` — jq schema check; reconciliation script (`scripts/reconcile.py` or .csx) recomputes vert from raw and compares to summary ±1%.
- `gate-c-build.sh` — HTML validation (tidy/html-validate); `git diff --name-only` scope check (only site/ and data/ may change); grep that every summary metric appears in output.
- `gate-d-review.sh` — parse reviewer verdict JSON; block on any `"verdict": "block"`.
- Optional `gate-x-crossmodel.sh` — POST analyst summary + raw totals to OpenAI API (key in env, never committed); block if models disagree on totals. Stretch goal — implement last.

Gates are deterministic scripts. Never rely on an agent "checking its own work" as the gate.

## CLAUDE.md invariants (create in Phase 1)

1. Main thread orchestrates only: no coding, no analysis, no file edits by the orchestrator.
2. Data flows one direction: raw → summary → site. Builder never reads Strava; analyst never writes HTML.
3. TMS9918 palette only in site/ styling; palette hex values listed in CLAUDE.md.
3a. Site is served at **knoxy.com/gtcb/** (subpath, not root). All URLs in site/ must be relative — no root-absolute paths (`/app.js` is a bug; `./app.js` or `app.js` is correct). Gate C greps for `href="/` and `src="/` and blocks on any hit.
4. All dates/windows computed Europe/London; week = Mon 00:00 → Sun 23:59.
5. Plan targets live in `data/plan.json` (per-week vert targets, phase labels W1–23) — hand-maintained, agents read-only.
6. No secrets in repo. Strava auth via MCP; OpenAI key via env.
7. Every pipeline run is one commit with a conventional message: `refresh: 2026-W28 (mid-week)` etc.

## Phases (one numbered prompt file each; complete + verify a phase before starting the next)

1. **01_SCAFFOLD** — repo structure, CLAUDE.md, empty agent files, plan.json seeded with Base-phase targets, verify Strava MCP connectivity, GitHub Pages enabled.
   - *GitHub Pages setup (owner is new to Pages — explain as you go):* repo **Settings → Pages → Source: GitHub Actions** (preferred over deploy-from-branch; it composes with the Phase 6 workflow). Site serves from `site/`.
   - *Hosting target:* **knoxy.com/gtcb**. Preferred route: knoxy.com is configured as the custom domain on the owner's GitHub Pages *user site* repo (`<username>.github.io`); this repo is then named `gtcb` and its project Pages site serves at knoxy.com/gtcb automatically. Verify this setup in Phase 1; if knoxy.com is hosted outside GitHub Pages, stop and ask before proceeding.
   - Published Pages sites are public by default even from private repos — confirm with the owner before first publish, since it's training data.
2. **02_DATA** — data-agent + Gate A. Test: fetch current week, validate.
3. **03_ANALYST** — analyst-agent + Gate B + reconcile script. Test against real week data.
4. **04_BUILDER** — builder-agent + Gate C. Port/recreate dashboard visuals (TMS9918, Canvas). Midweek view: show week-to-date vs pro-rated target.
5. **05_REVIEWER** — reviewer-agent + Gate D. Then full end-to-end run.
6. **06_AUTOMATE** — GitHub Action, scheduled (e.g. Mon/Thu/Sun) headless run via `claude -p`, plus manual `workflow_dispatch` for on-demand midweek refresh.
7. **07_CROSSMODEL** (stretch) — Gate X adversarial verification via OpenAI API.

## Definition of done (per phase)

- Gate script exists, is executable, and demonstrably blocks a deliberately-bad output (test the gate by feeding it garbage once).
- Agent tool list verified minimal.
- One clean end-to-end run of everything built so far.
