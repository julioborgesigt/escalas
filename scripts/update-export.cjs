const fs = require('fs');
const path = require('path');
const base = path.join(__dirname, '..');

let exportFile = fs.readFileSync(path.join(base, 'src/lib/export.ts'), 'utf8');

// Append plantão export functions at the end
const plantaoFunctions = `
// ---- Shared helpers for plantão exports ----

interface OficialPlantao {
\tpolicial_id: number;
\tequipe: string;
\tnome: string;
\tmatricula: string;
\tcargo: string;
\ttelefone: string;
\tlotacao: string;
\tdias: string[];
\tobservacoes: string;
}

function agruparPlantao(policiais: EscalaPolicialComDados[]): Map<string, OficialPlantao[]> {
\tconst oficiais = new Map<string, OficialPlantao>();
\tfor (const p of policiais) {
\t\tconst key = \`\${p.policial_id}_\${p.equipe || ''}\`;
\t\tif (!oficiais.has(key)) {
\t\t\toficiais.set(key, {
\t\t\t\tpolicial_id: p.policial_id,
\t\t\t\tequipe: p.equipe || '',
\t\t\t\tnome: p.nome,
\t\t\t\tmatricula: p.matricula,
\t\t\t\tcargo: p.cargo,
\t\t\t\ttelefone: p.telefone || '',
\t\t\t\tlotacao: p.lotacao,
\t\t\t\tdias: [],
\t\t\t\tobservacoes: p.observacoes || ''
\t\t\t});
\t\t}
\t\toficiais.get(key)!.dias.push(p.data_plantao);
\t}

\tconst equipes = new Map<string, OficialPlantao[]>();
\tfor (const oficial of oficiais.values()) {
\t\toficial.dias.sort();
\t\tconst list = equipes.get(oficial.equipe) || [];
\t\tlist.push(oficial);
\t\tequipes.set(oficial.equipe, list);
\t}

\tfor (const list of equipes.values()) {
\t\tlist.sort((a, b) => {
\t\t\tif (a.cargo !== b.cargo) return a.cargo === 'DPC' ? -1 : 1;
\t\t\treturn a.nome.localeCompare(b.nome);
\t\t});
\t}

\treturn new Map([...equipes.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function formatarDias(dias: string[]): string {
\treturn dias.map((d) => d.split('-')[2]).join(', ');
}

function formatarMesAno(dateStr: string): string {
\tconst [year, month] = dateStr.split('-');
\tconst meses = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
\treturn \`\${meses[Number(month) - 1]}/\${year}\`;
}

const COLS_PLANTAO = ['NOME', 'MATRÍCULA', 'CARGO', 'TELEFONE', 'LOTAÇÃO', 'DIAS', 'OBSERVAÇÕES'] as const;

function rowPlantao(o: OficialPlantao): string[] {
\treturn [o.nome, o.matricula, o.cargo, o.telefone, o.lotacao, formatarDias(o.dias), o.observacoes];
}

// ---- DOCX Plantão ----
export async function gerarDocxPlantao(escala: Escala, policiais: EscalaPolicialComDados[]): Promise<Uint8Array> {
\tconst equipes = agruparPlantao(policiais);

\tconst titulo = new Paragraph({
\t\tchildren: [new TextRun({ text: 'POLÍCIA CIVIL DO ESTADO DO CEARÁ', bold: true, size: 22, font: 'Arial' })],
\t\talignment: AlignmentType.CENTER,
\t\tspacing: { after: 100 }
\t});

\tconst subtitulo = new Paragraph({
\t\tchildren: [new TextRun({ text: \`DELEGACIA: \${escala.cidade.toUpperCase()} — MÊS/ANO: \${formatarMesAno(escala.data_inicio)}\`, bold: true, size: 20, font: 'Arial' })],
\t\talignment: AlignmentType.CENTER,
\t\tspacing: { after: 300 }
\t});

\tconst borderStyle = { style: BorderStyle.SINGLE, size: 1 };
\tconst borders = { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle };

\tconst children: (Table | Paragraph)[] = [titulo, subtitulo];

\tfor (const [equipe, oficiais] of equipes) {
\t\tconst equipeLabel = equipe ? \`EQUIPE \${equipe}\` : 'EQUIPE';
\t\tchildren.push(new Paragraph({
\t\t\tchildren: [new TextRun({ text: equipeLabel, bold: true, size: 20, font: 'Arial', color: '1a5c57' })],
\t\t\tspacing: { before: 200, after: 100 }
\t\t}));

\t\tconst headerRow = new TableRow({
\t\t\tchildren: COLS_PLANTAO.map((text) =>
\t\t\t\tnew TableCell({
\t\t\t\t\tchildren: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 16, font: 'Arial', color: 'FFFFFF' })], alignment: AlignmentType.CENTER })],
\t\t\t\t\tshading: { fill: '1a5c57' },
\t\t\t\t\tborders
\t\t\t\t})
\t\t\t)
\t\t});

\t\tconst dataRows = oficiais.map((o) =>
\t\t\tnew TableRow({
\t\t\t\tchildren: rowPlantao(o).map((text, i) =>
\t\t\t\t\tnew TableCell({
\t\t\t\t\t\tchildren: [new Paragraph({ children: [new TextRun({ text, size: 18, font: 'Arial' })], alignment: i >= 1 && i <= 3 ? AlignmentType.CENTER : AlignmentType.LEFT })],
\t\t\t\t\t\tborders
\t\t\t\t\t})
\t\t\t\t)
\t\t\t})
\t\t);

\t\tchildren.push(new Table({ rows: [headerRow, ...dataRows], width: { size: 100, type: WidthType.PERCENTAGE } }));
\t\tchildren.push(new Paragraph({ spacing: { after: 100 } }));
\t}

\tconst doc = new Document({
\t\tsections: [{
\t\t\tproperties: {
\t\t\t\tpage: {
\t\t\t\t\tsize: { orientation: PageOrientation.LANDSCAPE, width: 16838, height: 11906 },
\t\t\t\t\tmargin: { top: 720, bottom: 720, left: 720, right: 720 }
\t\t\t\t}
\t\t\t},
\t\t\tchildren
\t\t}]
\t});

\tconst blob = await Packer.toBlob(doc);
\treturn new Uint8Array(await blob.arrayBuffer());
}

// ---- XLSX Plantão ----
export function gerarXlsxPlantao(escala: Escala, policiais: EscalaPolicialComDados[]): Uint8Array {
\tconst equipes = agruparPlantao(policiais);
\tconst wb = XLSX.utils.book_new();
\tconst rows: (string | null)[][] = [
\t\t['POLÍCIA CIVIL DO ESTADO DO CEARÁ'],
\t\t[\`DELEGACIA: \${escala.cidade.toUpperCase()} — MÊS/ANO: \${formatarMesAno(escala.data_inicio)}\`],
\t\t[]
\t];

\tfor (const [equipe, oficiais] of equipes) {
\t\trows.push([equipe ? \`EQUIPE \${equipe}\` : 'EQUIPE']);
\t\trows.push([...COLS_PLANTAO]);
\t\tfor (const o of oficiais) rows.push(rowPlantao(o));
\t\trows.push([]);
\t}

\tconst ws = XLSX.utils.aoa_to_sheet(rows);
\tws['!cols'] = [{ wch: 40 }, { wch: 15 }, { wch: 8 }, { wch: 18 }, { wch: 35 }, { wch: 35 }, { wch: 30 }];
\tXLSX.utils.book_append_sheet(wb, ws, 'Escala');
\treturn new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
}

// ---- ODS Plantão ----
export function gerarOdsPlantao(escala: Escala, policiais: EscalaPolicialComDados[]): Uint8Array {
\tconst equipes = agruparPlantao(policiais);
\tconst wb = XLSX.utils.book_new();
\tconst rows: (string | null)[][] = [
\t\t['POLÍCIA CIVIL DO ESTADO DO CEARÁ'],
\t\t[\`DELEGACIA: \${escala.cidade.toUpperCase()} — MÊS/ANO: \${formatarMesAno(escala.data_inicio)}\`],
\t\t[]
\t];

\tfor (const [equipe, oficiais] of equipes) {
\t\trows.push([equipe ? \`EQUIPE \${equipe}\` : 'EQUIPE']);
\t\trows.push([...COLS_PLANTAO]);
\t\tfor (const o of oficiais) rows.push(rowPlantao(o));
\t\trows.push([]);
\t}

\tconst ws = XLSX.utils.aoa_to_sheet(rows);
\tXLSX.utils.book_append_sheet(wb, ws, 'Escala');
\treturn new Uint8Array(XLSX.write(wb, { bookType: 'ods', type: 'array' }));
}

// ---- PDF Plantão ----
export function gerarPdfPlantao(escala: Escala, policiais: EscalaPolicialComDados[]): Uint8Array {
\tconst equipes = agruparPlantao(policiais);
\tconst doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
\tconst pageWidth = 297;
\tconst margin = 10;

\tlet y = 12;
\tdoc.setFontSize(10);
\tdoc.setFont('helvetica', 'bold');
\tdoc.text('POLÍCIA CIVIL DO ESTADO DO CEARÁ', pageWidth / 2, y, { align: 'center' });
\ty += 5;
\tdoc.setFontSize(8);
\tdoc.setFont('helvetica', 'normal');
\tdoc.text('DELEGACIA GERAL DA POLÍCIA CIVIL / DEPARTAMENTO DE POLÍCIA JUDICIÁRIA DO INTERIOR SUL', pageWidth / 2, y, { align: 'center' });
\ty += 5;
\tdoc.setFont('helvetica', 'bold');
\tdoc.text(\`DELEGACIA: \${escala.cidade.toUpperCase()}\`, margin, y);
\tdoc.text(\`MÊS/ANO: \${formatarMesAno(escala.data_inicio)}\`, pageWidth / 2, y);
\ty += 8;

\tfor (const [equipe, oficiais] of equipes) {
\t\tconst equipeLabel = equipe ? \`EQUIPE \${equipe}\` : 'EQUIPE';
\t\tconst rows = oficiais.map((o) => rowPlantao(o));

\t\tautoTable(doc, {
\t\t\thead: [
\t\t\t\t[{ content: equipeLabel, colSpan: 7, styles: { halign: 'center', fillColor: [26, 92, 87], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 } }],
\t\t\t\t[...COLS_PLANTAO]
\t\t\t],
\t\t\tbody: rows,
\t\t\tstartY: y,
\t\t\ttheme: 'grid',
\t\t\theadStyles: { fillColor: [26, 92, 87], textColor: 255, fontSize: 7, fontStyle: 'bold', halign: 'center' },
\t\t\tbodyStyles: { fontSize: 7 },
\t\t\tcolumnStyles: {
\t\t\t\t0: { cellWidth: 55 },
\t\t\t\t1: { cellWidth: 28, halign: 'center' },
\t\t\t\t2: { cellWidth: 14, halign: 'center' },
\t\t\t\t3: { cellWidth: 28, halign: 'center' },
\t\t\t\t4: { cellWidth: 38 },
\t\t\t\t5: { cellWidth: 55, halign: 'center' },
\t\t\t\t6: { cellWidth: 'auto' }
\t\t\t},
\t\t\tmargin: { left: margin, right: margin }
\t\t});

\t\ty = ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;
\t}

\t// Footer
\tconst footerY = y + 10;
\tdoc.setFontSize(8);
\tdoc.setFont('helvetica', 'normal');
\tdoc.text('Obs.: Escala sujeita a alteração conforme necessidade do serviço.', margin, footerY);
\tconst sigY = footerY + 14;
\tdoc.text(\`\${escala.cidade}, ______ de ________________ de ________\`, margin, sigY);
\tconst sigCenterX = pageWidth * 0.75;
\tdoc.line(sigCenterX - 45, sigY + 12, sigCenterX + 45, sigY + 12);
\tdoc.setFontSize(7);
\tdoc.text('Delegado(a) de Polícia / Carimbo', sigCenterX, sigY + 17, { align: 'center' });

\treturn new Uint8Array(doc.output('arraybuffer'));
}
`;

exportFile = exportFile.trimEnd() + '\n' + plantaoFunctions.split('\n').join('\r\n');
fs.writeFileSync(path.join(base, 'src/lib/export.ts'), exportFile);
console.log('export.ts done, gerarPdfPlantao check:', exportFile.includes('gerarPdfPlantao'));
