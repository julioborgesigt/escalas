/**
 * Testes da lógica pura de liveness challenges. A integração com
 * face-api é testada em e2e (não cobrimos aqui — exigiria webcam).
 */

import { describe, it, expect } from 'vitest';
import {
	sortearChallenge,
	BlinkCounter,
	SmileDetector,
	CHALLENGES_DISPONIVEIS
} from '../liveness-challenge';

// ---------------------------------------------------------------------------
// Helpers de fixture — landmarks de olho
// ---------------------------------------------------------------------------

/** Olho aberto: pontos verticais distantes da horizontal → EAR alto (~0.33). */
function olhoAberto() {
	return [
		{ x: 0, y: 0 }, // p1 (canto externo)
		{ x: 1, y: -1 }, // p2 (sup esq)
		{ x: 2, y: -1 }, // p3 (sup dir)
		{ x: 3, y: 0 }, // p4 (canto interno)
		{ x: 2, y: 1 }, // p5 (inf dir)
		{ x: 1, y: 1 } // p6 (inf esq)
	];
}

/** Olho fechado: pontos verticais colados → EAR baixo (~0.05). */
function olhoFechado() {
	return [
		{ x: 0, y: 0 },
		{ x: 1, y: -0.05 },
		{ x: 2, y: -0.05 },
		{ x: 3, y: 0 },
		{ x: 2, y: 0.05 },
		{ x: 1, y: 0.05 }
	];
}

/**
 * Olho PEQUENO aberto: EAR ≈ 0.22 — ABAIXO do antigo limiar absoluto de
 * "aberto" (0.25). Com a lógica fixa anterior, depois de uma piscada o olho
 * nunca era reconhecido como reaberto (0.22 < 0.25) → contador travava em 0/2.
 * Este é exatamente o caso que a baseline adaptativa conserta.
 */
function olhoPequenoAberto() {
	return [
		{ x: 0, y: 0 },
		{ x: 1, y: -0.33 },
		{ x: 2, y: -0.33 },
		{ x: 3, y: 0 },
		{ x: 2, y: 0.33 },
		{ x: 1, y: 0.33 }
	];
}

/** Olho PEQUENO fechado: EAR ≈ 0.08. */
function olhoPequenoFechado() {
	return [
		{ x: 0, y: 0 },
		{ x: 1, y: -0.12 },
		{ x: 2, y: -0.12 },
		{ x: 3, y: 0 },
		{ x: 2, y: 0.12 },
		{ x: 1, y: 0.12 }
	];
}

// ---------------------------------------------------------------------------
// sortearChallenge
// ---------------------------------------------------------------------------

describe('sortearChallenge', () => {
	it('sempre devolve um challenge da lista disponível', () => {
		for (let i = 0; i < 100; i++) {
			const c = sortearChallenge();
			expect(CHALLENGES_DISPONIVEIS).toContainEqual(c);
		}
	});

	it('distribuição razoavelmente uniforme (1000 amostras)', () => {
		const contagem: Record<string, number> = {};
		for (let i = 0; i < 1000; i++) {
			const c = sortearChallenge();
			contagem[c.tipo] = (contagem[c.tipo] || 0) + 1;
		}
		// Com 2 challenges, espera-se ~500 cada; tolerância ±150 para evitar flakiness.
		for (const tipo of CHALLENGES_DISPONIVEIS.map((c) => c.tipo)) {
			expect(contagem[tipo] ?? 0).toBeGreaterThan(350);
			expect(contagem[tipo] ?? 0).toBeLessThan(650);
		}
	});
});

// ---------------------------------------------------------------------------
// BlinkCounter
// ---------------------------------------------------------------------------

describe('BlinkCounter', () => {
	it('não conta blink em olhos sempre abertos', () => {
		const counter = new BlinkCounter();
		for (let i = 0; i < 10; i++) {
			counter.feed(olhoAberto(), olhoAberto());
		}
		const r = counter.feed(olhoAberto(), olhoAberto());
		expect(r.concluido).toBe(false);
		expect(r.progresso).toBe(0);
	});

	it('conta 1 blink após sequência aberto→fechado→aberto', () => {
		const counter = new BlinkCounter();
		counter.feed(olhoAberto(), olhoAberto());
		counter.feed(olhoFechado(), olhoFechado());
		const r = counter.feed(olhoAberto(), olhoAberto());
		expect(r.progresso).toBe(0.5); // 1 de 2 blinks
		expect(r.concluido).toBe(false);
	});

	it('confirma challenge após 2 blinks consecutivos', () => {
		const counter = new BlinkCounter();
		counter.feed(olhoAberto(), olhoAberto());
		counter.feed(olhoFechado(), olhoFechado()); // blink 1 começa
		counter.feed(olhoAberto(), olhoAberto()); // blink 1 confirma
		counter.feed(olhoFechado(), olhoFechado()); // blink 2 começa
		const r = counter.feed(olhoAberto(), olhoAberto()); // blink 2 confirma
		expect(r.concluido).toBe(true);
		expect(r.progresso).toBe(1);
		expect(r.mensagem).toContain('✅');
	});

	it('reset zera o contador', () => {
		const counter = new BlinkCounter();
		counter.feed(olhoFechado(), olhoFechado());
		counter.feed(olhoAberto(), olhoAberto());
		counter.reset();
		const r = counter.feed(olhoAberto(), olhoAberto());
		expect(r.progresso).toBe(0);
	});

	it('histerese: oscilação no limite não conta dupla', () => {
		const counter = new BlinkCounter();
		// Olho "meio fechado" — EAR ~0.22 (entre os dois limiares).
		// Não deve disparar contagem nem para fechado nem para aberto.
		const olhoMeio = [
			{ x: 0, y: 0 },
			{ x: 1, y: -0.7 },
			{ x: 2, y: -0.7 },
			{ x: 3, y: 0 },
			{ x: 2, y: 0.7 },
			{ x: 1, y: 0.7 }
		];
		for (let i = 0; i < 20; i++) {
			counter.feed(olhoMeio, olhoMeio);
		}
		const r = counter.feed(olhoMeio, olhoMeio);
		expect(r.concluido).toBe(false);
	});

	it('REGRESSÃO: conta 2 piscadas em olho pequeno (EAR aberto ~0.22 < limiar fixo antigo)', () => {
		const counter = new BlinkCounter();
		// Calibra a baseline (~0.22) com 5 frames de olho aberto pequeno.
		for (let i = 0; i < 5; i++) counter.feed(olhoPequenoAberto(), olhoPequenoAberto());
		// Duas piscadas: fechado→aberto ×2 (limiares agora relativos à baseline).
		counter.feed(olhoPequenoFechado(), olhoPequenoFechado());
		counter.feed(olhoPequenoAberto(), olhoPequenoAberto()); // blink 1
		counter.feed(olhoPequenoFechado(), olhoPequenoFechado());
		const r = counter.feed(olhoPequenoAberto(), olhoPequenoAberto()); // blink 2
		expect(r.concluido).toBe(true);
		expect(r.progresso).toBe(1);
	});

	it('baseline usa o MÁXIMO: uma piscada durante a calibração não a corrompe', () => {
		const counter = new BlinkCounter();
		// Calibração com uma piscada acidental no meio (frame fechado).
		counter.feed(olhoPequenoAberto(), olhoPequenoAberto());
		counter.feed(olhoPequenoAberto(), olhoPequenoAberto());
		counter.feed(olhoPequenoFechado(), olhoPequenoFechado()); // piscada acidental
		counter.feed(olhoPequenoAberto(), olhoPequenoAberto());
		counter.feed(olhoPequenoAberto(), olhoPequenoAberto()); // baseline = max ≈ 0.22
		// Agora 2 piscadas devem contar normalmente.
		counter.feed(olhoPequenoFechado(), olhoPequenoFechado());
		counter.feed(olhoPequenoAberto(), olhoPequenoAberto());
		counter.feed(olhoPequenoFechado(), olhoPequenoFechado());
		const r = counter.feed(olhoPequenoAberto(), olhoPequenoAberto());
		expect(r.concluido).toBe(true);
	});

	it('ignora frames sem landmarks (arrays vazios) sem contar piscada falsa', () => {
		const counter = new BlinkCounter();
		for (let i = 0; i < 5; i++) counter.feed([], []); // sem dados → ignorado
		const r = counter.feed([], []);
		expect(r.progresso).toBe(0);
		expect(r.concluido).toBe(false);
	});

	it('frame sem landmarks no meio de uma piscada não a interrompe', () => {
		const counter = new BlinkCounter();
		for (let i = 0; i < 5; i++) counter.feed(olhoPequenoAberto(), olhoPequenoAberto());
		counter.feed(olhoPequenoFechado(), olhoPequenoFechado()); // fecha
		counter.feed([], []); // frame perdido (ignorado, mantém estado "fechado")
		const r = counter.feed(olhoPequenoAberto(), olhoPequenoAberto()); // reabre → blink 1
		expect(r.progresso).toBe(0.5);
	});
});

// ---------------------------------------------------------------------------
// SmileDetector
// ---------------------------------------------------------------------------

describe('SmileDetector', () => {
	it('não confirma com happy abaixo do threshold', () => {
		const det = new SmileDetector();
		for (let i = 0; i < 10; i++) {
			const r = det.feed(0.5);
			expect(r.concluido).toBe(false);
		}
	});

	it('confirma com 3 frames consecutivos acima do threshold', () => {
		const det = new SmileDetector();
		det.feed(0.8);
		det.feed(0.85);
		const r = det.feed(0.9);
		expect(r.concluido).toBe(true);
		expect(r.progresso).toBe(1);
	});

	it('reseta agressivamente quando happy cai abaixo do threshold', () => {
		const det = new SmileDetector();
		det.feed(0.8);
		det.feed(0.85);
		det.feed(0.5); // queda — reseta
		const r = det.feed(0.8);
		expect(r.concluido).toBe(false);
		expect(r.progresso).toBeLessThan(1);
	});

	it('uma vez confirmado, permanece confirmado mesmo se sorriso passar', () => {
		const det = new SmileDetector();
		det.feed(0.8);
		det.feed(0.85);
		det.feed(0.9); // confirma
		const r = det.feed(0.1); // sorriso desaparece
		expect(r.concluido).toBe(true);
	});

	it('reset zera o estado', () => {
		const det = new SmileDetector();
		det.feed(0.8);
		det.feed(0.85);
		det.feed(0.9);
		det.reset();
		const r = det.feed(0.5);
		expect(r.concluido).toBe(false);
	});
});
