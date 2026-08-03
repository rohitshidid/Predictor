// Season carry-in: what every team is worth on the morning of the first match.
//
// A season does not start from nothing. Before 2026 has produced a single
// result, the only evidence about these teams is what they did in 2025 — so
// that is what the opening table is built from. Without this every side scores
// an identical 34.0 (the flat value the engine returns when it has no matches
// to read), which says the champions and the wooden-spooners are the same team.
//
// The prior is DERIVED, not typed in. It is the index each side earned across
// the real 2025 season, computed by running the SAME engine and the SAME
// weights over data/cpl_2025.json. There is no second methodology to argue
// with: whatever the ranking formula says about 2025 is the number a team
// carries into 2026.
//
// Three cases:
//   - a returning team           -> its own 2025 index
//   - a rebranded team           -> the 2025 index of the franchise it continues
//                                   (`priorFrom` in the season data: Barbados
//                                   Tridents inherit Barbados Royals)
//   - a team with no 2025 record -> cannot be measured. Jamaica Kingsmen are new,
//                                   so they open a configured number of standard
//                                   deviations BELOW the 2025 league mean — an
//                                   explicit, stated first-year discount rather
//                                   than a silent guess.
//
// Decay lives in the engine, not here: see `prior` in weights.config.json.
const fs = require('node:fs');
const path = require('node:path');
const { rank } = require('./engine');

const SEASON_FILE = path.join(__dirname, '..', 'data', 'cpl_2025.json');

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const stddev = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};

let cache = null;

// Rank the 2025 season with prior blending switched OFF — a prior must never be
// built out of another prior.
function indexPrevSeason(config) {
  const season = JSON.parse(fs.readFileSync(SEASON_FILE, 'utf8'));
  const flat = { ...config, prior: { ...(config.prior || {}), enabled: false } };
  const rows = rank(season, flat, {});
  const byName = {};
  for (const r of rows) byName[r.name] = r.score;
  return { season, rows, byName };
}

// teams: the 2026 team list (each may carry `priorFrom`).
// Returns { priors, meta, leagueMean, leagueSd, expansion, source }.
function computePriors(config, teams) {
  const pCfg = (config && config.prior) || {};
  const { season, rows, byName } = indexPrevSeason(config);

  const scores = rows.map((r) => r.score);
  const leagueMean = mean(scores);
  const leagueSd = stddev(scores);
  const sigma = typeof pCfg.expansionSigma === 'number' ? pCfg.expansionSigma : 1;
  const expansion = leagueMean - sigma * leagueSd;

  // Squad continuity: how much of last season's record still describes this
  // squad. A side that kept its players is well described by its 2025 index; a
  // side that rebuilt is not, so its prior is pulled toward the league mean.
  //
  // This is uncertainty, not punishment. Heavy churn makes a BAD record less
  // predictive too, so a below-average team that rebuilt moves UP toward the
  // mean. Making churn actively cost a team would mean valuing the individual
  // players who left — a judgement call, and the ordering is meant to be
  // arithmetic.
  const cCfg = pCfg.continuity || {};
  const useContinuity = cCfg.enabled === true;
  const floor = typeof cCfg.confidenceFloor === 'number' ? cCfg.confidenceFloor : 0.5;
  const shrink = (index, sm) => {
    if (!useContinuity || !sm || !sm.squad2025) return { index, lambda: 1, continuity: null };
    const continuity = Math.max(0, Math.min(1, sm.kept / sm.squad2025));
    const lambda = floor + (1 - floor) * continuity;
    return { index: leagueMean + lambda * (index - leagueMean), lambda, continuity };
  };

  const priors = {};
  const meta = {};
  for (const t of teams) {
    const from = t.priorFrom || t.name;
    if (typeof byName[from] === 'number') {
      const raw = byName[from];
      const { index, lambda, continuity } = shrink(raw, t.squadMovement);
      priors[t.name] = index;
      meta[t.name] = {
        index,
        rawIndex: raw,
        continuity,
        lambda,
        squadMovement: t.squadMovement || null,
        basis: from === t.name ? 'own 2025 record' : `2025 record of ${from}`,
        rebrand: from !== t.name,
      };
    } else {
      priors[t.name] = expansion;
      meta[t.name] = {
        index: expansion,
        basis: `no 2025 record — opens ${sigma} sd below the ${rows.length}-team 2025 mean`,
        expansion: true,
      };
    }
  }
  return {
    priors,
    meta,
    leagueMean,
    leagueSd,
    expansion,
    sigma,
    source: {
      file: 'data/cpl_2025.json',
      season: season.season,
      matches: season.matches.length,
      note: season.source,
    },
  };
}

// Cached because it re-ranks a whole season. Invalidate whenever the weights
// change — the prior is computed with the same weights as the live table, so a
// tuned weight must move both.
function getPriors(config, teams) {
  const key = JSON.stringify([
    config.weights, config.enabled, config.prior,
    teams.map((t) => [t.name, t.priorFrom, t.squadMovement]),
  ]);
  if (!cache || cache.key !== key) cache = { key, value: computePriors(config, teams) };
  return cache.value;
}

const invalidate = () => { cache = null; };

module.exports = { getPriors, computePriors, invalidate };
