// Server-side checkpoint store.
//
// One JSON per save, kept on disk under checkpoints/ so the machine holds a
// running history of daily patches independently of whatever the operator
// downloaded. Filenames carry the date and time, so the directory listing is
// the history: <league>-checkpoint-YYYY-MM-DD_HHMMSS.json
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DIR = process.env.CHECKPOINT_DIR
  ? path.resolve(process.env.CHECKPOINT_DIR)
  : path.join(__dirname, '..', 'checkpoints');

// Only ever accept a plain filename we generated — never a path from a client.
const SAFE = /^[a-z0-9][a-z0-9._-]*\.json$/i;

function ensureDir() {
  fs.mkdirSync(DIR, { recursive: true });
  return DIR;
}

const two = (n) => String(n).padStart(2, '0');
function stamp(d = new Date()) {
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
    + `_${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
}

function slug(s) {
  return String(s || 'power').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'power';
}

// Write a checkpoint. Returns the filename actually used.
function save(checkpoint) {
  ensureDir();
  const league = slug(checkpoint.leagueShort || checkpoint.league);
  const when = checkpoint.savedAt ? new Date(checkpoint.savedAt) : new Date();
  let name = `${league}-checkpoint-${stamp(when)}.json`;
  // Two saves inside the same second must not clobber each other.
  let n = 2;
  while (fs.existsSync(path.join(DIR, name))) {
    name = `${league}-checkpoint-${stamp(when)}-${n++}.json`;
  }
  fs.writeFileSync(path.join(DIR, name), JSON.stringify(checkpoint, null, 2));
  return name;
}

// Newest first, with just enough detail for the operator to pick one.
function list() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR)
    .filter((f) => f.toLowerCase().endsWith('.json'))
    .map((f) => {
      const p = path.join(DIR, f);
      const st = fs.statSync(p);
      let savedAt = null, matchCount = null, league = null;
      try {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        savedAt = j.savedAt || null;
        matchCount = typeof j.matchCount === 'number' ? j.matchCount : null;
        league = j.leagueShort || j.league || null;
      } catch { /* unreadable file still gets listed, flagged by nulls */ }
      return { file: f, bytes: st.size, modified: st.mtime.toISOString(), savedAt, matchCount, league };
    })
    .sort((a, b) => new Date(b.savedAt || b.modified) - new Date(a.savedAt || a.modified));
}

function read(file) {
  if (!SAFE.test(file)) throw new Error('bad checkpoint filename');
  const p = path.join(DIR, path.basename(file));
  if (!fs.existsSync(p)) throw new Error(`no such checkpoint: ${file}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function remove(file) {
  if (!SAFE.test(file)) throw new Error('bad checkpoint filename');
  const p = path.join(DIR, path.basename(file));
  if (fs.existsSync(p)) fs.unlinkSync(p);
  return true;
}

module.exports = { save, list, read, remove, dir: () => DIR, stamp };
