# Willow TV Project — T20 Cricket Power Rankings

A weekly, AI-assisted **power ranking** for T20 cricket leagues — a ranked list
of teams (1..N) with a movement arrow (▲2 / ▼1 since last week) and a short
**blurb** explaining each team's position, in the style of CBS Sports / ESPN
MLB power rankings.

One artifact per week feeds many surfaces:
- Willow e-newsletter to subscribers
- Social media posts
- On-air **TV slate** (the graphic between programming)
- Syndication to **Times of India (TOI) Sports** website
- Onward to **Yahoo! Sports**

This document is the handover: what to build, what already exists to reuse, and
where to look.

---

## 1. The single most important design decision

**The AI must NOT compute the ranking. Code computes it; the AI only writes the
prose.**

LLMs are unreliable at arithmetic and inconsistent week to week — the same
inputs can produce a different order twice. Split the job:

1. **A deterministic ranking engine (plain code)** consumes stats — wins,
   net run rate, recent-form weighting, strength of schedule — and outputs the
   ordered list plus each team's delta vs last week. Reproducible and
   defensible ("why is Mumbai 3rd?" has a numeric answer).
2. **The LLM writes only the blurb**, given the numbers and last week's rank:
   *"▲3 — three straight wins, and their death bowling has gone from leaking
   11 an over to 7.4."*

This is the same split the prediction game already uses: **code decides
eligibility and timing, the LLM only writes**. Keep it.

---

## 2. What already exists that we reuse (this is the point)

Everything below lives in **`champhunt-ms-contest/predictionGame/`** unless
noted. This module already runs a scheduled LLM pipeline with web-grounded
fact-checking, a self-critique gate, an admin control room, and CricAPI match
data. The power-ranking tool is the same machinery pointed at a different
output.

| Need for power rankings | Reuse this | File |
|---|---|---|
| **Web-grounded fact-check** so a blurb never invents a scoreline | `searchLLM.resolveQuestion` / `prePublishCheck` / `generateGrounded` — Gemini + Google Search grounding | `predictionGame/searchLLM.js` |
| **LLM provider wrapper + prompt/critic pattern** (returns structured JSON, self-scores, rejects low quality) | `getLLM()`, the `GENERATE_PROMPT` + merged critic pattern | `predictionGame/llm.js` |
| **CricAPI match cache** — live/upcoming/results, format, status, one cheap cached call | `refreshMatches`, `getLive`, `getUpcoming`, `findMatch`, `matchFinished`, `sweepFinishedMatches` | `predictionGame/matches.js` |
| **Scheduled background loop** with pause/resume, runtime interval, overlap guard, re-arm-on-interval-change | the ingest/resolve loop pattern | `predictionGame/index.js`, `ingestState.js`, `resolveState.js` |
| **Daily/period quota + reset** (IST day keying, atomic consume) | `getQuota`, `consume`, IST helpers | `predictionGame/quota.js` |
| **Admin control room UI** — status chips, interval dropdowns, pause buttons, audit trail of every LLM verdict, IST clock, danger zone | the whole dashboard | `champhunt-ui/src/components/admin/prediction/PredictionData.jsx` |
| **Mongoose model + audit-trail pattern** (every LLM verdict stored with sources for later justification) | `Question.resolution` sub-doc pattern | `predictionGame/models.js` |
| **Reader-facing rendering reference** (how a generated item is laid out for an audience) | the play/feed screen | `champhunt-ui-next/src/app/prediction-game/page.tsx` |

**The single most transferable piece is the grounded fact-check.** For a game,
a hallucinated fact costs some in-app runs. For Willow syndicating to Yahoo and
TOI, a hallucinated stat is a credibility problem — and we already built the
layer that catches it, and already log every verdict with its sources, which is
exactly what an editor needs to sign off.

### Models / cost (already proven in the prediction game)
- Generation (prose): `gemini-2.5-flash-lite` (`GEMINI_INGEST_MODEL`)
- Grounded verification: `gemini-2.5-flash` with `tools:[{google_search:{}}]`
  (`GEMINI_MODEL`) — see `config.js` and `searchLLM.js`.
- Same API key for both (the model is a URL path segment).
- Google Search grounding free tier: 500 grounded requests/day (2.5 family);
  paid: 1,500/day free then $35 / 1,000. A weekly ranking is a rounding error
  against that.

---

## 3. What is genuinely new (must be built)

1. **Ranking engine** — deterministic. Input: league + week of match data.
   Output: ordered teams with a computed score and last-week delta. Start
   simple (win%, NRR, last-5 form) and make the weighting a config, not code.
2. **Data source per league** — CricAPI covers match results, but **form and
   NRR need scorecard-level data**. Coverage must be checked per league before
   promising anything (see Open Questions).
3. **Blurb generation** — one LLM call per team given its numbers + last-week
   rank, grounded-verified before it's shown. Reuse `searchLLM` + the critic
   pattern; do not let the LLM output the rank.
4. **Weekly cadence** — the existing loops are daily/interval; this is once a
   week. Same scheduling code, different trigger.
5. **Editor-in-the-loop** — generate → editor reviews/edits → publish. Small
   addition to the existing admin dashboard.
6. **Output formatters** — newsletter HTML and a syndication feed (JSON/RSS)
   are easy. **TV slate graphics and social images are a different kind of
   work** (image rendering, brand templates) — treat as a later phase.

---

## 4. How this feeds back into the prediction game (not a side project)

- **Better AI predictions.** Today `aiPrediction` is the LLM's gut feel. The
  ranking model gives a real numeric prior — a genuine edge signal.
- **Free question material.** Every ranking is a prediction: *"Will Mumbai
  still be #1 next week?"* Admin-created, high quality, zero LLM cost.
- **Distribution.** Newsletter, TOI, Yahoo put Champhunt in front of a cricket
  audience that would actually play the game.

---

## 5. Suggested build order

1. **Ranking engine** over one league's historical data — deterministic,
   testable, no LLM. Prove the numbers are defensible.
2. **Blurb generation** on top of the engine output, grounded-verified,
   critic-gated. Reuse `searchLLM.js` + `llm.js` patterns.
3. **Weekly scheduler + admin review screen** — clone the loop + dashboard
   patterns from `predictionGame/`.
4. **Newsletter HTML + syndication feed** — the two cheap, high-value outputs.
5. **TV slate + social images** — later phase, separate skill set.

Rough instinct: ranking engine + blurb generation ≈ a couple of weeks; the
distribution formats are the longer tail.

---

## 6. Open questions to resolve before scoping

1. **Which leagues, and where does the data come from?** IPL, BBL, PSL, CPL,
   SA20, MLC, The Hundred? Verify CricAPI (or another provider) gives
   scorecard-level data per league — form and NRR need it.
2. **Human in the loop?** Strong recommendation: yes. Generate → editor edits →
   publish.
3. **Which output formats first?** Newsletter + syndication feed are easy;
   TV/social graphics are heavier.
4. **Whose product is this?** Willow's (licensed from us) or Champhunt-branded
   content Willow distributes? Standalone tool vs a new module inside
   `champhunt-ms-contest` — this changes the architecture.

---

## 7. Where to look first (orientation for whoever picks this up)

Read these, in order:
1. `champhunt-ms-contest/predictionGame/searchLLM.js` — the grounded
   fact-check. This is the crown jewel to reuse.
2. `champhunt-ms-contest/predictionGame/ingest.js` — end-to-end example of the
   "code gates, LLM writes, grounded check, then publish" pipeline.
3. `champhunt-ms-contest/predictionGame/matches.js` — the CricAPI data layer.
4. `champhunt-ui/src/components/admin/prediction/PredictionData.jsx` — the
   control-room UI to clone for the editor review screen.
5. `champhunt-ms-contest/predictionGame/config.js` — model choice, keys,
   quotas, all env-driven.

> Source of truth for reusable code is the running prediction game. When in
> doubt, mirror how it already does something rather than inventing a new
> pattern.

---

*This is a planning/handover document. No code here. All reusable components
referenced live in the existing Champhunt repos listed above.*
