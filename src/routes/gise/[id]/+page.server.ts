import type { PageServerLoad, Actions } from './$types';
import { redirect, error } from '@sveltejs/kit';
import {
	getDB,
	buscarGiseDetalhado,
	buscarPresencasGise,
	buscarAssinaturasRelatoriosGise,
	buscarRestringirSmartphone
} from '$lib/db';
import { isAdminGeral, isAdminSeccional, isAdminUnidade } from '$lib/auth';
import { decifrarCpfDoDB } from '$lib/crypto/cpf-cripto';
import { getBreveRelatorioEnvMergido } from '$lib/server/breve-relatorio-env';
import { buscarUnidadeIdSupervisaoExtra } from '$lib/server/gise-supervisao-extra';
import { adminParticipaDaGise } from '$lib/server/gise-permissao';
import { logger } from '$lib/server/logger';
import { unidades, policiais, giseRespostasFormulario } from '$lib/server/schema';
import { eq, asc, inArray, and, isNull } from 'drizzle-orm';
import { actionsEscala } from './_actions/actions-escala';
import { actionsSeccional } from './_actions/actions-seccional';
import { actionsEquipe } from './_actions/actions-equipe';
import { actionsMembros } from './_actions/actions-membros';
import { actionsUnidade } from './_actions/actions-unidade';

export const load: PageServerLoad = async ({ locals, params, platform, depends, parent }) => {
	depends('gise:detail');
	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');

	const id = parseInt(params.id);
	if (isNaN(id)) throw error(400, 'ID inválido');

	const db = getDB(platform);

	const isGeral = isAdminGeral(u);
	const isSeccional = isAdminSeccional(u);

	// isSupervisorGise já resolvido pelo layout (evita query duplicada)
	const parentData = await parent();
	const isSupervisor = u.tipo === 'policial' ? (parentData.isSupervisorGise ?? false) : false;

	// Escopo por participação (Opção B): admin seccional só abre GISEs que
	// incluem a seccional que ele administra — não qualquer GISE.
	const isSeccionalParticipante =
		isSeccional && (await adminParticipaDaGise(db, id, u.papel_unidade_id));
	if (!isGeral && !isSeccionalParticipante && !isSupervisor) {
		throw redirect(302, '/');
	}

	try {
		const gise = await buscarGiseDetalhado(db, id);
		if (!gise) throw error(404, 'Escala GISE não encontrada');

		// CPF do documento assinado é cifrado em repouso (LGPD) — decifra p/ exibição.
		if (gise.documento) {
			gise.documento.assinante_cpf = await decifrarCpfDoDB(
				gise.documento.assinante_cpf,
				platform?.env
			);
		}

		const supportIds = [
			gise.supervisor_id,
			gise.assessor_id,
			gise.seint1_id,
			gise.seint2_id
		].filter((val): val is number => val !== null);

		// Antes carregávamos até 10 000 policiais aqui só para popular `<SearchableSelect>`
		// no cliente. Agora os selects buscam sob demanda em `/api/policiais/search`
		// (paginado, com RBAC). O servidor só envia o **mínimo necessário** para
		// renderizar labels dos valores já selecionados:
		//   - Os 4 supportIds (supervisor/assessor/SEINT1/SEINT2) — para o card de supervisão.
		//   - Membros já alocados são entregues via `gise.seccionais[].equipes[].membros`
		//     (já vêm com nome/matrícula em `buscarGiseDetalhado`), nada a fazer.
		const policiaisPromise: Promise<
			Array<{
				id: number;
				nome: string;
				matricula: string;
				cargo: 'DPC' | 'OIP';
				lotacao: string;
				email: string | null;
				email_pessoal: string | null;
			}>
		> =
			supportIds.length > 0
				? // E-mails (dado pessoal — LGPD) só para Admin Geral, espelhando a
					// política de /api/policiais/[id]/email-aviso e do campo
					// `assessorEmailSugerido` abaixo. A condição fica na PROJEÇÃO do
					// SELECT (minimização: o dado nem sai do banco para supervisores),
					// não em anulação pós-fetch.
					isGeral
					? db
							.select({
								id: policiais.id,
								nome: policiais.nome,
								matricula: policiais.matricula,
								cargo: policiais.cargo,
								lotacao: policiais.lotacao,
								email: policiais.email,
								email_pessoal: policiais.email_pessoal
							})
							.from(policiais)
							.where(and(eq(policiais.ativo, 1), inArray(policiais.id, supportIds)))
							.orderBy(asc(policiais.nome))
					: db
							.select({
								id: policiais.id,
								nome: policiais.nome,
								matricula: policiais.matricula,
								cargo: policiais.cargo,
								lotacao: policiais.lotacao
							})
							.from(policiais)
							.where(and(eq(policiais.ativo, 1), inArray(policiais.id, supportIds)))
							.orderBy(asc(policiais.nome))
							.then((rows) => rows.map((r) => ({ ...r, email: null, email_pessoal: null })))
				: Promise.resolve([]);

		const seintIdsParaRelatorio = [gise.seint1_id, gise.seint2_id].filter(
			(x): x is number => x != null
		);

		/** E-mail do assessor já vinculado à GISE (pessoal ou institucional), só para Admin Geral — não depende da lista enxuta nem de `ativo`. */
		const assessorEmailRowPromise =
			isGeral && gise.assessor_id
				? db
						.select({
							email_pessoal: policiais.email_pessoal,
							email: policiais.email
						})
						.from(policiais)
						.where(eq(policiais.id, gise.assessor_id))
						.get()
				: Promise.resolve(null as { email_pessoal: string | null; email: string | null } | null);

		// Queries paralelas restantes
		const [
			policiaisListResult,
			todasUnidades,
			assinaturasRelatorios,
			restringirSmartphone,
			presencasGise,
			supervisaoExtraUnidadeId,
			respostasSeintSupervisaoRows,
			assessorEmailRow
		] = await Promise.all([
			policiaisPromise,
			db.select().from(unidades).orderBy(asc(unidades.nome)),
			buscarAssinaturasRelatoriosGise(db, id),
			buscarRestringirSmartphone(db),
			buscarPresencasGise(db, id, platform?.env),
			buscarUnidadeIdSupervisaoExtra(db),
			seintIdsParaRelatorio.length
				? db
						.select({ policial_id: giseRespostasFormulario.policial_id })
						.from(giseRespostasFormulario)
						.where(
							and(
								eq(giseRespostasFormulario.gise_id, id),
								inArray(giseRespostasFormulario.policial_id, seintIdsParaRelatorio),
								isNull(giseRespostasFormulario.equipe_id)
							)
						)
						.all()
				: Promise.resolve([] as { policial_id: number | null }[]),
			assessorEmailRowPromise
		]);

		const assessorEmailSugerido =
			isGeral && assessorEmailRow
				? assessorEmailRow.email_pessoal?.trim() || assessorEmailRow.email?.trim() || null
				: null;

		const seintSupervisaoComRelatorio = [
			...new Set(
				respostasSeintSupervisaoRows
					.map((r) => r.policial_id)
					.filter((pid): pid is number => pid != null)
			)
		];

		return {
			gise,
			breveRelatorioEnv: await getBreveRelatorioEnvMergido(db),
			policiais: policiaisListResult,
			assessorEmailSugerido,
			todasUnidades,
			assinaturasRelatorios,
			presencasGise,
			supervisaoExtraUnidadeId,
			seintSupervisaoComRelatorio,
			papelGise: isGeral
				? 'admin_geral'
				: isSeccional
					? 'admin_seccional'
					: isSupervisor
						? 'supervisor'
						: 'policial',
			isGeral,
			isSeccional,
			isUnidade: isAdminUnidade(u),
			isSupervisor,
			isMembro: u.tipo === 'policial' ? (parentData.isMembroGise ?? false) : false,
			minhaSeccionalId: isSeccional || isAdminUnidade(u) ? u.papel_unidade_id : null,
			usuarioAtual: u,
			restringirSmartphone,
			exigirFotoAssinatura: parentData.exigirFotoAssinatura,
			exigirGpsAssinatura: parentData.exigirGpsAssinatura,
			exigirCodigoEmailAssinatura: parentData.exigirCodigoEmailAssinatura
		};
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		const msg = e instanceof Error ? e.message : String(e);
		// errorId correlaciona a mensagem genérica ao log estruturado — a
		// mensagem interna (Drizzle/D1) nunca vai para o cliente.
		const errorId = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
		logger.error('[gise/load] Erro ao carregar GISE', {
			gise_id: id,
			errorId,
			error: msg,
			stack: e instanceof Error ? e.stack : undefined
		});
		throw error(500, `Erro ao carregar a escala GISE. Informe o código ${errorId} ao suporte.`);
	}
};

export const actions: Actions = {
	...actionsEscala,
	...actionsSeccional,
	...actionsEquipe,
	...actionsMembros,
	...actionsUnidade
};
