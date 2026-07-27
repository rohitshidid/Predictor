# selfcorrection.md — The Preference Ledger

> The system's memory for user feedback. Read this **before touching any code**
> to avoid repeating past mistakes. Log any correction or preference the moment
> it is issued in chat.

_Last updated: 2026-07-25_

---

## Coding Preferences
_Specific stylistic and structural choices the user prefers._

- **This is a STANDALONE product, fully independent of Champhunt.** The Power
  Rankings output is its own self-contained webpage — no Champhunt UI, no
  Champhunt runtime, no shared server. Reusable Champhunt code is COPIED in, not
  linked. Never run/serve any Champhunt app for this project.

## Corrections Issued
_Cumulative log of corrections._

- **[2026-07-25]** Typing two team names must just work — fetch the latest match
  they played. Two rules fell out of fixing it, both now enforced in code:
  **(a)** a language model is never the primary resolver for "the latest X",
  because it has no clock and returns the most written-about match, not the most
  recent one; the structured feed decides, the model only backs it up;
  **(b)** a paid-quota failure must never be reported as "no match found" —
  they are different answers and conflating them sends the operator hunting for
  a bug that is not there.
- **[2026-07-25]** Respect the API budget as a first-class design constraint,
  not an afterthought. The CricAPI free plan is 100 calls/day; the original
  lookup spent up to 18 per search and exhausted the key. Cache to disk (survives
  restarts), cap fan-out explicitly, and short-circuit as early as the data allows.

- **[2026-07-23]** Do not work on the auto-generated feature branch. Work
  directly on the `main` branch until explicitly told to use a different one.
- **[2026-07-23]** No third-party/tooling attribution anywhere — messages,
  commit messages, trailers, code comments, or docs. Everything is authored by
  and attributed to Rohit Shidid (`rohitshidid@gmail.com`). Git identity set
  accordingly.
- **[2026-07-23]** Do NOT serve/run the Champhunt UI for this project. The root
  `.claude/launch.json` defines a `champhunt-ui` config on port 3101; the preview
  reads the ROOT launch.json, so a Predictor-only name is ignored and it defaults
  to Champhunt UI. Fix: the standalone `rankings` config in the ROOT launch.json
  (now `node server.js` on port 4310, autoPort:false) runs the simulator. Use
  `rankings`, never `champhunt-ui`. Kill strays with `lsof -ti tcp:4310 | xargs kill -9`.

- **[2026-07-25]** A cache must be visible and clearable. Storing responses to
  protect a 100-call/day plan is right, but an operator who cannot tell a cached
  answer from a live one, or force a fresh search, eventually gets lied to. Every
  cached answer now states its age; `↻ Search again` bypasses it for one lookup
  and `🗑 Clear all previous cache` drops everything.
- **[2026-07-25]** Match search is FORMAT-AGNOSTIC. Only "what did these two play
  last" matters — T20, ODI, Test or T10, decided purely by date. Never filter on
  match type.
- **[2026-07-25]** Weights are fitted, not asserted. When asked what a number
  should be, derive it from data with a stated method, a held-out score, and the
  caveat attached — do not hand back a plausible-looking guess. Where the fit
  conflicts with what a published table must look like, encode that as an
  explicit constraint and say what the constraint cost.

## Workflow Preferences
_How the user wants tasks handled._

- On every prompt: READ the three state files first, EXECUTE the task, then
  UPDATE all three state files.
- Maintain these three files continuously across the whole project.
- Do not create pull requests unless explicitly requested.
- Default working branch is `main`.
