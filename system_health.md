# system_health.md — The Operations Hub

> Tracks the active state and trajectory of the project.
> Updated after **every** interaction.

_Last updated: 2026-07-23_

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

- **INTERACTIVE SIMULATOR BUILT + verified.** Upgraded the static POC into a live
  match simulator: dependency-free Node HTTP server (`server.js`) + single-page
  app (`public/index.html`). Right-hand menu drives everything; deterministic
  engine now computes all 9 metrics from `parameters.md`; AI rewrites only the two
  played teams' summaries using each team's "significant" note as the lead. Verified
  end-to-end in browser (simulate match, deltas, AI regen, live weight sliders,
  baseline/fresh toggle). Console clean.

## Parameter model (from parameters.md, ALL 12 implemented 2026-07-23)
9 ALWAYS-ON weighted metrics (normalized 0..1, weights in `weights.config.json`):
winPct 0.25 · marginAdjustedWin 0.10 · rollingNRR 0.15 · form(Bayesian α) 0.15 ·
powerplayDominance 0.10 · deathOversNet 0.10 · sos 0.05 · homeAwayAdjustment 0.05 ·
keyPlayerAvailability 0.05. Death net scalingFactor 16.67 (economy→per-100-balls).
5 OPTIONAL metrics (`config.optionalWeights` + `config.enabled`, off by default,
toggled per-session in the UI): expectedWins (Pythagorean xW) · tossLeverage
(reward winning without the toss) · chaseSet (versatility) · top4Consistency
(mean+low volatility) · bowlingConcentration (spread attack = resilient).
New per-innings data fields: `top4`, `wktsLost`, `bowlTop2`. Every metric derived
from raw match data → math stays defensible. NOTE: keyPlayer/star availability is
still SYNTHETIC (squadStars), not a live ICC top-30 feed.

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
- [ ] Review output + tune weights via the live sliders (or `weights.config.json`).
- [ ] Decide: wire live CricAPI (`matches.js` pattern) + `BLURB_GROUNDING=web` +
      REAL ICC top-30 feed for key-player availability (currently synthetic).
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
