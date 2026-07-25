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

// Run `fn` only on a miss, then store its result.
async function through(ns, key, ttl, fn) {
  const hit = get(ns, key);
  if (hit !== undefined) return { data: hit, cached: true };
  const data = await fn();
  set(ns, key, data, ttl);
  return { data, cached: false };
}

// Drop everything. Used by tests, and by hand when a bad response got stored.
function clear() {
  mem.clear();
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* nothing to drop */ }
}

module.exports = { get, set, through, clear, ROOT };
