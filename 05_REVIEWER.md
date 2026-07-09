# 05_REVIEWER — Phase 5 delegation prompts

## Verdict contract

The reviewer-agent is read-only (Read/Grep/Glob — no Write), so it returns the verdict JSON as its **final message**, fenced in a ```json block. The orchestrator saves it verbatim to `data/review/<iso_week>.json`. Gate D then validates that file. Shape:

```json
{
  "verdict": "pass" | "block",
  "iso_week": "2026-W28",
  "reviewed_at": "<ISO>",
  "checks": [ { "invariant": "1|2|3|3a|4|5|6|7", "result": "pass" | "fail", "detail": "" } ],
  "reasons": [ "non-empty only when verdict is block" ]
}
```
`verdict` must be "block" iff any check failed; `checks` must cover every invariant 1–7 incl. 3a.

## Prompt A → gate-smith (general-purpose, sonnet): implement Gate D

- `scripts/gates/gate-d.mjs`: read the NEWEST (by mtime) `data/review/*.json`; exit 2 if none exist, it doesn't parse, `verdict` ∉ {pass, block}, `checks` doesn't cover all 8 invariant ids with result pass|fail, `verdict` is inconsistent with the checks (block iff ≥1 fail), `reasons` is non-empty on pass or empty on block, or verdict is "block" (print each reason). Exit 0 only on a well-formed pass.
- Rewrite stub `.claude/hooks/gate-d-review.sh` (same pattern as A/B/C).
- Sandbox-test: no file / malformed / inconsistent verdict / well-formed block → exit 2; well-formed pass → 0. Touch nothing under data/ or site/.

## Prompt B → reviewer-agent (sonnet, read-only): audit the run

You are reviewer-agent (charter: `.claude/agents/reviewer-agent.md`). Audit this pipeline run against every invariant in CLAUDE.md, using ONLY Read/Grep/Glob. For each invariant 1–7 (incl. 3a) do a concrete check, e.g.:

1. Orchestrator-only: `NN_*.md` prompt files exist showing delegation (best-effort; note as pass with caveat if unverifiable from files).
2. One-way data flow: agent charters scope tools/paths correctly (data-agent no site access; analyst no Strava/HTML; builder no Strava; raw files contain no computed fields; summaries contain no HTML).
3. Palette: grep site/ for all #hex literals; every one ∈ TMS9918 15 (+#000/#fff shorthand).
3a. Relative URLs: grep site/ for href="/, src="/, url(/, fetch("/.
4. Dates/windows: raw+summary windows are Mon 00:00:00→Sun 23:59:59 Europe/London; iso_week consistent with window.
5. plan.json: agents read-only (no pipeline output writes to it; git-tracked, hand-maintained).
6. No secrets: grep repo (excluding .git) for obvious token/key patterns (sk-, ghp_, strava tokens, Authorization:, api_key = <literal>).
7. Commit discipline: best-effort from file layout (note caveat).

Also sanity-check: summary numbers plausible vs raw (spot-check one week), site/data copies match data/, flags surfaced in the site (calf rehab invariant). Output ONLY the verdict JSON (contract above) fenced in ```json as your final message. Be strict: any concrete violation → block.

## Orchestrator steps
1. Gate D built + garbage-tested.
2. Reviewer runs → orchestrator saves verdict to `data/review/2026-W28.json` (saving a returned artifact verbatim is clerical, not analysis) → Gate D runs on it.
3. Full end-to-end: data-agent (current week re-fetch) → Gate A → analyst → Gate B → builder (refresh copies) → Gate C → reviewer → Gate D.
4. Commit `phase-5: reviewer-agent + gate D + e2e`.
