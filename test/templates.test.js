const test = require('node:test');
const assert = require('node:assert');
const { templateBlurb, preseasonBlurb, inSeasonBlurb } = require('../src/templates');

const played = {
  name: 'Trinbago Knight Riders', played: 6, won: 4, lost: 2, winPct: 4 / 6,
  rollingNRR: 0.42, powerplayDominance: 0.2, deathOversNet: -2,
  formRecord: { wins: 3, of: 5 }, streak: { len: 2, type: 'W' },
  rank: 1, delta: 0, movement: 'same',
};
const blank = { ...played, played: 0, won: 0, lost: 0, winPct: 0, rollingNRR: 0, streak: null };

const ctx = {
  priorSeason: '2025',
  prior: {
    'Trinbago Knight Riders': { index: 63.4, rawIndex: 66.26, rebrand: false,
      basis: 'own 2025 record', squadMovement: { squad2025: 18, kept: 11, lost: 7 } },
    'Jamaica Kingsmen': { index: 42.98, expansion: true, basis: 'no 2025 record' },
    'Barbados Tridents': { index: 41.2, rawIndex: 39.13, rebrand: true,
      basis: '2025 record of Barbados Royals', squadMovement: { squad2025: 18, kept: 12, lost: 6 } },
  },
  forecast: { teams: {
    'Trinbago Knight Riders': { won: 6, lost: 4, vsAverage: 0.607 },
    'Jamaica Kingsmen': { won: 4, lost: 6, vsAverage: 0.439 },
    'Barbados Tridents': { won: 4, lost: 6, vsAverage: 0.425 },
  } },
};

test('a played season still gets the in-season line', () => {
  const s = templateBlurb(played, ctx);
  assert.match(s, /4-2/);
  assert.ok(!/Projected/.test(s), 'a side that has played should not be described by a projection');
});

test('the preseason line never claims a 0-0 record or a zero run rate', () => {
  const s = templateBlurb(blank, ctx);
  assert.ok(!/0-0/.test(s), `"${s}" still reports a 0-0 record`);
  assert.ok(!/0% wins/.test(s), `"${s}" still reports 0% wins`);
  assert.ok(!/NRR \+0\.00/.test(s), `"${s}" still reports a zero run rate`);
});

test('it says where the opening rating came from, and what is projected', () => {
  const s = templateBlurb(blank, ctx);
  assert.match(s, /own 2025 record/i);
  assert.match(s, /11 of 18/);
  assert.match(s, /Projected 6-4/);
  assert.match(s, /61% chance/);
});

test('the continuity adjustment is stated, with its direction', () => {
  const s = preseasonBlurb(blank, ctx);
  assert.match(s, /discounting the carry-in by 2\.9/,
    'TKR lose squad, so the carry-in is discounted from its raw 2025 index');
  const bt = preseasonBlurb({ ...blank, name: 'Barbados Tridents' }, ctx);
  assert.match(bt, /lifting the carry-in by 2\.1/,
    'BT are pulled UP toward the mean, so the adjustment reads as a lift');
});

test('a rebrand is described as inheriting, with a readable possessive', () => {
  const s = preseasonBlurb({ ...blank, name: 'Barbados Tridents' }, ctx);
  assert.match(s, /across the rename/);
  assert.match(s, /Barbados Royals'/, 'a name ending in s takes a bare apostrophe');
  assert.ok(!/Royals's/.test(s), 'and never doubles the s');
});

test('an expansion side is not described as inheriting anything', () => {
  const s = preseasonBlurb({ ...blank, name: 'Jamaica Kingsmen' }, ctx);
  assert.match(s, /New side/);
  assert.ok(!/inherit its own/.test(s));
  assert.match(s, /Projected 4-6/);
});

test('Fresh Start has no past to describe and says so', () => {
  const s = templateBlurb(blank, null);
  assert.match(s, /every side opens level/i);
  assert.ok(!/0-0/.test(s));
});

test('no context at all still produces a sentence rather than throwing', () => {
  assert.equal(typeof templateBlurb(blank), 'string');
  assert.ok(templateBlurb(blank).length > 0);
  assert.equal(typeof inSeasonBlurb(played), 'string');
});

test('once the league is under way a team yet to play is not sold a projection', () => {
  // Its own row shows the real 0-0 by then, so quoting a forecast beside it is
  // exactly the contradiction the preseason line exists to remove.
  const started = { ...ctx, seasonStarted: true };
  const s = preseasonBlurb(blank, started);
  assert.match(s, /^Yet to play/);
  assert.ok(!/Projected/.test(s), `"${s}" still quotes a projection after the season started`);
  assert.ok(!/0-0/.test(s));
});

test('and with no priors either, it just says so', () => {
  const s = preseasonBlurb(blank, { seasonStarted: true });
  assert.equal(s, 'Yet to play.');
});
