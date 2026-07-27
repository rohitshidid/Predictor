# system_health.md — The Operations Hub

> Tracks the active state and trajectory of the project.
> Updated after **every** interaction.

_Last updated: 2026-07-25_

---

## Non-Negotiables
_Core architectural rules, tech stack constraints, and absolute boundaries._

- **The ranking must NOT be computed by the language model.** Deterministic code
  computes the ranked list and deltas; the model only writes the prose blurb.
- **Grounded fact-check is mandatory** before any generated blurb is shown —
  every stat must pass web-grounded verification (reuse `searchLLM.js`).
- **Reuse over reinvention.** The running prediction game
  (`champhunt-ms-contest/predictionGame/`) is the source of truth for reusable
  patterns. Mirror it rather than inventing new patterns.
- **Every model verdict is logged with its sources** (audit trail) so an editor
  can sign off — non-negotiable for TOI/Yahoo syndication credibility.
- **Ranking weighting is config, not code.**

## Active Rules
_Current development guidelines in effect._

- **Work on the `main` branch** until explicitly told to use a different branch.
- **All commits and content are authored by Rohit Shidid**
  (`rohitshidid@gmail.com`). No third-party attribution, co-authors, or tooling
  references anywhere — commits, comments, docs, or messages.
- Follow the operational workflow on every task: READ the three state files →
  EXECUTE → UPDATE all three state files.
- Keep model/keys/quotas env-driven (mirror `predictionGame/config.js`).

## Current Tasks
_The macro-level task currently being worked on._

- **MATCH SEARCH FIXED (2026-07-25).** "Fetch latest match between A and B" was
  returning the June 2024 T20 World Cup game for India v Pakistan and rejecting
  it as 776 days old, so the operator got nothing. Two causes, both now fixed:
  (1) `CRICAPI_KEY` was never set, so the authoritative feed was skipped entirely
  and the Gemini backup — which has no clock — answered with the most
  *written-about* fixture; (2) one lookup cost up to 18 CricAPI calls against a
  100/day plan, which is how the key ended up exhausted (110 hits) in the first
  place. See "Match search" below.

- **INTERACTIVE SIMULATOR BUILT + verified.** Upgraded the static POC into a live
  match simulator: dependency-free Node HTTP server (`server.js`) + single-page
  app (`public/index.html`). Right-hand menu drives everything; deterministic
  engine now computes all 9 metrics from `parameters.md`; AI rewrites only the two
  played teams' summaries using each team's "significant" note as the lead. Verified
  end-to-end in browser (simulate match, deltas, AI regen, live weight sliders,
  baseline/fresh toggle). Console clean.

## Parameter model (from parameters.md, ALL 12 implemented 2026-07-23)
9 ALWAYS-ON weighted metrics (normalized 0..1, weights in `weights.config.json`):
winPct 0.30 · deathOversNet 0.18 · powerplayDominance 0.16 · rollingNRR 0.09 ·
form(Bayesian α) 0.08 · homeAwayAdjustment 0.08 · keyPlayerAvailability 0.05 ·
marginAdjustedWin 0.03 · sos 0.03 (fitted 2026-07-25, see Weights section above;
was hand-set 0.25/0.10/0.15/0.15/0.10/0.10/0.05/0.05/0.05).
Death net scalingFactor 16.67 (economy→per-100-balls).
5 OPTIONAL metrics (`config.optionalWeights` + `config.enabled`, off by default,
toggled per-session in the UI): expectedWins (Pythagorean xW) · tossLeverage
(reward winning without the toss) · chaseSet (versatility) · top4Consistency
(mean+low volatility) · bowlingConcentration (spread attack = resilient).
New per-innings data fields: `top4`, `wktsLost`, `bowlTop2`. Every metric derived
from raw match data → math stays defensible. NOTE: keyPlayer/star availability is
still SYNTHETIC (squadStars), not a live ICC top-30 feed.

## Weights (hand-set 2026-07-27 — fitted values withdrawn)
- **Method:** editorial, set by cricket judgement, published in
  `power-rankings-explained.md` so they can be argued with. Config, not code.
- **Shipped:** winPct 0.30 · deathOversNet 0.15 · rollingNRR 0.15 ·
  powerplayDominance 0.12 · form 0.12 · homeAwayAdjustment 0.05 ·
  keyPlayerAvailability 0.05 · marginAdjustedWin 0.04 · sos 0.02. Sum 1.00.
- **Why the fit was withdrawn:** it maximised correlation against the generator's
  latent `strength`, but the generator derives phase splits straight from that
  same number, so powerplay/death read as the answer key and took ~34% of the
  table. Precision we could not support on real cricket.
- **Re-fit against REAL results** once a live season exists; the method in
  `parameters.md` transfers unchanged, only the target changes.


## Match search (locked 2026-07-25)
- **Resolver order:** CricAPI structured feed (authoritative — the match is chosen
  by filtering/sorting a real index in code) → Gemini grounded search (backup,
  date-pinned) → explicit `notFound`. It NEVER falls back to the offline snapshot
  for a team query; handing back an unrelated fixture stamped REJECTED reads as a
  bug in the search rather than as "we could not find it".
- **FORMAT-AGNOSTIC BY DESIGN.** Nothing filters on match type. Whatever the pair
  played most recently — T20, ODI, Test, T10 — wins, chosen purely by date. A
  draw/tie/no-result reports its own status instead of naming a winner.
- **Series ranking (fixed 2026-07-25):** a series naming exactly ONE of the two
  teams is a bilateral against a third team and CANNOT hold their match — it now
  scores -6, not +3. India and Pakistan never play bilaterals, so the only series
  that can hold their fixture is a multi-team tournament naming neither of them;
  the old scoring buried it below "India tour of Zimbabwe" every time.
- **All probed series are compared (fixed 2026-07-25).** Probing used to stop at
  the first series containing any fixture, which returned the second-latest
  match. Now the newest across every probed series wins; a series that ENDED
  before the best match in hand is skipped as unable to beat it.
- **Year-less dates (fixed 2026-07-25).** CricAPI writes `endDate` without a year
  ("Mar 08"); `Date.parse` resolves that to 2001 and backdated the 2026 World Cup
  by 25 years, so it was skipped. `seriesDate()` resolves the year against the
  series' own start; unparseable returns 0, which every caller reads as "unknown,
  do not skip".
- **The cache is visible and clearable.** A cached answer states its age on the
  card; a live one says so. `↻ Search again` bypasses the cache for one lookup,
  `🗑 Clear all previous cache` (POST /api/cache/clear) drops everything. A cache
  the operator cannot see or clear eventually lies to them.
- **The model has no clock.** The Gemini prompt now pins today's date and a
  freshness window, accepts `{"notFound": true}` as a correct answer, and retries
  once with the rejection reason when it returns something stale.
- **Quota is the real constraint.** Free plan = 100 calls/day, resets midnight IST.
  Live-window hit = 1 call; cold new pair ≤ 9; repeat search = 0 (disk cache under
  `.cache/`, pair-keyed and order-insensitive). A blown quota raises `QuotaError`
  and stops immediately — it is never reported as "no such match".
- **Verification gate unchanged and non-negotiable:** wrong teams or age >
  `MATCH_MAX_AGE_DAYS` = rejected, nothing enters the table.
- **Tests:** `npm test` — 12 cases on recorded payloads, spends no API calls.

## Simulator behaviour
- Modes: **From Baseline** (90-match snapshot) / **Fresh Start** (empty); toggling
  repopulates/clears. Reset current. AI-write-all button.
- Finish Match: appends match → re-ranks all → regenerates ONLY the 2 played teams'
  AI summaries (their per-team significant note = authorized lead colour).
- Live weight sliders → instant re-rank, prose untouched.
- ▲/▼ arrows diff against the state immediately before each action.

## POC decisions (locked 2026-07-23)
- **Engine language:** Node/JS (CommonJS, dependency-free — plain fetch, mirrors
  `predictionGame`).
- **POC data:** synthetic self-consistent season, real IPL team names; engine
  derives every stat from raw match innings.
- **Blurbs:** AI required now. Real Gemini calls (`gemini-2.5-flash-lite`
  generate, `gemini-2.5-flash` grounded critic). Key in gitignored `.env`
  (⚠ ROTATE — shared in chat). `BLURB_GROUNDING=stats` grounds against the
  dataset; `web` flips to live Google Search once real data is wired.
- **Home:** standalone in `Predictor/` — independent of Champhunt (see
  `selfcorrection.md`).

## Micro-tasks
_Granular checklist of the immediate next steps._

- [x] Consolidate state files on `main` under Rohit's authorship.
- [x] Write `steps.md` (build plan + POC).
- [x] Owner answered open decisions (Node, synthetic data, AI-now).
- [x] POC step 1: `data/ipl_2024.json` snapshot (+ `src/generateSeason.js`).
- [x] POC step 2: deterministic ranking engine (`src/engine.js`) +
      `weights.config.json` + `data/lastweek.json` deltas.
- [x] POC step 3: AI blurbs (`src/blurbs.js`) + template fallback
      (`src/templates.js`), audit trail (`audit.json`).
- [x] POC step 4: static `rankings.html` (`src/render.js`, `build.js`). Verified
      in browser, light + dark.
- [x] Add all 9 parameters from `parameters.md` to the engine (rich per-innings data).
- [x] Interactive simulator: server + SPA, right-hand parameter menu, Finish Match,
      per-team significant-event boxes feeding the AI, live weight sliders,
      baseline/fresh toggle. Verified in browser.
- [x] Implement ALL remaining spec metrics (xW, toss leverage, chase/set, top-4
      consistency, bowling Gini) as toggleable optional metrics with weight sliders.
- [x] Multi-select "Extra metrics (optional)" panel + list chips + Randomize button
      (fills all params, no auto-simulate). Verified in browser, console clean.
- [x] Tune weights — fitted against latent strength over 300 seasons rather than
      hand-set; held-out Spearman 0.694 -> 0.760. Write-up in `parameters.md`.
- [ ] Rework `marginAdjustedWin` (measured r = +0.01 — no signal as computed),
      then re-fit its weight.
- [ ] Fix `sos` sign / restrict it to unbalanced schedules (measured r = -1.00 in
      a round robin, and the engine adds it positively).
- [ ] Re-fit all weights against REAL results once a season of live CricAPI data
      has accumulated. The method transfers unchanged.
- [x] Wire live CricAPI as the primary match resolver, with a disk cache, an
      explicit call budget and quota-aware error reporting.
- [ ] Decide: `BLURB_GROUNDING=web` + REAL ICC top-30 feed for key-player
      availability (currently synthetic).
- [ ] Consider a paid CricAPI plan if match search becomes a daily workflow —
      100 calls/day is roughly 10 cold lookups, and the cache only helps repeats.
- [ ] Decide: weekly scheduler + editor review screen; persist sim state across restarts.

## Upcoming Goals
_Roadmap of future features / refactoring (per structure.md build order)._

1. **Ranking engine** — deterministic, over one league's historical data
   (win%, NRR, last-5 form). Prove numbers are defensible.
2. **Blurb generation** — one grounded, critic-gated model call per team.
3. **Weekly scheduler + admin review screen** — clone loop + dashboard patterns.
4. **Newsletter HTML + syndication feed (JSON/RSS)** — cheap, high-value outputs.
5. **TV slate + social images** — later phase, separate skill set.

### Open questions blocking full scoping
- Which leagues, and does the data source give scorecard-level data (form/NRR)?
- Human-in-the-loop confirmed? (Strong recommendation: yes.)
- Which output formats first?
- Whose product — standalone tool vs. new module inside `champhunt-ms-contest`?
