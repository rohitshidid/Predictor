#!/usr/bin/env node
// Pull a whole season from ESPN's public cricket API into the engine's match shape.
//
//   node tools/import-espn-season.js <espnLeagueId> <firstEventId> <lastEventId>
//        [--out matches.json] [--checkpoint cp.json] [--until YYYY-MM-DD]
//
// WBBL|11 (2025):  node tools/import-espn-season.js 1490537 1494526 1494568 --out matches-2025.json
// WBBL|12 (2026):  node tools/import-espn-season.js 18042   1543944 1543999 --until 2026-11-21 \
//                    --checkpoint "21 nov 2026/wbbl-checkpoint-2026-11-21.json"
//
// --checkpoint writes a file the app's "Load checkpoint" button restores as-is
// (the season file's teams + these matches). Unplayed fixtures are skipped, so
// an id range that runs past today is harmless.
//
// ESPN numbers a series' fixtures consecutively, so the range is walked id by id
// (the date-based scoreboard silently drops some double-header days). Every
// figure comes off the scorecard: totals, balls, wickets, the toss, and the
// powerplay (overs 1-6) and death (overs 16-20) splits, which are summed from
// ESPN's over-by-over runs rather than estimated. Abandoned / no-result games are
// kept with `innings: []` and `winner: null`, exactly like data/cpl_2025.json,
// so the engine skips them the same way.
//
// Without --out the matches are printed as a JSON array, ready to be loaded as
// a checkpoint or merged into a season file.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SUMMARY = (league, event) =>
  `https://site.api.espn.com/apis/site/v2/sports/cricket/${league}/summary?event=${event}`;

// ESPN sends the winner flag as the STRING "true"/"false" on summaries.
const isWinner = (c) => c.winner === true || c.winner === 'true';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function statOf(linescore, name) {
  const cats = (linescore.statistics && linescore.statistics.categories) || [];
  for (const c of cats) for (const s of c.stats || []) if (s.name === name) return num(s.value);
  return 0;
}

// "129 (20 ov, target 141)", "106/4 (12/13 ov, target 106)", "114/1 (12/12 ov)"
// -> the over limit after the slash, when the innings was reduced.
function quotaFromScore(score) {
  const m = String(score || '').match(/\(\s*[\d.]+\s*\/\s*(\d+)\s*ov/);
  return m ? +m[1] : null;
}

function targetFromScore(score) {
  const m = String(score || '').match(/targets+(d+)/);
  return m ? +m[1] : 0;
}

// Sum ESPN's per-over runs into the two phase windows the engine reads.
function phaseSplits(linescore) {
  const overs = ((linescore.statistics && linescore.statistics.overs) || [])[0] || [];
  let pp = 0, death = 0;
  for (const o of overs) {
    const n = num(o.number);
    if (n >= 1 && n <= 6) pp += num(o.runs);
    if (n >= 16 && n <= 20) death += num(o.runs);
  }
  return { ppRuns: pp, deathRuns: death, overCount: overs.length };
}

function rosterStats(d, teamName) {
  const r = (d.rosters || []).find((x) => x.team && x.team.displayName === teamName);
  return ((r && r.roster) || []).map((p) => {
    const out = {};
    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      if (n.statistics) for (const c of n.statistics.categories || []) for (const s of c.stats || []) {
        const v = Number(s.value != null ? s.value : s.displayValue);
        if (Number.isFinite(v)) out[s.name] = v;
      }
      if (Array.isArray(n.linescores)) n.linescores.forEach(walk);
    };
    (p.linescores || []).forEach(walk);
    return { name: p.athlete && p.athlete.displayName, runs: out.runs || 0, pos: out.battingPosition || 99, wkts: out.wickets || 0 };
  });
}

function normalize(d, espnId) {
  const comp = d.header.competitions[0];
  const status = (comp.status && comp.status.type && comp.status.type.description) || '';
  const summary = (comp.status && comp.status.summary) || '';
  const desc = comp.description || '';
  const stage = /knockout|challenger|final|eliminator|qualifier/i.test(desc) ? desc : 'league';
  const name = (c) => c.team.displayName;
  const home = comp.competitors.find((c) => c.homeAway === 'home') || comp.competitors[0];
  const away = comp.competitors.find((c) => c !== home);
  const venue = (d.gameInfo && d.gameInfo.venue && d.gameInfo.venue.fullName) || '';
  const tossNote = (d.notes || []).find((n) => n.type === 'toss');

  const base = {
    espnId: String(espnId),
    matchNo: desc,
    date: new Date(comp.date).toISOString(),
    stage,
    home: name(home),
    away: name(away),
    venue,
    // ESPN's home flag is the host club; a neutral ground has no home side.
    venueHomeTeam: comp.neutralSite ? null : name(home),
  };

  // Batting innings, in the order they were played.
  const inns = [];
  for (const c of comp.competitors) {
    for (const ls of c.linescores || []) {
      if (ls.isBatting && (num(ls.runs) > 0 || statOf(ls, 'balls') > 0)) inns.push({ c, ls });
    }
  }
  inns.sort((a, b) => a.ls.period - b.ls.period);

  const decided = comp.competitors.some(isWinner) && /won by|tied/i.test(summary);
  if (!decided || inns.length < 2) {
    return { ...base, result: 'no result', battingFirst: inns[0] ? name(inns[0].c) : null, winner: null, innings: [], note: summary || status };
  }

  const innings = inns.slice(0, 2).map(({ c, ls }) => {
    const bowling = comp.competitors.find((x) => x !== c);
    const balls = statOf(ls, 'balls') || Math.round(num(ls.overs) * 6);
    const wkts = num(ls.wickets);
    const { ppRuns, deathRuns } = phaseSplits(ls);
    const bat = rosterStats(d, name(c));
    const oppWkts = rosterStats(d, name(bowling)).map((p) => p.wkts).filter((w) => w > 0).sort((a, b) => b - a);
    const quota = quotaFromScore(ls.score);
    const inn = {
      batting: name(c),
      bowling: name(bowling),
      runs: num(ls.runs),
      balls,
      overs: +(balls / 6).toFixed(4),
      ppRuns,
      deathRuns,
      deathBalls: Math.max(0, Math.min(30, balls - 90)),
      top4: bat.filter((p) => p.pos <= 4).reduce((s, p) => s + p.runs, 0),
      wktsLost: wkts,
      bowlTop2: (oppWkts[0] || 0) + (oppWkts[1] || 0),
    };
    // A rain-reduced innings: NRR charges an all-out side the REDUCED quota,
    // not 20 overs (see oversFaced in src/engine.js).
    if (quota && quota < 20) inn.oversQuota = quota;
    const target = num(ls.target) || targetFromScore(ls.score);
    if (target) inn.target = target;
    return inn;
  });

  const winner = comp.competitors.find(isWinner);
  const tossWinner = tossNote
    ? comp.competitors.map(name).find((n) => tossNote.text.startsWith(n)) || null
    : null;
  const margin = summary.replace(/^.*? won by /i, '');
  const dls = /\(DLS\)/.test(summary);
  if (dls) applyDlsNrr(innings, name(winner), margin);
  return {
    ...base,
    battingFirst: innings[0].batting,
    tossWinner,
    winner: name(winner),
    margin,
    ...(dls ? { dls: true } : {}),
    innings,
  };
}

// Net run rate in a DLS result, per the playing conditions: the side batting
// first is credited with (revised target - 1) runs from the overs the chasing
// side was ALLOTTED; the chasing side keeps its actual runs, from the overs it
// faced (its full allotment if bowled out). If rain ended the chase with the
// result on par, both sides are measured over the overs actually bowled — and
// the feed's `target` is then the par score + 1, so (target - 1) is still right.
// Written as explicit nrrRuns / nrrOvers so the engine never has to re-derive
// it. Checked against the published WBBL|11 table: all eight sides reproduce to
// within 0.002.
function applyDlsNrr(innings, winnerName, margin) {
  const [a, b] = innings;
  if (!b || !b.target) return;
  // Allotment: the parsed "x/N ov" limit, else a full set of whole overs the
  // chase batted out without getting there.
  let allot = b.oversQuota
    || (b.wktsLost < 10 && b.balls % 6 === 0 && b.runs < b.target ? b.balls / 6 : 20);
  const chaseCutShort = winnerName === b.batting && /runs/.test(margin);
  if (chaseCutShort) allot = b.balls / 6;
  a.nrrRuns = b.target - 1;
  a.nrrOvers = +allot.toFixed(4);
  b.nrrRuns = b.runs;
  b.nrrOvers = +(b.wktsLost >= 10 ? allot : b.balls / 6).toFixed(4);
}

// ESPN's edge answers 502/504 under load; a few spaced retries clear it.
async function getWithRetry(url, tries = 6) {
  let res;
  for (let i = 0; i < tries; i++) {
    res = await fetch(url);
    if (res.ok || res.status < 500) return res;
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  return res;
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
  const out = flag('--out');
  const until = flag('--until');
  const checkpoint = flag('--checkpoint');
  const [league, first, last] = args;
  if (!league || !first || !last) {
    console.error('usage: node tools/import-espn-season.js <espnLeagueId> <firstEventId> <lastEventId> [--out file] [--until YYYY-MM-DD]');
    process.exit(2);
  }
  const matches = [];
  for (let id = +first; id <= +last; id++) {
    const res = await getWithRetry(SUMMARY(league, id));
    if (!res.ok) { console.error(`event ${id}: HTTP ${res.status} — skipped`); continue; }
    const d = await res.json();
    const comp = d.header && d.header.competitions && d.header.competitions[0];
    if (!comp) { console.error(`event ${id}: no competition — skipped`); continue; }
    const st = comp.status && comp.status.type;
    if (st && st.state === 'pre') { console.error(`event ${id}: not played yet — skipped`); continue; }
    const m = normalize(d, id);
    if (until && m.date.slice(0, 10) > until) continue;
    matches.push(m);
    console.error(`${m.date.slice(0, 10)} ${m.matchNo.padEnd(12)} ${m.home} v ${m.away} -> ${m.winner || m.result}`);
  }
  matches.sort((a, b) => a.date.localeCompare(b.date));
  matches.forEach((m, i) => { m.id = i + 1; });
  const ordered = matches.map(({ id, ...rest }) => ({ id, ...rest }));
  const json = JSON.stringify(ordered, null, 2);
  if (checkpoint) {
    // A checkpoint the app's "Load checkpoint" button restores directly: the
    // current season file's teams with these matches, in baseline mode.
    const { seasonFile } = require('../src/config');
    const season = JSON.parse(fs.readFileSync(seasonFile, 'utf8'));
    const data = {
      season: season.season, league: season.league, leagueShort: season.leagueShort,
      region: season.region, teams: season.teams, matches: ordered,
    };
    const cp = {
      kind: 'power-rankings-checkpoint', version: 1, savedAt: new Date().toISOString(),
      league: data.league, leagueShort: data.leagueShort, season: data.season,
      mode: 'baseline', matchCount: ordered.length, data, blurbs: {}, prevRanks: {},
    };
    fs.mkdirSync(path.dirname(path.resolve(checkpoint)), { recursive: true });
    fs.writeFileSync(path.resolve(checkpoint), JSON.stringify(cp, null, 2) + '\n');
    console.error(`wrote checkpoint with ${ordered.length} matches to ${checkpoint}`);
  }
  if (out) {
    fs.writeFileSync(path.resolve(out), json + '\n');
    console.error(`wrote ${ordered.length} matches to ${out}`);
  } else if (!checkpoint) {
    process.stdout.write(json + '\n');
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { normalize, phaseSplits, quotaFromScore };
