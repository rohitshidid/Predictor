// Deterministic ranking engine — NO AI. The crown rule: code computes the order
// and deltas from stats; the model only writes prose later. Same numbers in =>
// same order out. All weighting + normalization bounds come from
// weights.config.json (config, not code).
//
// 9 ALWAYS-ON metrics (each normalized 0..1 before weighting):
//   winPct · marginAdjustedWin · rollingNRR · form(Bayesian) · powerplayDominance
//   · deathOversNet · sos · homeAwayAdjustment · keyPlayerAvailability
// 5 OPTIONAL metrics (contribute only when enabled in config.enabled):
//   expectedWins (Pythagorean xW) · tossLeverage · chaseSet · top4Consistency
//   · bowlingConcentration

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const norm = (x, min, max) => (max === min ? 0 : clamp01((x - min) / (max - min)));
const safeDiv = (a, b) => (b ? a / b : 0);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const stddev = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};

function sides(match, team) {
  const own = match.innings.find((i) => i.batting === team);
  const opp = match.innings.find((i) => i.batting !== team);
  return { own, opp };
}

function collect(data) {
  const squadStars = {};
  for (const t of data.teams) squadStars[t.name] = t.squadStars || 0;

  const teams = {};
  for (const t of data.teams) {
    teams[t.name] = {
      name: t.name,
      short: t.short,
      played: 0,
      won: 0,
      lost: 0,
      runsFor: 0,
      oversFor: 0,
      runsAgainst: 0,
      oversAgainst: 0,
      ppRunsFor: 0,
      ppRunsAgainst: 0,
      deathRunsFor: 0,
      deathBallsFor: 0,
      deathRunsAgainst: 0,
      deathBallsAgainst: 0,
      homePlayed: 0,
      homeWon: 0,
      awayPlayed: 0,
      awayWon: 0,
      // toss
      tossWon: 0,
      tossWonWins: 0,
      tossLost: 0,
      tossLostWins: 0,
      // chase vs set
      setGames: 0,
      setWins: 0,
      chaseGames: 0,
      chaseWins: 0,
      // top-4 batting (chronological totals) + bowling wicket spread
      top4Series: [],
      bowlWkts: 0,
      bowlTop2: 0,
      starsAvailable: squadStars[t.name],
      squadStars: squadStars[t.name],
      results: [],
      opponents: [],
    };
  }

  const byDate = [...data.matches].sort((a, b) => new Date(a.date) - new Date(b.date));
  for (const m of byDate) {
    for (const team of [m.home, m.away]) {
      const t = teams[team];
      if (!t) continue;
      const { own, opp } = sides(m, team);
      if (!own || !opp) continue;
      const win = m.winner === team;

      t.played++;
      t.won += win ? 1 : 0;
      t.lost += win ? 0 : 1;
      t.runsFor += own.runs;
      t.oversFor += own.overs;
      t.runsAgainst += opp.runs;
      t.oversAgainst += opp.overs;
      t.ppRunsFor += own.ppRuns;
      t.ppRunsAgainst += opp.ppRuns;
      t.deathRunsFor += own.deathRuns;
      t.deathBallsFor += own.deathBalls;
      t.deathRunsAgainst += opp.deathRuns;
      t.deathBallsAgainst += opp.deathBalls;

      const atHome = m.venueHomeTeam === team;
      if (atHome) {
        t.homePlayed++;
        t.homeWon += win ? 1 : 0;
      } else {
        t.awayPlayed++;
        t.awayWon += win ? 1 : 0;
      }

      // Toss
      if (m.tossWinner === team) {
        t.tossWon++;
        t.tossWonWins += win ? 1 : 0;
      } else {
        t.tossLost++;
        t.tossLostWins += win ? 1 : 0;
      }

      // Chase vs set
      if (m.battingFirst === team) {
        t.setGames++;
        t.setWins += win ? 1 : 0;
      } else {
        t.chaseGames++;
        t.chaseWins += win ? 1 : 0;
      }

      // Top-4 batting (this team's innings) + bowling spread (from the innings it bowled)
      if (typeof own.top4 === 'number') t.top4Series.push(own.top4);
      if (typeof opp.wktsLost === 'number') {
        t.bowlWkts += opp.wktsLost;
        t.bowlTop2 += opp.bowlTop2 || 0;
      }

      t.opponents.push(team === m.home ? m.away : m.home);
      t.results.push({ date: m.date, opponent: team === m.home ? m.away : m.home, win, match: m });

      if (m.stars && m.stars[team]) {
        t.starsAvailable = m.stars[team].available;
        t.squadStars = m.stars[team].squad;
      }
    }
  }
  return teams;
}

// --- always-on metrics -------------------------------------------------------
const winPct = (t) => safeDiv(t.won, t.played);
const seasonNRR = (t) => safeDiv(t.runsFor, t.oversFor) - safeDiv(t.runsAgainst, t.oversAgainst);

function rollingNRR(t, window) {
  const recent = t.results.slice(-window);
  let rf = 0, of = 0, ra = 0, oa = 0;
  for (const r of recent) {
    const { own, opp } = sides(r.match, t.name);
    rf += own.runs; of += own.overs; ra += opp.runs; oa += opp.overs;
  }
  return safeDiv(rf, of) - safeDiv(ra, oa);
}

function momentum(t, alpha) {
  let m = 0.5;
  for (const r of t.results) m = alpha * (r.win ? 1 : 0) + (1 - alpha) * m;
  return m;
}

function marginAdjustedWin(t) {
  const wins = t.results.filter((r) => r.win);
  if (!wins.length) return 0;
  let sum = 0;
  for (const r of wins) {
    const m = r.match;
    const { own, opp } = sides(m, t.name);
    const q = m.battingFirst === t.name
      ? safeDiv(own.runs - opp.runs, own.runs) * 100
      : safeDiv(120 - own.balls, 120) * 100;
    sum += Math.max(0, Math.min(100, q));
  }
  return sum / wins.length;
}

function powerplayDominance(t) {
  const batRR = safeDiv(t.ppRunsFor, 6 * t.played);
  const bowlRR = safeDiv(t.ppRunsAgainst, 6 * t.played);
  return { batRR, bowlRR, dominance: batRR - bowlRR };
}

function deathOvers(t, scaling) {
  const batSR = safeDiv(t.deathRunsFor, t.deathBallsFor) * 100;
  const bowlEcon = safeDiv(t.deathRunsAgainst, t.deathBallsAgainst / 6);
  return { batSR, bowlEcon, net: batSR - bowlEcon * scaling };
}

function homeAway(t) {
  const home = safeDiv(t.homeWon, t.homePlayed);
  const away = safeDiv(t.awayWon, t.awayPlayed);
  const score = t.homePlayed || t.awayPlayed ? clamp01(0.6 * away + 0.4 * home) : winPct(t);
  return { home, away, score };
}

const availability = (t) => (t.squadStars ? clamp01(t.starsAvailable / t.squadStars) : 1);

// --- optional metrics --------------------------------------------------------
// Expected wins (Pythagorean): how many a team "deserves" from runs scored vs conceded.
function expectedWins(t) {
  const f = t.runsFor ** 2;
  const a = t.runsAgainst ** 2;
  return f + a ? f / (f + a) : 0.5;
}

// Toss: reward teams that win WITHOUT the toss (low dependency). Leverage shown for audit.
function toss(t) {
  const wonPct = safeDiv(t.tossWonWins, t.tossWon);
  const lostPct = safeDiv(t.tossLostWins, t.tossLost);
  return { wonPct, lostPct, leverage: wonPct - lostPct, independence: lostPct };
}

// Chase vs set: reward versatility (good at BOTH), so a one-dimensional team scores lower.
function chaseSet(t) {
  const chase = safeDiv(t.chaseWins, t.chaseGames);
  const set = safeDiv(t.setWins, t.setGames);
  const versatility = 0.5 * Math.min(chase, set) + 0.5 * ((chase + set) / 2);
  return { chase, set, versatility };
}

// Top-4 batting consistency: high average AND low volatility = reliable/rankable.
function top4Consistency(t, window) {
  const recent = t.top4Series.slice(-window);
  const m = mean(recent);
  const sd = stddev(recent);
  const normMean = norm(m, 40, 140);
  const stability = 1 - norm(sd, 0, 50);
  return { mean: m, std: sd, score: clamp01(0.6 * normMean + 0.4 * stability) };
}

// Bowling concentration (wicket-Gini): a spread attack is resilient; top-2-reliant is fragile.
function bowlingConcentration(t) {
  const concentration = safeDiv(t.bowlTop2, t.bowlWkts);
  return { concentration, resilience: clamp01(1 - concentration) };
}

// --- misc --------------------------------------------------------------------
function streakOf(t) {
  const r = [...t.results].reverse();
  if (!r.length) return { type: null, len: 0 };
  const type = r[0].win ? 'W' : 'L';
  let len = 0;
  for (const g of r) { if ((g.win ? 'W' : 'L') === type) len++; else break; }
  return { type, len };
}
function formRecord(t, window) {
  const recent = t.results.slice(-window);
  return { wins: recent.filter((r) => r.win).length, of: recent.length };
}

const OPTIONAL_KEYS = ['expectedWins', 'tossLeverage', 'chaseSet', 'top4Consistency', 'bowlingConcentration'];

// Rank the league. `lastWeek` maps teamName -> previous rank for the ▲/▼ delta.
function rank(data, config, lastWeek = {}) {
  const w = config.weights;
  const ow = config.optionalWeights || {};
  const enabled = config.enabled || {};
  const { alpha, window } = config.form;
  const nrrCfg = config.nrr;
  const ppCfg = config.powerplay;
  const dCfg = config.deathOvers;
  const scale = config.scoreScale || 100;

  const teams = collect(data);
  const list = Object.values(teams);

  const winPctOf = {};
  for (const t of list) winPctOf[t.name] = winPct(t);

  const rows = list.map((t) => {
    const wp = winPctOf[t.name];
    const season = seasonNRR(t);
    const rNRR = rollingNRR(t, nrrCfg.rollingWindow);
    const form = momentum(t, alpha);
    const margin = marginAdjustedWin(t);
    const pp = powerplayDominance(t);
    const death = deathOvers(t, dCfg.scalingFactor);
    const ha = homeAway(t);
    const avail = availability(t);
    const opp = t.opponents;
    const sos = opp.length ? opp.reduce((s, o) => s + (winPctOf[o] || 0), 0) / opp.length : 0;
    // optional
    const xW = expectedWins(t);
    const tossM = toss(t);
    const cs = chaseSet(t);
    const t4 = top4Consistency(t, nrrCfg.rollingWindow);
    const bowl = bowlingConcentration(t);

    const n = {
      winPct: clamp01(wp),
      marginAdjustedWin: clamp01(margin / 100),
      rollingNRR: norm(rNRR, nrrCfg.seasonMin, nrrCfg.seasonMax),
      form: clamp01(form),
      powerplayDominance: norm(pp.dominance, ppCfg.dominanceMin, ppCfg.dominanceMax),
      deathOversNet: norm(death.net, dCfg.netMin, dCfg.netMax),
      sos: clamp01(sos),
      homeAwayAdjustment: clamp01(ha.score),
      keyPlayerAvailability: clamp01(avail),
      // optional
      expectedWins: clamp01(xW),
      tossLeverage: clamp01(tossM.independence),
      chaseSet: clamp01(cs.versatility),
      top4Consistency: clamp01(t4.score),
      bowlingConcentration: clamp01(bowl.resilience),
    };

    let score = 0;
    for (const k of Object.keys(w)) score += (w[k] || 0) * (n[k] || 0);
    for (const k of OPTIONAL_KEYS) if (enabled[k]) score += (ow[k] || 0) * (n[k] || 0);
    score *= scale;

    return {
      name: t.name, short: t.short, played: t.played, won: t.won, lost: t.lost,
      winPct: wp, seasonNRR: season, rollingNRR: rNRR, nrrTrend: rNRR - season,
      form, formRecord: formRecord(t, window), marginAdjustedWin: margin,
      ppBatRR: pp.batRR, ppBowlRR: pp.bowlRR, powerplayDominance: pp.dominance,
      deathBatSR: death.batSR, deathBowlEcon: death.bowlEcon, deathOversNet: death.net,
      sos, homeWinPct: ha.home, awayWinPct: ha.away, homeAwayScore: ha.score,
      starsAvailable: t.starsAvailable, squadStars: t.squadStars, keyPlayerAvailability: avail,
      // optional (raw for display)
      expectedWins: xW, tossWonPct: tossM.wonPct, tossLostPct: tossM.lostPct, tossLeverage: tossM.leverage,
      chaseWinPct: cs.chase, setWinPct: cs.set, chaseSetVersatility: cs.versatility,
      top4Mean: t4.mean, top4Std: t4.std, top4Consistency: t4.score,
      bowlConcentration: bowl.concentration, bowlingResilience: bowl.resilience,
      streak: streakOf(t), normalized: n, score,
    };
  });

  rows.sort((a, b) => b.score - a.score || b.winPct - a.winPct || b.rollingNRR - a.rollingNRR);
  rows.forEach((r, i) => {
    r.rank = i + 1;
    const prev = lastWeek[r.name];
    if (typeof prev === 'number') {
      r.delta = prev - r.rank;
      r.movement = r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : 'same';
    } else {
      r.delta = 0;
      r.movement = 'new';
    }
  });

  return rows;
}

module.exports = { rank, collect, OPTIONAL_KEYS };
