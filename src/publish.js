// Website publish payload — the one document the cplxch marketing site consumes.
//
// The checkpoint format is a *restore* file: it carries the match list so the
// engine can re-derive the table byte-for-byte. That makes it the wrong shape
// for a website, which needs the derived figures (ratings, form strings, per-
// factor marks, prose) and none of the ball-by-ball input.
//
// So this module renders a second, flat view of the SAME ranked rows:
//   kind: "champhunt-site-rankings", version 1
// Nothing here recomputes anything — every number comes from engine.rank(), so
// the published table and the broadcast graphic can never disagree.
'use strict';

const { rank, collect } = require('./engine');
const { templateBlurb } = require('./templates');

// Display metadata for each engine metric key. The site renders `name`/`note`
// verbatim, so the wording lives here rather than being duplicated in the
// front-end — change it once and every published week picks it up.
const FACTOR_META = {
  winPct: {
    name: 'Win %',
    note: 'How often they win. The foundation.',
  },
  deathOversNet: {
    name: 'Death overs (16–20)',
    note: 'The closing overs, where T20 games are actually decided — their hitting against their bowling.',
  },
  powerplayDominance: {
    name: 'Powerplay (overs 1–6)',
    note: 'Command of the opening burst. Runs scored there, minus runs conceded.',
  },
  rollingNRR: {
    name: 'Rolling net run rate',
    note: 'Whether they out-score opponents — last five games only, so one early thrashing does not flatter them all season.',
  },
  form: {
    name: 'Momentum',
    note: 'Are they hot right now? The latest match counts most.',
  },
  homeAwayAdjustment: {
    name: 'Home / away',
    note: 'Teams that only win at home are flattered. Travelling well counts.',
  },
  keyPlayerAvailability: {
    name: 'Key players',
    note: "A side missing its stars isn't the same side, whatever last week's results say.",
  },
  marginAdjustedWin: {
    name: 'Win quality',
    note: 'How they win — a 60-run rout versus a last-ball escape.',
  },
  sos: {
    name: 'Strength of schedule',
    note: 'Whether the opponents they beat were any good.',
  },
  // Optional metrics — only published when switched on in the config.
  expectedWins: {
    name: 'Expected wins',
    note: 'What their run-scoring says their record should have been.',
  },
  tossLeverage: {
    name: 'Toss leverage',
    note: 'Whether they win regardless of the coin, or only with it.',
  },
  chaseSet: {
    name: 'Chase vs defend',
    note: 'A side that can only do one of the two is easier to plan against.',
  },
  top4Consistency: {
    name: 'Top-order consistency',
    note: 'A top four that fires most weeks, rather than once a fortnight.',
  },
  bowlingConcentration: {
    name: 'Bowling spread',
    note: 'An attack that spreads its wickets survives an off day from its best bowler.',
  },
};

const signed = (x, d = 2) => `${x >= 0 ? '+' : ''}${x.toFixed(d)}`;
const mark = (x) => Math.round(Math.max(0, Math.min(1, x || 0)) * 100);

/** First sentence of a blurb, for the short "what changed" note. */
function firstSentence(text) {
  const s = String(text || '').trim();
  const cut = s.search(/[.!?](\s|$)/);
  return cut === -1 ? s : s.slice(0, cut + 1);
}

/** Last-N W/L sequence, oldest first — the form pills on the site. */
function formSequence(results, n = 5) {
  return results.slice(-n).map((r) => (r.win ? 'W' : 'L'));
}

/**
 * Build the site payload.
 *
 * @param {object}   o
 * @param {object}   o.data        season data (teams + matches)
 * @param {object}   o.config      live weights/optionalWeights/enabled
 * @param {object}   o.blurbs      teamName -> { text, source }
 * @param {object}   o.prevRanks   teamName -> rank before the last mutation
 * @param {object}   o.meta        operator-set fields (week, headline, nextMatch…)
 */
function buildSitePayload({ data, config, blurbs = {}, prevRanks = {}, meta = {},
                           priors = null, forecast = null, blurbCtx = null }) {
  // Ranked WITH the carry-in, exactly as the app and the graphics do. Without it
  // the published table was a different computation from the one on screen:
  // harmless once a season is under way and the prior has decayed off, and
  // completely wrong at week zero, where the prior IS the rating and every side
  // would have published as identical.
  const rows = rank(data, config, prevRanks, priors);
  const collected = collect(data);
  const teamMeta = Object.fromEntries((data.teams || []).map((t) => [t.name, t]));

  const wk = Math.round(Number(meta.week));
  const week = Number.isFinite(wk) && wk >= 0 ? wk : 1;
  // Preseason means nothing has been played. Week 0 is the label for that state,
  // but the MATCH LIST is what decides it — a mislabelled week must not be able
  // to publish projections over the top of real results.
  const preseason = (data.matches || []).length === 0;

  const weights = config.weights || {};
  const optionalWeights = config.optionalWeights || {};
  const enabled = config.enabled || {};

  // Percentages, in the order the site should list them: heaviest first.
  const factors = [
    ...Object.keys(weights).map((key) => ({ key, weight: weights[key], optional: false })),
    ...Object.keys(optionalWeights)
      .filter((key) => enabled[key])
      .map((key) => ({ key, weight: optionalWeights[key], optional: true })),
  ]
    .map((f) => ({
      key: f.key,
      name: (FACTOR_META[f.key] || {}).name || f.key,
      note: (FACTOR_META[f.key] || {}).note || '',
      // Weights are stored 0..1 and shown as whole percentages.
      weight: Math.round(f.weight * 1000) / 10,
      optional: f.optional,
    }))
    .sort((a, b) => b.weight - a.weight)
    .map((f, i) => ({ n: i + 1, ...f }));

  const factorKeys = factors.map((f) => f.key);

  const teams = rows.map((r) => {
    const tm = teamMeta[r.name] || {};
    const cached = blurbs[r.name];
    const c = collected[r.name] || { results: [] };
    const prev = typeof prevRanks[r.name] === 'number' ? prevRanks[r.name] : r.rank;
    const fc = preseason && forecast && forecast.teams ? forecast.teams[r.name] : null;

    return {
      rank: r.rank,
      prev,
      delta: r.delta,
      movement: r.movement,
      team: r.name,
      // `short` on a CPL team is the abbreviation (TKR); the site also wants a
      // human short name for narrow screens, so derive one from the full name.
      short: shortName(r.name),
      abbr: tm.short || r.short || '',
      color: (tm.colors && tm.colors.primary) || '#334155',
      secondary: (tm.colors && tm.colors.secondary) || '#94a3b8',
      logo: tm.logo || null,
      // The PUBLISHED rating, on the 70-89 band — the figure on the graphics and in
      // the app. This emitted `score`, the engine's raw index, so the site was
      // handed 34-67 where the screen said 75-84. The raw index still ships
      // alongside, because every audit record is expressed in it.
      rating: Math.round(r.scoreDisplay * 10) / 10,
      index: Math.round(r.score * 10) / 10,
      played: r.played,
      // Preseason, the record on screen is the PROJECTION, so that is what the
      // site gets — flagged, never passed off as a result.
      w: fc ? fc.won : r.won,
      l: fc ? fc.lost : r.lost,
      recordIsProjected: !!fc,
      nrr: signed(r.seasonNRR),
      rollingNrr: signed(r.rollingNRR),
      form: formSequence(c.results),
      streak: r.streak,
      blurb: cached && cached.text ? cached.text : templateBlurb(r, blurbCtx),
      blurbSource: cached && cached.source ? cached.source : 'template',
      // Per-factor marks, 0-100, keyed exactly as `factors[].key`. These replace
      // the front-end's placeholder bars, which were generated from a sine wave.
      marks: Object.fromEntries(factorKeys.map((k) => [k, mark(r.normalized[k])])),
    };
  });

  // "What changed this week" — the biggest movers, described by their own prose.
  const changes = teams
    .filter((t) => t.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 4)
    .map((t) => ({
      team: t.short,
      abbr: t.abbr,
      color: t.color,
      delta: t.delta,
      note: `${t.delta > 0 ? '▲' : '▼'}${Math.abs(t.delta)} — ${firstSentence(t.blurb)}`,
    }));

  // Worked example: the middle of the table by default. A top or bottom side
  // makes the arithmetic look like a foregone conclusion; a mid-table one shows
  // the factors actually pulling against each other.
  const middle = teams[Math.floor(teams.length / 2)] || teams[0];
  const workedAbbr = meta.workedExampleAbbr || (middle && middle.abbr);
  const worked = teams.find((t) => t.abbr === workedAbbr) || middle;

  const top = teams[0];
  const region = meta.region || data.region || data.leagueShort || data.league;

  return {
    kind: 'champhunt-site-rankings',
    version: 1,
    site: meta.site || 'cplxch',

    league: data.league,
    leagueShort: data.leagueShort,
    season: String(data.season),
    region,

    week,
    weekLabel: meta.weekLabel || (week === 0 ? 'Preseason' : `Week ${week}`),
    preseason,
    publishedAt: new Date().toISOString(),
    matchCount: (data.matches || []).length,

    // Hero copy. Operator-overridable, because the automatic sentence is only
    // ever as good as the team name it is built from.
    headline:
      meta.headline ||
      (top ? `${top.short} are playing the best cricket in the ${region} right now.` : ''),
    subhead: meta.subhead || 'Not our opinion. Nine measurements, one number, no editorial.',

    // Next fixture for the hero countdown. Null => the site keeps its own value.
    nextMatch: meta.nextMatch || null,

    teams,
    factors,
    changes,
    workedExample: worked
      ? { abbr: worked.abbr, team: worked.team, short: worked.short, total: worked.rating }
      : null,
  };
}

/**
 * "Trinbago Knight Riders" -> "Trinbago". Long multi-word names ("St Kitts &
 * Nevis Patriots") keep everything up to the last word, which is the club
 * suffix; the result is what a broadcaster would say on air.
 */
function shortName(name) {
  const words = String(name || '').trim().split(/\s+/);
  if (words.length <= 1) return name;
  const SUFFIX = new Set([
    'Riders', 'Warriors', 'Royals', 'Kings', 'Patriots', 'Falcons', 'Kingsmen',
    'Knight', 'Amazon', 'Super', 'Tallawahs', 'Zouks', 'Tridents',
  ]);
  // Drop trailing club words until something substantive is left.
  const kept = [];
  for (const w of words) {
    if (SUFFIX.has(w)) break;
    kept.push(w);
  }
  return (kept.length ? kept : words.slice(0, 1)).join(' ');
}

module.exports = { buildSitePayload, FACTOR_META, shortName };
