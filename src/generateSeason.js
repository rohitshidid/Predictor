// Generates a self-consistent synthetic T20 season -> data/ipl_2024.json.
// Real IPL team names, invented-but-consistent results. Every ranking figure is
// DERIVED by the engine from these raw per-innings numbers, so the math stays
// defensible. Seeded RNG -> reproducible snapshot. Now emits the richer fields
// the expanded metric set needs (phase splits, toss, venue, star availability).
const fs = require('node:fs');
const path = require('node:path');

// ---- seeded RNG (mulberry32) ------------------------------------------------
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20240322);

// `strength` biases outcomes; `squadStars` = # of top-30 ICC players on the
// roster (feeds Key Player Availability). `colors` (primary/secondary) drive the
// original crest badge in the UI — brand colours only, not the trademarked logo
// artwork. None of this is stored on matches; the engine only reads results.
// 2026 Caribbean Premier League — 7 franchises.
const TEAMS = [
  { name: 'Trinbago Knight Riders', short: 'TKR', strength: 0.68, squadStars: 5, colors: { primary: '#C8102E', secondary: '#F5C518' } },
  { name: 'Guyana Amazon Warriors', short: 'GAW', strength: 0.66, squadStars: 5, colors: { primary: '#16A34A', secondary: '#F5C518' } },
  { name: 'Antigua & Barbuda Falcons', short: 'ABF', strength: 0.55, squadStars: 4, colors: { primary: '#1E3A8A', secondary: '#EF4444' } },
  { name: 'Barbados Royals', short: 'BR', strength: 0.54, squadStars: 4, colors: { primary: '#E6007E', secondary: '#0B1B3F' } },
  { name: 'Saint Lucia Kings', short: 'SLK', strength: 0.52, squadStars: 4, colors: { primary: '#1D4ED8', secondary: '#FACC15' } },
  { name: 'St Kitts & Nevis Patriots', short: 'SNP', strength: 0.47, squadStars: 3, colors: { primary: '#0E7490', secondary: '#DC2626' } },
  { name: 'Jamaica Kingsmen', short: 'JAM', strength: 0.44, squadStars: 3, colors: { primary: '#111827', secondary: '#FDB913' } },
];

const TOTAL_BALLS = 120; // 20 overs

// Build one innings' phase-split scorecard for a batting side of given strength.
// Returns { runs, balls, overs, ppRuns, deathRuns, deathBalls }.
function innings(strength, ballsFaced) {
  const balls = ballsFaced != null ? ballsFaced : TOTAL_BALLS;
  const overs = +(balls / 6).toFixed(1);
  // Overall run rate scales with strength (~7 to ~9.5 rpo).
  const rpo = 7 + (strength - 0.5) * 3 + (rnd() - 0.5) * 1.4;
  const runs = Math.max(80, Math.round((rpo * balls) / 6));
  // Powerplay = first 36 balls (~30% of a full innings). Strong sides skew a
  // little higher; ~26-34% of the innings total lands here.
  const ppShare = 0.30 + (strength - 0.5) * 0.06 + (rnd() - 0.5) * 0.05;
  const ppRuns = Math.max(25, Math.round(runs * Math.max(0.2, ppShare)));
  // Death = last 30 balls (overs 16-20), the high-strike-rate window (~34%).
  const deathBalls = Math.max(0, Math.min(30, balls - 90));
  const deathShare = 0.34 + (strength - 0.5) * 0.08 + (rnd() - 0.5) * 0.05;
  const deathRuns = deathBalls ? Math.max(20, Math.round(runs * deathShare * (deathBalls / 30))) : 0;
  // Top-4 batters usually contribute ~60-72% of the total (feeds Top-4 Consistency).
  const top4 = Math.round(runs * (0.6 + (strength - 0.5) * 0.06 + (rnd() - 0.5) * 0.08));
  return { runs, balls, overs, ppRuns, deathRuns, deathBalls, top4 };
}

function starsFor(team) {
  // Usually the full star cast; occasionally 1 rested/injured.
  const out = rnd() < 0.18 ? 1 : 0;
  return { available: Math.max(0, team.squadStars - out), squad: team.squadStars };
}

function playMatch(id, dateISO, home, away) {
  const tossWinner = rnd() < 0.5 ? home.name : away.name;
  // Toss winner usually elects to field (chase) in modern T20.
  const homeBatsFirst = tossWinner === home.name ? rnd() < 0.35 : rnd() < 0.65;
  const first = homeBatsFirst ? home : away;
  const second = homeBatsFirst ? away : home;

  const firstInn = innings(first.strength);
  const target = firstInn.runs + 1;

  // Decide winner: strength-led, nudged by the first-innings total.
  const edge = second.strength - first.strength;
  const secondWinsP = 0.5 + edge * 0.9 - (firstInn.runs - 150) / 400;
  const secondWins = rnd() < Math.max(0.1, Math.min(0.9, secondWinsP));

  let secondInn;
  if (secondWins) {
    // Chased down early: fewer balls used.
    const ballsUsed = Math.round(90 + rnd() * 28);
    secondInn = innings(second.strength, Math.min(TOTAL_BALLS, ballsUsed));
    secondInn.runs = target + Math.floor(rnd() * 20); // overtakes the target
    // recompute death within the (possibly short) chase
    secondInn.deathBalls = Math.max(0, Math.min(30, secondInn.balls - 90));
    secondInn.deathRuns = secondInn.deathBalls ? Math.round(secondInn.runs * 0.33 * (secondInn.deathBalls / 30)) : 0;
  } else {
    secondInn = innings(second.strength);
    if (secondInn.runs >= target) secondInn.runs = firstInn.runs - (3 + Math.floor(rnd() * 30));
    secondInn.runs = Math.max(75, secondInn.runs);
  }

  const winner = secondWins ? second.name : first.name;

  const innFor = (team, inn) => {
    // Wickets the batting side LOST this innings (i.e. the bowling side TOOK).
    // `bowlTop2` = how many of those fell to the bowling team's top-2 bowlers
    // (feeds Bowling Concentration / Wicket-Gini for the bowling side).
    const wktsLost = 3 + Math.floor(rnd() * 8); // 3..10
    const bowlTop2 = Math.min(wktsLost, Math.round(wktsLost * (0.4 + rnd() * 0.4)));
    return {
      batting: team.name,
      bowling: team === first ? second.name : first.name,
      runs: inn.runs,
      balls: inn.balls,
      overs: +(inn.balls / 6).toFixed(1),
      ppRuns: inn.ppRuns,
      deathRuns: inn.deathRuns,
      deathBalls: inn.deathBalls,
      top4: inn.top4,
      wktsLost,
      bowlTop2,
    };
  };

  return {
    id,
    date: dateISO,
    home: home.name,
    away: away.name,
    venueHomeTeam: home.name, // home team plays at its own venue
    tossWinner,
    battingFirst: first.name,
    winner,
    innings: [innFor(first, firstInn), innFor(second, secondInn)],
    stars: { [home.name]: starsFor(home), [away.name]: starsFor(away) },
  };
}

function buildSchedule() {
  const matches = [];
  let id = 1;
  let day = new Date('2024-03-22T14:00:00Z');
  const pairs = [];
  for (let i = 0; i < TEAMS.length; i++)
    for (let j = 0; j < TEAMS.length; j++) if (i !== j) pairs.push([TEAMS[i], TEAMS[j]]);
  for (let i = pairs.length - 1; i > 0; i--) {
    const k = Math.floor(rnd() * (i + 1));
    [pairs[i], pairs[k]] = [pairs[k], pairs[i]];
  }
  for (const [home, away] of pairs) {
    matches.push(playMatch(id++, new Date(day).toISOString(), home, away));
    day = new Date(day.getTime() + 12 * 3600 * 1000);
  }
  return matches;
}

const season = {
  season: '2026',
  league: 'Caribbean Premier League',
  leagueShort: 'CPL',
  generatedAt: new Date().toISOString(),
  note: 'Synthetic, self-consistent snapshot with real team names. Standings are derived from `matches` by the engine.',
  teams: TEAMS.map((t) => ({ name: t.name, short: t.short, squadStars: t.squadStars, colors: t.colors })),
  matches: buildSchedule(),
};

const outPath = path.join(__dirname, '..', 'data', 'cpl_2026.json');
fs.writeFileSync(outPath, JSON.stringify(season, null, 2));
console.log(`[gen] wrote ${season.matches.length} matches for ${season.teams.length} teams -> ${outPath}`);
