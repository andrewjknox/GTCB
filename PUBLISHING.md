# PUBLISHING — owner runbook

How to get the GTCB dashboard live, keep it refreshing, and (later) serve it at
knoxy.com/gtcb. No GitHub Pages experience assumed.

## 1. One-time GitHub setup

1. **Make the repo public** (Settings → General → Danger Zone → Change visibility),
   *or* stay private on a GitHub Pro plan. On the Free plan, Pages requires a
   public repo. See the privacy note at the bottom before doing this.
2. **Enable Pages**: repo **Settings → Pages → Build and deployment → Source:
   GitHub Actions** (not "Deploy from a branch"). That's the whole setting — the
   `pages.yml` workflow does the rest on every push to `main` that touches `site/`.
3. ~~Add the API key secret~~ — no longer needed (2026-07-16): `refresh.yml`
   runs the pipeline as a deterministic Node script (`scripts/refresh.mjs`),
   so headless runs cost no Anthropic API tokens at all.

After the first deploy the site serves at:

**https://andrewjknox.github.io/gtcb/**

This works immediately — every URL in `site/` is relative (a hard invariant,
enforced by Gate C), so the site is happy at any subpath. Note the path is
**case-sensitive**: the repo was renamed to lowercase `gtcb` on 2026-07-09,
so `/GTCB/` no longer resolves.

### PR previews

Every open PR that touches `site/` or `data/` gets a live snapshot at
`https://andrewjknox.github.io/gtcb/previews/pr-<N>/` (a sticky PR comment
carries the link). Mechanics: `pr-preview.yml` keeps a `pr-<N>/` folder per PR
on the orphan `previews` branch, and `pages.yml` folds that branch into the
production deploy under `previews/` — production always builds from `main` and
is unaffected. Previews are cleaned up when the PR closes.

## 2. Custom domain: knoxy.com/gtcb (later decision)

Current DNS: `knoxy.com` → Azure (`51.104.28.72`), so nothing needs to happen now.
Two routes when ready:

### Option A — move knoxy.com to GitHub Pages

1. Create a repo named exactly **`andrewjknox.github.io`** (your "user site").
   It can contain a bare index page.
2. In that repo: Settings → Pages → Custom domain → `knoxy.com`, and enable
   "Enforce HTTPS" once the certificate is issued.
3. At your DNS provider, point the apex at GitHub Pages:
   - `A     knoxy.com → 185.199.108.153`
   - `A     knoxy.com → 185.199.109.153`
   - `A     knoxy.com → 185.199.110.153`
   - `A     knoxy.com → 185.199.111.153`
   - `CNAME www.knoxy.com → andrewjknox.github.io` (optional)
4. Already done (2026-07-09): this repo is named **`gtcb`**, so its project
   Pages site serves under the custom domain automatically → **knoxy.com/gtcb**.
   The relative-URL invariant means no code changes are needed.

Note: this moves ALL of knoxy.com off Azure — anything currently served there
would need a new home first.

### Option B — stay on Azure

Keep DNS as-is. Either:

- copy the contents of `site/` to the Azure host under a `/gtcb` path (a small
  deploy step or manual copy after each refresh commit), or
- configure the Azure web server to reverse-proxy `/gtcb/*` to
  `https://andrewjknox.github.io/gtcb/*` (case-sensitive: lowercase).

The site is static files only, so both are safe; the reverse-proxy keeps GitHub
as the single source of truth.

## 3. Refreshing the dashboard

### Schedule

The cron schedule in `refresh.yml` is currently **disabled** (owner, 2026-07-09).
Since 2026-07-16 the headless run is free (no API tokens), but without a headless
Strava fetch a scheduled run can only rebuild from committed raw data, so the
schedule stays off until that's wired up. The intended times (UTC cron; ~1h
drift across BST/GMT is fine):

- **Mon + Thu 05:30 UTC** — early-week / mid-week check-in
- **Sun 20:30 UTC** — end-of-week wrap

### Manual refresh

Actions tab → **refresh** workflow → **Run workflow** → optionally type a note
(e.g. `mid-week`) → Run. The note lands in the commit message:
`refresh: 2026-W28 (mid-week)`.

### What the gates do (each must pass or the run fails)

- **Gate A** — every `data/raw/*.json` matches the raw schema: correct ISO week,
  Mon–Sun Europe/London window, well-formed activities inside the window.
- **Gate B** — every summary recomputes correctly from raw (totals within 1%,
  session counts exact), pro-rated targets/percentages check out, index manifest
  matches the files.
- **Gate C** — site HTML validates, relative URLs only, TMS9918 palette only,
  `site/data/` copies byte-identical to `data/`, all metrics consumed by the JS,
  diff touches only `site/` + `data/`.
- **Gate D** — the reviewer-agent's verdict is well-formed, covers all 8
  invariants, and is `pass`. (Full agent chain only — routine data refreshes
  are deterministic and don't produce a new reviewer verdict; see CLAUDE.md
  "Pipeline & gates".)

### TODO: Strava token for headless fetch

The interactive Claude session uses claude.ai-managed Strava OAuth, which does
NOT exist on a CI runner. Until a headless fetch is wired into `refresh.yml`
(a `STRAVA_REFRESH_TOKEN` secret plus a small script writing the raw schema),
CI runs **skip the Strava fetch** and rebuild everything from the raw data
already committed — still useful (recomputes summaries and site data), but new
activities only arrive when a fetch runs in an interactive session.

## 4. Privacy note

GitHub Pages sites are **public to anyone with the URL — even when the repo is
private**. There is no auth in front of Pages. Publishing means the training
data (activity names, dates, distances, descriptions in `site/data/`) is
world-readable, and on the Free plan the repo itself must be public too. You
approved this on 2026-07-09 (see DECISIONS.md); this note is here so future-you
remembers the trade-off before adding anything sensitive to activity
descriptions.
