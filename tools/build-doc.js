// Builds the print deliverables from power-rankings-explained.md:
//   power-rankings-explained.html  (styled, self-contained)
//   power-rankings-explained.pdf   (Letter, <= 2 pages, via headless Chromium)
//   power-rankings-explained.docx  (real Word tables/styles, written directly)
//
// The markdown is the single source of truth, and BOTH outputs render from one
// parsed document, so the PDF and the Word file can never drift apart.
// LibreOffice's HTML import filter is unavailable in this image, so the .docx is
// emitted as WordprocessingML and zipped rather than converted.
//
// Run: npm run doc
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
// Defaults to the parameter write-up; pass a markdown path to build any other
// document through the same pipeline (`node tools/build-doc.js cpl-2025.md`).
const SRC = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'power-rankings-explained.md');
const BASE = path.basename(SRC, '.md');

// Layout knobs — tuned so the document lands on exactly two Letter pages.
const PT = 8.55;          // body size (pt)
const LEAD = 1.36;        // line-height multiplier
const MARGIN_MM = 11;     // page margin
const COLS = [0.045, 0.25, 0.565, 0.14]; // table column widths (fractions)

// ---- parse markdown into blocks ---------------------------------------------
function parseInline(s) {
  const out = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ t: s.slice(last, m.index) });
    if (m[1]) out.push({ t: m[1].slice(1, -1), code: true });
    else if (m[2]) out.push({ t: m[2].slice(2, -2), bold: true });
    else out.push({ t: m[3].slice(1, -1), italic: true });
    last = re.lastIndex;
  }
  if (last < s.length) out.push({ t: s.slice(last) });
  return out;
}

const splitRow = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

function parse(md) {
  const lines = md.split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      blocks.push({ type: 'pre', text: buf.join('\n') });
      continue;
    }
    if (/^\|/.test(line) && /^\|[\s:|-]+\|?$/.test(lines[i + 1] || '')) {
      const head = splitRow(line).map(parseInline); i += 2;
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(splitRow(lines[i++]).map(parseInline));
      blocks.push({ type: 'table', head, rows });
      continue;
    }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { blocks.push({ type: 'h', level: m[1].length, runs: parseInline(m[2]) }); i++; continue; }
    if (/^---+\s*$/.test(line)) { blocks.push({ type: 'hr' }); i++; continue; }
    if (/^\s*$/.test(line)) { i++; continue; }
    if (/^-\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^-\s+/.test(lines[i])) {
        let text = lines[i++].replace(/^-\s+/, '');
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) text += ' ' + lines[i++].trim();
        items.push(parseInline(text));
      }
      blocks.push({ type: 'ul', items });
      continue;
    }
    const buf = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^[-#|`]/.test(lines[i])) buf.push(lines[i++]);
    if (buf.length) {
      let text = buf.join(' ').trim();
      // A whole paragraph wrapped in single asterisks is the standfirst/footer
      // note. Strip the outer pair FIRST, otherwise the inline pass cannot see
      // the **bold** and `code` nested inside it and the asterisks leak through.
      const note = /^\*[^*].*\*$/.test(text) && !/^\*\*/.test(text);
      if (note) text = text.slice(1, -1).trim();
      blocks.push({ type: 'p', runs: parseInline(text), note });
    }
  }
  return blocks;
}

// ---- HTML renderer (drives the PDF) -----------------------------------------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const runsToHtml = (runs) => runs.map((r) => {
  const t = esc(r.t);
  if (r.code) return `<code>${t}</code>`;
  if (r.bold) return `<strong>${t}</strong>`;
  if (r.italic) return `<em>${t}</em>`;
  return t;
}).join('');

function toHtml(blocks) {
  return blocks.map((b) => {
    switch (b.type) {
      case 'h': return `<h${b.level}>${runsToHtml(b.runs)}</h${b.level}>`;
      case 'p': return b.note
        ? `<p class="note"><em>${runsToHtml(b.runs)}</em></p>`
        : `<p>${runsToHtml(b.runs)}</p>`;
      case 'ul': return `<ul>${b.items.map((it) => `<li>${runsToHtml(it)}</li>`).join('')}</ul>`;
      case 'pre': return `<pre><code>${esc(b.text)}</code></pre>`;
      case 'hr': return '<hr>';
      case 'table': {
        // Same widths the .docx uses, so the two outputs stay in step.
        const tuned = isTuned(b);
        const cw = tuned ? COLS : contentFracs(b);
        const cg = `<colgroup>${cw.map((w) => `<col style="width:${(w * 100).toFixed(1)}%">`).join('')}</colgroup>`;
        const cls = (n) => (tuned ? ` class="c${n}"` : '');
        const th = b.head.map((h, n) => `<th${cls(n)}>${runsToHtml(h)}</th>`).join('');
        const tb = b.rows.map((r) => `<tr>${r.map((c, n) => `<td${cls(n)}>${runsToHtml(c)}</td>`).join('')}</tr>`).join('');
        return `<table>${cg}<thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>`;
      }
      default: return '';
    }
  }).join('\n');
}

const CSS = `
@page { size: Letter; margin: ${MARGIN_MM}mm ${MARGIN_MM + 1}mm; }
* { box-sizing: border-box; }
body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-size: ${PT}pt; line-height: ${LEAD}; color: #1e293b; margin: 0; }
h1 { font-size: 15.5pt; line-height: 1.14; color: #0f172a; margin: 0 0 5px;
  letter-spacing: -.01em; border-bottom: 2.2px solid #2563eb; padding-bottom: 5px; }
h2 { font-size: 10.8pt; color: #2563eb; margin: 10px 0 5px; padding-bottom: 2.5px;
  border-bottom: 1px solid #dbe3ee; break-after: avoid; page-break-after: avoid; }
h3 { font-size: 9.1pt; color: #0f172a; margin: 7px 0 3px; break-after: avoid; page-break-after: avoid; }
p { margin: 0 0 4.5px; }
strong { color: #0f172a; font-weight: 700; }
hr { border: 0; border-top: 1px solid #e2e8f0; margin: 7px 0; }
ul { margin: 0 0 5px; padding-left: 14px; }
li { margin-bottom: 2px; }
code { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 7.7pt;
  background: #f1f5f9; color: #0f172a; padding: 0.5px 2.5px; border-radius: 3px; }
pre { background: #f8fafc; border: 1px solid #e2e8f0; border-left: 3px solid #2563eb;
  border-radius: 4px; padding: 4px 8px; margin: 3px 0 5px;
  break-inside: avoid; page-break-inside: avoid; }
pre code { background: none; padding: 0; font-size: 7.8pt; line-height: 1.36; white-space: pre-wrap; }
.note { color: #475569; font-size: 8.1pt; }
/* fixed layout stops the narrow "#" column claiming an equal share */
table { width: 100%; border-collapse: collapse; table-layout: fixed;
  margin: 6px 0 7px; break-inside: avoid; page-break-inside: avoid; }
th, td { border: 1px solid #d7dee8; padding: 3px 6.5px; text-align: left;
  font-size: 8pt; line-height: 1.32; vertical-align: top; }
th { background: #eef2f8; color: #0f172a; font-weight: 700; font-size: 7.4pt;
  text-transform: uppercase; letter-spacing: .03em; }
tbody tr:nth-child(even) { background: #fafbfd; }
td.c0, th.c0 { text-align: center; color: #64748b; }
td.c3, th.c3 { text-align: center; white-space: nowrap; }
td.c3 { font-weight: 700; color: #0f172a; }
`;

// ---- DOCX renderer (WordprocessingML) ---------------------------------------
const xe = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const half = (pt) => Math.round(pt * 2);            // w:sz is half-points
const TWIP_PAGE = 12240, TWIP_MARGIN = Math.round(MARGIN_MM / 25.4 * 1440);
const CONTENT_TW = TWIP_PAGE - 2 * TWIP_MARGIN;

// NOTE: WordprocessingML child order is schema-enforced — Word reports a file as
// corrupt if properties appear out of sequence. rPr must be
// rFonts, b, i, color, sz, shd; pPr must be pBdr, spacing, ind, jc.
function runXml(r, opt = {}) {
  const sz = opt.sz || PT;
  const props = [
    `<w:rFonts w:ascii="${r.code ? 'Consolas' : 'Helvetica'}" w:hAnsi="${r.code ? 'Consolas' : 'Helvetica'}"/>`,
    r.bold || opt.bold ? '<w:b/>' : '',
    r.italic || opt.italic ? '<w:i/>' : '',
    `<w:color w:val="${opt.color || (r.bold ? '0F172A' : '1E293B')}"/>`,
    `<w:sz w:val="${half(r.code ? sz - 0.6 : sz)}"/>`,
    r.code ? '<w:shd w:val="clear" w:fill="F1F5F9"/>' : '',
  ].join('');
  return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${xe(r.t)}</w:t></w:r>`;
}

const spacing = (before, after) => `<w:spacing w:before="${before}" w:after="${after}" w:line="${Math.round(LEAD * 240)}" w:lineRule="auto"/>`;

function paraXml(runs, opt = {}) {
  const pPr = `<w:pPr>${opt.border || ''}${spacing(opt.before || 0, opt.after == null ? 70 : opt.after)}${opt.ind || ''}${opt.jc || ''}</w:pPr>`;
  return `<w:p>${pPr}${runs.map((r) => runXml(r, opt)).join('')}</w:p>`;
}

// COLS and the centred/bold column treatment belong to ONE table — the parameter
// table in power-rankings-explained.md — so they key off its actual headings, not
// off "has four columns". Any other four-column table (a playoff bracket, say) was
// getting a 4.5%-wide first column meant for a rank number.
const TUNED_HEAD = ['#', 'What we measure', 'What it tells you', 'Counts for'];
const isTuned = (b) => b.head.length === TUNED_HEAD.length
  && b.head.every((h, n) => h.map((x) => x.t).join('').trim() === TUNED_HEAD[n]);

// Column widths for tables that aren't the tuned four-column one. An even split
// starves the one column carrying sentences and leaves date/number columns half
// empty, so each column is sized by its longest cell — clamped, because one long
// outlier should widen a column, not collapse every other one.
function contentFracs(b) {
  const longest = b.head.map((h, n) =>
    b.rows.reduce((m, r) => Math.max(m, ((r[n] || []).map((x) => x.t).join('')).length),
      h.map((x) => x.t).join('').length));
  const w = longest.map((L) => Math.min(Math.max(L, 6), 46));
  const total = w.reduce((a, c) => a + c, 0);
  return w.map((x) => x / total);
}

function tableXml(b) {
  // COLS is tuned for the four-column parameter table. Any other shape gets an
  // even split rather than an undefined width, which Word renders as a collapsed
  // column — the same fallback the HTML side already takes by dropping colgroup.
  const nCol = b.head.length;
  const tuned = isTuned(b);
  const fracs = tuned ? COLS : contentFracs(b);
  const widths = fracs.map((f) => Math.round(CONTENT_TW * f));
  const border = '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="D7DEE8"/>`).join('') +
    '</w:tblBorders>';
  const cell = (runs, n, isHead, shade) => {
    // The centred/bold treatment is the parameter table's rank and weight
    // columns; on any other shape every column is plain left-aligned body text.
    const keyed = tuned && (n === 0 || n === 3);
    const jc = keyed ? '<w:jc w:val="center"/>' : '';
    return `<w:tc><w:tcPr><w:tcW w:w="${widths[n]}" w:type="dxa"/>` +
      `${shade ? `<w:shd w:val="clear" w:fill="${shade}"/>` : ''}` +
      `<w:vAlign w:val="top"/></w:tcPr>` +
      paraXml(runs, { sz: isHead ? 7.4 : 8, bold: isHead || (keyed && n === 3), after: 0, jc,
                      color: isHead ? '0F172A' : (keyed && n === 0 ? '64748B' : '1E293B') }) +
      '</w:tc>';
  };
  const head = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${b.head.map((h, n) => cell(h, n, true, 'EEF2F8')).join('')}</w:tr>`;
  const rows = b.rows.map((r, ri) =>
    `<w:tr>${r.map((c, n) => cell(c, n, false, ri % 2 ? 'FAFBFD' : null)).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${CONTENT_TW}" w:type="dxa"/>${border}` +
    `<w:tblLayout w:type="fixed"/></w:tblPr>` +
    `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${head}${rows}</w:tbl>`;
}

function toDocxBody(blocks) {
  const HSZ = { 1: 15.5, 2: 10.8, 3: 9.1, 4: 8.8 };
  return blocks.map((b) => {
    switch (b.type) {
      case 'h': {
        const bottom = b.level <= 2
          ? `<w:pBdr><w:bottom w:val="single" w:sz="${b.level === 1 ? 18 : 6}" w:space="2" w:color="${b.level === 1 ? '2563EB' : 'DBE3EE'}"/></w:pBdr>` : '';
        return paraXml(b.runs, {
          sz: HSZ[b.level], bold: true, before: b.level === 1 ? 0 : 180, after: 90,
          color: b.level === 2 ? '2563EB' : '0F172A', border: bottom,
        });
      }
      case 'p': return paraXml(b.runs, { sz: b.note ? 8.1 : PT, color: b.note ? '475569' : undefined, italic: b.note });
      case 'ul': return b.items.map((it) => paraXml([{ t: '•  ' }, ...it], {
        ind: '<w:ind w:left="220" w:hanging="140"/>', after: 40,
      })).join('');
      case 'pre': return paraXml([{ t: b.text.replace(/\n/g, '  '), code: true }], {
        sz: 7.8, after: 70,
        border: '<w:pBdr><w:left w:val="single" w:sz="18" w:space="4" w:color="2563EB"/></w:pBdr>',
        ind: '<w:ind w:left="120"/>',
      });
      case 'hr': return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="E2E8F0"/></w:pBdr>${spacing(40, 60)}</w:pPr></w:p>`;
      case 'table': return tableXml(b);
      default: return '';
    }
  }).join('');
}

function writeDocx(blocks, outPath) {
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'docx-'));
  const w = (rel, content) => {
    const p = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };

  w('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`);

  w('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

  w('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);

  w('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Helvetica" w:hAnsi="Helvetica"/><w:sz w:val="${half(PT)}"/><w:color w:val="1E293B"/>
</w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
</w:styles>`);

  w('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${toDocxBody(blocks)}
<w:sectPr><w:pgSz w:w="${TWIP_PAGE}" w:h="15840"/>
<w:pgMar w:top="${TWIP_MARGIN}" w:right="${TWIP_MARGIN}" w:bottom="${TWIP_MARGIN}" w:left="${TWIP_MARGIN}" w:header="0" w:footer="0" w:gutter="0"/>
</w:sectPr></w:body></w:document>`);

  // mimetype-style ordering isn't required for docx; a plain deflate zip is fine.
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  execFileSync('zip', ['-q', '-r', '-X', outPath, '[Content_Types].xml', '_rels', 'word'], { cwd: tmp });
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---- build ------------------------------------------------------------------
function main() {
  const blocks = parse(fs.readFileSync(SRC, 'utf8'));

  // Title comes from the document's own H1. It used to be hardcoded to the
  // power-rankings title, so every OTHER document built through this pipeline
  // shipped with the wrong name in the browser tab and in the PDF metadata.
  const h1 = blocks.find((b) => b.type === 'h' && b.level === 1);
  const title = h1 ? h1.runs.map((r) => r.t).join('') : BASE;

  const htmlPath = path.join(ROOT, `${BASE}.html`);
  fs.writeFileSync(htmlPath, `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${title.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</title>
<style>${CSS}</style></head><body>
${toHtml(blocks)}
</body></html>`);
  console.log(`[doc] wrote ${BASE}.html`);

  // Headless Chrome renders the PDF. The single hardcoded Linux path meant the
  // PDF was silently skipped on macOS while the HTML and DOCX were rewritten,
  // so the PDF drifted out of date without anything saying so.
  const chromium = [
    process.env.CHROME_PATH,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ].filter(Boolean).find((p) => fs.existsSync(p)) || '';
  if (fs.existsSync(chromium)) {
    execFileSync(chromium, ['--headless', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer',
      `--print-to-pdf=${path.join(ROOT, `${BASE}.pdf`)}`, `file://${htmlPath}`], { stdio: 'pipe' });
    console.log(`[doc] wrote ${BASE}.pdf`);
  } else {
    console.warn('[doc] chromium not found — skipped PDF');
  }

  writeDocx(blocks, path.join(ROOT, `${BASE}.docx`));
  console.log(`[doc] wrote ${BASE}.docx`);
}

main();
