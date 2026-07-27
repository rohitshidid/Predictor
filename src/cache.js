// Disk-backed TTL cache. Dependency-free, JSON files under `.cache/`.
//
// Why disk and not just memory: the cricket feed is on a 100-calls-a-day plan and
// one match lookup costs several calls. An in-memory cache is wiped by every
// server restart, so a day of ordinary development can burn the whole quota
// before lunch. Persisting means a finished scorecard is fetched exactly once,
// ever, and a repeated "India v Pakistan" search costs nothing.
//
// Entries are plain JSON: { at, ttl, data }. A corrupt or unreadable file is
// treated as a miss, never as an error — the cache must never be able to break a
// request.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Overridable so tests get a throwaway directory instead of poisoning (or being
// poisoned by) the real one.
const ROOT = process.env.CACHE_DIR || path.join(__dirname, '..', '.cache');

function fileFor(ns, key) {
  const hash = crypto.createHash('sha1').update(String(key)).digest('hex').slice(0, 32);
  return path.join(ROOT, ns, `${hash}.json`);
}

// In-process mirror, so a hot key does not hit the filesystem repeatedly.
const mem = new Map();

function get(ns, key) {
  const memKey = `${ns}::${key}`;
  const hit = mem.get(memKey);
  if (hit) {
    if (Date.now() - hit.at < hit.ttl) return hit.data;
    mem.delete(memKey);
  }
  try {
    const raw = fs.readFileSync(fileFor(ns, key), 'utf8');
    const entry = JSON.parse(raw);
    if (!entry || typeof entry.at !== 'number') return undefined;
    if (Date.now() - entry.at >= entry.ttl) return undefined;
    mem.set(memKey, entry);
    return entry.data;
  } catch {
    return undefined;
  }
}

function set(ns, key, data, ttl) {
  const entry = { at: Date.now(), ttl, data };
  mem.set(`${ns}::${key}`, entry);
  try {
    const file = fileFor(ns, key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(entry));
  } catch {
    // A read-only or full disk is not a reason to fail the request — the
    // in-memory copy still serves this process.
  }
  return data;
}

// When an entry was written, or null if it is not cached. Lets a caller tell the
// operator "this answer is 40 minutes old" instead of presenting stale data as
// if it were fresh.
function ageOf(ns, key) {
  const memKey = `${ns}::${key}`;
  const hit = mem.get(memKey);
  if (hit && Date.now() - hit.at < hit.ttl) return Date.now() - hit.at;
  try {
    const entry = JSON.parse(fs.readFileSync(fileFor(ns, key), 'utf8'));
    if (!entry || typeof entry.at !== 'number') return null;
    const age = Date.now() - entry.at;
    return age < entry.ttl ? age : null;
  } catch {
    return null;
  }
}

// Run `fn` only on a miss, then store its result. `bypass` forces a live call
// and refreshes the entry — the escape hatch for "I know this is stale".
async function through(ns, key, ttl, fn, bypass = false) {
  if (!bypass) {
    const age = ageOf(ns, key);
    const hit = get(ns, key);
    if (hit !== undefined) return { data: hit, cached: true, age };
  }
  const data = await fn();
  set(ns, key, data, ttl);
  return { data, cached: false, age: 0 };
}

// How many entries are stored, per namespace.
function stats() {
  const out = { total: 0, namespaces: {} };
  try {
    for (const ns of fs.readdirSync(ROOT)) {
      const dir = path.join(ROOT, ns);
      if (!fs.statSync(dir).isDirectory()) continue;
      const n = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length;
      out.namespaces[ns] = n;
      out.total += n;
    }
  } catch { /* no cache directory yet */ }
  return out;
}

// Drop everything, and report what was dropped. This is the operator's answer to
// "the feed has moved on but I keep getting the stored result" — the next search
// then runs completely cold.
function clear() {
  const before = stats();
  mem.clear();
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* nothing to drop */ }
  return before;
}

module.exports = { get, set, through, clear, stats, ageOf, ROOT };
