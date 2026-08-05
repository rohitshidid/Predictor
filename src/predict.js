// Forecast each team's 2026 league record from the 2025-derived priors.
//
// The crown rule holds here exactly as it does for the ranking: this is
// arithmetic, not a model's opinion. Nothing in this file asks a language model
// what it thinks will happen. The forecast is a closed-form function of the same
// prior indices the opening ratings come from, so a weight change moves the
// ratings and the predicted records together, and running it twice gives the
// same answer twice.
//
// Method. Two teams' prior indices are turned into a win probability with a
// logistic, and each team's expected wins is the sum of that probability against
// every opponent, scaled to the number of games it actually plays:
//
//     P(a beats b) = 1 / (1 + exp(-(Ra - Rb) / scale))
//     E[wins_a]    = games / (n - 1)  x  SUM over b != a of P(a beats b)
//
// The `games / (n - 1)` factor is what a balanced schedule means: each team meets
// each opponent an equal share of its fixtures. Because P(a beats b) and
// P(b beats a) sum to 1, the expected wins across the league sum to exactly
// n x games / 2 — the number of matches actually played — with no fudging.
//
// Why closed form rather than a Monte Carlo: the expectation IS the average over
// simulated seasons, so simulating would return the same numbers with sampling
// noise on top and a seed to argue about.
const DEFAULTS = {
  // Games each side plays in the league stage. CPL 2025 ran six teams x ten
  // games; 2026 adds a seventh, and 7 x 10 / 2 = 35 league matches, which with
  // four playoff matches is the 39-match season we were given.
  gamesEach: 10,
  // Index points for a fixed odds ratio — the spread control. It is set so the
  // FORECAST spread comes out well inside the spread of last season's OUTCOMES
  // (2.1 wins against 4.0), which is the property a forecast should have:
  // finishing positions contain luck, and a projection of them should not
  // reproduce that luck as if it were skill. It is deliberately not tuned to hit
  // a target table. The published records are in any case robust to it — every
  // value from 25 to 35 rounds to the same integer records.
  scale: 30,
};

function logistic(delta, scale) {
  return 1 / (1 + Math.exp(-delta / scale));
}

// Round a set of fractional wins to integers that still sum to the number of
// matches played. Rounding each independently does not: three sides on x.5 round
// up and the league is credited with wins nobody won. Largest-remainder assigns
// the floor to everyone, then hands the leftover wins to the largest fractions,
// which is the standard apportionment fix and is order-stable.
function largestRemainder(values, total) {
  const floors = values.map((v) => Math.floor(v));
  let left = Math.round(total - floors.reduce((a, b) => a + b, 0));
  const order = values
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = floors.slice();
  for (let k = 0; k < order.length && left > 0; k++, left--) out[order[k].i] += 1;
  return out;
}

// `priorIndex` is { teamName: index }. Returns, per team, the expected wins and
// the integer record that is actually published.
function forecast(priorIndex, opts) {
  const o = Object.assign({}, DEFAULTS, opts || {});
  const names = Object.keys(priorIndex);
  const n = names.length;
  if (n < 2) return { teams: {}, gamesEach: o.gamesEach, matches: 0, scale: o.scale };

  const expected = names.map((a) => {
    let sum = 0;
    for (const b of names) if (b !== a) sum += logistic(priorIndex[a] - priorIndex[b], o.scale);
    return (o.gamesEach / (n - 1)) * sum;
  });

  const matches = (n * o.gamesEach) / 2;
  const wins = largestRemainder(expected, matches);

  const teams = {};
  names.forEach((name, i) => {
    teams[name] = {
      expectedWins: +expected[i].toFixed(2),
      won: wins[i],
      lost: o.gamesEach - wins[i],
      // Win probability against an average side — the one-number read on how the
      // forecast rates them, independent of the fixture count.
      vsAverage: +logistic(priorIndex[name] - mean(names.map((t) => priorIndex[t])), o.scale).toFixed(3),
    };
  });
  return { teams, gamesEach: o.gamesEach, matches, scale: o.scale };
}

function mean(a) {
  return a.reduce((x, y) => x + y, 0) / a.length;
}

module.exports = { forecast, logistic, largestRemainder, DEFAULTS };
