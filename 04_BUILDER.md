# 04_BUILDER — Phase 4 delegation prompts

## Prompt A → gate-smith (general-purpose, sonnet): implement Gate C

Implement Gate C: `scripts/gates/gate-c.mjs` + rewrite stub `.claude/hooks/gate-c-build.sh` (same pattern as gates A/B). Checks, all deterministic, any failure → exit 2:

1. **HTML validity**: `npx --yes html-validate site/*.html` must exit 0 (spawn it from the script; if html-validate needs a config to run cleanly, commit a minimal `.htmlvalidate.json` at repo root — that is part of this task).
2. **Relative URLs only** (CLAUDE.md invariant 3a): scan every file in `site/` (html/css/js) for `href="/`, `src="/`, `url(/`, `fetch("/`, `fetch('/` — any hit fails.
3. **Palette lockdown**: every `#rgb`/`#rrggbb` literal in `site/` files must be one of the 15 TMS9918 hexes in CLAUDE.md (case-insensitive; `#000`/`#fff` shorthand allowed for black/white).
4. **Data fidelity**: `site/data/plan.json`, `site/data/summary/index.json`, and every week listed in the index exist and are byte-identical to their `data/` counterparts (the site serves from `site/`, so these are build-time copies of the single source of truth).
5. **All data points render**: for the newest summary week, every one of these field names appears as a string in the site's JS (proof the app consumes them): `actual_m`, `target_m`, `prorated_target_m`, `pct_of_target`, `pct_of_prorated`, `time_on_feet`, `distance`, `sessions`, `on_foot_count`, `daily`, `flags`, `phase`, `training_week`.
6. **Diff scope**: `git diff --name-only HEAD` ∪ untracked files (`git ls-files --others --exclude-standard`) must all be under `site/` or `data/`. (Pipeline runs may only touch those; the orchestrator commits everything else before the builder runs.)
7. `site/index.html` exists and is non-empty.

Print one line per check. Test each check in a sandbox with a deliberate violation. Do not modify anything under `site/` or `data/` — the builder-agent owns those.

## Prompt B → builder-agent (claude-fable-5): build the dashboard

You are builder-agent (charter: `.claude/agents/builder-agent.md`). Read CLAUDE.md fully (invariants, palette, data shapes), then `data/plan.json`, `data/summary/index.json` and all summary files. Build the static dashboard in `site/`:

**Constraints (invariants — Gate C enforces all of these):**
- Files: `site/index.html`, `site/app.js`, `site/styles.css` (+ `site/data/**` copies). No framework, no external resources (fonts, CDNs) — fully self-contained.
- ALL URLs relative (`app.js`, `./data/...`); the site serves at a subpath.
- Only TMS9918 palette hexes (CLAUDE.md) in any styling — no other color literals.
- Copy `data/plan.json` → `site/data/plan.json`, `data/summary/*` → `site/data/summary/*`, byte-identical (use Bash `cp`).
- App loads data at runtime with relative `fetch` of `./data/...` (so future refreshes only swap JSON), driven by `summary/index.json`.

**Design — retro MSX1 (TMS9918) aesthetic:**
- Black screen, chunky pixel look (system monospace is fine; CSS can fake bitmap chunkiness), scanline/CRT touches welcome but subtle; `image-rendering: pixelated` on canvases.
- Header: race title + live countdown to Fri 2026-11-13 (computed in JS, Europe/London).
- Hero panel (current = newest week in index): training week + phase badge; big weekly vert number vs target — since the week may be in progress, show week-to-date vert against the **pro-rated target** (`prorated_target_m`, `pct_of_prorated`) as the primary readout, with the full-week target (`target_m`, `pct_of_target`) secondary; a chunky segmented progress bar; time on feet (h:mm), distance (km), sessions (`on_foot_count`/`count`).
- Canvas bar chart "the build": one bar per training week W1–23 — actual vert (where a summary exists) over/next to target outline, phase-colored (Base/Build/Peak/Taper/Race), current week highlighted. Numbers from summaries + plan only; never invent data.
- Canvas daily strip for the current week: Mon–Sun vert per day.
- Flags panel: render `flags[]` (calf entries prominent — dark red/light red), or an "ALL CLEAR" state.
- Footer: `generated_at`, data window, "GTCB 102K · 6,280m D+".
- Handle a missing/future week gracefully (no NaN, no crashes; zero-fill).

Verify your own work with Bash: run `node --check site/app.js`, open-and-eyeball via a quick `node` static assertion if useful. Write ONLY under `site/`. Report what you built and any judgment calls.

## Orchestrator verification
- Commit gate C + this file BEFORE the builder runs (keeps check 6 meaningful).
- Garbage-test Gate C (e.g. inject `src="/x.js"` + off-palette hex into a copy) → exit 2; restore.
- Run real Gate C → exit 0. Screenshot/serve site locally for a sanity look if feasible.
- Commit `phase-4: builder-agent + gate C`.
