// Renders the ranked table to a single self-contained rankings.html — the demo
// artifact. Looks like the real product (numbered list, movement arrows, blurbs)
// but runs off the fixed dataset. Theme-aware, no external assets.

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function arrow(r) {
  if (r.movement === 'up') return `<span class="mv up">▲${r.delta}</span>`;
  if (r.movement === 'down') return `<span class="mv down">▼${Math.abs(r.delta)}</span>`;
  if (r.movement === 'same') return `<span class="mv same">—</span>`;
  return `<span class="mv new">NEW</span>`;
}

function nrrFmt(n) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
}

function row(r, blurb) {
  const badge =
    blurb.source === 'ai'
      ? `<span class="src ai" title="AI-written, grounded-verified">AI ✓</span>`
      : `<span class="src tpl" title="Deterministic template (AI blurb did not clear the bar)">TEMPLATE</span>`;
  return `
  <li class="team">
    <div class="rank">${r.rank}</div>
    <div class="body">
      <div class="head">
        <span class="name">${esc(r.name)}</span>
        <span class="short">${esc(r.short)}</span>
        ${arrow(r)}
        ${badge}
      </div>
      <p class="blurb">${esc(blurb.text)}</p>
      <div class="stats">
        <span><b>${r.won}-${r.lost}</b> W-L</span>
        <span><b>${Math.round(r.winPct * 100)}%</b> win</span>
        <span><b>${nrrFmt(r.rollingNRR)}</b> rNRR</span>
        <span><b>${r.formRecord.wins}/${r.formRecord.of}</b> form</span>
        <span><b>${r.score.toFixed(1)}</b> score</span>
      </div>
    </div>
  </li>`;
}

function render({ data, rows, blurbs, generatedAt, aiCount }) {
  const items = rows.map((r) => row(r, blurbs[r.name])).join('');
  const title = `${data.league} Power Rankings — Week of ${new Date(generatedAt).toISOString().slice(0, 10)}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root {
    --bg:#f6f7f9; --card:#fff; --ink:#12151a; --muted:#5b6472; --line:#e5e8ec;
    --up:#12864f; --down:#c0392b; --accent:#0b5cff; --chip:#eef1f5;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0d1015; --card:#161a21; --ink:#eef1f5; --muted:#98a2b3; --line:#252b34;
            --up:#37d391; --down:#ff6b5e; --accent:#5b8cff; --chip:#1f2530; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .wrap { max-width:760px; margin:0 auto; padding:32px 18px 64px; }
  header h1 { font-size:26px; margin:0 0 4px; letter-spacing:-.02em; }
  header .sub { color:var(--muted); font-size:13px; margin-bottom:24px; }
  ol { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:12px; }
  .team { display:flex; gap:16px; background:var(--card); border:1px solid var(--line);
    border-radius:14px; padding:16px 18px; }
  .rank { font-size:30px; font-weight:800; min-width:38px; text-align:center; color:var(--accent);
    font-variant-numeric:tabular-nums; }
  .body { flex:1; min-width:0; }
  .head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .name { font-weight:700; font-size:16px; }
  .short { color:var(--muted); font-size:12px; letter-spacing:.05em; }
  .mv { font-size:12px; font-weight:700; padding:1px 7px; border-radius:20px; background:var(--chip); }
  .mv.up { color:var(--up); } .mv.down { color:var(--down); } .mv.same { color:var(--muted); }
  .mv.new { color:var(--accent); }
  .src { margin-left:auto; font-size:10px; font-weight:700; letter-spacing:.04em;
    padding:2px 7px; border-radius:6px; }
  .src.ai { color:var(--up); background:color-mix(in srgb, var(--up) 14%, transparent); }
  .src.tpl { color:var(--muted); background:var(--chip); }
  .blurb { margin:8px 0 10px; }
  .stats { display:flex; flex-wrap:wrap; gap:14px; font-size:12px; color:var(--muted);
    font-variant-numeric:tabular-nums; }
  .stats b { color:var(--ink); }
  footer { margin-top:28px; color:var(--muted); font-size:12px; text-align:center; }
  footer code { background:var(--chip); padding:1px 5px; border-radius:4px; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>${esc(data.league)} — Power Rankings</h1>
      <div class="sub">Season ${esc(data.season)} · generated ${esc(new Date(generatedAt).toUTCString())} ·
        ${aiCount}/${rows.length} blurbs AI-written &amp; grounded-verified</div>
    </header>
    <ol>${items}
    </ol>
    <footer>
      Ranking computed deterministically from match data (win%, NRR, form, strength of schedule).
      The model writes only the prose. Weights in <code>weights.config.json</code>. Audit trail in <code>audit.json</code>.
    </footer>
  </div>
</body>
</html>`;
}

module.exports = { render };
