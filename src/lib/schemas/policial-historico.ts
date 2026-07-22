import { z } from 'zod';

/**
 * NUP (Número Único de Protocolo) no formato `00000.000000/0000-00`. Opcional:
 * nem todo registro histórico tem um processo associado. Aceita string vazia.
 */
const nupSchema = z
	.string()
	.trim()
	.regex(/^\d{5}\.\d{6}\/\d{4}-\d{2}$/, 'NUP inválido (use 00000.000000/0000-00)')
	.or(z.literal(''))
	.optional()
	.nullable();

/** Data no formato ISO `YYYY-MM-DD` (input type="date"). */
const dataISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');

export const SUBTIPOS_AFASTAMENTO = [
	'ferias',
	'licenca_medica',
	'judicial',
	'licenca_outros',
	'outros'
] as const;

export const movimentacaoSchema = z.object({
	unidade_destino: z
		.string()
		.trim()
		.min(1, 'Informe a unidade de destino')
		.max(200, 'Unidade muito longa'),
	data_evento: dataISO,
	nup: nupSchema
});

export const afastamentoSchema = z.object({
	subtipo: z.enum(SUBTIPOS_AFASTAMENTO, { message: 'Tipo de afastamento inválido' }),
	descricao: z.string().trim().max(500, 'Descrição muito longa').optional().nullable(),
	data_inicio: dataISO,
	data_fim: dataISO,
	qtd_dias: z.coerce.number().int().min(1, 'Quantidade de dias inválida').max(3650).optional(),
	nup: nupSchema
});

export const desvinculacaoSchema = z.object({
	destino: z
		.string()
		.trim()
		.min(1, 'Informe o destino do policial')
		.max(200, 'Destino muito longo'),
	data_evento: dataISO,
	nup: nupSchema
});

export type MovimentacaoInput = z.infer<typeof movimentacaoSchema>;
export type AfastamentoInput = z.infer<typeof afastamentoSchema>;
export type DesvinculacaoInput = z.infer<typeof desvinculacaoSchema>;

/** Rótulos PT-BR dos subtipos de afastamento (fonte única para UI e histórico). */
export const LABEL_SUBTIPO_AFASTAMENTO: Record<(typeof SUBTIPOS_AFASTAMENTO)[number], string> = {
	ferias: 'Férias',
	licenca_medica: 'Licença Médica',
	judicial: 'Judicial',
	licenca_outros: 'Licença outros',
	outros: 'Outros afastamentos'
};
