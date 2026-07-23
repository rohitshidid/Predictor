// Env-driven config. Mirrors champhunt-ms-contest/predictionGame/config.js:
// model/keys are path segments + env vars, nothing hardcoded. Dependency-free —
// we parse .env ourselves rather than pulling in dotenv, matching the reuse repo's
// "plain fetch, no SDKs" posture.
const fs = require('node:fs');
const path = require('node:path');

// ---- tiny .env loader (no dotenv dependency) --------------------------------
function loadDotEnv() {
  const p = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv();

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

module.exports = {
  llm: {
    geminiKey: (process.env.GEMINI_API_KEY || '').trim(),
    // Grounded verify / critic — judgement, full model.
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    // Prose generation — cheap, high volume. Falls back to the full model.
    ingestModel:
      process.env.GEMINI_INGEST_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
    timeoutMs: num(process.env.LLM_TIMEOUT_MS, 90000),
  },
  blurb: {
    // Minimum critic score (0-10) a blurb must reach to publish as-is.
    minScore: num(process.env.BLURB_MIN_SCORE, 8),
    // "stats" grounds a blurb against the POC dataset (source of truth for a
    // synthetic season). "web" grounds against live Google Search — the crown-jewel
    // check from searchLLM.js, meaningful only once real match data is wired.
    grounding: (process.env.BLURB_GROUNDING || 'stats').trim(),
  },
  isConfigured() {
    return Boolean(this.llm.geminiKey);
  },
};
