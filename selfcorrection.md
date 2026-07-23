# selfcorrection.md — The Preference Ledger

> The system's memory for user feedback. Read this **before touching any code**
> to avoid repeating past mistakes. Log any correction or preference the moment
> it is issued in chat.

_Last updated: 2026-07-23_

---

## Coding Preferences
_Specific stylistic and structural choices the user prefers._

- _(None recorded yet.)_

## Corrections Issued
_Cumulative log of corrections._

- **[2026-07-23]** Do not work on the auto-generated feature branch. Work
  directly on the `main` branch until explicitly told to use a different one.
- **[2026-07-23]** No third-party/tooling attribution anywhere — messages,
  commit messages, trailers, code comments, or docs. Everything is authored by
  and attributed to Rohit Shidid (`rohitshidid@gmail.com`). Git identity set
  accordingly.

## Workflow Preferences
_How the user wants tasks handled._

- On every prompt: READ the three state files first, EXECUTE the task, then
  UPDATE all three state files.
- Maintain these three files continuously across the whole project.
- Do not create pull requests unless explicitly requested.
- Default working branch is `main`.
