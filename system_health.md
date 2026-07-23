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

- **POC planning.** Lock the build plan and POC scope for the ranking engine +
  blurb demo, and get sign-off on the open decisions in `steps.md`.

## Micro-tasks
_Granular checklist of the immediate next steps._

- [x] Consolidate state files on `main` under Rohit's authorship.
- [x] Write `steps.md` (build plan + POC).
- [x] Commit and push `steps.md` + updated state files to `main`.
- [ ] Get owner's answers on the open decisions (engine language, POC data,
      reuse location) in `steps.md` §5.
- [ ] Build POC step 1: `data/ipl_<season>.json` snapshot.
- [ ] Build POC step 2: deterministic ranking engine + `weights.config`.
- [ ] Build POC step 3–4: templated blurbs + static `rankings.html`.

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
