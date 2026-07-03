/**
 * Geração do rascunho (PDF sem manifesto forense) usado nas cópias de
 * conferência. Centraliza a lógica para que TODOS os endpoints que servem o
 * documento assinado (download e documento-assinado, escala e GISE) produzam a
 * mesma cópia de conferência, sem divergência.
 */

import * as exportLib from '$lib/server/export';
import { getR2 } from '$lib/server/platform';
import { getBreveRelatorioEnvMergido } from '$lib/server/breve-relatorio-env';
import type { Database } from '$lib/db';

type EscalaArg = Parameters<typeof exportLib.gerarPdf>[0];
type PoliciaisArg = Parameters<typeof exportLib.gerarPdf>[1];
type GiseDetalhado = Parameters<typeof exportLib.toGisePdfData>[0];

/** Carrega um logo do R2 (best-effort; undefined em qualquer falha). */
async function carregarLogoR2(
	platform: App.Platform | undefined,
	key: string
): Promise<Uint8Array | undefined> {
	try {
		const r2 = getR2(platform);
		if (!r2) return undefined;
		const obj = await r2.get(key);
		if (!obj) return undefined;
		return new Uint8Array(await obj.arrayBuffer());
	} catch {
		return undefined;
	}
}

/**
 * Gera o rascunho PDF da escala (sem manifesto forense), conforme o tipo.
 *
 * `rubrica` (opcional): quando informada, é desenhada acima da linha de
 * assinatura — usada pela CÓPIA DE CONFERÊNCIA para espelhar o documento
 * digital assinado por token (rubrica no campo, em vez de campo vazio).
 */
export async function gerarRascunhoEscalaPdf(
	escala: EscalaArg,
	policiais: PoliciaisArg,
	platform: App.Platform | undefined,
	rubrica?: string
): Promise<Uint8Array> {
	if (escala.tipo === 'expediente') {
		const [logoPolicia, logoCeara] = await Promise.all([
			carregarLogoR2(platform, 'assets/logogise.jpg'),
			carregarLogoR2(platform, 'assets/logo_ceara.jpg')
		]);
		const result = await exportLib.gerarPdfExpediente(
			escala,
			policiais,
			logoPolicia,
			logoCeara,
			rubrica
		);
		return result.pdf;
	}
	if (escala.tipo === 'plantao') {
		return exportLib.gerarPdfPlantao(escala, policiais, rubrica).pdf;
	}
	return exportLib.gerarPdf(escala, policiais, rubrica).pdf;
}

/** Gera o rascunho PDF de uma GISE detalhada (sem manifesto forense). */
export async function gerarRascunhoGisePdf(
	db: Database,
	gise: GiseDetalhado,
	platform: App.Platform | undefined
): Promise<Uint8Array> {
	const [logoGise, logoCeara] = await Promise.all([
		carregarLogoR2(platform, 'assets/logogise.jpg'),
		carregarLogoR2(platform, 'assets/logo_ceara.jpg')
	]);
	const brEnv = await getBreveRelatorioEnvMergido(db);
	const result = await exportLib.gerarPdfGise(
		exportLib.toGisePdfData(gise, brEnv),
		logoGise,
		logoCeara
	);
	return result.pdf;
}
