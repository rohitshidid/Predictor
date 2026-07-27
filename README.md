# Willow TV — T20 Cricket Power Rankings

A weekly, AI-assisted power ranking for T20 cricket leagues. Teams are ranked by a **deterministic engine** (pure math — no AI guessing) and each team gets a short **AI-written blurb** explaining their position, in the style of ESPN/CBS power rankings.

> **Core rule:** The AI never decides the ranking. Code computes the order from stats. The AI only writes the prose.

---

## Prerequisites

- **Node.js ≥ 18** — check with `node --version`
- A **Gemini API key** from [Google AI Studio](https://aistudio.google.com/app/apikey) *(optional — the app runs fully without it, AI blurbs are just disabled)*

---

## Quick Start

### 1. Clone and enter the project

```bash
cd "Willow TV Project/Predictor"
```

### 2. Set up environment variables

Copy the example env file and fill in your Gemini API key:

```bash
cp .env.example .env
```

Open `.env` and set your keys:

```
CRICAPI_KEY=your_cricapi_key_here
GEMINI_API_KEY=your_gemini_key_here
```

- **`CRICAPI_KEY`** powers the *"Fetch latest match between A and B"* search. Get one free at [cricapi.com](https://cricapi.com). Set this if you want match search to work — see [Match search](#match-search) below.
- **`GEMINI_API_KEY`** powers the AI blurbs. Without it the app runs in template mode: rankings are still fully computed, blurbs are auto-generated from the stats.

### 3. Start the server

```bash
node server.js
```

Or using npm:

```bash
npm start
```

### 4. Open the app

Visit **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## What you'll see

| Section | Description |
|---|---|
| **Left panel** | Live power rankings — teams ordered by score, with movement arrows (▲/▼) and a blurb for each team |
| **Season panel** (top right) | Switch between *Baseline* (90-match historical seed) and *Fresh Start* (empty season) |
| **Simulate Match** (right) | Enter match details and press **Simulate Match** to append the result and instantly re-rank |
| **Weights (live)** (bottom right) | Drag sliders to adjust how much each factor (Win %, NRR, Powerplay, etc.) contributes to the score. Rankings update instantly. |

---

## Available Scripts

| Command | What it does |
|---|---|
| `npm start` | Start the interactive ranking server on port 3000 |
| `node server.js` | Same as above |
| `npm test` | Run the match-resolution test suite (offline — spends no API calls) |
| `node src/generateSeason.js` | Regenerate the synthetic IPL season data in `data/` |

---

## Environment Variables

All settings live in `.env`. Copy `.env.example` to get started.

| Variable | Default | Description |
|---|---|---|
| `CRICAPI_KEY` | *(empty)* | Your [CricAPI](https://cricapi.com) key. **Required for the "Fetch latest match between A and B" box to work properly.** Without it the search falls back to grounded AI search, which reliably answers "latest India v Pakistan" with a famous *old* match. |
| `CRICAPI_MAX_SERIES_TERMS` | `4` | How many series searches one lookup may spend. Lower it to stretch a free plan, raise it for better coverage. |
| `CRICAPI_MAX_SERIES_PROBE` | `4` | How many candidate series one lookup may open. |
| `MATCH_TOURNAMENTS` | *(see `.env.example`)* | Extra series-search terms for multi-team events. A World Cup series is named after the event, not the teams, so a plain "India"/"Pakistan" search cannot see it. |
| `MATCH_STALE_DAYS` | `90` | Older than this, a resolved match is shown with a "confirm this is really the latest" warning. |
| `MATCH_MAX_AGE_DAYS` | `365` | Older than this, a resolved match is **rejected** — it cannot be "the latest". |
| `GEMINI_API_KEY` | *(empty)* | Your Google Gemini API key. Without this, AI blurbs are disabled and template blurbs are used instead. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Model used for grounded verification and the critic step. |
| `GEMINI_INGEST_MODEL` | `gemini-2.5-flash-lite` | Model used for prose generation (cheaper, high volume). |
| `BLURB_MIN_SCORE` | `8` | Minimum quality score (0–10) a generated blurb must pass before it is published. |
| `BLURB_GROUNDING` | `stats` | `stats` = ground blurbs against the local dataset. `web` = ground against live Google Search (requires a real API key). |

---

## Project Structure

```
Predictor/
├── server.js               # HTTP server — all API routes live here
├── public/
│   └── index.html          # The entire frontend (single file, no build step)
├── src/
│   ├── engine.js           # Deterministic ranking engine (pure math, no AI)
│   ├── blurbs.js           # AI blurb generation + critic gate
│   ├── config.js           # Env-driven config (models, keys, thresholds)
│   ├── simState.js         # In-memory state: matches, rankings, blurbs
│   ├── render.js           # Template blurb renderer (fallback when AI is off)
│   ├── templates.js        # Blurb sentence templates
│   └── generateSeason.js   # Generates synthetic IPL season data
├── data/
│   ├── ipl_2024.json       # 90-match IPL 2024 snapshot (baseline seed)
│   └── lastweek.json       # Last week's ranking snapshot (for ▲/▼ deltas)
├── weights.config.json     # Ranking weights — tune here, not in code
├── parameters.md           # All ranking parameters explained in detail
├── structure.md            # Architecture and design decisions
├── steps.md                # Build plan and POC scope
├── wiki.md                 # Full project encyclopedia and file index
└── .env.example            # Environment variable template
```

---

## How the Ranking Works

The ranking engine scores every team on 9 factors and sorts them highest to lowest. All weights are tunable in `weights.config.json` without touching any code.

| Factor | Weight | What it measures |
|---|---|---|
| **Win %** | 0.30 | Percentage of matches won this season |
| **Death overs** | 0.18 | Batting vs bowling performance in overs 16–20 |
| **Powerplay** | 0.16 | Batting vs bowling dominance in overs 1–6 |
| **Rolling NRR** | 0.09 | Net Run Rate over the last 5 games (not the whole season) |
| **Form (momentum)** | 0.08 | Recent results, weighted so the latest game counts most |
| **Home/away** | 0.08 | Consistency at home vs. away venues |
| **Key players** | 0.05 | Number of ICC top-30 ranked players available |
| **Win quality** | 0.03 | How convincingly — an 8-wicket win scores higher than a 1-run squeaker |
| **Str. of schedule** | 0.03 | Average Win% of opponents faced |

See [`parameters.md`](parameters.md) for the full formula behind each metric, and the [weights study](parameters.md#how-these-weights-were-derived) for how the numbers above were arrived at.

### Where the weights come from

They are fitted, not guessed. 300 independently seeded synthetic seasons are generated, each team carrying the latent `strength` the generator used to produce it; every metric is normalized exactly as the engine does it; then the weights that best make the ranking track true strength are solved for, subject to `w ≥ 0` and `Σw = 1`, fitted on two-thirds of the seasons and scored on the held-out third.

| Weights | Held-out Spearman vs true strength | Correct #1 |
|---|---|---|
| Previous hand-set | 0.694 | 46% |
| Current (fitted) | 0.760 | 50% |

Floors and caps keep the table publishable — results must visibly drive it, and no single family may dominate. `weights.config.json` carries a per-metric note explaining each number.

> **Caveat:** the only ground truth available today is the synthetic generator, so phase metrics score better here than they likely would against real cricket. Re-fit once a season of live CricAPI results has accumulated.

---

## Match search

Type two team names into **Fetch latest match between** and press **Fetch match result**. The app resolves the most recent *completed* fixture between them and fills the simulate form with the real scorecard.

### How a match is resolved

Two resolvers run in order, and the answer is verified before it can touch the table.

1. **CricAPI (the structured feed)** — authoritative. The match is picked by filtering and sorting a real match index *in code*, so it cannot be invented. Requires `CRICAPI_KEY`.
2. **Gemini + Google Search** — backup only, used when the feed is unavailable. The prompt pins today's date and an explicit freshness window, and an out-of-window answer is thrown back at the model once before being given up on.
3. **Verification gate** — whatever comes back must be *these two teams* and must be recent. A match older than `MATCH_MAX_AGE_DAYS` is rejected outright, and a squad qualifier counts as a different team, so a request for India never resolves to India Women, India A or India U19.

If nothing resolves, the card says so and shows the resolver chain. It never falls back to an unrelated fixture.

### The free plan is 100 calls a day

That is the real constraint on this feature, so the lookup is built around it:

- **A completed match in the live window costs one call.** That is the common case — a fixture that just ended.
- **A cold lookup for a brand-new team pair costs at most 9 calls** (`1 + CRICAPI_MAX_SERIES_TERMS + CRICAPI_MAX_SERIES_PROBE + 1`).
- **Repeat searches cost nothing.** Responses are cached on disk under `.cache/`, keyed so that "India v Pakistan" and "Pakistan v India" are one question. Series lists last a day, finished scorecards last a month — they cannot change.
- **A blown quota stops immediately** rather than spending the rest of the allowance proving it is blown.

The card shows `CricAPI quota: n/100 calls used today` after every fetch. The allowance resets at **midnight IST**.

If you run out mid-session, paste a scorecard link into **Match links** — that gives the AI backup the page text to work from, so it can still answer without the feed.

### When the cached answer is stale

A cached answer always says so: the card reads *"Served from cache (stored 40 min ago)"*. A live one reads *"Live lookup — not from cache."* Two buttons sit under **Fetch match result**:

| Button | What it does |
|---|---|
| **↻ Search again (ignore cache)** | Re-runs *this* lookup against the feed, ignoring every stored response. Use it when you have added a link, or when a new match has just finished. |
| **🗑 Clear all previous cache** | Drops every stored response so the next search of any pair starts completely cold. |

> Deleting the `.cache/` folder by hand only clears the disk copy — a running server still holds its in-memory mirror. Use the button, or restart the server after deleting.

### Any format counts

The resolver never filters by format. Whatever these two teams played most recently — T20, ODI, Test, T10 — is what comes back, chosen purely by date. A draw, tie or no-result reports its own status instead of naming a winner.

Non-T20 results are still loaded into a T20 engine, so the card warns you: phase splits are estimated and the totals are read literally.

---

## Running Without a Gemini API Key

The app works fully without an API key:

- Rankings are computed deterministically from the stats (nothing changes here)
- Blurbs are generated from sentence templates instead of the AI
- The **AI ✓** badge in the header changes to **AI off**
- Everything else — sliders, simulation, deltas, the full UI — works normally

To enable AI blurbs later, just add `GEMINI_API_KEY=your_key` to your `.env` file and restart the server.

---

## Sharing Publicly via Cloudflare Tunnel

Cloudflare Tunnel gives you a live public URL that proxies straight to your local server — no hosting, no deployment, no code changes. Your laptop must be on and the server must be running.

### Prerequisites

Install `cloudflared` via Homebrew:

```bash
brew install cloudflare/cloudflare/cloudflared
```

### Steps

**1. Start the server** (in one terminal):

```bash
cd "/Users/rohitshidid/Documents/AntiGravity/Champhunt/Willow TV Project/Predictor"
node server.js
```

You should see:
```
[server] Power-Ranking simulator on http://localhost:4310
```

**2. Open the tunnel** (in a second terminal):

```bash
cloudflared tunnel --url http://localhost:4310
```

After a few seconds you will see a line like:
```
https://random-words-abc123.trycloudflare.com
```

That URL is now publicly accessible. Share it with anyone — it routes directly to your running server.

**3. Stop the tunnel** — press `Ctrl+C` in the tunnel terminal. The URL is immediately deactivated.

> **Note:** The public URL is randomly generated each time you run the tunnel. It changes every session. If you need a stable URL, use Railway (see below).

### Important Limitations

| Limitation | Detail |
|---|---|
| **Laptop must stay on** | The moment your machine sleeps or the server stops, the URL goes dead |
| **URL changes every session** | A new random URL is generated each time you run `cloudflared tunnel` |
| **State is in-memory** | Restarting the server resets all simulated matches and rankings back to baseline |
| **For demos only** | Not suitable for production or 24/7 availability |

---

## Sharing Publicly via LocalTunnel

LocalTunnel is the simplest zero-install option — no account, no setup, runs directly with `npx`. Like Cloudflare Tunnel, your laptop must be on and the server must be running.

### Steps

**1. Start the server** (in one terminal):

```bash
cd "/Users/rohitshidid/Documents/AntiGravity/Champhunt/Willow TV Project/Predictor"
node server.js
```

You should see:
```
[server] Power-Ranking simulator on http://localhost:4310
```

**2. Open the tunnel** (in a second terminal — no install needed):

```bash
npx localtunnel --port 4310
```

The first time you run it, npx will ask to install `localtunnel@2.0.2` — type `y` and press Enter. After that it runs instantly.

You will see:
```
your url is: https://some-random-name.loca.lt
```

That URL is now publicly accessible. Share it with anyone.

> **Note:** When someone opens the URL for the first time, LocalTunnel may show a "tunnel password" page. The password is your **public IP address** — visitors can find it by going to [https://loca.lt/mytunnelpassword](https://loca.lt/mytunnelpassword) and entering that string.

**3. Stop the tunnel** — press `Ctrl+C` in the tunnel terminal.

### Comparison: LocalTunnel vs Cloudflare Tunnel

| | LocalTunnel | Cloudflare Tunnel |
|---|---|---|
| **Install required** | None (`npx`) | `brew install cloudflared` |
| **Speed** | Slightly slower | Faster (QUIC protocol) |
| **Reliability** | Occasionally drops | More stable |
| **URL style** | `*.loca.lt` | `*.trycloudflare.com` |
| **Password page** | Yes (first visit) | No |

---

## Troubleshooting

**Port already in use?**
```bash
lsof -ti:4310 | xargs kill -9
node server.js
```

**Rankings not updating after a simulate?**
Hard-refresh the browser (`Cmd+Shift+R` on Mac).

**AI blurbs not generating?**
Check that `GEMINI_API_KEY` is set in `.env` (not `.env.example`) and the server was restarted after editing the file.

**Match search returns an old match, or says "REJECTED"?**
The label under *Fetch latest match between* tells you which resolver is in play. If it reads `no CRICAPI_KEY, using AI search`, set `CRICAPI_KEY` in `.env` and restart — grounded search alone tends to return the most *written-about* fixture rather than the most recent one, which is exactly what the rejection is catching.

**Match search says the quota is exhausted?**
The free CricAPI plan is 100 calls/day and resets at midnight IST. The fetch card shows the current count. Until it resets, paste a scorecard link into **Match links** so the AI backup has a page to read.

**Match search says "no completed match found"?**
Check both team names are spelled as the feed names them, then paste a link to the match or its series — the series slug in the URL is used as a search term and usually pins it down immediately.

**Cloudflare Tunnel not connecting?**
Make sure the server is running first (`node server.js`), then start the tunnel. If `cloudflared` is not found, run `brew install cloudflare/cloudflare/cloudflared`.
