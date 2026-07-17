# 06_AUTOMATE — Phase 6 delegation prompt

> **Superseded in part (2026-07-16):** `refresh.yml` no longer runs `claude -p` — the headless pipeline is now the deterministic `node scripts/refresh.mjs` (zero API tokens, no `ANTHROPIC_API_KEY` secret needed), and per-PR preview deployments were added via `pr-preview.yml`. The workflow files and PUBLISHING.md are the live truth; this prompt records the original design.

## Prompt → automation-smith (general-purpose, sonnet)

Create the CI/publish layer for this repo. Read CLAUDE.md and DECISIONS.md first. Deliverables:

### 1. `.github/workflows/refresh.yml`

- Triggers: `schedule` cron `30 5 * * 1,4` and `30 20 * * 0` (Mon+Thu 05:30, Sun 20:30 UTC — note in a comment that these approximate Europe/London and drift 1h across DST, acceptable), plus `workflow_dispatch` (optional input `note`, e.g. "mid-week").
- Job `refresh` on ubuntu-latest:
  - checkout (full history not needed, `fetch-depth: 1` fine, but the job commits — use a PAT-free `GITHUB_TOKEN` with `contents: write` permission);
  - setup Node 24 (no npm install needed — gates are dependency-free; html-validate arrives via `npx --yes`);
  - install Claude Code CLI (`npm install -g @anthropic-ai/claude-code`);
  - run the pipeline headless: `claude -p "<pipeline prompt>" --permission-mode acceptEdits --allowedTools <the minimum set>` with `ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}`. The pipeline prompt: read CLAUDE.md, run the four-agent chain for the current week, gates via the four hook scripts must each exit 0.
  - **Belt-and-braces**: after the `claude -p` step, run all four gate scripts explicitly as workflow steps (`bash .claude/hooks/gate-a-raw.sh` etc.) — CI must not trust the agent to have run its own gates.
  - Commit as one `refresh: <iso-week>` commit (compute ISO week in a step; include "(mid-week)" when triggered mid-week Mon–Sat) and push. Skip commit cleanly if no changes.
  - **Strava MCP caveat**: the interactive session uses claude.ai-managed Strava OAuth, which is NOT available headless. Document clearly in the workflow header comment: the runner needs a Strava MCP server configured via `claude mcp add` with its own token (e.g. env `STRAVA_REFRESH_TOKEN` secret) — mark the data-fetch step with a TODO and make the workflow tolerate its absence by falling back to "recompute from committed raw data" (skip data-agent, still run analyst→builder→gates B–D) so the workflow is useful immediately.
- Concurrency group so runs don't overlap.

### 2. `.github/workflows/pages.yml`

Standard GitHub Pages deploy: on push to main touching `site/**` + `workflow_dispatch`; permissions pages/id-token; upload `site/` as the Pages artifact; deploy job with `actions/deploy-pages`. (Owner selects Settings → Pages → Source: GitHub Actions.)

### 3. `PUBLISHING.md`

Owner-facing runbook (owner is new to GitHub Pages; explain plainly):
- One-time GitHub setup: make repo public (or Pro), Settings → Pages → Source: **GitHub Actions**; add `ANTHROPIC_API_KEY` secret (Settings → Secrets and variables → Actions); site then serves at `https://andrewjknox.github.io/GTCB/` — works immediately because all site URLs are relative.
- Custom domain knoxy.com/gtcb (current DNS: knoxy.com → Azure 51.104.28.72, so this is a later decision): **Option A (GitHub route)** — create `andrewjknox.github.io` user-site repo, set custom domain knoxy.com there (CNAME/A records to GitHub Pages IPs), rename this repo `gtcb` → serves at knoxy.com/gtcb automatically. **Option B (stay on Azure)** — keep DNS as-is; copy/deploy `site/` to the Azure host under /gtcb (or reverse-proxy to the Pages URL). Spell out DNS records for A.
- How to trigger a manual refresh (`workflow_dispatch`), what the schedule is, what each gate does (one line each), and the Strava-token TODO for headless data fetch.
- Privacy note: Pages sites are public even from private repos (and Free plan requires public repo).

Validate both YAML files parse (node + a YAML check via `npx --yes yaml` or a small JS parser — your choice). Touch nothing under site/ or data/.
