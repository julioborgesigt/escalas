/**
 * Form actions do CICLO DE VIDA do FDS em `/escalas/[id]`.
 *
 * A escala de fim de semana não é assinada — é ENVIADA por e-mail com o `.docx`
 * anexo. `finalizar` grava o destinatário e dispara o envio, `reenviarEmail`
 * repete o envio sem refazer o registro, `desfinalizar` reabre.
 *
 * São operações de `'ciclo'`, não de `'conteudo'`: não podem travar pelo próprio
 * estado que existem para mudar.
 */
import { fail } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import {
	listarPoliciaisEscala,
	registrarAuditComContexto,
	contextoDeEvento,
	finalizarEscalaFDS,
	desfinalizarEscalaFDS
} from '$lib/db';
import * as exportLib from '$lib/server/export';
import { enviarEscalaFDSPorEmail } from '$lib/server/email';
import { logger } from '$lib/server/logger';
import { eq } from 'drizzle-orm';
import { escalas as escalasTable } from '$lib/server/schema';
import { carregarEscalaComPermissao } from './shared';
import { registrarMudancaEscala } from './desfecho';

/** O `event` das actions desta rota: `params.id` é a escala. */
type Event = RequestEvent<{ id: string }>;

export const actionsCiclo = {
	/**
	 * Encerra a escala de FDS ENVIANDO o PDF por e-mail ao destino informado.
	 *
	 * No FDS não há assinatura digital (a escala não exige): o marco de conclusão
	 * é a entrega, e é o envio que grava `finalizada_em`.
	 */
	finalizar: async (event: Event) => {
		const { request, locals, platform, params } = event;
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id, 'ciclo');
		if ('erro' in ctx) return ctx.erro;
		const { db, escala, escalaId, usuario: u } = ctx;

		if (escala.tipo !== 'fds')
			return fail(400, { error: 'Operação válida apenas para escalas de FDS' });

		const formData = await request.formData();
		const emailDestino = (formData.get('email_destino') as string | null)?.trim() ?? '';
		if (!emailDestino || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailDestino)) {
			return fail(400, { error: 'E-mail de destino inválido' });
		}

		// Finalizar duas vezes gravaria um novo `finalizada_em` por cima do
		// primeiro — a data de conclusão do documento passaria a ser a da segunda
		// tentativa. Para reenviar existe a action própria.
		if (escala.finalizada_em) {
			return fail(409, {
				error: 'Escala já finalizada. Use "Reenviar e-mail" para mandar de novo.'
			});
		}

		try {
			const policiais = await listarPoliciaisEscala(db, escalaId);
			const nomeArquivo = `${escala.titulo.replace(/[/\\?%*:|"<>]/g, '-')}.docx`;

			// A ENTREGA VEM PRIMEIRO, e a ordem é a correção (FLW-ESC-006).
			//
			// No FDS não há assinatura digital: o marco de conclusão É a entrega por
			// e-mail. Gravar `finalizada_em` antes de enviar invertia isso — a
			// falha virava um `logger.warn`, a resposta dizia sucesso e a trilha
			// registrava "finalizada e enviada para X" para um e-mail que não saiu.
			// A escala ficava fechada para edição, com destinatário nenhum
			// informado, e ninguém sabia.
			//
			// Falhando o envio, nada é gravado: a escala continua editável e o
			// operador tenta de novo. O risco invertido — timeout que na verdade
			// entregou, e o reenvio manda duas vezes — é aceitável: e-mail
			// duplicado se resolve lendo; escala fechada sem entrega, não.
			try {
				await Promise.race([
					(async () => {
						const docxBuffer = await exportLib.gerarDocx(escala, policiais);
						await enviarEscalaFDSPorEmail(
							emailDestino,
							escala.titulo,
							u.nome,
							docxBuffer,
							nomeArquivo,
							platform
						);
					})(),
					new Promise<void>((_, reject) =>
						setTimeout(() => reject(new Error('Timeout (25s)')), 25_000)
					)
				]);
			} catch (emailErr) {
				const msg = emailErr instanceof Error ? emailErr.message : String(emailErr);
				logger.error('[escalas/finalizar] Envio falhou — escala NÃO foi finalizada', {
					escalaId,
					emailDestino,
					error: msg
				});

				const { contexto, env } = contextoDeEvento(event);
				await registrarAuditComContexto(db, {
					usuario: u,
					acao: 'finalizar_escala_fds',
					entidade: 'escala',
					entidade_id: escalaId,
					alvo_tipo: 'escala',
					alvo_id: escalaId,
					// `resultado: 'falha'` é o que separa a tentativa do ato na trilha.
					resultado: 'falha',
					detalhes: `Falha ao entregar a escala de FDS em ${emailDestino}: ${msg}`,
					metadados: { emailDestino, emailEnviado: false },
					...contexto,
					env
				});

				return fail(502, {
					error:
						'Não foi possível enviar a escala por e-mail. Ela continua aberta — ' +
						'confira o endereço e tente novamente.'
				});
			}

			await finalizarEscalaFDS(db, escalaId, emailDestino);

			const { contexto, env } = contextoDeEvento(event);
			await registrarAuditComContexto(db, {
				usuario: u,
				acao: 'finalizar_escala_fds',
				entidade: 'escala',
				entidade_id: escalaId,
				alvo_tipo: 'escala',
				alvo_id: escalaId,
				detalhes: `Escala de FDS finalizada e enviada para ${emailDestino}: ${escala.titulo}`,
				metadados: { emailDestino, emailEnviado: true },
				...contexto,
				env
			});
			return { success: true, emailDestino, emailEnviado: true };
		} catch {
			return fail(500, { error: 'Erro ao finalizar escala' });
		}
	},

	/** Reabre a escala de FDS para correção, limpando `finalizada_em`. */
	desfinalizar: async (event: Event) => {
		const { locals, platform, params } = event;
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id, 'ciclo');
		if ('erro' in ctx) return ctx.erro;
		const { db, escala, escalaId, usuario: u } = ctx;

		if (escala.tipo !== 'fds')
			return fail(400, { error: 'Operação válida apenas para escalas de FDS' });

		try {
			await desfinalizarEscalaFDS(db, escalaId);

			// Reabrir desfaz um documento que JÁ CIRCULOU fora do sistema: o PDF
			// está na caixa de entrada de alguém e vai divergir da escala a partir
			// da próxima edição. É `critico` no catálogo por isso.
			await registrarMudancaEscala(event, {
				db,
				escalaId,
				usuario: u,
				acao: 'reabrir_escala_fds',
				alvo: { tipo: 'escala', id: escalaId, nome: escala.titulo },
				detalhes: `Escala de FDS reaberta para correção (havia sido enviada para ${escala.email_envio ?? 'destino não registrado'})`,
				itens: 0,
				dados_antes: { finalizada_em: escala.finalizada_em, email_envio: escala.email_envio },
				dados_depois: { finalizada_em: null }
			});

			return { success: true };
		} catch {
			return fail(500, { error: 'Erro ao reabrir escala' });
		}
	},

	/** Reenvia o PDF da escala de FDS já finalizada (endereço errado, caixa cheia). */
	reenviarEmail: async (event: Event) => {
		const { request, locals, platform, params } = event;
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id, 'ciclo');
		if ('erro' in ctx) return ctx.erro;
		const { db, escala, escalaId, usuario: u } = ctx;

		if (escala.tipo !== 'fds')
			return fail(400, { error: 'Operação válida apenas para escalas de FDS' });

		// Reenvio é do documento já entregue — sem finalizada_em seria exportar
		// rascunho aberto por e-mail (FLW-AUT-011).
		if (!escala.finalizada_em) {
			return fail(409, {
				error: 'Só é possível reenviar e-mail de escala de FDS já finalizada.'
			});
		}

		const formData = await request.formData();
		const emailDestino = (formData.get('email_destino') as string | null)?.trim() ?? '';
		if (!emailDestino || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailDestino)) {
			return fail(400, { error: 'E-mail de destino inválido' });
		}

		try {
			const policiais = await listarPoliciaisEscala(db, escalaId);
			const nomeArquivo = `${escala.titulo.replace(/[/\\?%*:|"<>]/g, '-')}.docx`;

			// Atualiza o e-mail armazenado caso tenha mudado
			if (emailDestino !== escala.email_envio) {
				await db
					.update(escalasTable)
					.set({ email_envio: emailDestino })
					.where(eq(escalasTable.id, escalaId));
			}

			await Promise.race([
				(async () => {
					const docxBuffer = await exportLib.gerarDocx(escala, policiais);
					await enviarEscalaFDSPorEmail(
						emailDestino,
						escala.titulo,
						u.nome,
						docxBuffer,
						nomeArquivo,
						platform
					);
				})(),
				new Promise<void>((_, reject) =>
					setTimeout(() => reject(new Error('Timeout (25s)')), 25_000)
				)
			]);

			// Entrega de documento a um endereço externo: é o mesmo ato que
			// `finalizar` audita, repetido — e o motivo de repeti-lo (endereço
			// errado, caixa cheia) é exatamente o que se quer poder reconstituir.
			await registrarMudancaEscala(event, {
				db,
				escalaId,
				usuario: u,
				acao: 'reenviar_escala_fds',
				alvo: { tipo: 'escala', id: escalaId, nome: escala.titulo },
				detalhes: `Escala de FDS reenviada para ${emailDestino}`,
				itens: policiais.length,
				metadados: { emailDestino, email_anterior: escala.email_envio }
			});

			return { success: true, emailDestino };
		} catch (err) {
			const msg =
				err instanceof Error && err.message.startsWith('Timeout')
					? 'O envio demorou demais. Tente novamente.'
					: 'Erro ao reenviar e-mail';
			return fail(500, { error: msg });
		}
	}
};
