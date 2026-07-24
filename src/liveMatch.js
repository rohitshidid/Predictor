// Live-match fetch layer (provider-pluggable).
//
// The production flow: after a real fixture ends, the admin clicks "Fetch match
// result" and this module pulls that match from a cricket-data provider,
// normalizes it to the shape the engine + simulate route already understand, and
// hands it back. No manual data entry.
//
// Default provider is `espn` — ESPN's public cricket API (site.api.espn.com),
// which is keyless and returns live scorecards, so this works both here and on a
// laptop in production. If the live call fails (offline, rate limit), it falls
// back to a verified snapshot of the current test fixture so the button never
// dead-ends; the response's `source` says which path produced it (`espn` = live,
// `stub` = fallback snapshot).
//
// Normalized shape (one match):
//   { source, competition, format, date, venue,
//     home, away, battingFirst, tossWinner, tossDecision, winner, margin,
//     innings: [ { batting, bowling, runs, balls, overs, wktsLost, top4,
//                  bowlTop2, ppRuns, deathRuns, deathBalls } x2 ],
//     batters: { <team>: [ {name, runs} ] },
//     bowlers: { <team>: [ {name, wkts} ] } }

const cfg = require('./config');

// Which finished match to pull. Defaults to the test fixture — India v England,
// 3rd ODI, Lord's, 19 Jul 2026 — overridable per environment / per league.
const DEFAULT_SERIES_ID = (process.env.MATCH_SERIES_ID || '1496488').trim();
const DEFAULT_EVENT_ID = (process.env.MATCH_EVENT_ID || '1496581').trim();

// ---- ESPN public cricket API (live, keyless) --------------------------------
const ESPN_URL = (series, event) =>
  `https://site.api.espn.com/apis/site/v2/sports/cricket/${series}/summary?event=${event}`;

// Flatten ESPN's deeply-nested per-player stat tree into a flat { name: number }.
function flattenStats(node) {
  const out = {};
  const visit = (st) => {
    if (!st) return;
    for (const c of st.categories || []) for (const s of c.stats || []) {
      const v = Number(s.value != null ? s.value : s.displayValue);
      if (Number.isFinite(v)) out[s.name] = v;
    }
  };
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.statistics) visit(n.statistics);
    if (Array.isArray(n.linescores)) n.linescores.forEach(walk);
  };
  (Array.isArray(node) ? node : [node]).forEach(walk);
  return out;
}

// The competitor's "score" string ("387/3", or "214" for all out) is the
// authoritative total; linescores entries are per-period and can include empty
// ones, so parse the score and match the right linescore for overs/balls.
function scoreParts(c) {
  const m = String(c.score || '').match(/(\d+)(?:\/(\d+))?/);
  if (!m) return null;
  return { runs: +m[1], wkts: m[2] != null ? +m[2] : 10 };
}

function inningsLine(competitor) {
  const lss = competitor.linescores || [];
  const sp = scoreParts(competitor);
  if (sp) { const hit = lss.find((l) => Number(l.runs) === sp.runs); if (hit) return hit; }
  return lss.slice().sort((a, b) => (b.runs || 0) - (a.runs || 0))[0] || {};
}

// Turn one ESPN summary payload into the normalized match shape.
function normalizeEspn(d) {
  const comp = d.header && d.header.competitions && d.header.competitions[0];
  if (!comp || !comp.competitors || comp.competitors.length < 2) throw new Error('espn: no competition data');

  const rosterFor = (teamName) => (d.rosters || []).find((r) => r.team && r.team.displayName === teamName) || { roster: [] };

  // The chasing side carries a target; the other batted first.
  const withTarget = comp.competitors.map((c) => ({ c, target: inningsLine(c).target || 0 }));
  const chasing = withTarget.find((x) => x.target > 0);
  const firstC = chasing ? comp.competitors.find((c) => c !== chasing.c) : comp.competitors[0];
  const secondC = comp.competitors.find((c) => c !== firstC);

  const teamName = (c) => c.team.displayName;
  const winnerC = comp.competitors.find((c) => c.winner) || firstC;

  const playerStats = (roster) => (roster.roster || []).map((p) => {
    const m = flattenStats(p.linescores);
    return { name: p.athlete && p.athlete.displayName, runs: m.runs || 0, pos: m.battingPosition || 99, wkts: m.wickets || 0 };
  });

  const buildInnings = (batC, bowlC) => {
    const ls = inningsLine(batC);
    const sp = scoreParts(batC) || { runs: ls.runs || 0, wkts: ls.wickets || 0 };
    const overs = ls.overs || (ls.balls ? ls.balls / 6 : 50);
    const balls = ls.balls || Math.round(overs * 6);
    const bat = playerStats(rosterFor(teamName(batC)));
    const top4 = bat.filter((p) => p.pos <= 4).reduce((s, p) => s + p.runs, 0);
    const oppWkts = playerStats(rosterFor(teamName(bowlC))).map((p) => p.wkts).filter((w) => w > 0).sort((a, b) => b - a);
    return {
      batting: teamName(batC), bowling: teamName(bowlC),
      runs: sp.runs, balls, overs: +(+overs).toFixed(1), wktsLost: sp.wkts,
      top4, bowlTop2: (oppWkts[0] || 0) + (oppWkts[1] || 0),
      ppRuns: null, deathRuns: null, deathBalls: null,
    };
  };

  const innings = [buildInnings(firstC, secondC), buildInnings(secondC, firstC)];
  const first = innings[0], second = innings[1];
  const margin = teamName(winnerC) === first.batting
    ? `${first.runs - second.runs} runs`
    : `${10 - second.wktsLost} wickets`;

  const topBatters = (c) => playerStats(rosterFor(teamName(c))).filter((p) => p.runs > 0)
    .sort((a, b) => b.runs - a.runs).slice(0, 4).map((p) => ({ name: p.name, runs: p.runs }));
  const topBowlers = (c) => playerStats(rosterFor(teamName(c))).filter((p) => p.wkts > 0)
    .sort((a, b) => b.wkts - a.wkts).slice(0, 3).map((p) => ({ name: p.name, wkts: p.wkts }));

  const venue = (d.gameInfo && d.gameInfo.venue) || {};
  const vFull = venue.fullName || '';
  const vCity = (venue.address && venue.address.city) || '';
  const venueName = (vCity && !vFull.includes(vCity) ? [vFull, vCity].filter(Boolean).join(', ') : vFull) || 'Unknown venue';
  const league = (d.header && d.header.league && d.header.league.name) || (comp.type && comp.type.text) || 'International';

  return {
    source: 'espn',
    competition: league,
    format: first.balls > 200 ? 'ODI' : (first.balls > 0 ? 'T20' : 'Match'),
    date: (comp.date || '').slice(0, 10),
    venue: venueName,
    home: teamName(firstC),
    away: teamName(secondC),
    battingFirst: first.batting,
    tossWinner: first.batting,      // ESPN summary omits toss; default to the side that batted first
    tossDecision: 'bat',
    winner: teamName(winnerC),
    margin,
    innings,
    batters: { [teamName(firstC)]: topBatters(firstC), [teamName(secondC)]: topBatters(secondC) },
    bowlers: { [teamName(firstC)]: topBowlers(firstC), [teamName(secondC)]: topBowlers(secondC) },
  };
}

async function fetchEspn(id) {
  let series = DEFAULT_SERIES_ID, event = DEFAULT_EVENT_ID;
  if (id && /^\d+$/.test(id)) event = id;                 // ?id=<eventId>
  else if (id && id.includes(':')) { const [s, e] = id.split(':'); if (s) series = s; if (e) event = e; }
  const res = await fetch(ESPN_URL(series, event), { signal: AbortSignal.timeout(cfg.llm.timeoutMs) });
  if (!res.ok) throw new Error(`espn ${res.status}`);
  const d = await res.json();
  return normalizeEspn(d);
}

// ---- verified fallback snapshot (real scorecard) ----------------------------
// India v England, 3rd ODI, Lord's, London — 19 Jul 2026.
// England 387/3 (50 ov); India 360/7 (50 ov); England won by 27 runs.
const IND_ENG_3RD_ODI_2026 = {
  source: 'stub',
  competition: 'India tour of England, 3rd ODI',
  format: 'ODI',
  date: '2026-07-19',
  venue: "Lord's, London",
  home: 'England',
  away: 'India',
  battingFirst: 'England',
  tossWinner: 'England',
  tossDecision: 'bat',
  winner: 'England',
  margin: '27 runs',
  innings: [
    {
      batting: 'England', bowling: 'India',
      runs: 387, balls: 300, overs: 50.0, wktsLost: 3,
      top4: 320,          // Duckett 141 + Bethell 91 + Root 74 + Brook 14
      bowlTop2: 3,        // India's top-2 bowlers: Krishna 2 + Yadav 1 (of England's 3 wkts)
      ppRuns: null, deathRuns: null, deathBalls: null,
    },
    {
      batting: 'India', bowling: 'England',
      runs: 360, balls: 300, overs: 50.0, wktsLost: 7,
      top4: 303,          // Rohit 138 + Gill 77 + Kohli 74 + Kishan 14
      bowlTop2: 5,        // England's top-2 bowlers: Curran 4 + 1 (of India's 7 wkts)
      ppRuns: null, deathRuns: null, deathBalls: null,
    },
  ],
  batters: {
    England: [
      { name: 'Ben Duckett', runs: 141 },
      { name: 'Jacob Bethell', runs: 91 },
      { name: 'Joe Root', runs: 74 },
      { name: 'Jos Buttler', runs: 41 },
    ],
    India: [
      { name: 'Rohit Sharma', runs: 138 },
      { name: 'Shubman Gill', runs: 77 },
      { name: 'Virat Kohli', runs: 74 },
      { name: 'Ishan Kishan', runs: 14 },
    ],
  },
  bowlers: {
    England: [
      { name: 'Sam Curran', wkts: 4 },
      { name: 'Jofra Archer', wkts: 1 },
    ],
    India: [
      { name: 'Prasidh Krishna', wkts: 2 },
      { name: 'Kuldeep Yadav', wkts: 1 },
    ],
  },
};

function clone(o) { return JSON.parse(JSON.stringify(o)); }

// ---- provider registry ------------------------------------------------------
const PROVIDERS = {
  espn: fetchEspn,
  stub: async (_id) => clone(IND_ENG_3RD_ODI_2026),

  // Example CricAPI adapter — inert until CRICAPI_KEY is set. Left as a seam.
  cricapi: async (id) => {
    const key = (process.env.CRICAPI_KEY || '').trim();
    if (!key) throw new Error('CRICAPI_KEY not set');
    const url = `https://api.cricapi.com/v1/match_scorecard?apikey=${encodeURIComponent(key)}&id=${encodeURIComponent(id)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(cfg.llm.timeoutMs) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status !== 'success') throw new Error(`cricapi ${res.status}: ${(data && data.status) || 'error'}`);
    throw new Error('CricAPI normalizer not implemented yet — wire field mapping when a key is available');
  },
};

// Default to live ESPN; MATCH_PROVIDER can force stub/cricapi.
function providerName() {
  return (process.env.MATCH_PROVIDER || 'espn').trim();
}

// Fetch + normalize one finished match. On a live-provider failure, fall back to
// the verified snapshot (tagged source:'stub') so the client always gets data.
async function fetchMatch(id) {
  const name = providerName();
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`unknown match provider: ${name}`);
  try {
    const match = await provider(id);
    match.source = match.source || name;
    return match;
  } catch (e) {
    if (name === 'stub') throw e;
    const match = await PROVIDERS.stub(id);
    match.source = 'stub';
    match.fallbackReason = e.message;
    return match;
  }
}

module.exports = { fetchMatch, providerName, IND_ENG_3RD_ODI_2026 };
