/**
 * `GET /api/planos/[id]/download` — o PDF do plano operacional.
 *
 * Três coisas acontecem, nesta ordem, e a ordem importa:
 *
 * 1. **o portão** (`carregarPlanoParaEdicao`) decide se este usuário pode. É o
 *    mesmo do editor — não há um segundo gate escrito aqui;
 * 2. **a auditoria**, ANTES de qualquer byte sair. O documento leva nome,
 *    matrícula, lotação e telefone de todo o efetivo: baixar é acesso a dado
 *    pessoal e fica registrado mesmo que a geração falhe depois. É a regra que
 *    `api/gise/[id]/download` já segue;
 * 3. **a emissão**, que só acontece se não houver pendência de cadastro.
 *
 * ## Por que a recusa por pendência mora aqui também
 *
 * A tela já desabilita o botão. Isso não é autorização — o GET direto tem de
 * morrer no servidor, e o `CLAUDE.md` é explícito quanto a isso. Sem o gate
 * aqui, colar a URL na barra emitiria um documento orçado a menor, que é
 * exatamente o que `podeEmitir` existe para impedir.
 *
 * Quem decide é `podeEmitir(custoDoPlano(...))` — a MESMA chamada da tela, para
 * as duas não poderem discordar.
 */
import type { RequestHandler } from './$types';
import { getDB, janelaDaEquipe, briefingDaEquipe, buscarPolicial, tryGetR2 } from '$lib/db';
import { unidades } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import { carregarPlanoParaEdicao } from '$lib/server/planos/permissao';
import { montarCustoDoPlano, versaoDeValores } from '$lib/server/planos/custo-do-plano';
import { podeEmitir } from '$lib/planos/custo';
import { registrarAuditComContexto } from '$lib/db/audit';
import { CACHE_PRIVADO, contentDisposition, conflict, serverError } from '$lib/server/api';
import { hojeBrasilISO } from '$lib/utils/datas';
import { logger } from '$lib/server/logger';
import { mensagemDeErro } from '$lib/utils/erro';

export const GET: RequestHandler = async ({ locals, params, platform }) => {
	const db = getDB(platform);
	const id = Number(params.id);

	const acesso = await carregarPlanoParaEdicao(db, id, locals.usuario);
	if (acesso instanceof Response) return acesso;
	const { plano } = acesso;

	// Antes de qualquer byte. Ver o cabeçalho.
	await registrarAuditComContexto(db, {
		usuario: locals.usuario,
		acao: 'exportar_plano_operacional',
		entidade: 'plano_operacional',
		entidade_id: plano.id,
		detalhes: `Download do plano ${plano.numero}/${plano.ano}`
	});

	// A MESMA montagem do editor — ver `custo-do-plano.ts`. O total impresso aqui
	// é, por construção, o que o admin conferiu na tela antes de emitir.
	const { equipes, porEquipe, parametros, custo } = await montarCustoDoPlano(db, plano);

	if (!podeEmitir(custo)) {
		const nomes = custo.pendencias.map((p) => `${p.nome} (${p.equipe})`).join('; ');
		return conflict(
			`O plano não pode ser emitido: ${custo.pendencias.length} servidor(es) sem classe resolvida — ${nomes}. Corrija o cadastro e reaplique cargo/classe no editor.`
		);
	}

	// Coordenador e demandante são opcionais no plano; o documento imprime "A
	// designar" e omite a seção quando faltam.
	const [coordenador, demandanteRow] = await Promise.all([
		plano.coordenador_id ? buscarPolicial(db, plano.coordenador_id) : Promise.resolve(null),
		plano.demandante_unidade_id
			? db
					.select({ nome: unidades.nome })
					.from(unidades)
					.where(eq(unidades.id, plano.demandante_unidade_id))
					.get()
			: Promise.resolve(undefined)
	]);

	// Logos: best-effort, como nos outros PDFs. Ausência não impede a emissão.
	let logoEsq: Uint8Array | undefined;
	let logoDir: Uint8Array | undefined;
	const r2 = tryGetR2(platform);
	if (r2) {
		try {
			const [esq, dir] = await Promise.all([
				r2.get('assets/logogise.jpg'),
				r2.get('assets/logo_ceara.jpg')
			]);
			if (esq) logoEsq = new Uint8Array(await esq.arrayBuffer());
			if (dir) logoDir = new Uint8Array(await dir.arrayBuffer());
		} catch (e) {
			logger.warn('[planos/download] logos indisponíveis', { error: mensagemDeErro(e) });
		}
	}

	try {
		const { gerarPdfPlanoOperacional } = await import('$lib/server/export');
		const resultado = await gerarPdfPlanoOperacional(
			{
				numero: plano.numero,
				ano: plano.ano,
				nome: plano.nome,
				finalidade: plano.finalidade,
				acoes: plano.acoes,
				nup: plano.nup,
				data_inicio: plano.data_inicio,
				hora_inicio: plano.hora_inicio,
				departamento: plano.departamento,
				coordenador: coordenador
					? {
							nome: coordenador.nome,
							matricula: coordenador.matricula,
							lotacao: coordenador.lotacao
						}
					: null,
				demandante: demandanteRow?.nome ?? null,
				diretor_nome: plano.diretor_nome,
				diretor_cargo: plano.diretor_cargo,
				equipes: equipes.map((e) => ({
					id: e.id,
					nome: e.nome,
					tipo: e.tipo,
					viatura_modelo: e.viatura_modelo,
					viatura_placa: e.viatura_placa,
					cidade_destino: e.cidade_destino,
					tipo_custo: e.tipo_custo,
					horas_normais: e.horas_normais,
					horas_plus: e.horas_plus,
					diaria_tipo: e.diaria_tipo,
					diarias_meias: e.diarias_meias,
					// A cascata equipe → plano resolvida AQUI, pelas mesmas funções que a
					// tela usa: o gerador recebe o valor efetivo e não reimplementa a
					// herança.
					horaApresentacao: janelaDaEquipe(e, plano).horaInicio,
					briefing: briefingDaEquipe(e, plano),
					membros: (porEquipe.get(e.id) ?? []).map((m) => ({
						policial_id: m.policial_id,
						nome: m.nome,
						matricula: m.matricula,
						lotacao: m.lotacao,
						telefone: m.telefone,
						cargo_snapshot: m.cargo_snapshot,
						classe_snapshot: m.classe_snapshot,
						chefe: m.chefe
					}))
				})),
				custo,
				versaoValores: versaoDeValores(parametros),
				emitidoEm: hojeBrasilISO()
			},
			logoEsq,
			logoDir
		);

		const nomeArquivo = `plano_operacional_${plano.numero}_${plano.ano}.pdf`;
		return new Response(resultado.pdf as unknown as BodyInit, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': contentDisposition(nomeArquivo),
				'Cache-Control': CACHE_PRIVADO
			}
		});
	} catch (e) {
		return serverError(`[planos/download] Erro ao gerar o PDF (plano=${plano.id})`, e);
	}
};
