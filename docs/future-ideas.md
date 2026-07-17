# Future ideas — GTCB dashboard

Backlog of enhancements discussed but not yet built. Not prioritised into the
pipeline; pick up when there's appetite.

---

## 1. Pace / cut-off planner on the course profile ★ top pick — ✅ SHIPPED

**Built 2026-07-15/16, merged to main in PR #2.** Lives on `site/course.html` as
the PACE PLANNER: finish-time slider with per-control arrival clocks and cut-off
buffers, plus a **PREDICTED** mode that models arrivals from the 2022 CB Trails
46K pace-vs-grade curve scaled by current training readiness — see
`docs/pace-model.md`. The "leave-by" column was dropped (provably identical to
the cut-off under cut-off anchoring). Original pitch kept below for the record.

**The question it answers:** in a race where *miss one cut-off = out*, "how much
cushion do I have?" matters more than "where am I."

Started as a "how long will it take me → show my position on the profile" idea.
The worry was that the massively changing course makes position estimation too
hard. It doesn't — for two reasons:

1. **Effort-weighted position, not distance.** Place the runner by cumulative
   *effort*, not km. Classic trail formula (Naismith/Langmuir):
   `time ≈ flat_distance + ascent ÷ climb_rate` (+ a small steep-descent
   penalty). Compute cumulative effort at every track point once, normalise
   0→1, multiply by the chosen finish time. A 24 h runner and a 16 h runner then
   sit in *different* places at the same clock time — because the climbs eat the
   slower runner disproportionately, which is the truth.

2. **Official cut-offs are the answer key.** `course-data.js` already carries
   cut-off clock times at 7 controls (Helipuerto 03:00, Benimantell 06:30,
   Confrides 13:30, Partagat 15:30, Sella 19:00, Mas de l'Oficial 22:00, finish
   23:00 Sat). Those *are* the organiser's back-of-pack pace schedule — they've
   already solved the terrain. Anchor the effort curve through those points and
   the model self-validates.

**The build (reuses everything on `course.html`):**

- Input: target finish time (slider ~16–24 h), or "cut-off pace" preset.
- On the existing SVG profile: a moving "you" marker + predicted arrival clock
  time at every control.
- Next to each hard cut-off: **buffer in minutes** (green = comfy, red = tight).
- "Leave-by" time at each control — latest departure that still finishes.
- Start fixed at Fri 23:00.

**Design call to make first:** primary input = target finish time (predicts
cushions) vs default to the official cut-off schedule. Lean: finish-time slider
with the cut-off line always drawn behind as the reference — best of both.

**Why it's the top pick:** highest leverage, directly answers the original
instinct, well-constrained by official cut-offs (not a guessing exercise), and
reuses the profile SVG, station data, and tooltip system already on the page.

---

## 2. Bridge training → the race's actual demand

The site has two halves that never talk: the dashboard tracks *weekly* vert vs
plan; the course page says the race is *6,280 m in one push*. Nothing says
whether training is building the right *single-day* capacity.

Add a "RACE READINESS" tile: *biggest single on-foot day* and *biggest
back-to-back weekend* as a % of the 6,280 m race demand. Answers the real
question ("can my legs take one 6,280 m day?") that weekly totals hide. Data is
already in the `daily[]` arrays in each summary.

---

## 3. Trajectory line on the build chart

Actual-vs-target bars show the scorecard but not where it's heading. A faint
projected line ("at your current 4-week trend you'll bank X of the plan's total
vert by race week") turns the chart into a forecast.

Lower priority — the build chart is already dense, so this risks clutter. Only
if wanted.

---

## Smaller notes

- **Data-freshness cue above the fold.** The footer carries the data window, but
  a stale-data glance-check near the top of the dashboard would help.
- **"You are here" in distance terms on the course page** for race-morning
  reading — solved by the pace planner (idea 1, shipped).
