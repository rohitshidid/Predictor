// POC orchestrator: data -> deterministic ranking -> AI blurbs (grounded) ->
// rankings.html + audit.json. Run with `npm run build`.
//
// The order is the whole point: the ranking is FINAL before any model is called.
// The model only writes prose about numbers it cannot change.
const fs = require('node:fs');
const path = require('node:path');
const cfg = require('./src/config');
const { rank } = require('./src/engine');
const { blurbForTeam } = require('./src/blurbs');
const { render } = require('./src/render');

const ROOT = __dirname;
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

async function main() {
  const data = read('data/cpl_2026.json');
  const config = read('weights.config.json');
  const lastWeek = read('data/lastweek.json').ranks || {};

  // 1. Deterministic ranking — no AI. Final order fixed here.
  const rows = rank(data, config, lastWeek);
  console.log(`[build] ranked ${rows.length} teams (deterministic).`);

  // 2. AI blurbs — one grounded call chain per team. Sequential to stay well
  //    under any rate limit; a weekly job has all the time in the world.
  if (!cfg.isConfigured()) {
    console.warn('[build] GEMINI_API_KEY not set — every blurb falls back to the deterministic template.');
  } else {
    console.log(`[build] generating blurbs via Gemini (grounding=${cfg.blurb.grounding})...`);
  }

  const blurbs = {};
  const audit = [];
  let aiCount = 0;
  for (const r of rows) {
    const b = await blurbForTeam(r);
    blurbs[r.name] = b;
    audit.push(b.audit);
    if (b.source === 'ai') aiCount++;
    console.log(`  #${String(r.rank).padStart(2)} ${r.short.padEnd(4)} [${b.source}] ${b.text}`);
  }
  console.log(`[build] ${aiCount}/${rows.length} blurbs AI-written & grounded-verified.`);

  // 3. Render + write outputs.
  const generatedAt = new Date().toISOString();
  const html = render({ data, rows, blurbs, generatedAt, aiCount });
  fs.writeFileSync(path.join(ROOT, 'rankings.html'), html);

  const auditDoc = {
    generatedAt,
    league: data.league,
    season: data.season,
    grounding: cfg.blurb.grounding,
    minScore: cfg.blurb.minScore,
    aiCount,
    teams: rows.length,
    ranking: rows.map((r) => ({
      rank: r.rank,
      team: r.name,
      delta: r.delta,
      score: +r.score.toFixed(2),
      winPct: +r.winPct.toFixed(3),
      nrr: +r.nrr.toFixed(3),
      form: +r.form.toFixed(3),
      sos: +r.sos.toFixed(3),
      blurbSource: blurbs[r.name].source,
    })),
    verdicts: audit,
  };
  fs.writeFileSync(path.join(ROOT, 'audit.json'), JSON.stringify(auditDoc, null, 2));

  console.log('[build] wrote rankings.html + audit.json');
}

main().catch((e) => {
  console.error('[build] FAILED:', e);
  process.exit(1);
});
