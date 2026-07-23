// Interactive Power-Ranking simulator server. Dependency-free Node http.
//   GET  /                 -> the single-page app
//   GET  /api/state        -> current mode, ranking, blurbs, weights, teams
//   POST /api/simulate     -> append a match, re-rank, regenerate the 2 teams' AI summaries
//   POST /api/weights      -> live weight change, re-rank (no AI)
//   POST /api/mode         -> switch baseline|fresh (repopulates / clears), re-rank
//   POST /api/reset        -> reset current mode
//   POST /api/generate-all -> regenerate every team's AI summary
//
// The crown rule holds end to end: the engine fixes the ranking FIRST; the model
// only writes the two involved teams' prose, from numbers it cannot change.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const cfg = require('./src/config');
const { rank } = require('./src/engine');
const { blurbForTeam } = require('./src/blurbs');
const { templateBlurb } = require('./src/templates');
const sim = require('./src/simState');

const PORT = Number(process.env.PORT || 4310);
const BASE_WEIGHTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'weights.config.json'), 'utf8'));

// Live, mutable config (slider changes edit this, never the file on disk).
let config = JSON.parse(JSON.stringify(BASE_WEIGHTS));

// Blurb cache: teamName -> { text, source, audit }. Empty => template shown.
let blurbCache = {};

function currentRanking() {
  return rank(sim.getData(), config, sim.getPrevRanks());
}

// Build the full state payload the client renders. Snapshots the order so the
// NEXT action's arrows diff against this one.
function buildState(rows) {
  const ranking = rows || currentRanking();
  const blurbs = {};
  for (const r of ranking) {
    const cached = blurbCache[r.name];
    blurbs[r.name] = cached
      ? { text: cached.text, source: cached.source }
      : { text: templateBlurb(r), source: 'template' };
  }
  sim.snapshot(ranking);
  return {
    mode: sim.getMode(),
    league: sim.getData().league,
    season: sim.getData().season,
    aiConfigured: cfg.isConfigured(),
    grounding: cfg.blurb.grounding,
    minScore: cfg.blurb.minScore,
    weights: config.weights,
    optionalWeights: config.optionalWeights || {},
    enabled: config.enabled || {},
    matchCount: sim.getData().matches.length,
    teams: sim.getTeams().map((t) => ({
      name: t.name,
      short: t.short,
      squadStars: t.squadStars || 0,
      primary: (t.colors && t.colors.primary) || '#334155',
      secondary: (t.colors && t.colors.secondary) || '#94a3b8',
      logo: t.logo || null,
    })),
    ranking,
    blurbs,
  };
}

// ---- helpers ----------------------------------------------------------------
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// Validate + normalize a simulate payload into a stored match record.
function toMatch(p) {
  const need = ['home', 'away', 'winner'];
  for (const k of need) if (!p[k] || typeof p[k] !== 'string') throw new Error(`missing ${k}`);
  if (p.home === p.away) throw new Error('home and away must differ');
  if (!Array.isArray(p.innings) || p.innings.length !== 2) throw new Error('need exactly 2 innings');
  const inn = p.innings.map((i) => ({
    batting: String(i.batting),
    bowling: String(i.bowling),
    runs: Math.max(0, Math.round(+i.runs || 0)),
    balls: Math.max(1, Math.round(+i.balls || 120)),
    overs: +(+((+i.balls || 120) / 6)).toFixed(1),
    ppRuns: Math.max(0, Math.round(+i.ppRuns || 0)),
    deathRuns: Math.max(0, Math.round(+i.deathRuns || 0)),
    deathBalls: Math.max(0, Math.round(+i.deathBalls || 0)),
    // Optional-metric inputs (safe defaults if the client omits them).
    top4: Math.max(0, Math.round(+i.top4 || 0)),
    wktsLost: Math.max(0, Math.min(10, Math.round(+i.wktsLost || 0))),
    bowlTop2: Math.max(0, Math.min(10, Math.round(+i.bowlTop2 || 0))),
  }));
  return {
    home: p.home,
    away: p.away,
    venueHomeTeam: p.venueHomeTeam || p.home,
    tossWinner: p.tossWinner || p.home,
    battingFirst: p.battingFirst || inn[0].batting,
    winner: p.winner,
    innings: inn,
    stars: p.stars || {},
    significant: p.significant || {},
  };
}

async function regenerate(teamNames, significantMap = {}) {
  const ranking = currentRanking();
  for (const name of teamNames) {
    const row = ranking.find((r) => r.name === name);
    if (!row) continue;
    const b = await blurbForTeam(row, { significant: significantMap[name] || '' });
    blurbCache[name] = b;
  }
  return ranking;
}

// ---- routes -----------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      return send(res, 200, buildState());
    }

    // Serve licensed team logo files dropped into public/logos/. path.basename
    // strips any directory component, so ../ traversal can't escape the folder.
    if (req.method === 'GET' && url.pathname.startsWith('/logos/')) {
      const file = path.join(__dirname, 'public', 'logos', path.basename(url.pathname));
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        const type = {
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif',
        }[path.extname(file).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
        return res.end(fs.readFileSync(file));
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('not found');
    }

    if (req.method === 'POST' && url.pathname === '/api/mode') {
      const { mode } = await readBody(req);
      sim.setMode(mode);
      blurbCache = {}; // new season => summaries reset to templates
      return send(res, 200, buildState());
    }

    if (req.method === 'POST' && url.pathname === '/api/reset') {
      sim.reset();
      blurbCache = {};
      return send(res, 200, buildState());
    }

    if (req.method === 'POST' && url.pathname === '/api/weights') {
      const body = await readBody(req);
      if (body.weights && typeof body.weights === 'object') {
        for (const k of Object.keys(config.weights)) {
          if (typeof body.weights[k] === 'number') config.weights[k] = body.weights[k];
        }
      }
      if (body.optionalWeights && typeof body.optionalWeights === 'object') {
        config.optionalWeights = config.optionalWeights || {};
        for (const k of Object.keys(config.optionalWeights)) {
          if (typeof body.optionalWeights[k] === 'number') config.optionalWeights[k] = body.optionalWeights[k];
        }
      }
      if (body.enabled && typeof body.enabled === 'object') {
        config.enabled = config.enabled || {};
        for (const k of Object.keys(config.enabled)) {
          if (typeof body.enabled[k] === 'boolean') config.enabled[k] = body.enabled[k];
        }
      }
      return send(res, 200, buildState()); // re-rank only, blurbs untouched
    }

    if (req.method === 'POST' && url.pathname === '/api/simulate') {
      const body = await readBody(req);
      const match = toMatch(body);
      sim.appendMatch(match);
      // Regenerate ONLY the two teams that played, with their significant notes.
      await regenerate([match.home, match.away], match.significant);
      return send(res, 200, buildState());
    }

    if (req.method === 'POST' && url.pathname === '/api/generate-all') {
      const body = await readBody(req);
      const names = sim.getTeams().map((t) => t.name);
      await regenerate(names, body.significant || {});
      return send(res, 200, buildState());
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  } catch (e) {
    console.error('[server] error:', e.message);
    send(res, 400, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`[server] Power-Ranking simulator on http://localhost:${PORT}`);
  console.log(`[server] AI ${cfg.isConfigured() ? 'ENABLED' : 'DISABLED (no GEMINI_API_KEY)'} · grounding=${cfg.blurb.grounding}`);
  // Seed the baseline snapshot so the first render shows a stable order.
  sim.snapshot(currentRanking());
});
