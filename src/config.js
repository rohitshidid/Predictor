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
  // Structured cricket feed. This is the authoritative match resolver — the
  // language model is only a backup. The free plan is 100 calls/day, and one
  // lookup costs several, so every knob that limits fan-out lives here.
  cricapi: {
    key: (process.env.CRICAPI_KEY || '').trim(),
    // How many distinct series-search terms one lookup may spend calls on.
    maxSeriesTerms: num(process.env.CRICAPI_MAX_SERIES_TERMS, 4),
    // How many candidate series may be opened before giving up.
    maxSeriesProbe: num(process.env.CRICAPI_MAX_SERIES_PROBE, 4),
    ttl: {
      // The live window moves; everything else is effectively immutable.
      score: num(process.env.CRICAPI_TTL_SCORE_MS, 10 * 60 * 1000),
      series: num(process.env.CRICAPI_TTL_SERIES_MS, 24 * 3600 * 1000),
      seriesInfo: num(process.env.CRICAPI_TTL_SERIES_INFO_MS, 6 * 3600 * 1000),
      // A finished scorecard never changes again.
      scorecard: num(process.env.CRICAPI_TTL_SCORECARD_MS, 30 * 86400 * 1000),
      // A resolved "latest A v B" answer, so repeat searches are free.
      resolved: num(process.env.CRICAPI_TTL_RESOLVED_MS, 3 * 3600 * 1000),
    },
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
  hasCricApi() {
    return Boolean(this.cricapi.key);
  },
};
