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

Open `.env` and set your key:

```
GEMINI_API_KEY=your_key_here
```

> **No key?** That's fine. The app runs in template mode — rankings are fully computed, AI blurbs are replaced with auto-generated text from the stats.

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
| `node src/generateSeason.js` | Regenerate the synthetic IPL season data in `data/` |

---

## Environment Variables

All settings live in `.env`. Copy `.env.example` to get started.

| Variable | Default | Description |
|---|---|---|
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

| Factor | What it measures |
|---|---|
| **Win %** | Percentage of matches won this season |
| **Win quality** | How convincingly — an 8-wicket win scores higher than a 1-run squeaker |
| **Rolling NRR** | Net Run Rate over the last 5 games (not the whole season) |
| **Form (momentum)** | Recent results, weighted so the latest game counts most |
| **Powerplay** | Batting vs bowling dominance in overs 1–6 |
| **Death overs** | Batting vs bowling performance in overs 16–20 |
| **Str. of schedule** | Average Win% of opponents faced |
| **Home/away** | Consistency at home vs. away venues |
| **Key players** | Number of ICC top-30 ranked players available |

See [`parameters.md`](parameters.md) for the full formula behind each metric.

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

**Cloudflare Tunnel not connecting?**
Make sure the server is running first (`node server.js`), then start the tunnel. If `cloudflared` is not found, run `brew install cloudflare/cloudflare/cloudflared`.
