/**
 * Schemas Zod para os endpoints LGPD admin.
 *
 * Antes desses schemas, os handlers em `/api/admin/lgpd/*` faziam parse
 * manual de `Record<string, unknown>` com `String(body.X)` campo a campo —
 * sem limite de tamanho, sem validar enums, sem bloquear `created_by_id`
 * (vetor de mass-assignment) e sem rejeitar tipos malformados.
 *
 * Limites de tamanho são propositadamente generosos para não cortar
 * conteúdo legítimo (descrição de incidente pode ser detalhada) mas
 * fechados o suficiente para barrar payloads abusivos (~5-10 MB).
 */

import { z } from 'zod';

const dateIsoSchema = z
	.string()
	.refine((s) => !Number.isNaN(Date.parse(s)), { message: 'Data inválida (esperado ISO 8601)' });

const tipoIncidenteSchema = z.enum([
	'acesso_nao_autorizado',
	'vazamento',
	'uso_indevido',
	'perda',
	'alteracao',
	'outro'
]);

const gravidadeIncidenteSchema = z.enum(['baixa', 'media', 'alta', 'critica']);

const statusIncidenteSchema = z.enum(['aberto', 'investigando', 'notificado_anpd', 'encerrado']);

/** Criação de incidente — `created_by_id`/`created_by_nome` ficam fora (vêm da sessão). */
export const novoIncidenteSchema = z.object({
	titulo: z.string().min(3, 'Título muito curto').max(200),
	descricao: z.string().min(10, 'Descrição muito curta').max(10_000),
	tipo_incidente: tipoIncidenteSchema,
	data_ocorrencia: dateIsoSchema.optional().nullable(),
	data_descoberta: dateIsoSchema,
	dados_afetados: z.string().min(1).max(5_000),
	usuarios_afetados_estimativa: z.number().int().min(0).max(10_000_000).optional().nullable(),
	gravidade: gravidadeIncidenteSchema,
	responsavel_nome: z.string().min(3).max(200),
	responsavel_email: z.string().email('E-mail do responsável inválido').max(200),
	medidas_tomadas: z.string().max(10_000).optional().nullable()
});

/** PATCH — todos os campos opcionais, mas pelo menos um precisa estar presente. */
export const atualizarIncidenteSchema = z
	.object({
		titulo: z.string().min(3).max(200).optional(),
		descricao: z.string().min(10).max(10_000).optional(),
		status: statusIncidenteSchema.optional(),
		gravidade: gravidadeIncidenteSchema.optional(),
		medidas_tomadas: z.string().max(10_000).optional().nullable(),
		notificado_anpd_em: dateIsoSchema.optional().nullable(),
		responsavel_nome: z.string().min(3).max(200).optional(),
		responsavel_email: z.string().email().max(200).optional()
	})
	.refine((v) => Object.keys(v).length > 0, {
		message: 'Informe ao menos um campo para atualizar'
	});

// ──────────────────────────────────────────────────────────────────────

const tipoDireitoLgpdSchema = z.enum([
	'acesso',
	'correcao',
	'anonimizacao',
	'portabilidade',
	'eliminacao',
	'informacao_compartilhamento',
	'revogacao_consentimento',
	'oposicao'
]);

/** Status válidos para o admin definir via PATCH (`pendente` é o inicial, não-editável). */
const statusResponderSolicitacaoSchema = z.enum(['em_analise', 'concluida', 'indeferida']);

export const responderSolicitacaoSchema = z.object({
	status: statusResponderSolicitacaoSchema,
	resposta: z.string().min(1, 'Campo obrigatório: resposta').max(10_000)
});

/** Submissão do titular (não-admin). */
export const novaSolicitacaoTitularSchema = z.object({
	tipo_direito: tipoDireitoLgpdSchema,
	descricao: z.string().max(5_000).optional().nullable()
});
