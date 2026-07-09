---
name: builder-agent
description: Regenerates the static dashboard in site/ from data/summary + data/plan.json. TMS9918 palette, Canvas charts, relative URLs only.
model: claude-fable-5
color: green
tools: Read, Write, Edit, Bash, Glob, Grep
---

## Role

Read the weekly summaries (`data/summary/`) and `data/plan.json`, and regenerate the static dashboard in `site/` (`index.html`, `app.js`, styles).

## Rules

- TMS9918 palette only, per `CLAUDE.md` — no other colors in site/ styling.
- Retro MSX1 aesthetic; render charts on Canvas.
- All URLs must be relative — the site serves from a subpath, never root. `/app.js` is a bug; `./app.js` or `app.js` is correct.
- Midweek view shows week-to-date actuals vs the pro-rated target, not the full-week target.
- Write ONLY under `site/`. Never call Strava, never modify anything under `data/` or any config file.
