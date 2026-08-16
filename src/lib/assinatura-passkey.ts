/**
 * Fluxo de assinatura avançada com passkey, em duas etapas:
 * preparar (o servidor monta o PDF e devolve o hash) → cerimônia biométrica no
 * aparelho → finalizar (o servidor confere a asserção, sela e grava).
 *
 * Irmão de `$lib/assinatura-token.ts`, que faz o mesmo para o Token A3, e pelo
 * mesmo motivo: a orquestração de três passos espalhada pelos componentes foi
 * onde correções de robustez entravam num lugar e não nos outros.
 *
 * O desafio da cerimônia é o **hash do PDF preparado**. É isso que faz a
 * assinatura dizer "afirmei ESTE documento" em vez de "me autentiquei": o
 * `preparedPdf` volta inteiro no finalizar, e o servidor confere que é o mesmo
 * que ele preparou antes de olhar para a asserção.
 */
import { apiFetch } from '$lib/api-fetch';
import { assinarComPasskey } from '$lib/webauthn-cliente';

interface PreparacaoPasskey {
	intencao: string;
	preparedPdf: string;
	/** SHA-256 do PDF preparado — o desafio da cerimônia. */
	documentHash: string;
	/** Credencial ativa do titular, para `allowCredentials`. */
	credentialId: string;
}

export interface EvidenciasAssinatura {
	rubrica: string;
	latitude?: number;
	longitude?: number;
	selfieBase64?: string | null;
	codigoValidação?: string;
	desafioId?: string;
	livenessChallenge?: unknown;
	reauthId?: string;
}

async function assinarComPasskeyDuasFases(
	prepararUrl: string,
	finalizarUrl: string,
	evidencias: EvidenciasAssinatura & { tipo?: string },
	onEtapa?: (rotulo: string) => void
): Promise<unknown> {
	onEtapa?.('Preparando o documento...');
	const preparo = await apiFetch<PreparacaoPasskey>(prepararUrl, {
		method: 'POST',
		body: JSON.stringify(evidencias)
	});

	onEtapa?.('Confirme com sua biometria...');
	const assercao = await assinarComPasskey(preparo.documentHash, preparo.credentialId);

	onEtapa?.('Finalizando assinatura...');
	return apiFetch<unknown>(finalizarUrl, {
		method: 'POST',
		body: JSON.stringify({
			intencao: preparo.intencao,
			preparedPdf: preparo.preparedPdf,
			assercao
		})
	});
}

/**
 * Executa o fluxo inteiro e resolve quando a escala está assinada.
 *
 * @param onEtapa recebe o rótulo de cada etapa, para o indicador de progresso —
 * a cerimônia biométrica abre um diálogo do sistema e o usuário precisa
 * entender por que a tela parou.
 */
export async function assinarEscalaComPasskey(
	escalaId: number,
	evidencias: EvidenciasAssinatura,
	onEtapa?: (rotulo: string) => void
): Promise<unknown> {
	return assinarComPasskeyDuasFases(
		`/api/escalas/${escalaId}/preparar-assinatura-avancada`,
		`/api/escalas/${escalaId}/finalizar-assinatura-avancada`,
		evidencias,
		onEtapa
	);
}

export async function assinarGiseComPasskey(
	giseId: number,
	evidencias: EvidenciasAssinatura,
	onEtapa?: (rotulo: string) => void
): Promise<unknown> {
	return assinarComPasskeyDuasFases(
		`/api/gise/${giseId}/preparar-assinatura-avancada`,
		`/api/gise/${giseId}/finalizar-assinatura-avancada`,
		evidencias,
		onEtapa
	);
}

export async function assinarExtraComPasskey(
	giseId: number,
	seccionalId: number,
	evidencias: EvidenciasAssinatura & { tipo?: string },
	onEtapa?: (rotulo: string) => void
): Promise<unknown> {
	return assinarComPasskeyDuasFases(
		`/api/gise/${giseId}/relatorios/${seccionalId}/preparar-assinatura-avancada`,
		`/api/gise/${giseId}/relatorios/${seccionalId}/finalizar-assinatura-avancada`,
		evidencias,
		onEtapa
	);
}

export async function assinarPresencaComPasskey(
	giseId: number,
	tipo: 'entrada' | 'saida',
	evidencias: EvidenciasAssinatura,
	onEtapa?: (rotulo: string) => void
): Promise<unknown> {
	return assinarComPasskeyDuasFases(
		`/api/gise/${giseId}/presenca/preparar-assinatura-avancada`,
		`/api/gise/${giseId}/presenca/finalizar-assinatura-avancada?tipo=${tipo}`,
		{ ...evidencias, tipo },
		onEtapa
	);
}
