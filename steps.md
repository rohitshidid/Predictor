# steps.md — Build Plan & POC

_Willow TV — T20 Cricket Power Rankings. Last updated: 2026-07-23._

This is the working plan: what we're building, the phased build order, and the
concrete POC we start with.

---

## 1. What we're building (in one paragraph)

A **weekly power ranking for T20 cricket leagues** — a numbered list of teams
(1..N), each with a movement arrow (▲2 / ▼1 vs last week) and a short blurb
explaining its position, in the style of ESPN/CBS power rankings. One weekly
artifact feeds a newsletter, social posts, an on-air TV slate, and syndication
(Times of India → Yahoo).

**The rule that defines the architecture:** the language model does **not**
decide the ranking. Deterministic code computes the order from stats (win %,
net run rate, recent form, strength of schedule). The model only writes the
prose blurb from those numbers. This keeps the ranking reproducible and
defensible, and keeps the model away from arithmetic.

---

## 2. Build order (full project)

1. **Ranking engine (deterministic, no AI).** Input: one league's match data
   for a window. Output: ordered teams, each with a computed score and the
   delta vs last week. Weighting (win% vs NRR vs form) lives in a **config
   file, not code**, so it is tunable without a rewrite.
2. **Blurb generation (AI, tightly fenced).** One model call per team, given
   only its numbers + last week's rank. Output is web-grounded verified before
   it is shown, and a self-critique step rejects weak copy. Reuses the existing
   Champhunt prediction-game machinery rather than building fresh.
3. **Weekly scheduler + editor review screen.** Generate → a human edits/
   approves → publish. Cloned from the existing admin dashboard pattern.
4. **Output formatters.** Newsletter HTML + a syndication feed (JSON/RSS)
   first — they are cheap. TV-slate graphics and social images are a heavier,
   later phase.

---

## 3. The POC (what we start with)

Scope the POC to **steps 1 + 2 only, one league, no scheduler, no publishing** —
just enough to prove the two genuinely hard parts: defensible math and
trustworthy prose.

### POC steps
1. **Data snapshot.** Drop a small `data/ipl_<season>.json` — teams + match
   results for one IPL season. Start with a static snapshot (real export or a
   realistic sample); no live API needed to prove the concept.
2. **Ranking engine.** Write an engine that reads the data + a `weights.config`
   and outputs the ordered table with score and ▲/▼ delta vs a stored
   "last week" snapshot.
3. **Blurb per team.** Generate a blurb for each team. Start with deterministic
   sentence templates from the numbers; layer the real grounded + critic AI
   pipeline on afterward.
4. **Render.** Produce a single static `rankings.html` — the ranked list with
   arrows and blurbs. That is the demo: it looks like the real product but runs
   on a fixed dataset.

Then review together, tune the weights, and decide whether to wire live
CricAPI data and the real AI blurb layer next.

---

## 4. POC defaults (recommended)

| Decision | Recommendation | Why |
|---|---|---|
| **League** | IPL | Most complete public data; NRR + recent form without coverage gaps. |
| **Code home** | Standalone in this `Predictor` repo | Repo currently holds only docs; reuse targets live in separate Champhunt repos not in this session. Fold into `champhunt-ms-contest` later if desired. |
| **POC data** | Static snapshot (CSV/JSON) | No API keys or rate limits; fully reproducible for a demo. Swap in live CricAPI later. |
| **Blurbs** | Deterministic templates first, AI after | Proves the ranking math and end-to-end demo without needing a Gemini/Google-Search key in this environment. |

---

## 5. Open decisions before building

- **Engine language:** Node/JS (matches the Champhunt reuse target — leaning
  this way) vs Python (fastest to prototype the math). 
- **POC data:** a real IPL results export provided by the owner, vs a realistic
  synthetic season generated for the demo.
- **Reuse location:** confirm whether the code should ultimately live here or as
  a module inside `champhunt-ms-contest` (affects imports of `searchLLM.js`,
  `matches.js`).

---

## 6. Reference

- `structure.md` — full architectural handover and reuse map.
- `system_health.md` — active state, rules, current tasks, roadmap.
- `wiki.md` — codebase map and file index.
