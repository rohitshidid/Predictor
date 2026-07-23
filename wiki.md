# wiki.md — The Project Encyclopedia

> The definitive map of the codebase: architectural overview, a per-file index,
> and line-number anchors linking documentation to exact code.

_Last updated: 2026-07-23_

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
| `system_health.md` | repo root | Operations hub — active state, rules, tasks, roadmap. |
| `selfcorrection.md` | repo root | Preference ledger — user preferences and corrections. |
| `wiki.md` | repo root | Project encyclopedia — this file. |

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
