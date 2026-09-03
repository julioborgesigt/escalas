import { describe, it, expect } from 'vitest';
import {
	MOTIVOS_SEM_EVIDENCIA,
	lerMotivoSemEvidencia,
	recusaPorEvidenciaDePresenca,
	metadadosDeEvidenciaPresenca,
	type EvidenciaPresenca,
	type FlagsEvidenciaPresenca
} from '../assinatura-evidencia';

function flags(over: Partial<FlagsEvidenciaPresenca> = {}): FlagsEvidenciaPresenca {
	// Os DOIS defaults do sistema são `true` — é o estado em que a falha existia.
	return { exigirFotoAssinatura: true, exigirGpsAssinatura: true, ...over };
}

function ev(over: Partial<EvidenciaPresenca> = {}): EvidenciaPresenca {
	return {
		gpsValido: true,
		temSelfie: true,
		motivoSemGps: null,
		motivoSemFoto: null,
		...over
	};
}

describe('lerMotivoSemEvidencia', () => {
	it('aceita os três motivos da lista fechada', () => {
		for (const m of MOTIVOS_SEM_EVIDENCIA) {
			expect(lerMotivoSemEvidencia(m)).toBe(m);
		}
	});

	it('apara espaços — FormData entrega o que o cliente mandou', () => {
		expect(lerMotivoSemEvidencia('  permissao_negada  ')).toBe('permissao_negada');
	});

	it('RECUSA texto fora da lista: é o que impede o campo de virar texto livre', () => {
		for (const ruim of [
			'porque eu quis',
			'PERMISSAO_NEGADA',
			'permissao_negada_x',
			'',
			'   ',
			null,
			undefined,
			42,
			{ motivo: 'permissao_negada' },
			['permissao_negada']
		]) {
			expect(lerMotivoSemEvidencia(ruim), String(ruim)).toBeNull();
		}
	});
});

describe('recusaPorEvidenciaDePresenca', () => {
	it('evidência completa passa', () => {
		expect(recusaPorEvidenciaDePresenca(flags(), ev())).toBeNull();
	});

	it('recusa foto ausente sem motivo declarado', () => {
		const r = recusaPorEvidenciaDePresenca(flags(), ev({ temSelfie: false }));
		expect(r?.error).toMatch(/foto é obrigatória/i);
	});

	it('recusa GPS ausente sem motivo declarado — o furo que não existia no servidor', () => {
		const r = recusaPorEvidenciaDePresenca(flags(), ev({ gpsValido: false }));
		expect(r?.error).toMatch(/localização é obrigatória/i);
	});

	it('motivo declarado libera o ato — presença tem janela e não pode travar no campo', () => {
		expect(
			recusaPorEvidenciaDePresenca(
				flags(),
				ev({ gpsValido: false, motivoSemGps: 'permissao_negada' })
			)
		).toBeNull();
		expect(
			recusaPorEvidenciaDePresenca(
				flags(),
				ev({ temSelfie: false, motivoSemFoto: 'indisponivel_no_aparelho' })
			)
		).toBeNull();
	});

	it('o motivo de UMA evidência não cobre a outra', () => {
		const r = recusaPorEvidenciaDePresenca(
			flags(),
			ev({ gpsValido: false, motivoSemFoto: 'permissao_negada' })
		);
		expect(r?.error).toMatch(/localização/i);
	});

	it('flag desligada não exige nem motivo', () => {
		expect(
			recusaPorEvidenciaDePresenca(
				flags({ exigirGpsAssinatura: false, exigirFotoAssinatura: false }),
				ev({ gpsValido: false, temSelfie: false })
			)
		).toBeNull();
	});

	it('a foto é conferida ANTES do GPS quando faltam as duas', () => {
		const r = recusaPorEvidenciaDePresenca(flags(), ev({ gpsValido: false, temSelfie: false }));
		expect(r?.error).toMatch(/foto/i);
	});
});

describe('metadadosDeEvidenciaPresenca', () => {
	it('capturado: só os dois booleanos, sem motivo', () => {
		expect(metadadosDeEvidenciaPresenca(ev())).toEqual({ temSelfie: true, temGps: true });
	});

	it('ausente COM motivo: a trilha diz o porquê', () => {
		expect(
			metadadosDeEvidenciaPresenca(ev({ gpsValido: false, motivoSemGps: 'permissao_negada' }))
		).toEqual({ temSelfie: true, temGps: false, motivoSemGps: 'permissao_negada' });
	});

	it('"sem GPS" e "sem GPS porque o aparelho negou" deixam de ser a mesma linha', () => {
		const semMotivo = metadadosDeEvidenciaPresenca(ev({ gpsValido: false }));
		const comMotivo = metadadosDeEvidenciaPresenca(
			ev({ gpsValido: false, motivoSemGps: 'falha_tecnica' })
		);
		expect(semMotivo).not.toEqual(comMotivo);
		expect('motivoSemGps' in semMotivo).toBe(false);
	});
});
