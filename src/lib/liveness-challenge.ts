/**
 * Liveness ATIVA (challenge-response) usando @vladmandic/face-api.
 *
 * Antes, o SignaturePad só validava presença de rosto e estabilidade do
 * enquadramento — vulnerável a:
 *   - foto de alta resolução exibida na tela do agressor
 *   - vídeo pré-gravado da vítima
 *   - máscaras/máscaras de látex bem iluminadas
 *
 * Esta camada exige que o usuário execute uma AÇÃO ALEATÓRIA dentro de uma
 * janela curta (~10 s). Cada assinatura sorteia um challenge diferente
 * (`blink`, `smile`), tornando inviável o uso de mídia pré-gravada — o
 * atacante não sabe o desafio antes de iniciar a captura.
 *
 * Não é defesa contra deepfake em tempo real (Nível 3 ou 4 fariam) — mas
 * resolve o ataque oportunístico mais comum em fraudes de assinatura em
 * tela: usar selfie roubada da vítima.
 *
 * Fronteira de garantia (auditoria A2): a avaliação roda NO CLIENTE e o
 * servidor confia no resultado reportado (só confere consistência estrutural
 * e temporal em signature-service.ts). Um cliente adulterado pode forjar o
 * payload — por isso o liveness é REFORÇO da assinatura AVANÇADA, não prova
 * de identidade forte. Para não-repúdio pleno, use a QUALIFICADA via Token A3
 * (ICP-Brasil). Endurecer exigiria PAD server-side certificado (serviço
 * externo) — decisão de produto não adotada ("Nível 0").
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type ChallengeTipo = 'blink' | 'smile';

export interface ChallengeDefinicao {
	tipo: ChallengeTipo;
	/** Instrução em pt-BR para o usuário. */
	instrucao: string;
	/** Hint curto exibido durante a captura. */
	hint: string;
	/** Tempo máximo (ms) para o usuário cumprir o challenge antes de re-sortear. */
	timeoutMs: number;
}

export interface ChallengeProgresso {
	tipo: ChallengeTipo;
	/** 0 a 1 — progresso do challenge (ex.: blinks contados / esperados). */
	progresso: number;
	/** Quando true, o challenge foi cumprido nesta iteração. */
	concluido: boolean;
	/** Mensagem dinâmica para a UI ("Pisque 1 vez mais", "Sorria com mais ênfase"). */
	mensagem: string;
}

// ---------------------------------------------------------------------------
// Definições dos challenges
// ---------------------------------------------------------------------------

/**
 * Lista de challenges disponíveis. Cada assinatura sorteia 1.
 *
 * Não incluímos `head_turn` (girar a cabeça) por enquanto — exige cálculo de
 * pose 3D mais elaborado e UX é confusa em smartphone na vertical. Pode ser
 * adicionado em iteração futura.
 */
export const CHALLENGES_DISPONIVEIS: ChallengeDefinicao[] = [
	{
		tipo: 'blink',
		instrucao: 'Pisque os olhos 2 vezes',
		hint: 'Pisque devagar, fechando bem os olhos',
		timeoutMs: 10_000
	},
	{
		tipo: 'smile',
		instrucao: 'Sorria para a câmera',
		hint: 'Sorriso natural por ~1 segundo',
		timeoutMs: 10_000
	}
];

/**
 * Sorteia um challenge para a sessão de assinatura atual.
 *
 * Usa `crypto.getRandomValues` (CSPRNG) e NÃO `Math.random` — embora o
 * "segredo" não tenha valor criptográfico em si, a aleatoriedade forte
 * impede que um atacante consiga prever o próximo challenge a partir da
 * URL/horário e pré-gravar o vídeo da vítima.
 */
export function sortearChallenge(): ChallengeDefinicao {
	const bytes = crypto.getRandomValues(new Uint8Array(1));
	const idx = bytes[0] % CHALLENGES_DISPONIVEIS.length;
	return CHALLENGES_DISPONIVEIS[idx];
}

// ---------------------------------------------------------------------------
// Eye Aspect Ratio (EAR) — blink detection
// ---------------------------------------------------------------------------

/**
 * Calcula o EAR de um olho a partir dos 6 landmarks do face-api
 * (índices 36-41 para olho direito; 42-47 para olho esquerdo).
 *
 * Algoritmo clássico de Soukupová & Čech (2016):
 *
 *           |p2 - p6| + |p3 - p5|
 *   EAR  =  ─────────────────────
 *                2 · |p1 - p4|
 *
 * Olho aberto: EAR ≈ 0.25–0.35.
 * Olho fechado (blink): EAR cai abruptamente para < 0.20.
 */
interface LandmarkPoint {
	x: number;
	y: number;
}

function dist(a: LandmarkPoint, b: LandmarkPoint): number {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	return Math.sqrt(dx * dx + dy * dy);
}

function ear(eye: LandmarkPoint[]): number {
	if (eye.length !== 6) return NaN; // sem dados → sentinela (frame ignorado)
	const vert1 = dist(eye[1], eye[5]);
	const vert2 = dist(eye[2], eye[4]);
	const horiz = dist(eye[0], eye[3]);
	if (horiz === 0) return NaN;
	return (vert1 + vert2) / (2.0 * horiz);
}

/**
 * Limiares ABSOLUTOS de fallback — usados só antes da baseline calibrar (ou se a
 * calibração falhar). O EAR de olho aberto varia muito por pessoa/câmera/óculos/
 * distância, então a detecção principal é RELATIVA à baseline (ver `BlinkCounter`).
 */
const EAR_FECHADO = 0.2;
const EAR_ABERTO = 0.25;
/** Quantos blinks consecutivos exigir para considerar o challenge cumprido. */
const BLINKS_NECESSARIOS = 2;

/** Frames de olho aberto coletados para estimar a baseline do usuário. */
const CALIB_FRAMES = 5;
/** Olho "fechado" quando o EAR cai abaixo de baseline × este fator. */
const RATIO_FECHADO = 0.75;
/** Olho "aberto" de novo quando o EAR sobe acima de baseline × este fator (histerese). */
const RATIO_ABERTO = 0.85;

/**
 * Máquina de estados para detecção de blink com BASELINE ADAPTATIVO.
 *
 * Em vez de limiares fixos (frágeis: olhos pequenos podem nunca cair abaixo de
 * 0.2), calibra a abertura de olho do próprio usuário nos primeiros frames e
 * detecta a piscada por queda RELATIVA. Conta UM blink quando o EAR cai abaixo
 * de `baseline × RATIO_FECHADO` e depois sobe acima de `baseline × RATIO_ABERTO`
 * (histerese proporcional). Antes da calibração, recorre aos limiares absolutos.
 */
export class BlinkCounter {
	private estado: 'aberto' | 'fechado' = 'aberto';
	private blinksDetectados = 0;
	private baseline: number | null = null;
	private amostrasCalib: number[] = [];

	/**
	 * Alimenta um frame com landmarks do face-api.
	 *
	 * @param leftEye - 6 pontos (landmarks 36-41 do modelo 68)
	 * @param rightEye - 6 pontos (landmarks 42-47)
	 * @returns Progresso atualizado.
	 */
	feed(leftEye: LandmarkPoint[], rightEye: LandmarkPoint[]): ChallengeProgresso {
		const earMedio = (ear(leftEye) + ear(rightEye)) / 2;

		// Sem medição confiável (landmarks ausentes → ear()=NaN): ignora o frame,
		// não calibra nem muda de estado.
		const semMedida = !Number.isFinite(earMedio);

		if (!semMedida) {
			// Calibração: coleta as primeiras amostras válidas e usa o MÁXIMO como
			// baseline de olho aberto — robusto a uma piscada acidental durante a
			// janela (o frame baixo não vira a baseline).
			if (this.baseline === null) {
				this.amostrasCalib.push(earMedio);
				if (this.amostrasCalib.length >= CALIB_FRAMES) {
					this.baseline = Math.max(...this.amostrasCalib);
				}
			}

			const limFechado = this.baseline !== null ? this.baseline * RATIO_FECHADO : EAR_FECHADO;
			const limAberto = this.baseline !== null ? this.baseline * RATIO_ABERTO : EAR_ABERTO;

			if (this.estado === 'aberto' && earMedio < limFechado) {
				this.estado = 'fechado';
			} else if (this.estado === 'fechado' && earMedio > limAberto) {
				this.estado = 'aberto';
				this.blinksDetectados++;
			}
		}

		const concluido = this.blinksDetectados >= BLINKS_NECESSARIOS;
		return {
			tipo: 'blink',
			progresso: Math.min(1, this.blinksDetectados / BLINKS_NECESSARIOS),
			concluido,
			mensagem: concluido
				? '✅ Piscadas detectadas'
				: `Pisque mais ${BLINKS_NECESSARIOS - this.blinksDetectados}× (${this.blinksDetectados}/${BLINKS_NECESSARIOS})`
		};
	}

	reset(): void {
		this.estado = 'aberto';
		this.blinksDetectados = 0;
		this.baseline = null;
		this.amostrasCalib = [];
	}
}

// ---------------------------------------------------------------------------
// Smile detection
// ---------------------------------------------------------------------------

/** Probabilidade mínima de "happy" para considerar sorriso confirmado. */
const SMILE_THRESHOLD = 0.7;
/** Quantos frames consecutivos acima do threshold para confirmar. */
const SMILE_FRAMES_CONSECUTIVOS = 3;

export class SmileDetector {
	private framesAcima = 0;
	private confirmado = false;

	/**
	 * Alimenta a probabilidade `happy` do face-api expression model.
	 * Vai de 0.0 a 1.0.
	 */
	feed(happy: number): ChallengeProgresso {
		if (this.confirmado) {
			return {
				tipo: 'smile',
				progresso: 1,
				concluido: true,
				mensagem: '✅ Sorriso detectado'
			};
		}
		if (happy >= SMILE_THRESHOLD) {
			this.framesAcima++;
			if (this.framesAcima >= SMILE_FRAMES_CONSECUTIVOS) {
				this.confirmado = true;
			}
		} else {
			// Reset agressivo — exige sorriso CONTÍNUO, não 3 frames isolados.
			this.framesAcima = 0;
		}
		return {
			tipo: 'smile',
			progresso: Math.min(1, this.framesAcima / SMILE_FRAMES_CONSECUTIVOS),
			concluido: this.confirmado,
			mensagem: this.confirmado
				? '✅ Sorriso detectado'
				: this.framesAcima > 0
					? `Continue sorrindo... (${this.framesAcima}/${SMILE_FRAMES_CONSECUTIVOS})`
					: 'Sorria com mais ênfase'
		};
	}

	reset(): void {
		this.framesAcima = 0;
		this.confirmado = false;
	}
}
