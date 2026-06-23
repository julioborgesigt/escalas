/**
 * Testes da lógica pura de liveness challenges. A integração com
 * face-api é testada em e2e (não cobrimos aqui — exigiria webcam).
 */

import { describe, it, expect } from 'vitest';
import {
	sortearChallenge,
	HeadTurnDetector,
	SmileDetector,
	CHALLENGES_DISPONIVEIS
} from '../liveness-challenge';

// ---------------------------------------------------------------------------
// Helpers de fixture — landmarks de mandíbula + nariz (head_turn)
// ---------------------------------------------------------------------------

/**
 * Mandíbula (17 pontos). O detector só usa os extremos horizontais: índice 0
 * (esquerda, x=0) e índice 16 (direita, x=100). Os demais são irrelevantes.
 */
function jaw() {
	const pts = Array.from({ length: 17 }, () => ({ x: 50, y: 0 }));
	pts[0] = { x: 0, y: 0 };
	pts[16] = { x: 100, y: 0 };
	return pts;
}

/**
 * Nariz (9 pontos). O detector usa só a ponta = índice 3. `noseX` controla a
 * posição horizontal: 50 = centrado (yaw ≈ 0); >50 vira p/ um lado; <50 p/ o
 * outro. yawRatio = (noseX·2 − 100) / 100.
 */
function nose(noseX: number) {
	const pts = Array.from({ length: 9 }, () => ({ x: 50, y: 0 }));
	pts[3] = { x: noseX, y: 0 };
	return pts;
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
// HeadTurnDetector
// ---------------------------------------------------------------------------

describe('HeadTurnDetector', () => {
	it('não conclui com rosto sempre centrado (yaw ≈ 0)', () => {
		const det = new HeadTurnDetector();
		let r = det.feed(jaw(), nose(50));
		for (let i = 0; i < 20; i++) r = det.feed(jaw(), nose(50));
		expect(r.concluido).toBe(false);
		expect(r.progresso).toBe(0);
	});

	it('conclui após giro amplo de um lado ao outro', () => {
		const det = new HeadTurnDetector();
		det.feed(jaw(), nose(50)); // de frente
		det.feed(jaw(), nose(80)); // vira p/ um lado
		det.feed(jaw(), nose(80));
		const r = det.feed(jaw(), nose(20)); // vira p/ o outro → amplitude grande
		expect(r.concluido).toBe(true);
		expect(r.progresso).toBe(1);
		expect(r.mensagem).toContain('✅');
	});

	it('exige MIN_FRAMES: amplitude atingida cedo demais ainda não conclui', () => {
		const det = new HeadTurnDetector();
		det.feed(jaw(), nose(50)); // frame 1
		det.feed(jaw(), nose(85)); // frame 2
		const r3 = det.feed(jaw(), nose(85)); // frame 3 — amplitude já grande, mas < MIN_FRAMES
		expect(r3.concluido).toBe(false);
		const r4 = det.feed(jaw(), nose(85)); // frame 4 → conclui
		expect(r4.concluido).toBe(true);
	});

	it('jitter pequeno de rosto parado não dispara falso-positivo', () => {
		const det = new HeadTurnDetector();
		let r = det.feed(jaw(), nose(50));
		// Oscilação de ±2px na ponta do nariz (yaw ±0.04) por muitos frames.
		for (let i = 0; i < 30; i++) {
			r = det.feed(jaw(), nose(i % 2 === 0 ? 52 : 48));
		}
		expect(r.concluido).toBe(false);
	});

	it('ignora frames sem landmarks suficientes (arrays vazios)', () => {
		const det = new HeadTurnDetector();
		for (let i = 0; i < 6; i++) det.feed([], []);
		const r = det.feed([], []);
		expect(r.progresso).toBe(0);
		expect(r.concluido).toBe(false);
	});

	it('frame sem landmarks no meio do giro não interrompe a amplitude acumulada', () => {
		const det = new HeadTurnDetector();
		det.feed(jaw(), nose(50));
		det.feed(jaw(), nose(85)); // vira
		det.feed([], []); // frame perdido — ignorado, não zera min/max
		det.feed(jaw(), nose(15)); // vira p/ o outro lado
		const r = det.feed(jaw(), nose(50));
		expect(r.concluido).toBe(true);
	});

	it('reset zera o detector', () => {
		const det = new HeadTurnDetector();
		det.feed(jaw(), nose(50));
		det.feed(jaw(), nose(85));
		det.feed(jaw(), nose(85));
		det.feed(jaw(), nose(20)); // concluiria
		det.reset();
		const r = det.feed(jaw(), nose(50));
		expect(r.progresso).toBe(0);
		expect(r.concluido).toBe(false);
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
