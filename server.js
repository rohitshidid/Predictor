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
const { fetchMatch, providerName, quotaState, clearCache, cacheStats } = require('./src/liveMatch');
const store = require('./src/checkpoints');
const { buildSitePayload } = require('./src/publish');

const PORT = Number(process.env.PORT || 4310);
const BASE_WEIGHTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'weights.config.json'), 'utf8'));

// Live, mutable config (slider changes edit this, never the file on disk).
let config = JSON.parse(JSON.stringify(BASE_WEIGHTS));

// Blurb cache: teamName -> { text, source, audit }. Empty => template shown.
let blurbCache = {};

// Editorial fields the engine cannot derive — which week this is, the hero
// sentence, the next fixture. They ride along in checkpoints so restoring a
// Tuesday file brings back Tuesday's week number too.
const DEFAULT_SITE_META = {
  site: 'cplxch',
  week: 1,
  weekLabel: '',
  headline: '',
  subhead: '',
  region: '',
  workedExampleAbbr: '',
  nextMatch: null, // { iso, home, away, venue }
};
let siteMeta = { ...DEFAULT_SITE_META };

// Only accept the fields we know about, and coerce them — this payload comes
// straight from a browser form.
function mergeSiteMeta(patch) {
  if (!patch || typeof patch !== 'object') return siteMeta;
  const next = { ...siteMeta };
  if (patch.week != null) next.week = Math.max(1, Math.min(52, Math.round(+patch.week) || 1));
  for (const k of ['site', 'weekLabel', 'headline', 'subhead', 'region', 'workedExampleAbbr']) {
    if (typeof patch[k] === 'string') next[k] = patch[k].trim().slice(0, 240);
  }
  if (patch.nextMatch === null) next.nextMatch = null;
  else if (patch.nextMatch && typeof patch.nextMatch === 'object') {
    const iso = String(patch.nextMatch.iso || '').trim();
    next.nextMatch = iso
      ? {
          iso,
          home: String(patch.nextMatch.home || '').slice(0, 60),
          away: String(patch.nextMatch.away || '').slice(0, 60),
          venue: String(patch.nextMatch.venue || '').slice(0, 60),
        }
      : null;
  }
  siteMeta = next;
  return siteMeta;
}

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
    // Without this key the match search falls back to grounded model search,
    // which is materially less reliable — the UI says so up front rather than
    // letting the operator discover it from a rejected fetch.
    cricapiConfigured: cfg.hasCricApi(),
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

// ---- checkpoints ------------------------------------------------------------
// Everything needed to reproduce today's table. The match list is the source of
// truth — the engine re-derives every figure from it — so a checkpoint cannot
// drift from the table it was taken from.
function buildCheckpoint() {
  const ranking = currentRanking();
  return {
    kind: 'power-rankings-checkpoint',
    version: 1,
    savedAt: new Date().toISOString(),
    league: sim.getData().league,
    leagueShort: sim.getData().leagueShort,
    season: sim.getData().season,
    mode: sim.getMode(),
    matchCount: sim.getData().matches.length,
    data: sim.getData(),
    config: { weights: config.weights, optionalWeights: config.optionalWeights, enabled: config.enabled },
    blurbs: blurbCache,
    prevRanks: sim.getPrevRanks(),
    siteMeta,
    // Read-only copy of the table as it stood — for audit, not for restore.
    ranking: ranking.map((r) => ({ rank: r.rank, team: r.name, score: +r.score.toFixed(2), won: r.won, lost: r.lost })),
  };
}

// The website's copy of today's table. Same ranked rows as the graphic — only
// the shape differs (derived figures instead of the match list).
function buildPublishPayload() {
  return buildSitePayload({
    data: sim.getData(),
    config,
    blurbs: blurbCache,
    prevRanks: sim.getPrevRanks(),
    meta: siteMeta,
  });
}

function restoreCheckpoint(cp) {
  if (!cp || !cp.data) throw new Error('not a checkpoint file — expected a "data" object');
  if (cp.kind && cp.kind !== 'power-rankings-checkpoint') throw new Error(`unrecognised file kind: ${cp.kind}`);
  sim.loadData(cp.data, cp.mode, cp.prevRanks);
  if (cp.config && typeof cp.config === 'object') {
    if (cp.config.weights) for (const k of Object.keys(config.weights)) {
      if (typeof cp.config.weights[k] === 'number') config.weights[k] = cp.config.weights[k];
    }
    if (cp.config.optionalWeights) for (const k of Object.keys(config.optionalWeights || {})) {
      if (typeof cp.config.optionalWeights[k] === 'number') config.optionalWeights[k] = cp.config.optionalWeights[k];
    }
    if (cp.config.enabled) for (const k of Object.keys(config.enabled || {})) {
      if (typeof cp.config.enabled[k] === 'boolean') config.enabled[k] = cp.config.enabled[k];
    }
  }
  blurbCache = (cp.blurbs && typeof cp.blurbs === 'object') ? cp.blurbs : {};
  // Older checkpoints predate siteMeta — those restore to the defaults rather
  // than inheriting whatever week the server happened to be on.
  siteMeta = { ...DEFAULT_SITE_META };
  mergeSiteMeta(cp.siteMeta);
  // buildState renders the arrows against the checkpoint's saved prevRanks, then
  // snapshots the restored order so the NEXT action diffs against it.
  return buildState();
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

    // Pull a finished match and return it normalized. GET (no body) uses the
    // keyless live ESPN default; POST { teamA, teamB, links } resolves the latest
    // match between two teams and reads any pasted links via Gemini grounding.
    if (url.pathname === '/api/fetch-match' && (req.method === 'GET' || req.method === 'POST')) {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const id = url.searchParams.get('id') || (body.id || '');
      const teamA = String(body.teamA || '').trim().slice(0, 60);
      const teamB = String(body.teamB || '').trim().slice(0, 60);
      const links = Array.isArray(body.links) ? body.links.map((l) => String(l).trim()).filter(Boolean).slice(0, 10) : [];
      // `refresh` bypasses every cached response for this one lookup, so a
      // re-search after the feed has moved on genuinely re-searches.
      const match = await fetchMatch({ id, teamA, teamB, links, refresh: !!body.refresh });
      return send(res, 200, {
        provider: providerName(),
        cricapiConfigured: cfg.hasCricApi(),
        quota: quotaState(),
        match,
      });
    }

    // Drop every cached provider response so the next search runs completely
    // cold. The cache exists to protect a 100-calls-a-day plan, but a cache the
    // operator cannot clear is a cache that eventually lies to them.
    if (req.method === 'POST' && url.pathname === '/api/cache/clear') {
      const dropped = clearCache();
      return send(res, 200, { cleared: dropped.total, namespaces: dropped.namespaces });
    }

    if (req.method === 'GET' && url.pathname === '/api/cache/stats') {
      return send(res, 200, cacheStats());
    }

    // The browser cannot list a directory, so the backdrop stills available for
    // the broadcast-frame export are enumerated here. Drop a still into
    // public/backgrounds/ and it appears in the picker on the next load.
    if (req.method === 'GET' && url.pathname === '/api/backgrounds') {
      const dir = path.join(__dirname, 'public', 'backgrounds');
      let files = [];
      try {
        files = fs.readdirSync(dir)
          .filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && fs.statSync(path.join(dir, f)).isFile())
          .sort();
      } catch { files = []; }   // folder absent is normal, not an error
      return send(res, 200, { files });
    }

    // Serve drop-in artwork: licensed team logos and branding marks from
    // public/logos/, broadcast backdrop stills from public/backgrounds/. The
    // folder is matched against a fixed list rather than taken from the URL, and
    // path.basename strips any directory component, so ../ traversal can't
    // escape either folder.
    const assetDir = /^\/(logos|backgrounds)\//.exec(url.pathname);
    if (req.method === 'GET' && assetDir) {
      // Decode before resolving: a filename containing a space arrives as
      // %20 and would never match the file on disk. basename still runs after
      // decoding, so ../ traversal cannot escape the folder.
      let requested;
      try { requested = decodeURIComponent(url.pathname); } catch { requested = url.pathname; }
      const file = path.join(__dirname, 'public', assetDir[1], path.basename(requested));
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

    // ---- daily checkpoints --------------------------------------------------
    // GET  returns everything needed to reproduce today's table exactly.
    // POST restores one. The match list is the source of truth; the engine
    // re-derives every figure from it, so a restored checkpoint cannot drift
    // from the table that produced it.
    // List what the server has kept.
    if (req.method === 'GET' && url.pathname === '/api/checkpoints') {
      return send(res, 200, { dir: store.dir(), items: store.list() });
    }

    // Save to disk AND hand the same document back for download.
    if (req.method === 'POST' && url.pathname === '/api/checkpoint/save') {
      const cp = buildCheckpoint();
      const file = store.save(cp);
      return send(res, 200, { file, dir: store.dir(), checkpoint: cp });
    }

    // Restore one the server already holds.
    if (req.method === 'POST' && url.pathname === '/api/checkpoint/restore') {
      const { file } = await readBody(req);
      if (!file) throw new Error('missing "file"');
      return send(res, 200, restoreCheckpoint(store.read(file)));
    }

    if (req.method === 'POST' && url.pathname === '/api/checkpoint/delete') {
      const { file } = await readBody(req);
      if (!file) throw new Error('missing "file"');
      store.remove(file);
      return send(res, 200, { ok: true, items: store.list() });
    }

    if (req.method === 'GET' && url.pathname === '/api/checkpoint') {
      return send(res, 200, buildCheckpoint());
    }

    // ---- website publish ----------------------------------------------------
    // The flat, derived view of the same table that cplxch's /admin ingests.
    // GET  returns the current meta + payload; POST sets the meta first, so the
    // "Export for website" button is a single round trip.
    if (req.method === 'GET' && url.pathname === '/api/publish') {
      return send(res, 200, { meta: siteMeta, payload: buildPublishPayload() });
    }

    if (req.method === 'POST' && url.pathname === '/api/publish') {
      mergeSiteMeta(await readBody(req));
      return send(res, 200, { meta: siteMeta, payload: buildPublishPayload() });
    }

    if (req.method === 'POST' && url.pathname === '/api/checkpoint') {
      return send(res, 200, restoreCheckpoint(await readBody(req)));
    }

    // Undo the last match. The summaries for the two sides involved described a
    // match that no longer exists, so they are dropped back to the deterministic
    // template rather than left describing deleted data.
    if (req.method === 'POST' && url.pathname === '/api/undo-match') {
      const removed = sim.undoLastMatch();
      if (!removed) throw new Error('no matches to undo');
      for (const t of [removed.home, removed.away]) delete blurbCache[t];
      const state = buildState();
      state.undone = { home: removed.home, away: removed.away, winner: removed.winner };
      return send(res, 200, state);
    }

    // Clear every match, keeping the teams and mode. Restoring a checkpoint
    // afterwards brings the count back to exactly what that file holds.
    if (req.method === 'POST' && url.pathname === '/api/clear-matches') {
      const cleared = sim.clearMatches();
      blurbCache = {};
      const state = buildState();
      state.cleared = cleared;
      return send(res, 200, state);
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
  console.log(`[server] match search: CricAPI ${cfg.hasCricApi() ? 'ENABLED' : 'DISABLED (no CRICAPI_KEY — set it in .env)'}`);
  // Seed the baseline snapshot so the first render shows a stable order.
  sim.snapshot(currentRanking());
});
