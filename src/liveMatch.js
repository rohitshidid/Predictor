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

// ---- link reading + Gemini resolver -----------------------------------------
// "Team A vs Team B" and pasted links are resolved by Gemini grounded search
// (the project's crown-jewel pattern). The server first physically fetches each
// link and strips it to text, then hands the excerpts + the team query to Gemini,
// which returns the match as normalized JSON. Needs GEMINI_API_KEY.
const MAX_LINKS = 10;

async function readLink(url) {
  try {
    if (!/^https?:\/\//i.test(url)) return { url, ok: false, error: 'not an http(s) url' };
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Mozilla/5.0 (PowerRankings match fetcher)' },
    });
    if (!res.ok) return { url, ok: false, error: `HTTP ${res.status}` };
    const html = (await res.text()).slice(0, 300000);
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 6000);
    return { url, ok: true, text };
  } catch (e) {
    return { url, ok: false, error: e.message };
  }
}

async function readLinks(links) {
  return Promise.all((links || []).slice(0, MAX_LINKS).map(readLink));
}

function extractJson(text) {
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
  const c = fenced ? fenced[1] : String(text);
  const s = c.indexOf('{'), e = c.lastIndexOf('}');
  if (s === -1 || e === -1 || e < s) throw new Error('no JSON in model reply');
  return JSON.parse(c.slice(s, e + 1));
}

const num = (v, def = 0) => { const n = Number(v); return Number.isFinite(n) ? n : def; };

function normalizeGemini(d, sources) {
  if (!d || !Array.isArray(d.innings) || d.innings.length < 2) throw new Error('no match found for that pair');
  const inn = d.innings.slice(0, 2).map((i) => {
    const balls = num(i.balls, 300) || 300;
    return {
      batting: String(i.batting || ''), bowling: String(i.bowling || ''),
      runs: num(i.runs), balls, overs: +num(i.overs, balls / 6).toFixed(1),
      wktsLost: Math.max(0, Math.min(10, num(i.wktsLost, 0))),
      top4: num(i.top4), bowlTop2: num(i.bowlTop2),
      ppRuns: i.ppRuns != null ? num(i.ppRuns) : null,
      deathRuns: i.deathRuns != null ? num(i.deathRuns) : null,
      deathBalls: i.deathBalls != null ? num(i.deathBalls) : null,
    };
  });
  return {
    source: 'gemini',
    competition: String(d.competition || 'Match'),
    format: String(d.format || (inn[0].balls > 200 ? 'ODI' : 'T20')),
    date: String(d.date || '').slice(0, 10),
    venue: String(d.venue || 'Unknown venue'),
    home: String(d.home || inn[0].batting),
    away: String(d.away || inn[1].batting),
    battingFirst: String(d.battingFirst || inn[0].batting),
    tossWinner: String(d.tossWinner || inn[0].batting),
    tossDecision: String(d.tossDecision || 'bat'),
    winner: String(d.winner || ''),
    margin: String(d.margin || ''),
    innings: inn,
    batters: (d.batters && typeof d.batters === 'object') ? d.batters : {},
    bowlers: (d.bowlers && typeof d.bowlers === 'object') ? d.bowlers : {},
    groundingSources: sources || [],
  };
}

async function fetchViaGemini(o, linksRead) {
  if (!cfg.isConfigured()) throw new Error('GEMINI_API_KEY not set');
  const { generateGrounded } = require('./blurbs');
  const excerpts = (linksRead || []).filter((l) => l.ok)
    .map((l, i) => `SOURCE ${i + 1} (${l.url}):\n${l.text}`).join('\n\n').slice(0, 24000);
  const who = (o.teamA && o.teamB) ? `the LATEST COMPLETED men's cricket match between "${o.teamA}" and "${o.teamB}"` : 'the cricket match described in the sources below';
  const prompt = `You are a cricket data extractor. Identify ${who}. Use Google Search to confirm the most recent result and the exact scorecard.${excerpts ? `\n\nAlso use these page excerpts the user provided:\n${excerpts}` : ''}

Return STRICT JSON ONLY (no prose, no markdown) in EXACTLY this schema. All numbers must be real from the scorecard; use null for a phase split you cannot find:
{
 "competition": string, "format": "ODI"|"T20"|"Test"|string, "date": "YYYY-MM-DD", "venue": string,
 "home": string, "away": string, "battingFirst": string, "tossWinner": string, "tossDecision": "bat"|"bowl",
 "winner": string, "margin": string,
 "innings": [
   {"batting": string, "bowling": string, "runs": number, "balls": number, "overs": number, "wktsLost": number, "top4": number, "bowlTop2": number, "ppRuns": number|null, "deathRuns": number|null, "deathBalls": number|null},
   {"batting": string, "bowling": string, "runs": number, "balls": number, "overs": number, "wktsLost": number, "top4": number, "bowlTop2": number, "ppRuns": number|null, "deathRuns": number|null, "deathBalls": number|null}
 ],
 "batters": { "<team>": [ {"name": string, "runs": number} ] },
 "bowlers": { "<team>": [ {"name": string, "wkts": number} ] }
}
Where top4 = combined runs of that innings' top-4 batting positions, and bowlTop2 = wickets taken by the OTHER team's two leading bowlers in that innings.`;
  const g = await generateGrounded(prompt);
  return normalizeGemini(extractJson(g.text), g.sources);
}

// ---- CricAPI (structured feed — the authoritative resolver) ------------------
// Why this is primary: it exposes a queryable MATCH INDEX (teams + date +
// status), so "latest match between A and B" is resolved by filtering and
// sorting in CODE. A language model can never invent a match here — which is
// exactly the failure mode we hit when Gemini answered a "latest India v
// Pakistan" query with the famous 2024 T20 World Cup game.
const CRICAPI = 'https://api.cricapi.com/v1';

function cricapiKey() {
  return (process.env.CRICAPI_KEY || '').trim();
}

// The free plan allows only ~100 calls/day and one resolve costs several, so
// responses are cached in memory. Series lists and finished scorecards do not
// change, which makes repeat lookups free.
const CACHE_TTL_MS = num(process.env.CRICAPI_CACHE_MS, 6 * 3600 * 1000);
const cricapiCache = new Map();

async function cricapiGet(path, params) {
  const key = cricapiKey();
  if (!key) throw new Error('CRICAPI_KEY not set');
  const qs = new URLSearchParams({ apikey: key, ...params }).toString();
  const cacheKey = `${path}?${new URLSearchParams(params).toString()}`;
  const hit = cricapiCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const res = await fetch(`${CRICAPI}/${path}?${qs}`, { signal: AbortSignal.timeout(cfg.llm.timeoutMs) });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch {
    // A proxy/gateway error page is not JSON — report it as the transport
    // failure it is instead of letting it look like an empty result.
    throw new Error(`cricapi ${path}: HTTP ${res.status} non-JSON response (${text.slice(0, 80)})`);
  }
  if (!res.ok) throw new Error(`cricapi ${path}: HTTP ${res.status}`);
  if (data.status && data.status !== 'success') throw new Error(`cricapi ${path}: ${data.status}${data.reason ? ' — ' + data.reason : ''}`);
  cricapiCache.set(cacheKey, { at: Date.now(), data });
  return data;
}

const canon = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIAS = {
  windies: 'westindies', westindies: 'windies',
  uae: 'unitedarabemirates', unitedarabemirates: 'uae',
  usa: 'unitedstatesofamerica', unitedstatesofamerica: 'usa',
};
// A squad qualifier makes it a DIFFERENT team: "India" must never match
// "India Women", "India A" or "India U19" — that mismatch is how a request for
// the men's India v Pakistan game resolved to the Women's World Cup fixture.
const SQUAD_QUALIFIER = /(women|womens|u1[6-9]|under\s?1[6-9]|emerging|legends|masters|development|\bxi\b|\ba\b|\bb\b)/i;

function teamMatches(candidate, wanted) {
  const cRaw = String(candidate || '').toLowerCase().trim();
  const wRaw = String(wanted || '').toLowerCase().trim();
  const c = canon(candidate), w = canon(wanted);
  if (!c || !w) return false;
  if (c === w) return true;
  if (ALIAS[w] === c || ALIAS[c] === w) return true;
  // One side carrying a squad qualifier the other lacks = not the same team.
  if (SQUAD_QUALIFIER.test(cRaw) !== SQUAD_QUALIFIER.test(wRaw)) return false;
  return c.includes(w) || w.includes(c);
}

const isFinished = (m) => {
  const s = String(m.status || '').toLowerCase();
  if (!s || s.includes('not started') || s.includes('abandon') || s.includes('no result')) return false;
  return m.matchEnded === true || /won by|won the|tied|draw/.test(s);
};

// Find the most recent COMPLETED match between two teams.
//
// NOTE ON WHY THIS IS SERIES-BASED: CricAPI's /v1/matches index is grouped by
// series, NOT globally sorted by date (offsets jump Jun -> Apr -> Aug across
// pages), and it lists future fixtures first. Paging it therefore never reaches
// an older match, which is why a naive scan missed the 15 Feb 2026 India v
// Pakistan game. Series lookup is exact and cheap instead.
// Does a series NAME mention this team? (looser than teamMatches, which compares
// two team names to each other.)
const teamMatchesName = (name, team) => {
  const t = String(team || '').toLowerCase().trim();
  return t.length > 2 && String(name || '').toLowerCase().includes(t);
};

const matchesPair = (m, a, b) => {
  const teams = Array.isArray(m.teams) ? m.teams : [];
  return teams.length >= 2
    && teams.some((t) => teamMatches(t, a))
    && teams.some((t) => teamMatches(t, b));
};

// Turn pasted links into series-search terms. The URL slug alone names the
// tournament (".../series/icc-men-s-t20-world-cup-2025-26-1502138/..."), so we
// parse the STRING and never fetch it — which also sidesteps Cricinfo's 403s.
function linkHints(links) {
  const terms = [];
  for (const raw of links || []) {
    let path;
    try { path = new URL(raw).pathname; } catch { continue; }
    const segs = path.split('/').filter(Boolean);
    const i = segs.findIndex((s) => s === 'series');
    const slug = i >= 0 && segs[i + 1] ? segs[i + 1] : segs[0];
    if (!slug) continue;
    const tokens = slug.split('-').filter((t) => t.length > 1 && !/^\d+$/.test(t));
    for (let start = 0; start < Math.min(tokens.length, 3); start++) {
      const t = tokens.slice(start).join(' ');
      if (t.length > 4) terms.push(t);
    }
    if (tokens.length >= 3) terms.push(tokens.slice(-3).join(' '));
  }
  return terms;
}

async function cricapiFindLatest(teamA, teamB, links = []) {
  const found = [];
  // Transport/API errors must never masquerade as "no such match" — that is what
  // hid a proxy failure behind a misleading "not found" during development.
  const errors = [];

  // 1. cricScore — the current window. Covers the production case (a fixture
  //    that just ended) in a single cheap call.
  try {
    const cs = await cricapiGet('cricScore', {});
    for (const m of cs.data || []) {
      const teams = [m.t1, m.t2].map((t) => String(t || '').replace(/\s*\[.*?\]\s*/g, '').trim());
      const norm = { ...m, teams, dateTimeGMT: m.dateTimeGMT, status: m.status, id: m.id };
      if (matchesPair(norm, teamA, teamB) && isFinished(norm)) found.push(norm);
    }
  } catch (e) { errors.push(`cricScore: ${e.message}`); }

  // 2. Series lookup. Link slugs first (most specific), then the team names for
  //    bilateral tours. Series are then probed newest-first.
  const hints = linkHints(links);
  // Searching series by team name only finds BILATERAL tours ("Pakistan tour of
  // India"). Multi-team tournaments are named after the event, so a men's World
  // Cup fixture is invisible to a "India"/"Pakistan" search. These fallbacks let
  // the two-team form work without a pasted link.
  const TOURNAMENTS = (process.env.MATCH_TOURNAMENTS
    || 't20 world cup,cricket world cup,asia cup,champions trophy,premier league,tri-series,tri nation')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const terms = [...hints, teamA, teamB, ...(hints.length ? [] : TOURNAMENTS)].filter(Boolean);
  // Tokens from the link slug let us tell the real tournament from its
  // qualifiers: "ICC Men's T20 World Cup 2026" matches every slug token with no
  // spare words, while "...Europe Sub Regional Qualifier B 2026" carries many.
  const hintTokens = [...new Set(hints.flatMap((h) => h.split(' ')).filter((t) => t.length > 1))];
  // Compare WHOLE WORDS, not substrings: "men" appears inside "womens", so a
  // substring test scored the Women's World Cup as a perfect match for a men's
  // fixture. Tokenising both sides keeps them distinct.
  const wordsOf = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const relevance = (s) => {
    const nameWords = wordsOf(s.name);
    const set = new Set(nameWords);
    let score = 0;
    if (hintTokens.length) {
      const hit = hintTokens.filter((t) => set.has(t)).length;
      score += (hit / hintTokens.length) * 10;           // how much of the slug it covers
      if (hit === hintTokens.length) score += 4;          // covers all of it
      score -= Math.max(0, nameWords.length - hintTokens.length) * 0.5; // extra words = qualifier
    }
    if (teamMatchesName(s.name, teamA)) score += 3;
    if (teamMatchesName(s.name, teamB)) score += 3;
    return score;
  };

  const seenTerm = new Set();
  const series = [];
  for (const term of terms) {
    const key = term.toLowerCase();
    if (seenTerm.has(key) || seenTerm.size >= 8) continue;
    seenTerm.add(key);
    try {
      const r = await cricapiGet('series', { offset: '0', search: term });
      for (const s of r.data || []) {
        if (!s.id || series.some((x) => x.id === s.id)) continue;
        if (Number(s.matches) === 0) continue;
        series.push(s);
      }
    } catch (e) { errors.push(`series("${term}"): ${e.message}`); }
  }
  const started = (s) => Date.parse(s.startDate) || 0;
  const now = Date.now();
  const candidates = series.filter((x) => started(x) <= now);
  // Most relevant first, then most recent — so the real tournament beats both
  // its qualifiers and any newer but unrelated series.
  candidates.sort((a, b) => (relevance(b) - relevance(a)) || (started(b) - started(a)));

  for (const s of candidates.slice(0, 8)) {
    try {
      const info = await cricapiGet('series_info', { id: s.id });
      const list = (info.data && info.data.matchList) || [];
      for (const m of list) if (matchesPair(m, teamA, teamB) && isFinished(m)) found.push(m);
    } catch (e) { errors.push(`series_info(${s.name}): ${e.message}`); }
    if (found.length) break; // ranked order — the first hit is the right series
  }

  if (!found.length) {
    // If every lookup errored, this is an API/transport failure, not an empty result.
    if (errors.length && !series.length) throw new Error(`CricAPI unreachable — ${errors[0]}`);
    const detail = errors.length ? ` (${errors.length} lookup error(s): ${errors[0]})` : '';
    throw new Error(`no completed match found between "${teamA}" and "${teamB}"${detail} — try adding a link to the match or series`);
  }
  found.sort((a, b) => new Date(b.dateTimeGMT || b.date || 0) - new Date(a.dateTimeGMT || a.date || 0));
  return found[0];
}

// Map a CricAPI scorecard document onto the normalized shape.
function normalizeCricApi(d) {
  const teams = Array.isArray(d.teams) ? d.teams : [];
  const scores = Array.isArray(d.score) ? d.score : [];
  const cards = Array.isArray(d.scorecard) ? d.scorecard : [];
  if (scores.length < 2 && cards.length < 2) throw new Error('cricapi: scorecard incomplete');

  // Which side batted in each innings — read from the innings label, preferring
  // the LONGEST team name that matches so "India" can't win over "India Women".
  const inningTeam = (label, idx) => {
    const l = String(label || '').toLowerCase();
    const hits = teams.filter((t) => t && l.includes(String(t).toLowerCase()))
      .sort((a, b) => String(b).length - String(a).length);
    return hits[0] || teams[idx] || `Team ${idx + 1}`;
  };

  const build = (idx) => {
    const sc = scores[idx] || {};
    const card = cards[idx] || {};
    const batting = inningTeam(sc.inning || card.inning, idx);
    const bowling = teams.find((t) => t !== batting) || teams[1 - idx] || '';
    const overs = Number(sc.o) || 0;
    const balls = Math.round(overs * 6) || 0;

    // top4 = combined runs of the first four batting positions in this innings.
    const bats = Array.isArray(card.batting) ? card.batting : [];
    const top4 = bats.slice(0, 4).reduce((s, b) => s + (Number(b.r) || 0), 0);

    // bowlTop2 = wickets taken by the OPPOSITION's two leading bowlers in this innings.
    const bowls = Array.isArray(card.bowling) ? card.bowling : [];
    const wkts = bowls.map((b) => Number(b.w) || 0).sort((a, b) => b - a);
    const bowlTop2 = (wkts[0] || 0) + (wkts[1] || 0);

    return {
      batting, bowling,
      runs: Number(sc.r) || 0, balls, overs: +overs.toFixed(1),
      wktsLost: Number(sc.w) || 0,
      top4, bowlTop2,
      ppRuns: null, deathRuns: null, deathBalls: null,
    };
  };

  const innings = [build(0), build(1)];
  // Guard: the same side cannot bat both innings. If the labels were ambiguous,
  // force the second innings onto the other team.
  if (innings[0].batting === innings[1].batting) {
    const other = teams.find((t) => t !== innings[0].batting);
    if (other) { innings[1].batting = other; innings[1].bowling = innings[0].batting; }
  }
  const topBat = (idx) => (Array.isArray((cards[idx] || {}).batting) ? cards[idx].batting : [])
    .map((b) => ({ name: (b.batsman && b.batsman.name) || b.name || '', runs: Number(b.r) || 0 }))
    .filter((b) => b.name && b.runs > 0).sort((a, b) => b.runs - a.runs).slice(0, 4);
  const topBowl = (idx) => (Array.isArray((cards[idx] || {}).bowling) ? cards[idx].bowling : [])
    .map((b) => ({ name: (b.bowler && b.bowler.name) || b.name || '', wkts: Number(b.w) || 0 }))
    .filter((b) => b.name && b.wkts > 0).sort((a, b) => b.wkts - a.wkts).slice(0, 3);

  const winner = d.matchWinner || (String(d.status || '').match(/^(.+?)\s+won/) || [])[1] || '';
  const margin = (String(d.status || '').match(/won by\s+(.+)$/i) || [])[1] || String(d.status || '');

  return {
    source: 'cricapi',
    competition: d.name || d.series || 'Match',
    format: (d.matchType || '').toUpperCase() || 'T20',
    date: String(d.date || (d.dateTimeGMT || '')).slice(0, 10),
    venue: d.venue || 'Unknown venue',
    home: teams[0] || innings[0].batting,
    away: teams[1] || innings[1].batting,
    battingFirst: innings[0].batting,
    tossWinner: d.tossWinner || innings[0].batting,
    tossDecision: d.tossChoice || 'bat',
    winner, margin,
    innings,
    batters: { [innings[0].batting]: topBat(0), [innings[1].batting]: topBat(1) },
    bowlers: { [innings[0].batting]: topBowl(1), [innings[1].batting]: topBowl(0) },
  };
}

// Resolve "latest A v B" end to end through CricAPI.
async function fetchViaCricApi(teamA, teamB, links = []) {
  const found = await cricapiFindLatest(teamA, teamB, links);
  const sc = await cricapiGet('match_scorecard', { id: found.id });
  const m = normalizeCricApi(sc.data || {});
  m.matchId = found.id;
  return m;
}

// ---- provider registry ------------------------------------------------------
const PROVIDERS = {
  espn: fetchEspn,
  stub: async (_id) => clone(IND_ENG_3RD_ODI_2026),
  cricapi: async (id) => {
    const sc = await cricapiGet('match_scorecard', { id });
    return normalizeCricApi(sc.data || {});
  },
};

// Default to live ESPN; MATCH_PROVIDER can force stub/cricapi.
function providerName() {
  return (process.env.MATCH_PROVIDER || 'espn').trim();
}

// ---- verification gate ------------------------------------------------------
// The check that would have caught the bad answer: a "latest India v Pakistan"
// query that resolves to a 2024 match is not a near miss, it is a wrong answer.
// Nothing enters the ranking table without passing these, and every failure is
// surfaced to the operator instead of silently applied.
const STALE_DAYS = num(process.env.MATCH_STALE_DAYS, 90);
const MAX_AGE_DAYS = num(process.env.MATCH_MAX_AGE_DAYS, 365);

function verify(match, requested) {
  const warnings = [];
  let rejected = false;

  const ts = Date.parse(match.date);
  if (!Number.isFinite(ts)) {
    warnings.push('resolved match has no usable date — cannot confirm it is the latest');
  } else {
    const ageDays = Math.floor((Date.now() - ts) / 86400000);
    match.ageDays = ageDays;
    if (ageDays > MAX_AGE_DAYS) {
      rejected = true;
      warnings.push(`resolved match is ${ageDays} days old (${match.date}) — too old to be "the latest", so it was REJECTED`);
    } else if (ageDays > STALE_DAYS) {
      warnings.push(`resolved match is ${ageDays} days old (${match.date}) — confirm this is really the latest`);
    }
  }

  // The teams that came back must be the teams that were asked for.
  if (requested && requested.teamA && requested.teamB) {
    const sides = [match.home, match.away, ...(match.innings || []).map((i) => i.batting)];
    const okA = sides.some((s) => teamMatches(s, requested.teamA));
    const okB = sides.some((s) => teamMatches(s, requested.teamB));
    if (!okA || !okB) {
      rejected = true;
      warnings.push(`resolved match (${match.home} v ${match.away}) does not match the requested teams (${requested.teamA} v ${requested.teamB}) — REJECTED`);
    }
  }

  match.warnings = warnings;
  match.rejected = rejected;
  match.verified = !rejected && warnings.length === 0;
  return match;
}

// Fetch + normalize one finished match.
//   opts = { id?, teamA?, teamB?, links? }
// - teamA+teamB or links present -> Gemini grounded resolution (reads the links
//   too); without a key it still HITS the links but falls back to the snapshot.
// - otherwise -> keyless live ESPN by id, snapshot on failure.
// Always resolves to normalized data so the client never dead-ends.
async function fetchMatch(opts = {}) {
  const o = typeof opts === 'string' ? { id: opts } : (opts || {});
  const wantsQuery = (o.teamA && o.teamB) || (Array.isArray(o.links) && o.links.length);

  if (wantsQuery) {
    const linksRead = (Array.isArray(o.links) && o.links.length) ? await readLinks(o.links) : [];
    const linkSummary = linksRead.map((l) => ({ url: l.url, ok: l.ok, chars: l.text ? l.text.length : 0, error: l.error || null }));
    const requested = { teamA: o.teamA || null, teamB: o.teamB || null };
    const tried = [];

    const finish = (m) => {
      m.linksRead = linkSummary; m.requested = requested; m.tried = tried;
      return verify(m, requested);
    };

    // 1. CricAPI — the structured feed. Authoritative: the match is chosen by
    //    filtering + sorting a real index in code, so it cannot be hallucinated.
    if (o.teamA && o.teamB && cricapiKey()) {
      try {
        return finish(await fetchViaCricApi(o.teamA, o.teamB, o.links || []));
      } catch (e) { tried.push(`cricapi: ${e.message}`); }
    } else if (o.teamA && o.teamB) {
      tried.push('cricapi: CRICAPI_KEY not set');
    }

    // 2. Gemini + Google Search — backup only. Can read the pasted links, but is
    //    prone to answering with a famous older match, so it is never preferred
    //    over the feed and its result is still date/team verified below.
    if (cfg.isConfigured()) {
      try {
        return finish(await fetchViaGemini(o, linksRead));
      } catch (e) { tried.push(`gemini: ${e.message}`); }
    } else {
      tried.push('gemini: GEMINI_API_KEY not set');
    }

    const m = await PROVIDERS.stub();
    m.source = 'stub';
    m.fallbackReason = tried.join(' · ') || 'no resolver available';
    return finish(m);
  }

  const name = providerName();
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`unknown match provider: ${name}`);
  try {
    const match = await provider(o.id);
    match.source = match.source || name;
    return match;
  } catch (e) {
    if (name === 'stub') throw e;
    const match = await PROVIDERS.stub(o.id);
    match.source = 'stub';
    match.fallbackReason = e.message;
    return match;
  }
}

module.exports = { fetchMatch, providerName, MAX_LINKS, IND_ENG_3RD_ODI_2026 };
