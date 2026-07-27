// In-memory simulator state. Holds the working season the engine ranks, plus the
// mode toggle:
//   - baseline: seeded from data/ipl_2024.json (the 90-match snapshot)
//   - fresh:    same teams, ZERO matches — build the table from scratch
// Switching mode fully repopulates (baseline) or clears (fresh) the match list.
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
    teams: clone(baseline.teams),
    matches: [],
  };
}

function baselineFrom(baseline) {
  return {
    season: baseline.season,
    league: baseline.league,
    leagueShort: baseline.leagueShort,
    teams: clone(baseline.teams),
    matches: clone(baseline.matches),
  };
}

let mode = 'baseline';
let data = baselineFrom(BASELINE);
let prevRanks = {}; // teamName -> rank, captured before the last mutation

const state = {
  getMode: () => mode,
  getData: () => data,
  getTeams: () => data.teams,
  getPrevRanks: () => prevRanks,

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
      teams: clone(nextData.teams),
      matches: clone(nextData.matches),
    };
    if (nextMode === 'baseline' || nextMode === 'fresh') mode = nextMode;
    prevRanks = nextPrevRanks && typeof nextPrevRanks === 'object' ? { ...nextPrevRanks } : {};
    return data;
  },

  // Append one simulated match. Assigns an id + timestamp after the latest match.
  appendMatch(match) {
    const lastDate = data.matches.length
      ? new Date(data.matches[data.matches.length - 1].date)
      : new Date(BASELINE.matches[BASELINE.matches.length - 1].date);
    const id = (data.matches.reduce((mx, m) => Math.max(mx, m.id || 0), 0) || 0) + 1;
    const record = { ...match, id, date: new Date(lastDate.getTime() + 12 * 3600 * 1000).toISOString() };
    data.matches.push(record);
    return record;
  },
};

module.exports = state;
