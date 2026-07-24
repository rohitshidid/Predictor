// Live-match fetch layer (provider-pluggable).
//
// The production flow: after a real fixture ends, the admin clicks "Fetch match
// result" and this module pulls that match from a cricket-data provider (CricAPI
// or similar), normalizes it to the shape the engine + simulate route already
// understand, and hands it back. No manual data entry.
//
// Today there is no provider key wired into this repo, so `fetch()` returns a
// STUB record built from the real, verified scorecard of the test fixture
// (India v England, 3rd ODI, Ahmedabad, 12 Feb 2025). When a key is added, drop
// a real adapter into `PROVIDERS` and point `fetch` at it — nothing downstream
// changes, because the normalized shape is the contract.
//
// Normalized shape (one match):
//   { source, competition, format, date, venue,
//     home, away, battingFirst, tossWinner, tossDecision, winner, margin,
//     innings: [ { batting, bowling, runs, balls, overs, wktsLost, top4,
//                  bowlTop2, ppRuns, deathRuns, deathBalls } x2 ],
//     batters: { <team>: [ {name, runs} ] },
//     bowlers: { <team>: [ {name, wkts} ] } }

const cfg = require('./config');

// ---- verified test fixture (real scorecard) ---------------------------------
// India v England, 3rd ODI, Narendra Modi Stadium, Ahmedabad — 12 Feb 2025.
// India 356 all out (50 ov); England 214 all out (34.2 ov); India won by 142 runs.
const IND_ENG_3RD_ODI = {
  source: 'stub',
  competition: 'England tour of India, 3rd ODI',
  format: 'ODI',
  date: '2025-02-12',
  venue: 'Narendra Modi Stadium, Ahmedabad',
  home: 'India',
  away: 'England',
  battingFirst: 'India',
  tossWinner: 'England',
  tossDecision: 'bowl',
  winner: 'India',
  margin: '142 runs',
  innings: [
    {
      batting: 'India', bowling: 'England',
      runs: 356, balls: 300, overs: 50.0, wktsLost: 10,
      top4: 282,          // Gill 112 + Iyer 78 + Kohli 52 + Rahul 40
      bowlTop2: 6,        // Adil Rashid 4 + Mark Wood 2 (of India's 10 wkts)
      ppRuns: null, deathRuns: null, deathBalls: null, // not in the source feed
    },
    {
      batting: 'England', bowling: 'India',
      runs: 214, balls: 206, overs: 34.2, wktsLost: 10,
      top4: 133,          // Banton 38 + Atkinson 38 + Duckett 34 + Salt 23
      bowlTop2: 4,        // Arshdeep 2 + Harshit 2 (of England's 10 wkts)
      ppRuns: null, deathRuns: null, deathBalls: null,
    },
  ],
  batters: {
    India: [
      { name: 'Shubman Gill', runs: 112 },
      { name: 'Shreyas Iyer', runs: 78 },
      { name: 'Virat Kohli', runs: 52 },
      { name: 'KL Rahul', runs: 40 },
    ],
    England: [
      { name: 'Tom Banton', runs: 38 },
      { name: 'Gus Atkinson', runs: 38 },
      { name: 'Ben Duckett', runs: 34 },
      { name: 'Phil Salt', runs: 23 },
    ],
  },
  bowlers: {
    India: [
      { name: 'Arshdeep Singh', wkts: 2 },
      { name: 'Harshit Rana', wkts: 2 },
      { name: 'Axar Patel', wkts: 2 },
      { name: 'Hardik Pandya', wkts: 2 },
    ],
    England: [
      { name: 'Adil Rashid', wkts: 4 },
      { name: 'Mark Wood', wkts: 2 },
    ],
  },
};

// ---- provider adapters ------------------------------------------------------
// Each provider takes a match identifier and returns the normalized shape above.
// The stub ignores the id and returns the verified test fixture.
const PROVIDERS = {
  stub: async (_id) => clone(IND_ENG_3RD_ODI),

  // Example CricAPI adapter — inert until CRICAPI_KEY is set. Left here as the
  // seam to fill in: call the match_info endpoint, then map its scorecard onto
  // the normalized shape. Intentionally not called without a key.
  cricapi: async (id) => {
    const key = (process.env.CRICAPI_KEY || '').trim();
    if (!key) throw new Error('CRICAPI_KEY not set');
    const url = `https://api.cricapi.com/v1/match_scorecard?apikey=${encodeURIComponent(key)}&id=${encodeURIComponent(id)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(cfg.llm.timeoutMs) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status !== 'success') {
      throw new Error(`cricapi ${res.status}: ${(data && data.status) || 'error'}`);
    }
    return normalizeCricApi(data.data);
  },
};

function clone(o) { return JSON.parse(JSON.stringify(o)); }

// Placeholder mapper — shape a CricAPI scorecard into the normalized record.
// Stubbed to throw until the real field mapping is filled against live payloads.
function normalizeCricApi(_raw) {
  throw new Error('CricAPI normalizer not implemented yet — wire field mapping when a key is available');
}

// Which provider to use. Defaults to the stub; set MATCH_PROVIDER=cricapi (and a
// key) to go live.
function providerName() {
  return (process.env.MATCH_PROVIDER || 'stub').trim();
}

// Fetch + normalize one finished match. `id` is the provider's match id (unused
// by the stub). Always returns the normalized shape or throws.
async function fetchMatch(id) {
  const name = providerName();
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`unknown match provider: ${name}`);
  const match = await provider(id);
  match.source = match.source || name;
  return match;
}

module.exports = { fetchMatch, providerName, IND_ENG_3RD_ODI };
