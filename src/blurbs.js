// AI blurb layer — the model writes prose, and NOTHING else. It never sees or
// influences the rank; it is handed the finished numbers and asked for one or two
// sentences. Ported from the prediction game's proven pattern:
//   - generation transport         -> llm.js geminiGenerate (flash-lite, JSON mode)
//   - grounded verify / self-critic -> searchLLM.js generateGrounded (flash + search)
//
// Pipeline per team:  generate -> grounded critic -> (regenerate once) -> publish
//                     or fall back to the deterministic template.
// Every verdict (score, unsupported claims, sources) is logged for the editor
// audit trail — the same thing that lets an editor sign off before syndication.
const cfg = require('./config');
const { factSheet, templateBlurb } = require('./templates');

const GEMINI_URL = (model, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

function fetchWithTimeout(url, opts, ms) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
}

function extractJson(text) {
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : String(text);
  const s = candidate.indexOf('{');
  const e = candidate.lastIndexOf('}');
  if (s === -1 || e === -1 || e < s) throw new Error(`no JSON in model reply: ${String(text).slice(0, 160)}`);
  return JSON.parse(candidate.slice(s, e + 1));
}

// ---- transports -------------------------------------------------------------
// Plain generation (JSON mode). Cheap model, no grounding. Mirrors llm.js.
async function geminiGenerate(prompt) {
  const key = cfg.llm.geminiKey;
  if (!key) throw new Error('GEMINI_API_KEY not set');
  const res = await fetchWithTimeout(
    GEMINI_URL(cfg.llm.ingestModel, key),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.5, responseMimeType: 'application/json' },
      }),
    },
    cfg.llm.timeoutMs
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(data.error && data.error.message) || ''}`.trim());
  const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
  return (parts || []).map((p) => p.text || '').join('');
}

// Grounded generation (full model + Google Search). NOTE: forced-JSON is NOT set
// here — Gemini rejects responseMimeType together with search tools, so we parse
// JSON out of the text. Quirk kept verbatim from searchLLM.js.
async function generateGrounded(prompt) {
  const key = cfg.llm.geminiKey;
  if (!key) throw new Error('GEMINI_API_KEY not set');
  const base = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2 } };
  const call = async (tools) => {
    const res = await fetchWithTimeout(
      GEMINI_URL(cfg.llm.geminiModel, key),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...base, tools }) },
      cfg.llm.timeoutMs
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`gemini ${res.status}: ${(data.error && data.error.message) || ''}`.trim());
    return data;
  };
  let data;
  try {
    data = await call([{ google_search: {} }]);
  } catch (e) {
    if (/tool|google_search|INVALID_ARGUMENT|400/i.test(e.message)) data = await call([{ google_search_retrieval: {} }]);
    else throw e;
  }
  const cand = data.candidates && data.candidates[0];
  const text = ((cand && cand.content && cand.content.parts) || []).map((p) => p.text || '').join('');
  const gm = (cand && cand.groundingMetadata) || {};
  const sources = (gm.groundingChunks || []).map((c) => c.web && c.web.uri).filter(Boolean);
  return { text, sources };
}

// ---- prompts ----------------------------------------------------------------
// `sig` = the "something significant" text the editor typed for this team's latest
// match. It is AUTHORIZED context (a stated fact) the model may weave in as colour.
const GENERATE_PROMPT = (f, sig) => `You write ONE power-ranking blurb for a T20 cricket team, in the punchy style of ESPN/CBS Sports power rankings. Return JSON only, no prose.

You are given the FINAL numbers. You do NOT decide the rank — it is already ${f.rank}. Write about WHY the team sits there.

Team: ${f.team}
Rank this week: ${f.rank} (${f.movement})
Record: ${f.record} (${f.winPct} wins) over ${f.played} matches
Rolling NRR (last 5): ${f.rollingNRR} (${f.nrrTrend})
Recent form: ${f.form}
Current streak: ${f.streak}
Win quality: ${f.winQuality}
Powerplay: ${f.powerplay}
Death overs: ${f.death}
Home/away: ${f.homeAway}
Squad: ${f.stars}
${sig ? `\nSomething significant from their latest match (given as TRUE — weave it in naturally as the lead colour): "${sig}"\n` : ''}
HARD RULES:
- 1 to 2 sentences, max ~45 words. No emojis, no hashtags.
- Use ONLY the numbers above${sig ? ' and the significant event' : ''}. Do NOT invent scores, player names, dates, or other facts.
- Do NOT state a different rank or record than given.
- ${sig ? 'Lead with the significant event, then back it with a number.' : 'Lead with the movement or the streak if there is one.'}

JSON schema: {"blurb": string}`;

// Grounded critic. In "stats" mode the authoritative source is the fact sheet
// itself (correct for a synthetic season). In "web" mode it becomes the live
// Google-Search check — the crown jewel — meaningful once real data is wired.
const CRITIC_PROMPT = (blurb, f, mode, sig) => `You are an editor vetting a T20 power-ranking blurb before publication. Return JSON only.

Blurb: "${blurb}"

Authoritative facts about ${f.team}:
- Rank: ${f.rank} (${f.movement})
- Record: ${f.record} (${f.winPct} wins), ${f.played} matches
- Rolling NRR: ${f.rollingNRR} (${f.nrrTrend})
- Recent form: ${f.form}
- Streak: ${f.streak}
- Win quality: ${f.winQuality}; Powerplay: ${f.powerplay}; Death: ${f.death}
- Home/away: ${f.homeAway}; Squad: ${f.stars}
${sig ? `- Given TRUE match event (do NOT flag as unsupported): "${sig}"\n` : ''}${mode === 'web' ? '\nAlso SEARCH THE WEB to confirm no factual claim contradicts reality.\n' : ''}
Check the blurb:
1. Does every factual claim match the authoritative facts above${sig ? ' or the given event' : ''}${mode === 'web' ? ' and the web' : ''}?
2. Does it state the WRONG rank or record? (automatic fail)
3. Is it well-written and punchy for a public power ranking?

List any claim NOT supported by the facts (ignore the given event — it is true). Then score 0-10:
  0-4  = states a wrong/unsupported fact
  5-7  = accurate but dull or clumsy
  8-10 = accurate, crisp, publishable

JSON schema: {"score":<0-10>,"unsupported":[string],"reasoning":"one sentence"}`;

// ---- validation -------------------------------------------------------------
function asBlurb(o) {
  if (typeof o.blurb !== 'string' || o.blurb.trim().length < 8) throw new Error('bad blurb');
  return o.blurb.trim();
}
function asVerdict(o) {
  const score = typeof o.score === 'number' && o.score >= 0 && o.score <= 10 ? Math.round(o.score) : null;
  const unsupported = Array.isArray(o.unsupported) ? o.unsupported.map(String).slice(0, 5) : [];
  return { score, unsupported, reasoning: String(o.reasoning || '').slice(0, 300) };
}

async function tryTwice(fn) {
  let last;
  for (let i = 0; i < 2; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

// Generate + grounded-verify one team's blurb. Always resolves — falls back to
// the deterministic template rather than throwing, so the render never breaks.
// `opts.significant` = the editor's "something significant" note for this team's
// latest match (authorized colour). Returns { text, source, audit }.
async function blurbForTeam(row, opts = {}) {
  const sig = (opts.significant || '').trim().slice(0, 240);
  const f = factSheet(row);
  const template = templateBlurb(row);
  const audit = { team: row.name, rank: row.rank, attempts: [], grounding: cfg.blurb.grounding, significant: sig || null };

  if (!cfg.isConfigured()) {
    audit.result = 'no-key';
    return { text: template, source: 'template', audit };
  }

  let best = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let blurb;
    try {
      blurb = await tryTwice(async () => asBlurb(extractJson(await geminiGenerate(GENERATE_PROMPT(f, sig)))));
    } catch (e) {
      audit.attempts.push({ attempt, error: `generate: ${e.message}` });
      break;
    }

    let verdict;
    let sources = [];
    try {
      if (cfg.blurb.grounding === 'web') {
        const g = await generateGrounded(CRITIC_PROMPT(blurb, f, 'web', sig));
        verdict = asVerdict(extractJson(g.text));
        sources = g.sources;
      } else {
        verdict = await tryTwice(async () => asVerdict(extractJson(await geminiGenerate(CRITIC_PROMPT(blurb, f, 'stats', sig)))));
      }
    } catch (e) {
      audit.attempts.push({ attempt, blurb, error: `verify: ${e.message}` });
      // A blurb we couldn't verify is not trusted — keep as a candidate only if
      // nothing better exists, but never mark it published.
      best = best || { blurb, score: null };
      continue;
    }

    audit.attempts.push({ attempt, blurb, score: verdict.score, unsupported: verdict.unsupported, reasoning: verdict.reasoning, sources });

    const clean = verdict.unsupported.length === 0;
    if (verdict.score != null && verdict.score >= cfg.blurb.minScore && clean) {
      audit.result = 'ai-published';
      return { text: blurb, source: 'ai', audit };
    }
    if (!best || (verdict.score || 0) > (best.score || 0)) best = { blurb, score: verdict.score };
    // else loop and regenerate once.
  }

  // Nothing cleared the bar — the safe, always-true template wins.
  audit.result = 'template-fallback';
  return { text: template, source: 'template', audit };
}

module.exports = { blurbForTeam, geminiGenerate, generateGrounded };
