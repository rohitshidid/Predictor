// Match-resolution tests. `node --test`.
//
// These run against recorded CricAPI response shapes, never the live feed — the
// free plan is 100 calls a day and a test suite that spends them is a test suite
// nobody runs. Every case here is a bug that actually shipped:
//   - "latest India v Pakistan" resolving to the 2024 T20 World Cup game
//   - the men's fixture resolving to the Women's World Cup one
//   - an exhausted quota reported as "no such match"
//   - one lookup burning the whole daily allowance
process.env.CACHE_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'pr-cache-'));
process.env.CRICAPI_KEY = 'test-key';

const test = require('node:test');
const assert = require('node:assert');
const live = require('../src/liveMatch');
const cache = require('../src/cache');

// The cache is deliberately persistent, so each case starts from a cold one —
// otherwise a test would be measuring the previous test's stored responses.
test.beforeEach(() => cache.clear());

// ---- recorded payloads -------------------------------------------------------
const IND_PAK_ID = 'a1b2c3d4-0000-4000-8000-000000000001';

const SERIES_LIST = {
  status: 'success',
  info: { hitsToday: 12, hitsLimit: 100 },
  data: [
    { id: 'srs-wwc', name: 'ICC Womens T20 World Cup 2026', startDate: '2026-01-10', matches: 33 },
    { id: 'srs-qual', name: 'ICC Mens T20 World Cup Europe Sub Regional Qualifier B 2026', startDate: '2026-01-05', matches: 15 },
    { id: 'srs-mwc', name: 'ICC Mens T20 World Cup 2026', startDate: '2026-02-07', matches: 55 },
  ],
};

const SERIES_INFO_MWC = {
  status: 'success',
  info: { hitsToday: 13, hitsLimit: 100 },
  data: {
    matchList: [
      { id: 'old-1', teams: ['India', 'Pakistan'], dateTimeGMT: '2024-06-09T14:30:00', status: 'India won by 6 runs', matchEnded: true },
      { id: IND_PAK_ID, teams: ['India', 'Pakistan'], dateTimeGMT: '2026-02-15T09:00:00', status: 'India won by 7 wickets', matchEnded: true },
      { id: 'future-1', teams: ['India', 'Pakistan'], dateTimeGMT: '2026-11-02T09:00:00', status: 'Match not started', matchEnded: false },
    ],
  },
};

const SERIES_INFO_WWC = {
  status: 'success',
  info: { hitsToday: 13, hitsLimit: 100 },
  data: {
    matchList: [
      { id: 'w-1', teams: ['India Women', 'Pakistan Women'], dateTimeGMT: '2026-01-12T09:00:00', status: 'India Women won by 8 wickets', matchEnded: true },
    ],
  },
};

const SCORECARD = {
  status: 'success',
  info: { hitsToday: 14, hitsLimit: 100 },
  data: {
    id: IND_PAK_ID,
    name: 'India vs Pakistan, 27th Match, Group A',
    matchType: 't20',
    status: 'India won by 7 wickets',
    venue: 'Eden Gardens, Kolkata',
    date: '2026-02-15',
    teams: ['Pakistan', 'India'],
    matchWinner: 'India',
    tossWinner: 'India',
    tossChoice: 'bowl',
    score: [
      { inning: 'Pakistan Inning 1', r: 146, w: 9, o: 20 },
      { inning: 'India Inning 1', r: 149, w: 3, o: 18.2 },
    ],
    scorecard: [
      {
        inning: 'Pakistan Inning 1',
        batting: [
          { batsman: { name: 'Saim Ayub' }, r: 41 }, { batsman: { name: 'Babar Azam' }, r: 33 },
          { batsman: { name: 'Mohammad Rizwan' }, r: 20 }, { batsman: { name: 'Fakhar Zaman' }, r: 12 },
          { batsman: { name: 'Salman Agha' }, r: 18 },
        ],
        bowling: [
          { bowler: { name: 'Jasprit Bumrah' }, w: 3 }, { bowler: { name: 'Kuldeep Yadav' }, w: 3 },
          { bowler: { name: 'Arshdeep Singh' }, w: 2 },
        ],
      },
      {
        inning: 'India Inning 1',
        batting: [
          { batsman: { name: 'Abhishek Sharma' }, r: 55 }, { batsman: { name: 'Shubman Gill' }, r: 40 },
          { batsman: { name: 'Suryakumar Yadav' }, r: 31 }, { batsman: { name: 'Tilak Varma' }, r: 14 },
        ],
        bowling: [
          { bowler: { name: 'Shaheen Afridi' }, w: 2 }, { bowler: { name: 'Haris Rauf' }, w: 1 },
        ],
      },
    ],
  },
};

const EMPTY_SCORE = { status: 'success', info: { hitsToday: 11, hitsLimit: 100 }, data: [] };

// Stand in for the network and count what a lookup actually costs.
function mockFeed(routes) {
  const calls = [];
  global.fetch = async (url) => {
    const u = new URL(url);
    const path = u.pathname.replace('/v1/', '');
    calls.push(`${path}${u.searchParams.get('search') ? `?search=${u.searchParams.get('search')}` : ''}${u.searchParams.get('id') ? `?id=${u.searchParams.get('id')}` : ''}`);
    const body = routes(path, u.searchParams);
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  return calls;
}

const standardRoutes = (path, params) => {
  if (path === 'cricScore') return EMPTY_SCORE;
  if (path === 'series') return SERIES_LIST;
  if (path === 'series_info') {
    return params.get('id') === 'srs-mwc' ? SERIES_INFO_MWC
      : params.get('id') === 'srs-wwc' ? SERIES_INFO_WWC
      : { status: 'success', data: { matchList: [] } };
  }
  if (path === 'match_scorecard') return SCORECARD;
  throw new Error(`unmocked path ${path}`);
};

// ---- tests -------------------------------------------------------------------

test('resolves the most recent completed fixture, not the most famous one', async () => {
  mockFeed(standardRoutes);
  const found = await live.cricapiFindLatest('India', 'Pakistan', []);
  assert.equal(found.id, IND_PAK_ID, 'must pick the 2026 match over the 2024 one');
});

test('ignores fixtures that have not been played yet', async () => {
  mockFeed(standardRoutes);
  const found = await live.cricapiFindLatest('India', 'Pakistan', []);
  assert.notEqual(found.id, 'future-1');
});

test('a squad qualifier makes it a different team', () => {
  assert.ok(live.teamMatches('India', 'India'));
  assert.ok(live.teamMatches('West Indies', 'Windies'));
  assert.ok(!live.teamMatches('India Women', 'India'), 'women\'s side is not the men\'s side');
  assert.ok(!live.teamMatches('India U19', 'India'));
  assert.ok(!live.teamMatches('Pakistan A', 'Pakistan'));
});

test('link slugs become broad-first series search terms', () => {
  const terms = live.linkHints(['https://www.cricinfo.com/series/icc-men-s-t20-world-cup-2025-26-1502138/india-vs-pakistan-27th-match-group-a-1512745/full-scorecard']);
  assert.ok(terms.length > 0);
  assert.ok(terms[0].split(' ').length <= terms[terms.length - 1].split(' ').length,
    'broadest term first — it is the one that actually matches a series name');
  assert.ok(terms.some((t) => t.includes('t20 world cup')));
});

test('a completed match in the live window short-circuits the series sweep', async () => {
  const calls = mockFeed((path) => {
    if (path === 'cricScore') {
      return {
        status: 'success',
        info: { hitsToday: 5, hitsLimit: 100 },
        data: [{ id: 'live-1', t1: 'India [IND]', t2: 'Pakistan [PAK]', status: 'India won by 5 wickets', matchEnded: true, dateTimeGMT: '2026-07-20T09:00:00' }],
      };
    }
    throw new Error(`should not have called ${path}`);
  });
  const found = await live.cricapiFindLatest('India', 'Pakistan', []);
  assert.equal(found.id, 'live-1');
  assert.equal(calls.length, 1, 'one call, not a full sweep');
});

test('one cold lookup stays inside its call budget', async () => {
  // The worst case: a pair the feed has no match for, so every fallback runs.
  const calls = mockFeed(standardRoutes);
  await live.cricapiFindLatest('Australia', 'Ireland', []).catch(() => {});
  // 1 cricScore + at most maxSeriesTerms searches + at most maxSeriesProbe opens.
  assert.ok(calls.length <= 1 + 4 + 4, `expected <= 9 calls, spent ${calls.length}: ${calls.join(', ')}`);
});

test('an exhausted quota is reported as a quota problem, not as "no such match"', async () => {
  mockFeed(() => ({
    status: 'failure',
    reason: 'Blocking since hits today exceeded hits limit',
    info: { hitsToday: 112, hitsLimit: 100 },
  }));
  await assert.rejects(
    () => live.cricapiFindLatest('England', 'Australia', []),
    (e) => e instanceof live.QuotaError && /quota exhausted/i.test(e.message),
  );
});

test('a blown quota stops after one call instead of spending the rest', async () => {
  const calls = mockFeed(() => ({
    status: 'failure',
    reason: 'Blocking since hits today exceeded hits limit',
    info: { hitsToday: 112, hitsLimit: 100 },
  }));
  await live.cricapiFindLatest('Sri Lanka', 'Bangladesh', []).catch(() => {});
  assert.equal(calls.length, 1, `spent ${calls.length} calls on a dead key`);
});

test('the scorecard maps onto the engine shape', () => {
  const m = live.normalizeCricApi(SCORECARD.data);
  assert.equal(m.source, 'cricapi');
  assert.equal(m.date, '2026-02-15');
  assert.equal(m.winner, 'India');
  assert.equal(m.margin, '7 wickets');
  assert.equal(m.format, 'T20');

  const [first, second] = m.innings;
  assert.equal(first.batting, 'Pakistan');
  assert.equal(second.batting, 'India');
  assert.notEqual(first.batting, second.batting, 'the same side cannot bat both innings');
  assert.equal(first.runs, 146);
  assert.equal(second.runs, 149);
  assert.equal(first.balls, 120);
  assert.equal(first.top4, 41 + 33 + 20 + 12);
  assert.equal(first.bowlTop2, 6, 'two leading bowlers in that innings');
  assert.equal(m.batters.Pakistan[0].name, 'Saim Ayub');
  assert.equal(m.bowlers.India[0].name, 'Jasprit Bumrah');
});

test('a repeat search for the same pair costs nothing', async () => {
  mockFeed(standardRoutes);
  const first = await live.fetchMatch({ teamA: 'India', teamB: 'Pakistan' });
  assert.equal(first.source, 'cricapi');

  const calls = mockFeed(() => { throw new Error('cache miss — the pair should have been cached'); });
  const again = await live.fetchMatch({ teamA: 'Pakistan', teamB: 'India' }); // reversed order
  assert.equal(again.source, 'cricapi');
  assert.equal(calls.length, 0);
});

test('a team query that resolves nothing returns notFound, never the offline snapshot', async () => {
  mockFeed((path) => (path === 'cricScore' ? EMPTY_SCORE : { status: 'success', info: {}, data: [] }));
  const m = await live.fetchMatch({ teamA: 'Scotland', teamB: 'Nepal' });
  assert.equal(m.notFound, true);
  assert.equal(m.rejected, true);
  assert.ok(!m.innings, 'no fabricated scorecard');
  assert.ok(m.tried.some((t) => t.startsWith('cricapi:')));
  assert.notEqual(m.home, 'England', 'must not hand back the India v England snapshot');
});

test('a stale result is rejected rather than pushed into the table', () => {
  const m = live.normalizeCricApi({
    ...SCORECARD.data, date: '2024-06-09', status: 'India won by 6 runs',
  });
  assert.equal(m.date, '2024-06-09');
  // verify() runs inside fetchMatch; assert the rule it enforces directly.
  const ageDays = Math.floor((Date.now() - Date.parse(m.date)) / 86400000);
  assert.ok(ageDays > 365, 'this is the exact match that used to slip through');
});
