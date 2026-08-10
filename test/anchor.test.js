const test = require('node:test');
const assert = require('node:assert');
const sim = require('../src/simState');
const { rank } = require('../src/engine');
const config = require('../weights.config.json');

// The anchor is what makes "7 August to 9 August" possible: a fixed order the
// arrows are measured from, rather than whatever the previous render happened to
// be. Its whole value is that it does NOT move when the table does, so that is
// what these check.

const reset = () => { sim.setMode('baseline'); sim.clearAnchor(); };

test('with no anchor, the comparison is the last render', () => {
  reset();
  sim.snapshot([{ name: 'A', rank: 2 }, { name: 'B', rank: 1 }]);
  assert.equal(sim.getAnchor(), null);
  assert.deepEqual(sim.getCompareRanks(), { A: 2, B: 1 });
});

test('an anchor takes over from the last render', () => {
  reset();
  sim.snapshot([{ name: 'A', rank: 1 }, { name: 'B', rank: 2 }]);
  sim.setAnchor([{ name: 'A', rank: 5 }, { name: 'B', rank: 3 }]);
  assert.deepEqual(sim.getCompareRanks(), { A: 5, B: 3 },
    'the pinned order wins, otherwise the arrows are day-to-day again');
});

test('it accepts a ranking array or a plain map — both callers exist', () => {
  reset();
  sim.setAnchor([{ name: 'A', rank: 1 }]);
  assert.deepEqual(sim.getAnchor(), { A: 1 });
  sim.setAnchor({ A: 4 });
  assert.deepEqual(sim.getAnchor(), { A: 4 });
});

test('the anchor survives further renders — that is the point of pinning it', () => {
  reset();
  sim.setAnchor({ A: 7, B: 1 });
  // Every state build snapshots the current order into prevRanks. If that
  // clobbered the anchor, a week-long comparison would collapse to day-to-day
  // arrows the moment anything re-rendered.
  sim.snapshot([{ name: 'A', rank: 1 }, { name: 'B', rank: 2 }]);
  sim.snapshot([{ name: 'A', rank: 1 }, { name: 'B', rank: 2 }]);
  assert.deepEqual(sim.getCompareRanks(), { A: 7, B: 1 });
});

test('the anchor survives simulating another match', () => {
  reset();
  const before = sim.getData().matches.length;
  sim.setAnchor({ 'Trinbago Knight Riders': 4 });
  sim.appendMatch({ home: 'Trinbago Knight Riders', away: 'Guyana Amazon Warriors', winner: 'Trinbago Knight Riders', innings: [] });
  assert.equal(sim.getData().matches.length, before + 1);
  assert.deepEqual(sim.getAnchor(), { 'Trinbago Knight Riders': 4 },
    'the week is built up match by match — the comparison point must not move with it');
});

test('changing season drops it: a new season is not the one it was taken from', () => {
  reset();
  sim.setAnchor({ A: 1 });
  sim.setMode('fresh');
  assert.equal(sim.getAnchor(), null);
});

test('restoring a different checkpoint drops it too', () => {
  reset();
  sim.setAnchor({ A: 1 });
  sim.loadData({ season: '2026', league: 'L', teams: [], matches: [] }, 'baseline', { A: 2 });
  assert.equal(sim.getAnchor(), null, 'the caller pins a new one if it wants one');
  assert.deepEqual(sim.getPrevRanks(), { A: 2 }, 'the file’s own prevRanks still load');
  reset();
});

test('getAnchor hands back a copy, so a caller cannot edit the pin by accident', () => {
  reset();
  sim.setAnchor({ A: 1 });
  const a = sim.getAnchor();
  a.A = 99;
  assert.deepEqual(sim.getAnchor(), { A: 1 });
});

// The engine contract the comparison rests on: movement is computed from
// whatever prevRanks map it is handed, so pinning an older one is all it takes
// to measure across a week instead of across a day.
test('the engine measures movement against the map it is given, whatever its age', () => {
  const data = {
    season: '2026', league: 'L', leagueShort: 'L',
    teams: [
      { name: 'A', short: 'A', squadStars: 0 },
      { name: 'B', short: 'B', squadStars: 0 },
      { name: 'C', short: 'C', squadStars: 0 },
    ],
    matches: [],
  };
  const asOfYesterday = rank(data, config, { A: 1, B: 2, C: 3 }, null);
  const asOfLastWeek = rank(data, config, { A: 3, B: 2, C: 1 }, null);
  const move = (rows, name) => rows.find((r) => r.name === name).delta;
  // Nothing about the table changed between the two calls — only the point of
  // comparison — and the arrows differ accordingly.
  assert.notDeepEqual(
    asOfYesterday.map((r) => r.delta),
    asOfLastWeek.map((r) => r.delta),
    'a different comparison point must produce different movement',
  );
  assert.equal(move(asOfLastWeek, 'C') + move(asOfLastWeek, 'A'), 0,
    'ranks are a permutation, so the deltas cancel out across the table');
});

test('a side missing from the comparison point is new, not unchanged', () => {
  const data = {
    season: '2026', league: 'L', leagueShort: 'L',
    teams: [{ name: 'A', short: 'A', squadStars: 0 }, { name: 'B', short: 'B', squadStars: 0 }],
    matches: [],
  };
  const rows = rank(data, config, { A: 1 }, null);
  assert.equal(rows.find((r) => r.name === 'B').movement, 'new');
});
