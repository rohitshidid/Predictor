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
// what makes it sing; this is the safety net (and the pre-play placeholder).
function templateBlurb(r) {
  const bits = [`${r.won}-${r.lost} (${pct(r.winPct)} wins)`];
  const streak = streakPhrase(r);
  if (streak) bits.push(streak);
  bits.push(`rolling NRR ${signed(r.rollingNRR)}`);
  if (r.powerplayDominance >= 0.5) bits.push('powerplay strength');
  else if (r.deathOversNet <= -8) bits.push('leaky at the death');
  const move = r.movement === 'new' ? '' : `${cap(movementPhrase(r))}. `;
  return `${move}${cap(bits.join(', '))}.`;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

module.exports = { factSheet, templateBlurb, movementPhrase };
