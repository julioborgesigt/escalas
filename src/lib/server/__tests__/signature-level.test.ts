import { describe, it, expect } from 'vitest';
import {
	classificarNivelAssinaturaTela,
	contarReforcos,
	baseLegalDoNivel,
	REQUISITOS_OBRIGATORIOS_AVANCADA,
	REFORCOS_OPCIONAIS,
	REQUISITOS_SEMPRE_ATIVOS
} from '../signature-level';

describe('signature-level', () => {
	describe('classificarNivelAssinaturaTela', () => {
		it('classifica como SIMPLES quando 2FA por e-mail está desligado', () => {
			expect(
				classificarNivelAssinaturaTela({
					exigirFotoAssinatura: true,
					exigirGpsAssinatura: true,
					exigirCodigoEmailAssinatura: false,
					restringirSmartphone: true
				})
			).toBe('simples');
		});

		it('classifica como AVANÇADA quando 2FA por e-mail está ligado', () => {
			expect(
				classificarNivelAssinaturaTela({
					exigirFotoAssinatura: false,
					exigirGpsAssinatura: false,
					exigirCodigoEmailAssinatura: true,
					restringirSmartphone: false
				})
			).toBe('avancada');
		});

		it('foto/GPS/smartphone sozinhos NÃO promovem a SIMPLES → AVANÇADA', () => {
			// Reforços aumentam valor probatório mas não alteram a classificação legal.
			expect(
				classificarNivelAssinaturaTela({
					exigirFotoAssinatura: true,
					exigirGpsAssinatura: true,
					exigirCodigoEmailAssinatura: false,
					restringirSmartphone: true
				})
			).toBe('simples');
		});
	});

	describe('contarReforcos', () => {
		it('soma apenas as flags da lista REFORCOS_OPCIONAIS', () => {
			expect(
				contarReforcos({
					exigirFotoAssinatura: true,
					exigirGpsAssinatura: true,
					exigirCodigoEmailAssinatura: true, // não conta — é obrigatório
					restringirSmartphone: false
				})
			).toBe(2);
		});

		it('zero quando todos reforços estão desligados', () => {
			expect(
				contarReforcos({
					exigirFotoAssinatura: false,
					exigirGpsAssinatura: false,
					exigirCodigoEmailAssinatura: true,
					restringirSmartphone: false
				})
			).toBe(0);
		});

		it('máximo é REFORCOS_OPCIONAIS.length', () => {
			const score = contarReforcos({
				exigirFotoAssinatura: true,
				exigirGpsAssinatura: true,
				exigirCodigoEmailAssinatura: true,
				restringirSmartphone: true
			});
			expect(score).toBe(REFORCOS_OPCIONAIS.length);
		});
	});

	describe('baseLegalDoNivel', () => {
		it('qualificada → MP 2.200-2', () => {
			expect(baseLegalDoNivel('qualificada')).toContain('2.200-2');
			expect(baseLegalDoNivel('qualificada')).toContain('ICP-Brasil');
		});

		it('avancada → Lei 14.063 art. 4º II', () => {
			expect(baseLegalDoNivel('avancada')).toContain('14.063');
			expect(baseLegalDoNivel('avancada')).toContain('art. 4º II');
		});

		it('simples → Lei 14.063 art. 4º I', () => {
			expect(baseLegalDoNivel('simples')).toContain('14.063');
			expect(baseLegalDoNivel('simples')).toContain('art. 4º I');
		});
	});

	describe('estrutura dos requisitos', () => {
		it('REQUISITOS_OBRIGATORIOS_AVANCADA contém pelo menos `segundo_fator_email`', () => {
			expect(
				REQUISITOS_OBRIGATORIOS_AVANCADA.some((r) => r.id === 'segundo_fator_email')
			).toBe(true);
		});

		it('todos os obrigatórios referenciam a Lei 14.063 art. 4º II "b"', () => {
			for (const r of REQUISITOS_OBRIGATORIOS_AVANCADA) {
				expect(r.baseLegal).toContain('14.063');
				expect(r.baseLegal).toContain('II');
			}
		});

		it('REFORCOS_OPCIONAIS inclui selfie, GPS e restrição-smartphone', () => {
			const ids = REFORCOS_OPCIONAIS.map((r) => r.id);
			expect(ids).toContain('selfie_liveness');
			expect(ids).toContain('geolocalizacao');
			expect(ids).toContain('restricao_dispositivo');
		});

		it('flag de cada reforço bate com FlagsAssinatura', () => {
			const flagNames = REFORCOS_OPCIONAIS.map((r) => r.flag);
			expect(flagNames).toContain('exigirFotoAssinatura');
			expect(flagNames).toContain('exigirGpsAssinatura');
			expect(flagNames).toContain('restringirSmartphone');
		});

		it('REQUISITOS_SEMPRE_ATIVOS lista hash, sessão e auditoria', () => {
			const ids = REQUISITOS_SEMPRE_ATIVOS.map((r) => r.id);
			expect(ids).toContain('hash_sha256');
			expect(ids).toContain('sessao_autenticada');
			expect(ids).toContain('registro_auditoria');
		});
	});
});
