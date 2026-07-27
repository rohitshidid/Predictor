# wiki.md — The Project Encyclopedia

> The definitive map of the codebase: architectural overview, a per-file index,
> and line-number anchors linking documentation to exact code.

_Last updated: 2026-07-25 (weights study + match-search ranking fixes)_

---

## 1. Architectural Overview

**Project:** Willow TV — T20 Cricket Power Rankings.

A weekly power ranking for T20 cricket leagues: a ranked list of teams (1..N)
with a movement arrow (▲2 / ▼1 vs last week) and a short blurb per team, in the
style of CBS/ESPN power rankings. One weekly artifact feeds many surfaces:
Willow e-newsletter, social posts, on-air TV slate, and syndication to Times of
India Sports → Yahoo! Sports.

**Central design split (the crown rule):**
- **Deterministic code** computes the ranking + last-week deltas from stats
  (win%, NRR, recent-form weighting, strength of schedule).
- **The language model writes only the prose blurb**, given the numbers and last
  week's rank. It never outputs the rank.

**Reuse strategy:** the machinery already exists in the running prediction game
(`champhunt-ms-contest/predictionGame/`) — scheduled model pipeline, web-grounded
fact-check, self-critique gate, admin control room, CricAPI cache. The
power-ranking tool is that same machinery pointed at a different output.

> Note: the referenced Champhunt source files live in **other repositories**
> (`champhunt-ms-contest`, `champhunt-ui`, `champhunt-ui-next`) that are not
> present in this `Predictor` repo. They are documented here as the reuse map;
> line anchors will be added when/if those sources are pulled into scope.

## 2. File Index
_Registry of what each file in this repository does and where it lives._

| File | Location | Purpose |
|---|---|---|
| `structure.md` | repo root | Planning/handover doc for the Power Rankings project. No code. |
| `steps.md` | repo root | Build plan & POC — phased build order and the concrete POC to start with. |
| `system_health.md` | repo root | Operations hub — active state, rules, tasks, roadmap. |
| `selfcorrection.md` | repo root | Preference ledger — user preferences and corrections. |
| `wiki.md` | repo root | Project encyclopedia — this file. |
| `parameters.md` | repo root | Spec for the expanded metric set (12 params, 5 groups) + target weights.config structure. |
| `package.json` | repo root | Node manifest. Scripts: `gen-data`, `build` (static), `serve`/`start` (simulator). Dependency-free. |
| `server.js` | repo root | **Interactive simulator server** (vanilla Node http). Routes: state, simulate, weights, mode, reset, generate-all, fetch-match, cache/clear, cache/stats. |
| `build.js` | repo root | Legacy static orchestrator: data → rank → AI blurbs → `rankings.html` + `audit.json`. |
| `weights.config.json` | repo root | The 9 metric weights + 5 optional + form(α)/NRR/powerplay/death normalization bounds. Config, not code. Weights are **fitted** (see `parameters.md`); `_derivation` and `_weightNotes` record why each number is what it is. |
| `public/index.html` | `public/` | **Single-page simulator UI.** Ranking list + right-hand parameter menu, sig-event boxes, live weight sliders. |
| `.env` / `.env.example` | repo root | Secrets (gitignored) + template. `CRICAPI_KEY`, `GEMINI_API_KEY`, models, call budgets, freshness gate. |
| `.cache/` | repo root | **Generated** (gitignored): cached provider responses. Safe to delete; costs API calls to rebuild. |
| `.claude/launch.json` | `.claude/` | Preview config for the standalone page (superseded by ROOT launch.json's `rankings` entry). |
| `generateSeason.js` | `src/` | Seeded generator → self-consistent synthetic IPL season. |
| `config.js` | `src/` | Env-driven config + dependency-free `.env` loader. Mirrors `predictionGame/config.js`. |
| `engine.js` | `src/` | **Deterministic ranking engine.** No AI. Computes all 9 metrics from raw per-innings data + score + deltas. |
| `simState.js` | `src/` | In-memory simulator state: baseline/fresh season, append match, mode switch, prev-rank snapshot. |
| `templates.js` | `src/` | Deterministic blurb templates + fact sheets (fallback + grounding source of truth). |
| `blurbs.js` | `src/` | **AI blurb layer.** Gemini generate + grounded critic; accepts per-team significant-event context. Ports `llm.js` + `searchLLM.js`. |
| `liveMatch.js` | `src/` | **Match fetch + resolution.** CricAPI feed (primary) → Gemini grounded search (backup) → verification gate. Normalizes any provider onto one match shape. |
| `cache.js` | `src/` | Disk-backed TTL cache under `.cache/`. Exists because CricAPI's free plan is 100 calls/day and in-memory caching dies with every restart. Exposes `ageOf`/`stats`/`clear` so the UI can show a cached answer's age and drop it on demand. |
| `liveMatch.test.js` | `test/` | Match-resolution suite (`npm test`). Runs on recorded payloads — spends no API calls. |
| `render.js` | `src/` | Renders ranked table → self-contained, theme-aware `rankings.html`. |
| `data/ipl_2024.json` | `data/` | Generated season snapshot (90 matches, 10 teams). |
| `data/lastweek.json` | `data/` | Previous-week ranks → the ▲/▼ movement deltas. |
| `rankings.html` | repo root | **Generated demo output** (gitignored). The POC artifact. |
| `audit.json` | repo root | **Generated audit trail** (gitignored): every blurb verdict, score, unsupported claims. |

## 3. Line References
_Anchors linking documentation to exact lines of code / doc._

### `structure.md`
- **L20–37** — The single most important design decision (code ranks, model writes).
- **L49–58** — Reuse table: which existing component to reuse for each need.
- **L66–74** — Models & cost (Gemini flash-lite for prose, flash + Google Search
  grounding for verification).
- **L77–94** — What is genuinely new and must be built.
- **L109–121** — Suggested build order.
- **L125–136** — Open questions to resolve before scoping.
- **L140–155** — Orientation: where to look first in the Champhunt repos.

### `parameters.md` — the weights study
- **"How these weights were derived"** — method (300 seeded seasons vs latent
  `strength`, constrained correlation maximisation, 66/34 split), the measured
  per-metric table, the two defects it exposed (`marginAdjustedWin` has no
  signal as computed; `sos` is sign-inverted in a round robin), and the
  synthetic-ground-truth caveat.

### `src/liveMatch.js` — match resolution
- **L~316–430** — CricAPI transport: quota counters lifted from every response,
  `QuotaError` as its own condition, TTL-per-document-kind caching.
- **`seriesDate()`** — CricAPI writes `endDate` without a year ("Mar 08"), which
  `Date.parse` resolves to 2001. Resolves the year against the series' own start;
  returns 0 when unparseable, which callers read as "unknown, do not skip".
- **`cricapiFindLatest`** — live-window short-circuit (1 call), then a budgeted
  series sweep. `relevance()` scores a series naming exactly ONE of the two teams
  at **-6** (a bilateral against a third team cannot hold their match) and one
  naming neither at 0 (a multi-team tournament, where marquee fixtures live).
  Every probed series is compared and the newest match wins. Quota failure stops
  the sweep instead of spending it.
- **L~291–345** — Gemini backup prompt: today's date + freshness window pinned in,
  `{"notFound": true}` accepted as a valid answer, one corrective retry on a
  stale result.
- **L~745–790** — `verify()`: the gate. Rejects on age > `MATCH_MAX_AGE_DAYS` and
  on a team mismatch (squad qualifiers count as different teams).

### Reuse map (external Champhunt repos — anchors pending source access)
| Component | File |
|---|---|
| Grounded fact-check (crown jewel) | `predictionGame/searchLLM.js` |
| Model wrapper + prompt/critic pattern | `predictionGame/llm.js` |
| CricAPI match cache | `predictionGame/matches.js` |
| Scheduled background loop | `predictionGame/index.js`, `ingestState.js`, `resolveState.js` |
| Daily quota + IST reset | `predictionGame/quota.js` |
| Admin control-room UI | `champhunt-ui/src/components/admin/prediction/PredictionData.jsx` |
| Mongoose model + audit trail | `predictionGame/models.js` |
| Reader-facing rendering | `champhunt-ui-next/src/app/prediction-game/page.tsx` |
| Config / models / keys / quotas | `predictionGame/config.js` |
