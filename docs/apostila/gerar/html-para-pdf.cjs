/**
 * Renderiza o HTML da apostila em PDF A4 usando o Chromium do Playwright
 * (já é devDependency do projeto, via @playwright/test).
 *
 * A capa é renderizada em uma passada separada, SEM cabeçalho de página, e
 * remontada com `qpdf` — o Chromium aplica cabeçalho/rodapé em todas as
 * páginas ou em nenhuma, e cabeçalho em cima da capa fica feio.
 *
 * Uso: node docs/apostila/gerar/html-para-pdf.cjs <entrada.html> <saida.pdf>
 */
const { chromium } = require('@playwright/test');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ENTRADA = path.resolve(process.argv[2]);
const SAIDA = path.resolve(process.argv[3]);

const MARGENS = { top: '20mm', bottom: '16mm', left: '18mm', right: '18mm' };
const CABECALHO =
	'<div style="font-size:7pt;color:#8a8a8a;width:100%;padding:0 18mm;text-align:right;' +
	'font-family:Arial,sans-serif;">Sistema de Gestão de Escalas — PCCE · Apostila do Desenvolvedor</div>';
const RODAPE =
	'<div style="font-size:8pt;color:#8a8a8a;width:100%;text-align:center;font-family:Arial,sans-serif;">' +
	'<span class="pageNumber"></span></div>';

(async () => {
	const browser = await chromium.launch();
	const page = await browser.newPage();
	await page.goto('file://' + ENTRADA, { waitUntil: 'load' });
	await page.emulateMedia({ media: 'print' });

	const completo = SAIDA + '.completo.tmp.pdf';
	const capa = SAIDA + '.capa.tmp.pdf';

	await page.pdf({
		path: completo,
		format: 'A4',
		printBackground: true,
		displayHeaderFooter: true,
		margin: MARGENS,
		headerTemplate: CABECALHO,
		footerTemplate: RODAPE
	});
	await page.pdf({
		path: capa,
		format: 'A4',
		printBackground: true,
		pageRanges: '1',
		displayHeaderFooter: false,
		margin: MARGENS
	});
	await browser.close();

	try {
		execFileSync('qpdf', ['--empty', '--pages', capa, '1', completo, '2-z', '--', SAIDA]);
		fs.unlinkSync(completo);
		fs.unlinkSync(capa);
	} catch {
		// Sem qpdf: fica o PDF completo, com cabeçalho também na capa.
		fs.renameSync(completo, SAIDA);
		fs.unlinkSync(capa);
		console.warn('qpdf ausente — capa saiu com cabeçalho de página.');
	}
	console.log('PDF gerado:', SAIDA);
})();
