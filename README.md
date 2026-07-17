# GTCB
Grand Trail Costa Blanca training guide

## GTCB Dashboard

A static HTML/JS/Canvas doc site + dashboard tracking a 23-week ultra build to Gran Trail Costa Blanca 102K / 6,280m (Fri 2026-11-13), refreshed by a Claude Code pipeline and served at <https://andrewjknox.github.io/gtcb/>. Weekly on-foot vertical gain vs. plan is the primary metric, alongside time on feet and training flags (missed sessions, calf-rehab notes). Beyond the dashboard, the site carries the training plan (with per-week debrief narratives), strength work, training venues, the course profile with a pace/cut-off planner, and the race regulations/conditions.

Three refresh paths (see `CLAUDE.md` "Pipeline & gates" for the authoritative version):

- **Routine refresh** (data changed, site code did not): data-agent fetches raw Strava activity for the Mon–Sun window, then `node scripts/refresh.mjs` deterministically recomputes the summary, rebuilds the site data artifacts, and runs Gates A–C. No other agents, zero token cost.
- **Weekly report** (on demand, completed weeks): the above plus report-agent writing the week's debrief narrative, gated by Gate R and finalized by `node scripts/report.mjs`.
- **Full agent chain** (site code changes, or judgment needed):

```
data-agent → Gate A → analyst-agent → Gate B → builder-agent → Gate C → reviewer-agent → Gate D → publish
```

Every handoff is verified by a deterministic gate script, so no agent has to check its own work. See `CLAUDE.md` for the full invariants and data shapes.
