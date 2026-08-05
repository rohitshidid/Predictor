const test = require('node:test');
const assert = require('node:assert');
const { forecast, logistic, largestRemainder } = require('../src/predict');

test('equal sides split the season evenly', () => {
  const f = forecast({ A: 50, B: 50, C: 50, D: 50 }, { gamesEach: 10 });
  for (const t of Object.keys(f.teams)) {
    assert.equal(f.teams[t].expectedWins, 5, `${t} should expect exactly half of ten`);
    assert.equal(f.teams[t].won + f.teams[t].lost, 10);
  }
});

test('the published records add up to the matches actually played', () => {
  const priors = { A: 63.4, B: 56.4, C: 49.8, D: 49.5, E: 48.9, F: 43.0, G: 41.2 };
  const f = forecast(priors);
  const wins = Object.values(f.teams).reduce((s, t) => s + t.won, 0);
  const losses = Object.values(f.teams).reduce((s, t) => s + t.lost, 0);
  assert.equal(f.matches, 35, 'seven teams playing ten each is 35 matches');
  assert.equal(wins, 35, 'every match has exactly one winner');
  assert.equal(losses, 35, 'and exactly one loser');
});

test('expected wins sum to the match count before any rounding', () => {
  const priors = { A: 70, B: 60, C: 55, D: 50, E: 45, F: 40, G: 30 };
  const f = forecast(priors);
  const sum = Object.values(f.teams).reduce((s, t) => s + t.expectedWins, 0);
  assert.ok(Math.abs(sum - 35) < 0.01, `expected ${sum} to be 35 before rounding`);
});

test('a stronger prior never forecasts fewer wins', () => {
  const priors = { A: 63.4, B: 56.4, C: 49.8, D: 49.5, E: 48.9, F: 43.0, G: 41.2 };
  const f = forecast(priors);
  const order = Object.keys(priors).sort((a, b) => priors[b] - priors[a]);
  for (let i = 1; i < order.length; i++) {
    assert.ok(
      f.teams[order[i - 1]].expectedWins >= f.teams[order[i]].expectedWins,
      `${order[i - 1]} has the higher prior so must not forecast below ${order[i]}`,
    );
  }
});

test('the forecast is narrower than last season had it — it does not replay luck', () => {
  // 2025 finished 6,6,5,5,4,2: an outcome spread of four wins.
  const priors = { A: 63.4, B: 56.4, C: 49.8, D: 49.5, E: 48.9, F: 43.0, G: 41.2 };
  const e = Object.values(forecast(priors).teams).map((t) => t.expectedWins);
  const spread = Math.max(...e) - Math.min(...e);
  assert.ok(spread < 4, `forecast spread ${spread} should sit inside the outcome spread of 4`);
});

test('the published records do not move on the scale constant', () => {
  const priors = { A: 63.4, B: 56.4, C: 49.8, D: 49.5, E: 48.9, F: 43.0, G: 41.2 };
  const at = (scale) => Object.keys(priors).map((t) => forecast(priors, { scale }).teams[t].won).join(',');
  assert.equal(at(25), at(30), 'a scale of 25 and 30 must publish the same table');
  assert.equal(at(30), at(35), 'a scale of 30 and 35 must publish the same table');
});

test('largest remainder never invents or loses a win', () => {
  assert.deepEqual(largestRemainder([2.5, 2.5, 2.5, 2.5], 10), [3, 3, 2, 2]);
  assert.equal(largestRemainder([6.2, 5.6, 5.0, 4.9, 4.9, 4.3, 4.1], 35).reduce((a, b) => a + b, 0), 35);
});

test('a coin flip is the reference point', () => {
  assert.equal(logistic(0, 30), 0.5);
  assert.ok(logistic(10, 30) > 0.5 && logistic(-10, 30) < 0.5);
});
