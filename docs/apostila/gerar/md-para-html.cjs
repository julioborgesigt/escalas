/** Markdown -> HTML paginado (impressão A4) para a apostila. */
const fs = require('fs');
const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) {
	console.error('uso: node docs/apostila/gerar/md-para-html.cjs <entrada.md> <saida.html>');
	process.exit(1);
}
const raw = fs.readFileSync(SRC, 'utf8');

const meta = {};
const linhas = raw.split('\n');
let i = 0;
for (; i < linhas.length; i++) {
	const m = linhas[i].match(/^%%(\w+)%%\s*(.*)$/);
	if (!m) break;
	meta[m[1]] = m[2];
}
const L = linhas.slice(i);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function inline(t) {
	let s = esc(t);
	s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
	s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
	s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, a, b) => `<a href="${b.replace(/^&lt;|&gt;$/g, '')}">${a}</a>`);
	s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
	return s;
}
const slug = (t) =>
	t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const out = [];
const toc = [];
let k = 0;
while (k < L.length) {
	const ln = L[k];
	if (/^```/.test(ln.trim())) {
		k++;
		const buf = [];
		while (k < L.length && !/^```/.test(L[k].trim())) buf.push(L[k++]);
		k++;
		out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
		continue;
	}
	if (/^\|/.test(ln.trim()) && k + 1 < L.length && /^\|[\s:-]+\|/.test(L[k + 1].trim())) {
		const buf = [];
		while (k < L.length && /^\|/.test(L[k].trim())) buf.push(L[k++]);
		const cels = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
		const head = cels(buf[0]);
		const body = buf.slice(2).map(cels);
		out.push(
			'<table><thead><tr>' + head.map((h) => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>' +
			body.map((r) => '<tr>' + head.map((_, c) => `<td>${inline(r[c] || '')}</td>`).join('') + '</tr>').join('') +
			'</tbody></table>'
		);
		continue;
	}
	let m;
	if ((m = ln.match(/^(#{1,4})\s+(.*)$/))) {
		const n = m[1].length, txt = m[2], id = slug(txt);
		if (n <= 3) toc.push({ n, txt, id });
		out.push(`<h${n} id="${id}"${n === 1 ? ' class="cap"' : ''}>${inline(txt)}</h${n}>`);
		k++;
		continue;
	}
	if (/^---+$/.test(ln.trim())) { out.push('<hr>'); k++; continue; }
	if (/^>\s?/.test(ln)) {
		const buf = [];
		while (k < L.length && /^>\s?/.test(L[k])) buf.push(L[k++].replace(/^>\s?/, ''));
		out.push(`<blockquote>${inline(buf.join(' ').trim())}</blockquote>`);
		continue;
	}
	if (/^- \[ \]/.test(ln)) {
		const buf = [];
		while (k < L.length && /^- \[ \]/.test(L[k])) buf.push(L[k++].replace(/^- \[ \]\s*/, ''));
		out.push('<ul class="check">' + buf.map((b) => `<li>${inline(b)}</li>`).join('') + '</ul>');
		continue;
	}
	if (/^[-*]\s+/.test(ln)) {
		const buf = [];
		while (k < L.length && /^[-*]\s+/.test(L[k])) buf.push(L[k++].replace(/^[-*]\s+/, ''));
		out.push('<ul>' + buf.map((b) => `<li>${inline(b)}</li>`).join('') + '</ul>');
		continue;
	}
	if (/^\d+\.\s+/.test(ln)) {
		const buf = [];
		while (k < L.length && /^\d+\.\s+/.test(L[k])) buf.push(L[k++].replace(/^\d+\.\s+/, ''));
		out.push('<ol>' + buf.map((b) => `<li>${inline(b)}</li>`).join('') + '</ol>');
		continue;
	}
	if (ln.trim() === '') { k++; continue; }
	const p = inline(ln.trim());
	const cls = /^(⚠️|✅|💡|📖|❌)/.test(ln.trim()) ? ' class="callout"' : '';
	out.push(`<p${cls}>${p}</p>`);
	k++;
}

const tocHtml = toc
	.map((t) => `<div class="toc-l${t.n}"><a href="#${t.id}">${inline(t.txt)}</a></div>`)
	.join('\n');

const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${meta.TITULO}</title>
<style>
@page { size: A4; margin: 20mm 18mm 18mm 18mm; }
:root { --azul:#1f3864; --azul2:#2e5496; --cinza:#4a4a4a; }
* { box-sizing: border-box; }
body { font-family:"Liberation Serif","DejaVu Serif",Georgia,serif; font-size:10.5pt; line-height:1.55; color:#1a1a1a; margin:0; }
h1,h2,h3,h4 { font-family:"Liberation Sans","DejaVu Sans",Arial,sans-serif; color:var(--azul); line-height:1.25; }
h1.cap { font-size:24pt; page-break-before:always; border-bottom:2.5pt solid var(--azul); padding-bottom:5pt; margin:0 0 16pt; }
h2 { font-size:16pt; margin:22pt 0 8pt; page-break-after:avoid; }
h3 { font-size:12.5pt; color:var(--azul2); margin:16pt 0 6pt; page-break-after:avoid; }
h4 { font-size:11pt; color:#404040; margin:12pt 0 4pt; page-break-after:avoid; }
p { margin:0 0 7pt; text-align:justify; orphans:2; widows:2; }
ul,ol { margin:0 0 8pt; padding-left:16pt; }
li { margin-bottom:3pt; }
ul.check { list-style:none; padding-left:4pt; }
ul.check li::before { content:"\\2610  "; }
code { font-family:"DejaVu Sans Mono","Liberation Mono",monospace; font-size:8.8pt; background:#f2f2f2; padding:0.5pt 2.5pt; border-radius:2pt; }
pre { background:#f6f7f9; border:0.6pt solid #dcdfe4; border-left:2.5pt solid var(--azul2); border-radius:3pt;
      padding:7pt 9pt; margin:0 0 10pt; overflow-wrap:anywhere; tab-size:2; }
pre code { background:none; padding:0; font-size:8.5pt; line-height:1.42; white-space:pre-wrap; }
table { width:100%; border-collapse:collapse; margin:0 0 11pt; font-size:9pt; page-break-inside:avoid; }
th { background:#d9e2f3; color:#12294d; text-align:left; font-family:"Liberation Sans",sans-serif; }
th,td { border:0.6pt solid #bfbfbf; padding:3.5pt 5pt; vertical-align:top; }
tbody tr:nth-child(even) td { background:#f7f9fc; }
blockquote { margin:0 0 10pt; padding:6pt 10pt; background:#f4f6fb; border-left:3pt solid var(--azul);
             page-break-inside:avoid; }
blockquote p:last-child { margin-bottom:0; }
p.callout { background:#fffaf0; border-left:3pt solid #d18f2b; padding:6pt 9pt; page-break-inside:avoid; }
hr { border:none; border-top:0.6pt solid #cfcfcf; margin:12pt 0; }
a { color:var(--azul2); text-decoration:none; }
.capa { height:247mm; display:flex; flex-direction:column; justify-content:center; align-items:center;
        text-align:center; page-break-after:always; }
.capa .sub { font-family:"Liberation Sans",sans-serif; font-size:14pt; color:#555; letter-spacing:0.5pt; }
.capa .tit { font-family:"Liberation Sans",sans-serif; font-size:38pt; font-weight:bold; color:var(--azul);
             margin:10pt 0 14pt; line-height:1.1; }
.capa .rule { width:60%; border-top:2pt solid var(--azul); margin:0 0 16pt; }
.capa .linha { font-size:12pt; color:#444; max-width:70%; }
.capa .data { margin-top:22pt; font-size:11pt; color:#777; }
.sumario { page-break-after:always; }
.sumario h1 { font-size:22pt; border-bottom:2.5pt solid var(--azul); padding-bottom:5pt; margin:0 0 14pt; }
.toc-l1 { font-family:"Liberation Sans",sans-serif; font-weight:bold; font-size:11pt; margin:11pt 0 4pt; color:var(--azul); }
.toc-l2 { font-size:10pt; margin:2.5pt 0 2.5pt 10pt; }
.toc-l3 { font-size:9pt; margin:1.5pt 0 1.5pt 24pt; color:#555; }
.toc-l3 a { color:#555; }
</style></head><body>
<div class="capa">
  <div class="sub">${meta.SUBTITULO || ''}</div>
  <div class="tit">${meta.TITULO || ''}</div>
  <div class="rule"></div>
  <div class="linha">${meta.LINHA || ''}</div>
  <div class="data">${meta.DATA || ''}</div>
</div>
<div class="sumario"><h1>Sumário</h1>${tocHtml}</div>
${out.join('\n')}
</body></html>`;

fs.writeFileSync(OUT, html);
console.log('html gerado:', OUT, (html.length / 1024).toFixed(0) + ' KB | entradas de sumário:', toc.length);
