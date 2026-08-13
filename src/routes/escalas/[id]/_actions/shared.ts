/**
 * Preâmbulo comum às form actions de `/escalas/[id]`.
 *
 * Preâmbulo é o trecho que TODA action repete antes de mutar: autentica, valida
 * o id, confere permissão e — para operações de conteúdo — que a escala ainda
 * POSSA mudar. Fica num módulo só porque a alternativa já custou caro: quando
 * as catorze actions carregavam a escala cada uma à sua maneira, só UMA checava
 * `finalizada_em` e nenhuma checava assinatura (FLW-ESC-003).
 */
import { fail } from '@sveltejs/kit';
import { getDB, buscarEscala, buscarDocumentoEscala } from '$lib/db';
import { podeMexerNaEscala } from '$lib/server/escalas/permissao';

/**
 * O que a action vai fazer com a escala. **Parâmetro obrigatório de
 * propósito**: é ele que decide se o guard de imutabilidade roda, e deixá-lo
 * opcional faria a próxima action nascer sem proteção por omissão.
 *
 * - `'conteudo'` — mexe em QUEM está na escala ou em QUANDO (composição,
 *   datas, horários). É o que o documento assinado atesta, e por isso trava
 *   depois de assinar ou finalizar.
 * - `'ciclo'` — o ciclo de vida em si (finalizar, reabrir, reenviar) e a
 *   projeção do mês seguinte, que cria escala NOVA sem tocar nesta. Não pode
 *   travar pelo próprio estado que ela existe para mudar.
 */
export type OperacaoEscala = 'conteudo' | 'ciclo';

/**
 * Preâmbulo único das actions: autentica, valida o id, confere permissão e —
 * para operações de conteúdo — que a escala ainda possa mudar.
 *
 * DPC admin com solicitação de assinatura pode VER e ASSINAR, mas não MUTAR;
 * por isso a restrição por lotação continua valendo aqui, mesmo depois de a
 * leitura ter passado por `verificarPermissaoEscala`.
 *
 * **Imutabilidade após assinatura (FLW-ESC-003).** Havia PDF assinado, com
 * hash e carimbo de tempo, atestando uma composição que qualquer das dez
 * actions de conteúdo podia trocar por baixo — o documento seguia válido
 * criptograficamente e passava a descrever uma escala que não existe mais. A
 * UI escondia os controles; o servidor aceitava o POST. Só uma das catorze
 * actions checava `finalizada_em`, e nenhuma checava assinatura.
 *
 * Voltar a poder editar exige o caminho explícito e auditado que já existe:
 * revogar a assinatura (`DELETE /api/escalas/[id]/documento-assinado`) ou
 * reabrir o FDS (action `desfinalizar`).
 *
 * Devolve `db`/`escala`/`escalaId`/`usuario`, ou um `fail()` pronto.
 */
export async function carregarEscalaComPermissao(
	platform: App.Platform | undefined,
	usuario: App.Locals['usuario'],
	escalaIdRaw: string | undefined,
	operacao: OperacaoEscala
) {
	if (!usuario) {
		return { erro: fail(401, { error: 'Não autorizado' }) } as const;
	}
	const escalaId = Number(escalaIdRaw);
	if (isNaN(escalaId)) {
		return { erro: fail(400, { error: 'ID da escala inválido' }) } as const;
	}
	const db = getDB(platform);
	const escala = await buscarEscala(db, escalaId);
	if (!escala) {
		return { erro: fail(404, { error: 'Escala não encontrada' }) } as const;
	}
	if (!podeMexerNaEscala(usuario, escala.lotacao)) {
		return { erro: fail(403, { error: 'Sem permissão para alterar esta escala' }) } as const;
	}

	if (operacao === 'conteudo') {
		if (escala.finalizada_em) {
			return {
				erro: fail(409, {
					error: 'Escala finalizada. Reabra-a antes de alterar a composição.'
				})
			} as const;
		}
		if (await buscarDocumentoEscala(db, escalaId)) {
			return {
				erro: fail(409, {
					error: 'Escala já assinada. Revogue a assinatura antes de alterar a composição.'
				})
			} as const;
		}
	}

	return { db, escala, escalaId, usuario } as const;
}
