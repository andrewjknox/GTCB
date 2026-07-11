# Course page data — provenance & regeneration

The course page (`site/course.html`) draws its elevation profile from a GPS
track decoded out of the official race site, plus the aid-station rutómetro
transcribed from the official images. This file records where every number
came from and how to rebuild it when the organisers update the course.

## ⚠ The trace is the 2024 course

The interactive map embedded on <https://www.costablancatrails.com/102k/>
(fetched 2026-07-11) is Wikiloc trail **163001042, titled "GTCB 102K 2024"**.
The organisers embed the 2024 track on the 2026 race page — there is no 2026
GPX published yet. It agrees closely with the official 2026 numbers
(101.85 km computed vs 101.7 km official; elevation range 257–1,520 m matches
the embed's own min/max exactly; the profile shape matches the official 2026
`Perfil_carrera_102K_2026.jpg`), so the route is evidently unchanged or
near-unchanged — but **expect to regenerate if a 2026 track appears**.

The rutómetro table (stations, legs, D+/D−, cut-offs, support) is already
the **2026** data, transcribed from the official images. Its per-leg D+
figures sum to exactly the official 6,280 m.

## Data flow

```
docs/source/wikiloc_102k_track.json     raw Wikiloc mapData (geom + metadata), saved 2026-07-11
docs/source/profile_102K_2026.jpg       official profile image (visual cross-check)
docs/source/aid_stations_102K_2026.jpg  official rutómetro image (source of the stations table)
        │
        ▼
scripts/build/course-data.mjs           decode → smooth → simplify → snap stations/peaks
        │                               (also holds the hand-maintained STATIONS + PEAKS tables)
        ▼
site/course-data.js                     generated — do not edit (window.GTCB_COURSE)
        │
        ▼
site/course.html + site/course.js       responsive SVG profile + rutómetro table
```

## How to regenerate

**If a new Wikiloc track appears** (check the embed on costablancatrails.com/102k
for `wikiloc.com/wikiloc/embedv2.do?id=NNNNN`):

1. Fetch `https://www.wikiloc.com/wikiloc/spatialArtifacts.do?event=setCurrentSpatialArtifact&id=NNNNN`
   with a browser User-Agent and `Referer: https://www.costablancatrails.com/`.
   It returns the trail page HTML; extract the `var mapData = {...}` object
   (first element of its `mapData` array).
2. Save it as `docs/source/wikiloc_102k_track.json` in the shape
   `{ "source": "...", "trail_id": NNNNN, "fetched_at": "YYYY-MM-DD", "mapData": { ... } }`.
3. `node scripts/build/course-data.mjs` — it logs point counts, total km,
   elevation range, and warns if any station snaps > 60 m from its official
   altitude (the sign that the route or the rutómetro changed).
4. If the organisers publish a new rutómetro image, re-transcribe the
   `STATIONS` constant in `scripts/build/course-data.mjs` (kms, altitudes,
   leg D+/D−, aid type, cut-offs, evac/crew/medical). Sanity check: the
   `dplus` column should sum to the official total gain.
5. Re-run the jsdom smoke test if the station count changes (the harness
   asserts 14 controls / 8 hard cut-offs — it lived in the session scratchpad;
   cheap to rebuild from `site-verification-jsdom` conventions).

**If only a GPX is published** (no Wikiloc): skip the decode — replace the
decode section of `course-data.mjs` with a GPX parse into
`pts = [{lat, lng, ele}]`; everything downstream is unchanged.

## Wikiloc `geom` encoding (reverse-engineered 2026-07-11)

For posterity, since this isn't documented anywhere: `mapData.geom` is
**base64 → binary → little-endian 7-bit varints (0x80 = continuation), each
zigzag-decoded** (`even → n/2, odd → -(n+1)/2`). The value stream is:

- 3 header values (purpose unknown, discarded), then
- one absolute first point followed by deltas, in **groups of four**:
  `lng × 1e6`, `lat × 1e6`, `elevation × 10` (metres), `timestamp` (ms).

The page's `elevationMin`/`elevationMax` fields are in **feet**; `blat`/`blng`
and `elat`/`elng` give the expected first/last coordinates — use them to
verify a decode.
