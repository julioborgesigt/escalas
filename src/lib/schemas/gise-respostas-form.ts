import { z } from 'zod';

/** Respostas do formulário GISE: objeto JSON com chaves string (ids/perguntas). */
export const giseRespostasFormRecordSchema = z.record(z.string(), z.unknown());

export type GiseRespostasFormRecord = z.infer<typeof giseRespostasFormRecordSchema>;

/** Parse seguro: retorna `{}` se JSON inválido ou não for objeto registro. */
export function parseRespostasFormularioJsonLoose(
	raw: string | null | undefined
): Record<string, unknown> {
	if (raw == null || raw === '') return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {};
	}
	const r = giseRespostasFormRecordSchema.safeParse(parsed);
	return r.success ? r.data : {};
}

/** Para writes: falha com mensagem se o corpo não for um objeto registro válido. */
export function parseRespostasFormularioJsonStrict(
	raw: string
): { ok: true; data: GiseRespostasFormRecord } | { ok: false } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ok: false };
	}
	const r = giseRespostasFormRecordSchema.safeParse(parsed);
	if (!r.success) return { ok: false };
	return { ok: true, data: r.data };
}
