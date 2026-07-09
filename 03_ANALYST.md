# 03_ANALYST — Phase 3 delegation prompts

## Prompt A → gate-smith (general-purpose, sonnet): implement Gate B

Implement Gate B (read CLAUDE.md "Data shapes" first). Two dependency-free Node scripts plus the hook:

- `scripts/reconcile.mjs` — shared module exporting `reconcileWeek(raw, plan)` that recomputes, from a raw week file and `data/plan.json`:
  - on-foot activities = `sport_type` ∈ {Run, TrailRun, VirtualRun, Walk, Hike};
  - `vert_actual_m` = Σ elevation_gain_m (on-foot), `time_on_feet_s` = Σ moving_time_s (on-foot), `distance_m` = Σ distance_m (on-foot), `sessions_count` = all activities, `on_foot_count`, and per-day (Mon–Sun) vert/time/distance buckets by `start_date_local`.
  Also runnable directly (`node scripts/reconcile.mjs 2026-W28`) printing the recomputed numbers.
- `scripts/gates/gate-b.mjs` — validate every `data/summary/*.json` except `index.json`:
  1. Parses; `iso_week` matches filename; `window` rules identical to Gate A; `training_week`/`phase`/`vert.target_m` all agree with `data/plan.json`; `generated_at` parses.
  2. Numeric tolerance rule: `ok(a,b)` ⇔ both 0, or `|a-b| ≤ 0.01·max(|a|,|b|)`.
  3. Reconciliation vs the matching `data/raw/` file via `reconcileWeek`: `vert.actual_m`, `time_on_feet.actual_s`, `distance.actual_m` within tolerance; `sessions.count`/`sessions.on_foot_count` exact; a matching raw file must exist.
  4. `days_elapsed` integer 1–7, and exactly 7 when `window.end` is in the past (Europe/London); `vert.prorated_target_m` = round(target·days_elapsed/7) ±1; `pct_of_target` = round(100·actual/target) ±1 (0 if target is 0); `pct_of_prorated` likewise vs prorated.
  5. `daily` has exactly 7 entries, dates = the window's Mon..Sun in order; column sums within tolerance of the weekly totals.
  6. `flags` is an array; each entry has string `type` and `detail`.
  7. `data/summary/index.json` exists and its `weeks` array lists exactly the summary files present (sorted).
  Print one line per file; any failure → exit 2.
- Rewrite stub `.claude/hooks/gate-b-summary.sh` like gate-a-raw.sh (cd repo root, run gate-b.mjs, propagate exit code).
- Touch nothing else. `data/summary/` may still be empty while you work — that must also exit 2 ("no summary files found").

## Prompt B → analyst-agent (sonnet): produce summaries

You are analyst-agent (charter: `.claude/agents/analyst-agent.md`; shapes: CLAUDE.md). Using ONLY Read and Write:

1. Read `data/plan.json` and every `data/raw/2026-W2[4-8].json`.
2. For each week write `data/summary/<iso_week>.json` per the summary schema. Rules:
   - On-foot sport types: Run, TrailRun, VirtualRun, Walk, Hike. `vert.actual_m`, `time_on_feet.actual_s`, `distance.actual_m` sum on-foot activities only; `sessions.count` counts ALL activities in the window, `sessions.on_foot_count` on-foot only.
   - `target_m`/`phase`/`training_week` from plan.json. `days_elapsed`: 7 for completed weeks; for the current week (2026-W28, today is Thu 2026-07-09 Europe/London) it is 4. `prorated_target_m` = round(target·days_elapsed/7). `pct_of_target` = round(100·actual/target); `pct_of_prorated` = round(100·actual/prorated). Integers.
   - `daily`: exactly 7 entries Mon..Sun (ISO dates), zeros for empty/future days, on-foot sums only.
   - `flags`: (a) `calf` — any activity description mentioning the left-calf rehab (keywords: calf, physio, niggle, strain, tight/tightness; quote the relevant snippet + activity name/date in `detail`); (b) `anomaly` — completed week with actual vert < 60% of target, or zero on-foot sessions across any 3+ consecutive days in a completed week (likely missed sessions); (c) none otherwise. Keep details factual, no coaching advice.
3. Write `data/summary/index.json`: `{ "weeks": [ "2026-W24", ... ] }` sorted.
4. Write ONLY under `data/summary/`. Report per-week: vert actual vs target, time on feet, flags raised.

## Orchestrator verification
- Gate B garbage test: corrupt a copy of a summary (wrong totals) → exit 2; restore. Real data → exit 0.
- Cross-check one week's vert by hand against raw.
- Commit `phase-3: analyst-agent + gate B`.
