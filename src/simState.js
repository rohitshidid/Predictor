// In-memory simulator state. Holds the working season the engine ranks, plus the
// mode toggle:
//   - baseline: the 2026 season as recorded in data/cpl_2026.json, with each
//               team's rating OPENING on what it earned in the real 2025 season
//               (src/priors.js) and that carry-in decaying as 2026 results land
//   - fresh:    same teams, ZERO matches and NO carry-in — every side starts
//               level on 34.0 and the table is built from scratch
// The 2026 season opens 7 Aug 2026 with no matches played, so the two modes
// currently differ only in whether last season is allowed to count. That is the
// whole point of the toggle: Baseline answers "who is best going into 2026?",
// Fresh Start answers "what if nobody had a past?".
// `prevRanks` remembers the ranking BEFORE the last mutation so the ▲/▼ arrows
// show how the just-finished match (or weight change) moved every team.
const fs = require('node:fs');
const path = require('node:path');

const BASELINE = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'cpl_2026.json'), 'utf8')
);

const clone = (o) => JSON.parse(JSON.stringify(o));

function freshFrom(baseline) {
  return {
    season: baseline.season,
    league: baseline.league,
    leagueShort: baseline.leagueShort,
    region: baseline.region,
    teams: clone(baseline.teams),
    matches: [],
  };
}

function baselineFrom(baseline) {
  return {
    season: baseline.season,
    league: baseline.league,
    leagueShort: baseline.leagueShort,
    region: baseline.region,
    teams: clone(baseline.teams),
    matches: clone(baseline.matches),
  };
}

let mode = 'baseline';
let data = baselineFrom(BASELINE);
let prevRanks = {}; // teamName -> rank, captured before the last mutation
// A pinned comparison point. `prevRanks` moves every render, which is right for
// "what did that match just do" but wrong for "where is everyone against the
// baseline" — by the third match of the week the day-to-day arrows say almost
// nothing, and a side that has not played carries no arrow at all even though
// the table has moved under it. An anchor is an order the operator has chosen
// to measure against (an earlier checkpoint, usually the preseason one) and it
// SURVIVES simulating further matches, so a whole week reads against one fixed
// point. Null means the ordinary day-to-day behaviour.
let anchorRanks = null;

const state = {
  getMode: () => mode,
  getData: () => data,
  getTeams: () => data.teams,
  getPrevRanks: () => prevRanks,

  // What the arrows should actually diff against: the pinned anchor when one is
  // set, otherwise the last render. Every ranking path goes through this rather
  // than reading prevRanks directly, so the two cannot disagree.
  getCompareRanks: () => anchorRanks || prevRanks,
  getAnchor: () => (anchorRanks ? { ...anchorRanks } : null),
  // Accepts either a ranking array ([{name, rank}]) or a plain name->rank map,
  // because the two callers naturally hold one each.
  setAnchor(ranks) {
    if (!ranks) return (anchorRanks = null);
    anchorRanks = Array.isArray(ranks)
      ? Object.fromEntries(ranks.map((r) => [r.name, r.rank]))
      : { ...ranks };
    return anchorRanks;
  },
  clearAnchor() { anchorRanks = null; },

  // Only the baseline carries last season in. Fresh Start deliberately throws
  // the 2025 evidence away so every team opens on the same 34.0.
  usePriors: () => mode === 'baseline',

  // Remember the current order so the next render can diff against it.
  snapshot(ranks) {
    prevRanks = {};
    for (const r of ranks) prevRanks[r.name] = r.rank;
  },

  setMode(next) {
    if (next !== 'baseline' && next !== 'fresh') throw new Error('mode must be baseline|fresh');
    mode = next;
    data = next === 'baseline' ? baselineFrom(BASELINE) : freshFrom(BASELINE);
    prevRanks = {};
    // A new season is not the season the anchor was taken from.
    anchorRanks = null;
    return mode;
  },

  reset() {
    return this.setMode(mode);
  },

  // Remove the most recently appended match. A mis-entered result is otherwise
  // permanent — the match count only ever grew — so this is the one-step undo.
  // Returns the removed record, or null if there was nothing to remove.
  undoLastMatch() {
    if (!data.matches.length) return null;
    return data.matches.pop();
  },

  // Empty the match list, keeping the same teams and mode. Every ranking figure
  // is derived from the matches, so the table returns to its zero state.
  clearMatches() {
    const n = data.matches.length;
    data.matches = [];
    return n;
  },

  // Restore a season saved in a checkpoint. The match list is the source of
  // truth — every ranking figure is re-derived from it by the engine — so a
  // checkpoint reproduces the exact table it was taken from.
  loadData(nextData, nextMode, nextPrevRanks) {
    if (!nextData || !Array.isArray(nextData.teams) || !Array.isArray(nextData.matches)) {
      throw new Error('checkpoint is missing teams[] or matches[]');
    }
    data = {
      season: nextData.season,
      league: nextData.league,
      leagueShort: nextData.leagueShort,
      region: nextData.region,
      teams: clone(nextData.teams),
      matches: clone(nextData.matches),
    };
    if (nextMode === 'baseline' || nextMode === 'fresh') mode = nextMode;
    prevRanks = nextPrevRanks && typeof nextPrevRanks === 'object' ? { ...nextPrevRanks } : {};
    // Loading a different season drops the anchor; the caller pins a new one
    // straight afterwards if it wants one (that is what comparing two
    // checkpoints does).
    anchorRanks = null;
    return data;
  },

  // Append one simulated match. Assigns an id + timestamp after the latest match.
  appendMatch(match) {
    // With an empty season there is no previous match to date from, so fall back
    // to the published season start (7 Aug 2026) and finally to today. Reading
    // the last element of an empty baseline used to throw here.
    const seasonStart = BASELINE.seasonStart ? new Date(BASELINE.seasonStart) : null;
    const lastBaseline = BASELINE.matches.length
      ? new Date(BASELINE.matches[BASELINE.matches.length - 1].date)
      : null;
    const lastDate = data.matches.length
      ? new Date(data.matches[data.matches.length - 1].date)
      : seasonStart || lastBaseline || new Date();
    const id = (data.matches.reduce((mx, m) => Math.max(mx, m.id || 0), 0) || 0) + 1;
    const record = { ...match, id, date: new Date(lastDate.getTime() + 12 * 3600 * 1000).toISOString() };
    data.matches.push(record);
    return record;
  },
};

module.exports = state;
