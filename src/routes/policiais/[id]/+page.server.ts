/**
 * Ficha do POLICIAL (`/policiais/[id]`) — a tela de vida funcional: dados
 * cadastrais, papel administrativo, vínculo de Admin Geral e a linha do tempo
 * de movimentações, afastamentos e desvinculação.
 *
 * **Tudo aqui é restrito ao Admin Geral**, e a restrição é imposta em três
 * camadas independentes: o `load` redireciona, cada action confere de novo, e
 * as ações de histórico passam por `autorizarAcao`. Não é redundância inútil —
 * a tela esconde botões, mas POST direto tem de morrer no servidor.
 *
 * As três ações de histórico têm a mesma forma, e a ordem importa:
 *
 *   autorizar → validar (Zod) → **upload do PDF** → mutar → registrar histórico
 *   → auditar
 *
 * O upload vem ANTES da mutação de propósito: anexo inválido (não-PDF, > 10 MB,
 * R2 fora do ar) aborta com 400 sem ter mexido no cadastro. Invertido, um
 * policial ficaria movimentado com a portaria faltando.
 *
 * O que cada ação decide:
 *
 * - `salvar` — dados cadastrais. Matrícula duplicada vira 409 legível
 *   (`ehViolacaoUnique`), não 500 com SQL cru;
 * - `salvarPapel` — concede/revoga papel. Papel SEM unidade de
 *   responsabilidade é recusado: papel sem alcance deixa o escopo do RBAC
 *   indefinido;
 * - `toggleAdminGeral` — cria ou remove a conta administrativa VINCULADA ao
 *   policial. É a concessão mais forte do sistema, e por isso é a única
 *   auditada com `metadados` do estado alvo;
 * - `registrarMovimentacao` — troca a lotação E registra na linha do tempo.
 *   Recusa destino igual à origem, que só sujaria o histórico;
 * - `registrarAfastamento` — férias/licença. NÃO altera o cadastro: afastado
 *   continua ativo e escalável, e é `afastamentoVigente` que diz à tela quem
 *   está fora hoje;
 * - `registrarDesvinculacao` — inativa (`ativo: 0`), nunca apaga. O histórico
 *   de escalas continua apontando para o policial.
 */
import { redirect, fail, error } from '@sveltejs/kit';
import { ehViolacaoUnique } from '$lib/server/db-errors';
import type { PageServerLoad, Actions } from './$types';
import {
	getDB,
	getR2,
	hasR2,
	buscarPolicial,
	atualizarPolicial,
	listarLotacoes,
	listarUnidades,
	promoverPolicial,
	vincularAdminGeral,
	desvincularAdminGeral,
	ehAdminGeralVinculado,
	registrarHistorico,
	listarHistoricoPolicial,
	afastamentoVigente,
	auditar,
	contextoDeEvento
} from '$lib/db';
import { policialUpdateSchema } from '$lib/schemas/policial';
import {
	movimentacaoSchema,
	afastamentoSchema,
	desvinculacaoSchema,
	LABEL_SUBTIPO_AFASTAMENTO
} from '$lib/schemas/policial-historico';
import { isAdminGeral, isAdminSeccional, isAdminUnidade } from '$lib/auth';
import { lotacoesAdministradas, lotacaoNoEscopo } from '$lib/server/policial-permissao';
import { decifrarCpfDoDB } from '$lib/crypto/cpf-cripto';
import { resolverCredencial, revogarSessoesDaCredencial } from '$lib/server/auth/credencial';
import { getNowBR } from '$lib/utils/datas';
import type { RequestEvent } from './$types';

/** Data de hoje no fuso de Brasília (UTC-3) no formato ISO YYYY-MM-DD. */
function hojeBrasilISO(): string {
	return getNowBR().toISOString().slice(0, 10);
}

const TAMANHO_MAX_PDF = 10 * 1024 * 1024; // 10 MB

/**
 * Faz upload best-effort de um PDF anexo (Portaria/Documento) para o R2 e
 * devolve `{ key, nome }`, ou `null` quando nenhum arquivo foi enviado.
 * Lança `Error` com mensagem amigável em caso de arquivo inválido.
 */
async function uploadDocumento(
	event: RequestEvent,
	formData: FormData,
	policialId: number
): Promise<{ key: string; nome: string } | null> {
	const arquivo = formData.get('documento');
	if (!(arquivo instanceof File) || arquivo.size === 0) return null;

	if (arquivo.type && arquivo.type !== 'application/pdf') {
		throw new Error('O documento deve ser um PDF.');
	}
	if (arquivo.size > TAMANHO_MAX_PDF) {
		throw new Error('O documento excede o tamanho máximo de 10 MB.');
	}
	if (!hasR2(event.platform)) {
		throw new Error('Armazenamento de documentos indisponível no momento.');
	}

	const key = `policial-historico/${policialId}/${crypto.randomUUID()}.pdf`;
	const bytes = await arquivo.arrayBuffer();
	await getR2(event.platform).put(key, bytes, {
		httpMetadata: { contentType: 'application/pdf' }
	});
	const nome = arquivo.name?.slice(0, 200) || 'documento.pdf';
	return { key, nome };
}

/**
 * Autoriza a ação e devolve o `{ db, alvo }`, ou uma `Response`/objeto `fail`.
 * Todas as operações de histórico são restritas ao Admin Geral (a própria
 * página já exige isso no `load`).
 */
async function autorizarAcao(event: RequestEvent) {
	const { locals, platform, params } = event;
	const u = locals.usuario;
	if (!u || !isAdminGeral(u)) {
		return { erro: fail(403, { error: 'Apenas o Admin Geral pode registrar movimentações.' }) };
	}
	const id = Number(params.id);
	if (isNaN(id)) return { erro: fail(400, { error: 'ID inválido' }) };

	const db = getDB(platform);
	const alvo = await buscarPolicial(db, id);
	if (!alvo) return { erro: fail(404, { error: 'Policial não encontrado' }) };
	return { u, db, id, alvo };
}

export const load: PageServerLoad = async ({ locals, params, platform, depends }) => {
	const id = Number(params.id);
	if (!isNaN(id)) depends(`policial:${id}`);

	const u = locals.usuario;
	if (!u) redirect(302, '/login');

	if (!isAdminGeral(u)) {
		redirect(302, '/');
	}

	if (isNaN(id)) error(400, 'ID inválido');

	const db = getDB(platform);
	const policial = await buscarPolicial(db, id);
	if (!policial) error(404, 'Policial não encontrado');

	const isAdm = isAdminGeral(u);
	const isSeccional = isAdminSeccional(u);
	const isUnidade = isAdminUnidade(u);

	const [lotacoes, todasUnidades, ehAdminGeral, historico] = await Promise.all([
		isAdm ? listarLotacoes(db) : Promise.resolve<string[]>([]),
		isAdm || isSeccional || isUnidade ? listarUnidades(db) : Promise.resolve([]),
		ehAdminGeralVinculado(db, id),
		listarHistoricoPolicial(db, id)
	]);

	// CPF é cifrado em repouso (LGPD) — decifra para o formulário de edição
	// (público restrito a Admin Geral).
	const cpfClaro = await decifrarCpfDoDB(policial.cpf, platform?.env);

	const afastamentoAtual = afastamentoVigente(historico, hojeBrasilISO());

	return {
		policial: {
			...policial,
			cpf: cpfClaro || null,
			papel: policial.papel ?? null,
			papel_unidade_id: policial.papel_unidade_id ?? null
		},
		lotacoes,
		unidades: todasUnidades,
		isAdmin: isAdm,
		isAdminOrSeccional: isAdm || isSeccional,
		isAdminUnidade: isUnidade,
		ehAdminGeral,
		historico,
		afastamentoVigenteId: afastamentoAtual?.id ?? null
	};
};

/** Remove campos sensíveis (CPF/senha) antes de gravar um snapshot no log. */
function semCamposSensiveis(o: Record<string, unknown>): Record<string, unknown> {
	const copia: Record<string, unknown> = { ...o };
	delete copia.cpf;
	delete copia.senha;
	delete copia.cpf_index;
	return copia;
}

/** Campos que mudam com frequência técnica e não interessam ao histórico funcional. */
const CAMPOS_IGNORAR_DIFF = new Set(['updated_at', 'created_at', 'id']);

/**
 * Compara dois snapshots e devolve apenas os campos cujo valor mudou, em dois
 * objetos paralelos (`antes`/`depois`). Usado para não registrar "edições" que
 * não alteraram nada e para deixar o histórico legível.
 */
function camposAlterados(
	antes: Record<string, unknown>,
	depois: Record<string, unknown>
): { antes: Record<string, unknown>; depois: Record<string, unknown> } {
	const difAntes: Record<string, unknown> = {};
	const difDepois: Record<string, unknown> = {};
	for (const chave of Object.keys(depois)) {
		if (CAMPOS_IGNORAR_DIFF.has(chave)) continue;
		const va = antes[chave] ?? null;
		const vd = depois[chave] ?? null;
		if (va !== vd) {
			difAntes[chave] = va;
			difDepois[chave] = vd;
		}
	}
	return { antes: difAntes, depois: difDepois };
}

export const actions: Actions = {
	salvar: async (event) => {
		const { request, locals, platform, params } = event;
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });
		if (!isAdminGeral(u)) {
			return fail(403, { error: 'Sem permissão para editar policiais' });
		}

		const id = Number(params.id);
		if (isNaN(id)) return fail(400, { error: 'ID inválido' });

		const formData = await request.formData();
		const data = {
			nome: formData.get('nome')?.toString() || '',
			matricula: formData.get('matricula')?.toString() || '',
			cargo: formData.get('cargo')?.toString() as 'DPC' | 'OIP',
			cpf: formData.get('cpf')?.toString() || '',
			telefone: formData.get('telefone')?.toString() || '',
			lotacao: formData.get('lotacao')?.toString() || '',
			regime: formData.get('regime')?.toString() as 'plantao' | 'expediente' | 'ambos',
			classe: formData.get('classe')?.toString() || '',
			email: formData.get('email')?.toString() || null
		};

		const parsed = policialUpdateSchema.safeParse(data);
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0].message, fields: data });
		}

		const db = getDB(platform);
		const alvo = await buscarPolicial(db, id);
		if (!alvo) return fail(404, { error: 'Policial não encontrado', fields: data });

		const escopo = await lotacoesAdministradas(db, u);
		if (!lotacaoNoEscopo(escopo, alvo.lotacao)) {
			return fail(403, { error: 'Sem permissão para editar este policial', fields: data });
		}
		// Bloqueia transferência para fora do escopo do administrador (impede
		// admin_seccional/admin_unidade de "exportar" um policial e perder o
		// controle sobre ele depois).
		if (!lotacaoNoEscopo(escopo, data.lotacao)) {
			return fail(403, {
				error: 'Não é possível transferir o policial para fora das unidades sob sua administração',
				fields: data
			});
		}

		try {
			await atualizarPolicial(
				db,
				id,
				{ ...parsed.data, email: data.email ?? undefined },
				platform?.env
			);
			const antes = semCamposSensiveis(alvo);
			const depois = semCamposSensiveis({ ...parsed.data, email: data.email ?? undefined });

			// Registra no histórico funcional apenas os campos que de fato mudaram,
			// para a linha do tempo não poluir com "edições" sem alteração real.
			const diff = camposAlterados(antes, depois);
			if (Object.keys(diff.antes).length > 0) {
				await registrarHistorico(db, {
					policial_id: id,
					tipo: 'edicao',
					descricao: `Cadastro editado: ${Object.keys(diff.depois).join(', ')}`,
					dados_antes: diff.antes,
					dados_depois: diff.depois,
					registrado_por_id: u.id,
					registrado_por_nome: u.nome
				});
			}

			const { contexto, env } = contextoDeEvento(event);
			await auditar(
				db,
				{
					acao: 'editar_policial',
					usuario: u,
					entidade: 'policial',
					entidade_id: id,
					alvo_tipo: 'policial',
					alvo_id: id,
					alvo_nome: parsed.data.nome,
					detalhes: `Policial editado: ${parsed.data.nome} (mat. ${parsed.data.matricula})`,
					dados_antes: antes,
					dados_depois: depois,
					...contexto
				},
				{ env }
			);
			return { success: true };
		} catch (e: unknown) {
			// A violação de índice único fica em `e.cause` (ver `db-errors.ts`).
			if (ehViolacaoUnique(e)) {
				return fail(409, { error: 'Matrícula já cadastrada', fields: data });
			}
			return fail(500, { error: 'Erro interno ao atualizar policial', fields: data });
		}
	},

	salvarPapel: async (event) => {
		const { request, locals, platform, params } = event;
		const u = locals.usuario;
		if (!u || !isAdminGeral(u))
			return fail(403, { error: 'Apenas o Admin Geral pode alterar papéis' });

		const id = Number(params.id);
		if (isNaN(id)) return fail(400, { error: 'ID inválido' });

		const formData = await request.formData();
		const papel = (formData.get('papel')?.toString() || null) as
			'admin_seccional' | 'admin_unidade' | null;
		const papelUnidadeIdStr = formData.get('papel_unidade_id')?.toString();
		const papelUnidadeId = papelUnidadeIdStr ? Number(papelUnidadeIdStr) : null;

		// Papel administrativo exige a unidade/seccional de responsabilidade.
		if (papel && !papelUnidadeId) {
			return fail(400, {
				error: 'Selecione a unidade de responsabilidade para o papel escolhido.'
			});
		}

		const db = getDB(platform);
		const alvo = await buscarPolicial(db, id);
		await promoverPolicial(db, id, papel, papelUnidadeId);

		if (u) {
			await registrarHistorico(db, {
				policial_id: id,
				tipo: 'papel',
				descricao: `Papel administrativo alterado para ${papel ?? 'nenhum'}`,
				dados_antes: {
					papel: alvo?.papel ?? null,
					papel_unidade_id: alvo?.papel_unidade_id ?? null
				},
				dados_depois: { papel, papel_unidade_id: papelUnidadeId },
				registrado_por_id: u.id,
				registrado_por_nome: u.nome
			});
		}

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'mudar_papel',
				usuario: u,
				entidade: 'policial',
				entidade_id: id,
				alvo_tipo: 'policial',
				alvo_id: id,
				alvo_nome: alvo?.nome ?? null,
				detalhes: `Papel alterado para ${papel ?? 'nenhum'}${papelUnidadeId ? ` (unidade ${papelUnidadeId})` : ''}`,
				dados_antes: {
					papel: alvo?.papel ?? null,
					papel_unidade_id: alvo?.papel_unidade_id ?? null
				},
				dados_depois: { papel, papel_unidade_id: papelUnidadeId },
				...contexto
			},
			{ env }
		);
		return { success: true };
	},

	// Admin Geral agora é uma conta VINCULADA em `administradores` (login pela
	// matrícula, sem senha própria). O policial passa a poder logar escolhendo
	// "Administrador" com a mesma matrícula/senha. Cumulativo com o `papel`.
	toggleAdminGeral: async (event) => {
		const { request, locals, platform, params } = event;
		const u = locals.usuario;
		if (!u || !isAdminGeral(u))
			return fail(403, { error: 'Apenas o Admin Geral pode conceder Admin Geral' });

		const id = Number(params.id);
		if (isNaN(id)) return fail(400, { error: 'ID inválido' });

		const ativar = formData2Bool((await request.formData()).get('ativar'));
		const db = getDB(platform);
		const policial = await buscarPolicial(db, id);
		if (!policial) return fail(404, { error: 'Policial não encontrado' });

		try {
			if (ativar) {
				await vincularAdminGeral(db, policial);
			} else {
				await desvincularAdminGeral(db, id);
			}
		} catch (e: unknown) {
			if (ehViolacaoUnique(e)) {
				return fail(409, {
					error: 'Já existe um administrador com este login/matrícula.'
				});
			}
			return fail(500, { error: 'Erro ao atualizar a condição de Admin Geral' });
		}

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'toggle_admin_geral',
				usuario: u,
				entidade: 'policial',
				entidade_id: id,
				alvo_tipo: 'policial',
				alvo_id: id,
				alvo_nome: policial.nome,
				resultado: 'sucesso',
				detalhes: `${ativar ? 'Concedido' : 'Removido'} Admin Geral para ${policial.nome} (mat. ${policial.matricula})`,
				metadados: { ativar },
				...contexto
			},
			{ env }
		);
		return { success: true };
	},

	// ---- Movimentação: transfere a lotação e registra no histórico ----
	registrarMovimentacao: async (event) => {
		const auth = await autorizarAcao(event);
		if ('erro' in auth) return auth.erro;
		const { u, db, id, alvo } = auth;

		const formData = await event.request.formData();
		const parsed = movimentacaoSchema.safeParse({
			unidade_destino: formData.get('unidade_destino')?.toString() || '',
			data_evento: formData.get('data_evento')?.toString() || '',
			nup: formData.get('nup')?.toString() || ''
		});
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });

		let doc: { key: string; nome: string } | null;
		try {
			doc = await uploadDocumento(event, formData, id);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Falha no upload do documento' });
		}

		const origem = alvo.lotacao || '';
		if (parsed.data.unidade_destino === origem) {
			return fail(400, { error: 'A unidade de destino é igual à unidade atual.' });
		}
		await atualizarPolicial(db, id, { lotacao: parsed.data.unidade_destino });
		await registrarHistorico(db, {
			policial_id: id,
			tipo: 'movimentacao',
			unidade_origem: origem,
			unidade_destino: parsed.data.unidade_destino,
			data_evento: parsed.data.data_evento,
			nup: parsed.data.nup || null,
			documento_r2_key: doc?.key ?? null,
			documento_nome: doc?.nome ?? null,
			registrado_por_id: u.id,
			registrado_por_nome: u.nome
		});
		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'registrar_movimentacao',
				usuario: u,
				entidade: 'policial',
				entidade_id: id,
				alvo_tipo: 'policial',
				alvo_id: id,
				alvo_nome: alvo.nome,
				detalhes: `Movimentação: ${origem || '—'} → ${parsed.data.unidade_destino}`,
				metadados: { nup: parsed.data.nup || null, data: parsed.data.data_evento },
				...contexto
			},
			{ env }
		);
		return { success: true, tipo: 'movimentacao' };
	},

	// ---- Afastamento: férias/licenças (apenas registra na linha do tempo) ----
	registrarAfastamento: async (event) => {
		const auth = await autorizarAcao(event);
		if ('erro' in auth) return auth.erro;
		const { u, db, id, alvo } = auth;

		const formData = await event.request.formData();
		const qtdRaw = formData.get('qtd_dias')?.toString() || '';
		const parsed = afastamentoSchema.safeParse({
			subtipo: formData.get('subtipo')?.toString() || '',
			descricao: formData.get('descricao')?.toString() || '',
			data_inicio: formData.get('data_inicio')?.toString() || '',
			data_fim: formData.get('data_fim')?.toString() || '',
			qtd_dias: qtdRaw === '' ? undefined : qtdRaw,
			nup: formData.get('nup')?.toString() || ''
		});
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });
		if (parsed.data.data_fim < parsed.data.data_inicio) {
			return fail(400, { error: 'A data final não pode ser anterior à data inicial.' });
		}

		let doc: { key: string; nome: string } | null;
		try {
			doc = await uploadDocumento(event, formData, id);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Falha no upload do documento' });
		}

		await registrarHistorico(db, {
			policial_id: id,
			tipo: 'afastamento',
			subtipo: parsed.data.subtipo,
			descricao: parsed.data.descricao || null,
			data_inicio: parsed.data.data_inicio,
			data_fim: parsed.data.data_fim,
			qtd_dias: parsed.data.qtd_dias ?? null,
			nup: parsed.data.nup || null,
			documento_r2_key: doc?.key ?? null,
			documento_nome: doc?.nome ?? null,
			registrado_por_id: u.id,
			registrado_por_nome: u.nome
		});
		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'registrar_afastamento',
				usuario: u,
				entidade: 'policial',
				entidade_id: id,
				alvo_tipo: 'policial',
				alvo_id: id,
				alvo_nome: alvo.nome,
				detalhes: `Afastamento (${LABEL_SUBTIPO_AFASTAMENTO[parsed.data.subtipo]}): ${parsed.data.data_inicio} a ${parsed.data.data_fim}`,
				metadados: { subtipo: parsed.data.subtipo, nup: parsed.data.nup || null },
				...contexto
			},
			{ env }
		);
		return { success: true, tipo: 'afastamento' };
	},

	// ---- Desvinculação: baixa do policial (inativa e registra) ----
	registrarDesvinculacao: async (event) => {
		const auth = await autorizarAcao(event);
		if ('erro' in auth) return auth.erro;
		const { u, db, id, alvo } = auth;

		const formData = await event.request.formData();
		const parsed = desvinculacaoSchema.safeParse({
			destino: formData.get('destino')?.toString() || '',
			data_evento: formData.get('data_evento')?.toString() || '',
			nup: formData.get('nup')?.toString() || ''
		});
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });

		let doc: { key: string; nome: string } | null;
		try {
			doc = await uploadDocumento(event, formData, id);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Falha no upload do documento' });
		}

		await atualizarPolicial(db, id, { ativo: 0 });

		// Desativar tem de tirar a pessoa de DENTRO, não só impedir o próximo
		// login: sessão aberta continuaria funcionando até expirar (8h). Cobre as
		// duas identidades — quem tem Admin Geral vinculado tem dois cookies
		// possíveis, e o de administrador é o mais poderoso (FLW-RBAC-001).
		await revogarSessoesDaCredencial(db, await resolverCredencial(db, 'policial', id));
		await registrarHistorico(db, {
			policial_id: id,
			tipo: 'desvinculacao',
			descricao: parsed.data.destino,
			unidade_origem: alvo.lotacao || '',
			unidade_destino: parsed.data.destino,
			data_evento: parsed.data.data_evento,
			nup: parsed.data.nup || null,
			documento_r2_key: doc?.key ?? null,
			documento_nome: doc?.nome ?? null,
			registrado_por_id: u.id,
			registrado_por_nome: u.nome
		});
		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'desvincular_policial',
				usuario: u,
				entidade: 'policial',
				entidade_id: id,
				alvo_tipo: 'policial',
				alvo_id: id,
				alvo_nome: alvo.nome,
				resultado: 'sucesso',
				detalhes: `Desvinculação de ${alvo.nome} (mat. ${alvo.matricula}) → ${parsed.data.destino}`,
				metadados: { nup: parsed.data.nup || null, data: parsed.data.data_evento },
				...contexto
			},
			{ env }
		);
		return { success: true, tipo: 'desvinculacao' };
	}
};

function formData2Bool(v: FormDataEntryValue | null): boolean {
	const s = String(v ?? '').toLowerCase();
	return s === '1' || s === 'true' || s === 'on';
}
