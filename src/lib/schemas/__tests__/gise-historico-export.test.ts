import { describe, expect, it } from 'vitest';
import { giseHistoricoExportQuerySchema } from '../gise';

describe('giseHistoricoExportQuerySchema', () => {
	it('aceita tipoEquipe opcional no recorte', () => {
		const sem = giseHistoricoExportQuerySchema.safeParse({
			format: 'xlsx',
			periodo: 'mes',
			mesAno: '2026-08'
		});
		expect(sem.success).toBe(true);
		if (sem.success) expect(sem.data.tipoEquipe).toBeUndefined();

		const com = giseHistoricoExportQuerySchema.safeParse({
			format: 'pdf',
			periodo: 'data',
			data: '2026-08-10',
			tipoEquipe: 'seint'
		});
		expect(com.success).toBe(true);
		if (com.success) expect(com.data.tipoEquipe).toBe('seint');
	});

	it('recusa tipoEquipe que não é operacional nem seint', () => {
		const r = giseHistoricoExportQuerySchema.safeParse({
			format: 'xlsx',
			periodo: 'mes',
			mesAno: '2026-08',
			tipoEquipe: 'outra'
		});
		expect(r.success).toBe(false);
	});
});
