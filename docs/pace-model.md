# PREDICTED planner mode — pace model

The course page's PACE PLANNER has a **PREDICTED** toggle that replaces the
hand-picked target time with a modelled per-control arrival walk. This
documents the model and how to regenerate it.

## Data flow

```
Strava activity 8140385396 (CB Trails 46K, 2022-11-19)
  └─ streams (time/distance/altitude/moving, resolution 3000, via Strava MCP)
       → data/refs/cb46k-2022-streams.json     (checked in, one-off fetch)
            → scripts/build/fit-grade-curve.mjs
                 → data/refs/pace-model.json    (curve + knobs)
                      → scripts/build/inline-data.mjs → site/data.js (paceModel)
                           → site/course.js walks it over the 102K track
```

The site never talks to Strava (invariant 2): the 46K is a fixed historical
reference fetched once; per-week readiness comes from `data/summary/*` which
is already in `data.js` and refreshes with every pipeline run — so the
predicted time drifts week by week as training lands (or doesn't).

## The model

1. **Curve** — moving speed (m/s) by grade (%), median per 4 % bin over
   ~100 m chunks of the 46K, light 1-2-1 smoothing, calibrated so walking the
   46K's own samples reproduces its actual moving time exactly. Beyond the
   end bins, speed extends at constant *vertical* rate (climb/descent m/h
   plateau on very steep ground — the Puig Campana wall exceeds the fitted
   range).
2. **Grade normalisation** — the 102K Wikiloc trace over-reads total climb
   (~7,390 m vs the official 6,280 m; GPS/DEM noise) while the 46K's
   barometric altitude is clean (3,189 vs 3,110). course.js scales the
   trace's elevation deltas so total climb matches `C.official.gain_m`.
3. **Stops** — the 46K's elapsed/moving ratio (1.118) applied throughout.
4. **Fade** — flat ×1.06: Riegel k = 1.08 over the equivalent-distance ratio
   (102K ≈ 164 eq-km vs 46K ≈ 79 eq-km, at 100 m climb = 1 eq-km). Flat is
   conservative early / optimistic late.
5. **Night** — ×1.05 while the race clock is in darkness (mid-Nov Alicante:
   sunrise 07:45, sunset 17:45; the 23:00 Friday start means ~8¾ h dark
   before first light).
6. **Readiness** — vert attainment over the last 4 *completed* training
   weeks (`days_elapsed ≥ 7`), Σactual/Σtarget clamped to [0,1], mapped to a
   speed factor 0.90 + 0.10 × attainment. All knobs live in
   `pace-model.json`, not code.

At launch (W29, attainment 88%) it predicts ≈ 22:17 — under the 24 h limit
but **missing the Benimantell cut-off (ctrl 5) by ~half an hour**: per the
2022 record, the early steep third is the crux, not the finish. That is the
point of the per-control walk.

## Known limits

- The 46K is from Nov 2022 — a course-difficulty anchor, not current
  fitness; readiness carries the "current you" part and maxes out at parity
  with 2022 race shape.
- It includes the ~1.5 mi wrong-turn detour (slightly conservative anchor).
- Steep-grade bins (>20 %) are extrapolated, not measured — sparse samples.
- Nothing models sleep deprivation, weather, or aid-station strategy;
  the stop ratio is the 2022 daytime-46K habit, trimmable in a real race.

## Regenerating

Streams refetch (only if the reference is lost): Strava MCP
`get_activity_streams(8140385396, [time,distance,altitude,moving], 3000)`,
wrap with the `source` provenance block (see the existing file). Then:

```
node scripts/build/fit-grade-curve.mjs   # refs → pace-model.json
node scripts/build/inline-data.mjs       # → site/data.js
```

The jsdom smoke test for the toggle follows `site-verification-jsdom`
conventions (scratchpad, not checked in): load course.html with scripts,
click `#pred-toggle`, assert readout/table/slider/note states flip.
