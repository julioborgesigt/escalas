const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/lib/server/pdf-signing.ts');
let src = fs.readFileSync(filePath, 'utf8');

function crlf(s) { return s.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'); }

// ─── 1. LINHAS DIAGONAIS: adicionar clipping ao box (igual nas duas funções) ──
// O padrão é idêntico nas duas funções, replace_all substitui as duas.
const HATCH_OLD = crlf(`\tfor (let i = -boxH; i < boxW + 1; i += 8) {
\t\tlastPage.drawLine({
\t\t\tstart: { x: boxX + i,        y: boxY },
\t\t\tend:   { x: boxX + i + boxH, y: boxY + boxH },
\t\t\tthickness: 0.18, color: cHatch
\t\t});
\t}`);

const HATCH_NEW = crlf(`\t// Linhas clipadas ao box (evita extrapolação)
\tfor (let i = -(boxH); i < boxW + 1; i += 8) {
\t\tlet lx0 = boxX + i, ly0 = boxY;
\t\tlet lx1 = boxX + i + boxH, ly1 = boxY + boxH;
\t\tif (lx0 < boxX) { ly0 += boxX - lx0; lx0 = boxX; }
\t\tif (lx1 > boxX + boxW) { ly1 -= lx1 - (boxX + boxW); lx1 = boxX + boxW; }
\t\tif (lx0 >= lx1) continue;
\t\tlastPage.drawLine({ start: { x: lx0, y: ly0 }, end: { x: lx1, y: ly1 }, thickness: 0.18, color: cHatch });
\t}`);

const hatchCount = (src.split(HATCH_OLD).length - 1);
src = src.split(HATCH_OLD).join(HATCH_NEW);
console.log(`✓ Diagonal lines clipping: ${hatchCount} substituição(ões)`);

// ─── 2. PKI: Dimensões menores ─────────────────────────────────────────────
src = src.replace(crlf('\tconst boxW = 255;\r\n\tconst boxH = 82;\r\n\tconst marginY = 40;\r\n\tconst headerH = 11;'),
                  crlf('\tconst boxW = 232;\r\n\tconst boxH = 72;\r\n\tconst marginY = 40;\r\n\tconst headerH = 10;'));
console.log('✓ PKI: dimensões ajustadas (232×72)');

// PKI QR menor
src = src.replace('\tconst qrSize = 56;', '\tconst qrSize = 50;');
console.log('✓ PKI: QR size 56 → 50');

// PKI header text size
src = src.replace(
  crlf('\t\tsize: 5.5, font: fontBold, color: cWhite\r\n\t});'),
  crlf('\t\tsize: 5, font: fontBold, color: cWhite\r\n\t});')
);
console.log('✓ PKI: header text size 5.5 → 5');

// ─── 3. PKI: conteúdo textual (nome limpo, CPF completo, fontes menores) ───
const PKI_CONTENT_OLD = crlf(`\t// 7 — Conteúdo textual
\tconst txtX    = boxX + 7;
\tconst textMaxW = qrX - boxX - 14;
\tconst cpfFormatado = signerCpf
\t\t? \`CPF: ***.\${signerCpf.slice(3, 6)}.\${signerCpf.slice(6, 9)}-**\`
\t\t: '';

\tlastPage.drawText('Assinado digitalmente por:', {
\t\tx: txtX, y: boxY + boxH - headerH - 10,
\t\tsize: 6, font, color: cBlue
\t});

\tconst nomeAssinante = signerName.toUpperCase();
\tlet nomeDisplay = nomeAssinante;
\twhile (nomeDisplay.length > 5 && fontBold.widthOfTextAtSize(nomeDisplay, 8.5) > textMaxW) {
\t\tnomeDisplay = nomeDisplay.slice(0, -1);
\t}
\tif (nomeDisplay !== nomeAssinante) nomeDisplay += '\\u2026';
\tlastPage.drawText(nomeDisplay, {
\t\tx: txtX, y: boxY + boxH - headerH - 21,
\t\tsize: 8.5, font: fontBold, color: cDark
\t});

\tconst infoLine = cpfFormatado ? \`\${dataHora}   \${cpfFormatado}\` : dataHora;
\tlastPage.drawText(infoLine, {
\t\tx: txtX, y: boxY + boxH - headerH - 32,
\t\tsize: 6.5, font, color: cGray
\t});

\t// Caixa de destaque do código de verificação
\tif (verificationHash) {
\t\tconst hashLabel = \`Cód: \${verificationHash}\`;
\t\tconst hashBgW = fontMono.widthOfTextAtSize(hashLabel, 7.5) + 14;
\t\tlastPage.drawRectangle({ x: txtX - 2, y: boxY + 19, width: hashBgW, height: 12, color: cNavy });
\t\tlastPage.drawText(hashLabel, { x: txtX + 5, y: boxY + 23, size: 7.5, font: fontMono, color: cWhite });
\t}

\tlastPage.drawText('Assinado conforme MP 2.200-2/2001 — ICP-Brasil', {
\t\tx: txtX, y: boxY + 7, size: 4.5, font, color: cGray
\t});`);

const PKI_CONTENT_NEW = crlf(`\t// 7 — Conteúdo textual
\tconst txtX    = boxX + 7;
\tconst textMaxW = qrX - boxX - 14;

\t// Limpar nome: SERPRO/ICP-Brasil pode enviar "NOME:CPF" em signerName
\tconst rawSName = signerName.toUpperCase();
\tconst sColonIdx = rawSName.lastIndexOf(':');
\tconst nomeAssinante = sColonIdx !== -1 ? rawSName.slice(0, sColonIdx).trim() : rawSName;
\tconst cpfDoNome = sColonIdx !== -1 ? rawSName.slice(sColonIdx + 1).replace(/\\D/g, '') : '';
\tconst cpfFinal  = ((signerCpf ?? '').replace(/\\D/g, '') || cpfDoNome);
\tconst cpfDisplay = cpfFinal.length >= 9
\t\t? \`CPF: \${cpfFinal.slice(0,3)}.\${cpfFinal.slice(3,6)}.\${cpfFinal.slice(6,9)}-\${cpfFinal.slice(9)}\`
\t\t: '';

\tlastPage.drawText('Assinado digitalmente por:', {
\t\tx: txtX, y: boxY + boxH - headerH - 9,
\t\tsize: 5.5, font, color: cBlue
\t});

\tlet nomeDisplay = nomeAssinante;
\twhile (nomeDisplay.length > 5 && fontBold.widthOfTextAtSize(nomeDisplay, 8) > textMaxW) {
\t\tnomeDisplay = nomeDisplay.slice(0, -1);
\t}
\tif (nomeDisplay !== nomeAssinante) nomeDisplay += '\\u2026';
\tlastPage.drawText(nomeDisplay, {
\t\tx: txtX, y: boxY + boxH - headerH - 19,
\t\tsize: 8, font: fontBold, color: cDark
\t});

\tconst infoLine = cpfDisplay ? \`\${dataHora}   \${cpfDisplay}\` : dataHora;
\tlastPage.drawText(infoLine, {
\t\tx: txtX, y: boxY + boxH - headerH - 29,
\t\tsize: 6, font, color: cGray
\t});

\t// Caixa de destaque do código de verificação
\tif (verificationHash) {
\t\tconst hashLabel = \`Cód: \${verificationHash}\`;
\t\tconst hashBgW = fontMono.widthOfTextAtSize(hashLabel, 7) + 14;
\t\tlastPage.drawRectangle({ x: txtX - 2, y: boxY + 17, width: hashBgW, height: 11, color: cNavy });
\t\tlastPage.drawText(hashLabel, { x: txtX + 5, y: boxY + 21, size: 7, font: fontMono, color: cWhite });
\t}

\tlastPage.drawText('Assinado conforme MP 2.200-2/2001 — ICP-Brasil', {
\t\tx: txtX, y: boxY + 6, size: 4, font, color: cGray
\t});`);

if (src.includes(PKI_CONTENT_OLD)) {
  src = src.replace(PKI_CONTENT_OLD, PKI_CONTENT_NEW);
  console.log('✓ PKI: conteúdo textual atualizado (nome limpo + CPF completo)');
} else {
  console.log('✗ PKI: conteúdo textual — âncora não encontrada');
}

// ─── 4. RODAPÉ: Dimensões menores ──────────────────────────────────────────
src = src.replace(
  crlf('\tconst boxH    = 72;\r\n\tconst boxY    = 7;\r\n\tconst headerH = 14;'),
  crlf('\tconst boxH    = 64;\r\n\tconst boxY    = 7;\r\n\tconst headerH = 12;')
);
console.log('✓ Rodapé: dimensões ajustadas (boxH=64, headerH=12)');

// Rodapé header text size: 6.5 → 6
src = src.replace(
  crlf('\t\tsize: 6.5, font: fontBold, color: cWhite\r\n\t});'),
  crlf('\t\tsize: 6, font: fontBold, color: cWhite\r\n\t});')
);
console.log('✓ Rodapé: header text size 6.5 → 6');

// ─── 5. RODAPÉ: conteúdo textual (nome limpo, CPF, fontes menores) ────────
const RODAPE_CONTENT_OLD = crlf(`\t// 6 — Conteúdo textual
\tconst textX     = boxX + 8;
\tconst textMaxW  = qrColumnX - boxX - 22;
\tconst contentTop = boxY + boxH - headerH - 3;
\tconst dataHora   = formatarDataHora();

\tlastPage.drawText('Confirmado eletronicamente por:', {
\t\tx: textX, y: contentTop - 8, size: 6, font, color: cBlue
\t});

\t// Nome (truncado se necessário)
\tlet nomeDisplay = assinante.toUpperCase();
\twhile (nomeDisplay.length > 5 && fontBold.widthOfTextAtSize(nomeDisplay, 8.5) > textMaxW) {
\t\tnomeDisplay = nomeDisplay.slice(0, -1);
\t}
\tif (nomeDisplay !== assinante.toUpperCase()) nomeDisplay += '\\u2026';
\tlastPage.drawText(nomeDisplay, {
\t\tx: textX, y: contentTop - 19, size: 8.5, font: fontBold, color: cDark
\t});

\tlastPage.drawText(\`Data/Hora: \${dataHora}  (Horário de Brasília)\`, {
\t\tx: textX, y: contentTop - 30, size: 6.5, font, color: cGray
\t});

\t// 7 — Caixa de destaque do código de verificação (navy + Courier Bold)
\tif (verificationHash) {
\t\tconst hashLabel = \`Cód: \${verificationHash}\`;
\t\tconst hashBgW   = fontMono.widthOfTextAtSize(hashLabel, 8) + 16;
\t\tlastPage.drawRectangle({ x: textX - 2, y: boxY + 15, width: hashBgW, height: 13, color: cNavy });
\t\tlastPage.drawText(hashLabel, { x: textX + 6, y: boxY + 19, size: 8, font: fontMono, color: cWhite });
\t}

\tlastPage.drawText('Verificar em: escalas.policiacivil.ce.gov.br/validar', {
\t\tx: textX, y: boxY + 5, size: 5.5, font, color: cGray
\t});`);

const RODAPE_CONTENT_NEW = crlf(`\t// 6 — Conteúdo textual
\tconst textX     = boxX + 8;
\tconst textMaxW  = qrColumnX - boxX - 22;
\tconst contentTop = boxY + boxH - headerH - 3;
\tconst dataHora   = formatarDataHora();

\t// Limpar nome: extrair CPF se vier no formato "NOME:CPF" (ICP-Brasil/SERPRO)
\tconst rawNome = assinante.toUpperCase();
\tconst nColonIdx = rawNome.lastIndexOf(':');
\tconst nomeBase = nColonIdx !== -1 ? rawNome.slice(0, nColonIdx).trim() : rawNome;
\tconst cpfExtraido = nColonIdx !== -1 ? rawNome.slice(nColonIdx + 1).replace(/\\D/g, '') : '';
\tconst cpfStr = cpfExtraido.length >= 9
\t\t? \`CPF: \${cpfExtraido.slice(0,3)}.\${cpfExtraido.slice(3,6)}.\${cpfExtraido.slice(6,9)}-\${cpfExtraido.slice(9)}\`
\t\t: '';

\tlastPage.drawText('Confirmado eletronicamente por:', {
\t\tx: textX, y: contentTop - 7, size: 5.5, font, color: cBlue
\t});

\t// Nome (truncado se necessário)
\tlet nomeDisplay = nomeBase;
\twhile (nomeDisplay.length > 5 && fontBold.widthOfTextAtSize(nomeDisplay, 8) > textMaxW) {
\t\tnomeDisplay = nomeDisplay.slice(0, -1);
\t}
\tif (nomeDisplay !== nomeBase) nomeDisplay += '\\u2026';
\tlastPage.drawText(nomeDisplay, {
\t\tx: textX, y: contentTop - 16, size: 8, font: fontBold, color: cDark
\t});

\tconst dataHoraLine = cpfStr
\t\t? \`\${dataHora}   \${cpfStr}\`
\t\t: \`Data/Hora: \${dataHora}  (Horário de Brasília)\`;
\tlastPage.drawText(dataHoraLine, {
\t\tx: textX, y: contentTop - 26, size: 6, font, color: cGray
\t});

\t// 7 — Caixa de destaque do código de verificação (navy + Courier Bold)
\tif (verificationHash) {
\t\tconst hashLabel = \`Cód: \${verificationHash}\`;
\t\tconst hashBgW   = fontMono.widthOfTextAtSize(hashLabel, 7.5) + 14;
\t\tlastPage.drawRectangle({ x: textX - 2, y: boxY + 11, width: hashBgW, height: 11, color: cNavy });
\t\tlastPage.drawText(hashLabel, { x: textX + 5, y: boxY + 15, size: 7.5, font: fontMono, color: cWhite });
\t}

\tlastPage.drawText('Verificar em: escalas.policiacivil.ce.gov.br/validar', {
\t\tx: textX, y: boxY + 4, size: 5, font, color: cGray
\t});`);

if (src.includes(RODAPE_CONTENT_OLD)) {
  src = src.replace(RODAPE_CONTENT_OLD, RODAPE_CONTENT_NEW);
  console.log('✓ Rodapé: conteúdo textual atualizado (nome limpo + CPF completo)');
} else {
  console.log('✗ Rodapé: conteúdo textual — âncora não encontrada');
}

fs.writeFileSync(filePath, src, 'utf8');
console.log('\nArquivo salvo.');
