# DECISIONS — running log (orchestrator)

Decisions made during the autonomous build (2026-07-09), per 00_HANDOVER.md rule 3.

## Confirmed with owner (AskUserQuestion, 2026-07-09)
- **Hosting**: knoxy.com points to Azure (51.104.28.72), not GitHub Pages, and no `andrewjknox.github.io` user-site repo exists — the handover's preferred route isn't set up. Owner chose **build now, wire domain later**: everything uses strictly relative URLs (works at any subpath); domain wiring documented in Phase 6, not executed.
- **Public publish**: repo is currently private; owner approved public publishing when Pages is wired up.

## Decided and proceeded
1. **Toolchain**: `jq` and a real `python` are absent on this machine (python is the MS Store stub). All gate/reconcile scripts are **Node.js** (v24 present), invoked from bash gate scripts. Works locally (Git Bash) and on ubuntu-latest CI.
2. **Old dashboard unrecoverable**: knoxy-gtcb.tiiny.site no longer resolves (DNS gone). Visuals recreated from spec (TMS9918, Canvas, retro) rather than ported.
3. **Week numbering**: training W1 = Mon **2026-06-08** (ISO 2026-W24), so race week W23 = Mon 2026-11-09 contains race day Fri 2026-11-13. Current week (2026-07-09) = W5 = ISO 2026-W28, Base phase — consistent with the handover.
4. **Phase labels beyond Base**: handover only specifies Base W1–8. Defined Build W9–16, Peak W17–20, Taper W21–22, Race W23.
5. **plan.json targets are placeholders**: the old dashboard (and its plan table) is gone, and no targets were specified. Seeded a plausible progressive vert plan for a 102K/6,280m build (800→2,800 m, recovery weeks every 4th, W23 = 500 m pre-race). **Owner should hand-tune `data/plan.json`.**
6. **Historical backfill**: pipeline starts mid-build (W5). data-agent backfills raw files for W1–W4 (ISO 2026-W24…W27) in one run so the dashboard can chart the whole build; thereafter it fetches only the current week.
7. **Gate stubs first**: all four gate scripts exist from Phase 1 as exit-0 stubs (so `.claude/settings.json` hook wiring is valid), each implemented + garbage-tested in its own phase.
8. **SubagentStop hooks are wired but won't fire in the build session itself** (hook config is snapshotted at session start). During this build the orchestrator runs each gate script manually after the corresponding agent stops; hooks apply to future interactive sessions, and CI runs the gates explicitly.
9. **Phase 7 (cross-model gate) skipped**: `OPENAI_API_KEY` not present in env, per handover rule 5.
10. **gh CLI absent**: GitHub settings (Pages, secrets) can't be changed from this machine. Repo-side files are complete; the Settings-side steps are documented in Phase 6 for the owner.
11. **Reviewer verdict reformatting (2026-07-09)**: the reviewer's first verdict added three extra `sanity-*` check ids beyond the 8 the Gate D contract allows. Rather than relax the gate, the orchestrator folded those sanity findings into invariant 7's detail when saving `data/review/2026-W28.json` (clerical reformat, content unchanged). Future reviewer prompts state the id set is closed.
12. **Gate C diff-scope works as designed**: during the e2e run it blocked on uncommitted phase-5 dev files (gate-d, 05_REVIEWER.md) — confirmation that pipeline runs must start from a tree where only site/ + data/ change. Remedy: commit dev files at the phase boundary before running the pipeline.
