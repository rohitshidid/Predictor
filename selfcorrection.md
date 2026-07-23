# selfcorrection.md — The Preference Ledger

> The system's memory for user feedback. Read this **before touching any code**
> to avoid repeating past mistakes. Log any correction or preference the moment
> it is issued in chat.

_Last updated: 2026-07-23_

---

## Coding Preferences
_Specific stylistic and structural choices the user prefers._

- **This is a STANDALONE product, fully independent of Champhunt.** The Power
  Rankings output is its own self-contained webpage — no Champhunt UI, no
  Champhunt runtime, no shared server. Reusable Champhunt code is COPIED in, not
  linked. Never run/serve any Champhunt app for this project.

## Corrections Issued
_Cumulative log of corrections._

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

## Workflow Preferences
_How the user wants tasks handled._

- On every prompt: READ the three state files first, EXECUTE the task, then
  UPDATE all three state files.
- Maintain these three files continuously across the whole project.
- Do not create pull requests unless explicitly requested.
- Default working branch is `main`.
