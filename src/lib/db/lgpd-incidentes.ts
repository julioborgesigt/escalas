import { desc, eq } from 'drizzle-orm';
import { lgpdIncidentes } from '../server/schema';
import type { Database } from './core';
import type { LgpdIncidente } from '../server/schema';

type TipoIncidente =
	'acesso_nao_autorizado' | 'vazamento' | 'uso_indevido' | 'perda' | 'alteracao' | 'outro';
type GravidadeIncidente = 'baixa' | 'media' | 'alta' | 'critica';
type StatusIncidente = 'aberto' | 'investigando' | 'notificado_anpd' | 'encerrado';

interface NovoIncidenteInput {
	titulo: string;
	descricao: string;
	tipo_incidente: TipoIncidente;
	data_ocorrencia?: string | null;
	data_descoberta: string;
	dados_afetados: string;
	usuarios_afetados_estimativa?: number | null;
	gravidade: GravidadeIncidente;
	responsavel_nome: string;
	responsavel_email: string;
	medidas_tomadas?: string | null;
	created_by_id: number;
	created_by_nome: string;
}

interface AtualizarIncidenteInput {
	titulo?: string;
	descricao?: string;
	status?: StatusIncidente;
	gravidade?: GravidadeIncidente;
	medidas_tomadas?: string | null;
	notificado_anpd_em?: string | null;
	responsavel_nome?: string;
	responsavel_email?: string;
}

/** Prazo ANPD: 72h a partir da descoberta (art. 48 LGPD + Resolução CD/ANPD 2/2022). */
function calcularPrazoAnpd(dataDescoberta: string): string {
	const d = new Date(dataDescoberta);
	d.setHours(d.getHours() + 72);
	return d.toISOString();
}

export async function registrarIncidente(
	db: Database,
	input: NovoIncidenteInput
): Promise<LgpdIncidente> {
	const prazo = calcularPrazoAnpd(input.data_descoberta);
	const result = await db
		.insert(lgpdIncidentes)
		.values({
			titulo: input.titulo,
			descricao: input.descricao,
			tipo_incidente: input.tipo_incidente,
			data_ocorrencia: input.data_ocorrencia ?? null,
			data_descoberta: input.data_descoberta,
			dados_afetados: input.dados_afetados,
			usuarios_afetados_estimativa: input.usuarios_afetados_estimativa ?? null,
			gravidade: input.gravidade,
			status: 'aberto',
			responsavel_nome: input.responsavel_nome,
			responsavel_email: input.responsavel_email,
			prazo_notificacao_anpd: prazo,
			medidas_tomadas: input.medidas_tomadas ?? null,
			created_by_id: input.created_by_id,
			created_by_nome: input.created_by_nome
		})
		.returning()
		.get();
	return result;
}

export async function listarIncidentes(db: Database): Promise<LgpdIncidente[]> {
	return db.select().from(lgpdIncidentes).orderBy(desc(lgpdIncidentes.created_at)).all();
}

export async function buscarIncidente(
	db: Database,
	id: number
): Promise<LgpdIncidente | undefined> {
	return db.select().from(lgpdIncidentes).where(eq(lgpdIncidentes.id, id)).get();
}

export async function atualizarIncidente(
	db: Database,
	id: number,
	patch: AtualizarIncidenteInput
): Promise<LgpdIncidente | undefined> {
	const now = new Date().toISOString();
	const sets: Partial<typeof lgpdIncidentes.$inferInsert> = { updated_at: now };
	if (patch.titulo !== undefined) sets.titulo = patch.titulo;
	if (patch.descricao !== undefined) sets.descricao = patch.descricao;
	if (patch.status !== undefined) sets.status = patch.status;
	if (patch.gravidade !== undefined) sets.gravidade = patch.gravidade;
	if (patch.medidas_tomadas !== undefined) sets.medidas_tomadas = patch.medidas_tomadas;
	if (patch.notificado_anpd_em !== undefined) sets.notificado_anpd_em = patch.notificado_anpd_em;
	if (patch.responsavel_nome !== undefined) sets.responsavel_nome = patch.responsavel_nome;
	if (patch.responsavel_email !== undefined) sets.responsavel_email = patch.responsavel_email;

	return db.update(lgpdIncidentes).set(sets).where(eq(lgpdIncidentes.id, id)).returning().get();
}
