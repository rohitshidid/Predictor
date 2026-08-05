// Deterministic blurb templates — pure functions of the numbers, no AI. Two uses:
//   1. Fallback when the AI blurb fails grounding/critic (and the instant blurb
//      shown before a team has played in the simulator).
//   2. The "authoritative facts" a grounded critic checks the AI prose against.
// Every sentence here is provably true of the engine's output by construction.

const pct = (x) => `${Math.round(x * 100)}%`;
const signed = (x, d = 2) => `${x >= 0 ? '+' : ''}${x.toFixed(d)}`;

function movementPhrase(r) {
  if (r.movement === 'up') return `up ${r.delta} to ${r.rank}`;
  if (r.movement === 'down') return `down ${Math.abs(r.delta)} to ${r.rank}`;
  if (r.movement === 'same') return `holding at ${r.rank}`;
  return `new at ${r.rank}`;
}

function streakPhrase(r) {
  const s = r.streak;
  if (!s || !s.len || s.len < 2) return '';
  return s.type === 'W' ? `on a ${s.len}-match winning run` : `on a ${s.len}-match losing skid`;
}

// A compact, guaranteed-true fact sheet for one team — what the AI may draw from,
// and what the grounded critic verifies the prose against.
function factSheet(r) {
  return {
    rank: r.rank,
    team: r.name,
    record: `${r.won}-${r.lost}`,
    played: r.played,
    winPct: pct(r.winPct),
    rollingNRR: signed(r.rollingNRR),
    nrrTrend: `${signed(r.nrrTrend)} vs season`,
    form: `${r.formRecord.wins} of last ${r.formRecord.of}`,
    streak: r.streak && r.streak.len >= 2 ? `${r.streak.len}${r.streak.type}` : 'none',
    winQuality: `${Math.round(r.marginAdjustedWin)}/100`,
    powerplay: signed(r.powerplayDominance) + ' PP dominance',
    death: `death net ${signed(r.deathOversNet, 0)}`,
    homeAway: `home ${pct(r.homeWinPct)} / away ${pct(r.awayWinPct)}`,
    stars: `${r.starsAvailable}/${r.squadStars} stars available`,
    movement: movementPhrase(r),
  };
}

// Deterministic one-liner. Reads a touch mechanical on purpose — the AI layer is
// what makes it sing; this is the safety net.
function inSeasonBlurb(r) {
  const bits = [`${r.won}-${r.lost} (${pct(r.winPct)} wins)`];
  const streak = streakPhrase(r);
  if (streak) bits.push(streak);
  bits.push(`rolling NRR ${signed(r.rollingNRR)}`);
  if (r.powerplayDominance >= 0.5) bits.push('powerplay strength');
  else if (r.deathOversNet <= -8) bits.push('leaky at the death');
  const move = r.movement === 'new' ? '' : `${cap(movementPhrase(r))}. `;
  return `${move}${cap(bits.join(', '))}.`;
}

// Before a ball is bowled every in-season figure is zero, so the in-season line
// came out as "Holding at 1. 0-0 (0% wins), rolling NRR +0.00" — true, useless,
// and sitting directly beside a projected record that said something entirely
// different. This talks about the things that ARE known in the preseason: where
// the opening rating came from, how much of last season's squad is still there,
// and what the projection makes of it. Still deterministic — every clause is a
// fact off the prior or the forecast, nothing is asserted that isn't in the data.
function possessive(name) {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

function preseasonBlurb(r, ctx) {
  ctx = ctx || {};
  const meta = (ctx.prior && ctx.prior[r.name]) || null;
  // The projection is quoted only while the LEAGUE is unplayed, not merely while
  // this side is. Once any result exists the graphics switch their column back to
  // the real record, so a side still on 0-0 must not be described by a projection
  // its own row no longer shows — that was the contradiction this line was
  // written to remove, and keying it per-team would have reintroduced it a week
  // later for whoever had the bye.
  const fc = ctx.seasonStarted
    ? null
    : (ctx.forecast && ctx.forecast.teams && ctx.forecast.teams[r.name]) || null;
  const last = ctx.priorSeason ? `${ctx.priorSeason}` : 'last season';

  // Fresh Start deliberately throws the past away, so there is no carry-in to
  // describe and every side is identical. Say that rather than dressing it up.
  if (!meta && !fc) {
    return ctx.seasonStarted ? 'Yet to play.' : 'No matches played yet — every side opens level.';
  }

  // A sentence of its own, not a clause — joining it with a comma left the next
  // clause capitalised mid-sentence.
  const lead = ctx.seasonStarted ? 'Yet to play. ' : '';
  const bits = [];
  if (meta && meta.expansion) {
    bits.push(`New side with no ${last} record to inherit, so they open a stated distance below the ${last} league average rather than on somebody's hunch`);
  } else if (meta && meta.rebrand) {
    const from = String(meta.basis || '').replace(/^\d{4}\s+record of\s+/i, '').trim();
    bits.push(`Carries ${from ? possessive(from) : 'the predecessor’s'} ${last} record across the rename`);
  } else {
    bits.push(`Opens on its own ${last} record`);
  }

  const sm = meta && meta.squadMovement;
  if (sm && sm.squad2025) bits.push(`${sm.kept} of ${sm.squad2025} from that squad still here`);

  // The continuity adjustment is the one number a reader is most likely to
  // challenge, so state it rather than burying it in the details panel.
  if (meta && typeof meta.rawIndex === 'number' && Math.abs(meta.rawIndex - meta.index) >= 0.05) {
    const d = meta.index - meta.rawIndex;
    bits.push(`${d < 0 ? 'discounting' : 'lifting'} the carry-in by ${Math.abs(d).toFixed(1)}`);
  }

  let out = `${lead}${cap(bits.join(', '))}.`;
  if (fc) {
    out += ` Projected ${fc.won}-${fc.lost}`;
    if (typeof fc.vsAverage === 'number') out += `, a ${pct(fc.vsAverage)} chance against an average side`;
    out += '.';
  }
  return out;
}

// `ctx` carries the preseason context: { prior, forecast, priorSeason }. Absent,
// this behaves exactly as it always did, so any caller that has not been updated
// keeps working.
function templateBlurb(r, ctx) {
  return r.played === 0 ? preseasonBlurb(r, ctx) : inSeasonBlurb(r);
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

module.exports = { factSheet, templateBlurb, preseasonBlurb, inSeasonBlurb, movementPhrase };
