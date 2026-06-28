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
 * (`head_turn`, `smile`), tornando inviável o uso de mídia pré-gravada — o
 * atacante não sabe o desafio antes de iniciar a captura.
 *
 * NOTA DE DESIGN (substituição do `blink`): o desafio de PISCAR foi removido.
 * A lógica de contagem (EAR) estava correta, mas o face-api em celular não
 * consegue AMOSTRAR o frame de olho fechado de forma confiável: o pipeline de
 * landmarks leva 200-400 ms por frame, e a fase fechada de uma piscada natural
 * dura só ~100-150 ms — ela cai ENTRE dois frames e nunca é observada. Os dois
 * desafios sobreviventes são SUSTENTADOS (durar ≥ 1 s), imunes à amostragem
 * lenta: `smile` (estado de expressão segurado) e `head_turn` (movimento
 * lateral da cabeça, medido por geometria estável de mandíbula+nariz).
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

type ChallengeTipo = 'head_turn' | 'smile';

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
	/** 0 a 1 — progresso do challenge (ex.: amplitude do giro / amplitude exigida). */
	progresso: number;
	/** Quando true, o challenge foi cumprido nesta iteração. */
	concluido: boolean;
	/** Mensagem dinâmica para a UI ("Vire um pouco mais", "Sorria com mais ênfase"). */
	mensagem: string;
}

// ---------------------------------------------------------------------------
// Definições dos challenges
// ---------------------------------------------------------------------------

/**
 * Lista de challenges disponíveis. Cada assinatura sorteia 1.
 *
 * Ambos são SUSTENTADOS (≥ 1 s), o que os torna robustos à amostragem lenta do
 * face-api em celular — ver nota de design no topo do arquivo sobre por que o
 * `blink` (evento rápido, < 150 ms) foi removido.
 *
 * `head_turn` NÃO usa pose 3D: mede um proxy 2D de guinada (yaw) pela posição
 * horizontal do nariz entre os extremos da mandíbula — geometria estável,
 * sem depender da precisão fina dos landmarks de olho.
 */
export const CHALLENGES_DISPONIVEIS: ChallengeDefinicao[] = [
	{
		tipo: 'head_turn',
		instrucao: 'Vire a cabeça para os lados',
		hint: 'Gire o rosto devagar para a esquerda e depois para a direita',
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
// Head turn — detecção de guinada (yaw) por geometria 2D
// ---------------------------------------------------------------------------

interface LandmarkPoint {
	x: number;
	y: number;
}

/**
 * Proxy 2D de guinada (yaw) da cabeça, normalizado em [-1, 1] e centrado em ~0
 * quando o rosto está de frente.
 *
 * Usa só a coordenada X de 3 pontos MUITO estáveis do modelo de 68 landmarks:
 *   - extremo esquerdo da mandíbula (`getJawOutline()[0]`  = landmark 0)
 *   - extremo direito da mandíbula  (`getJawOutline()[16]` = landmark 16)
 *   - ponta do nariz                (`getNose()[3]`        = landmark 30)
 *
 *        dEsq = nariz.x − mandíbulaEsq.x
 *        dDir = mandíbulaDir.x − nariz.x
 *        razão = (dEsq − dDir) / (dEsq + dDir)
 *
 * De frente o nariz fica ~equidistante → razão ≈ 0. Ao virar a cabeça, o nariz
 * se aproxima de um lado e a razão tende a ±1. É invariante a escala e
 * translação (o denominador é a largura horizontal do rosto), então não importa
 * a distância à câmera nem o enquadramento.
 *
 * @returns razão em [-1, 1], ou NaN se os landmarks necessários faltarem.
 */
function yawRatio(jaw: LandmarkPoint[], nose: LandmarkPoint[]): number {
	if (jaw.length < 17 || nose.length < 4) return NaN; // sem dados → frame ignorado
	const esqX = jaw[0].x;
	const dirX = jaw[16].x;
	const narizX = nose[3].x;
	const dEsq = narizX - esqX;
	const dDir = dirX - narizX;
	const larguraX = dEsq + dDir;
	if (larguraX <= 0) return NaN; // landmarks degenerados
	return (dEsq - dDir) / larguraX;
}

/** Suavização exponencial (EMA) do yaw — corta jitter de landmark frame-a-frame. */
const SMOOTH_ALPHA = 0.5;
/**
 * Amplitude mínima de movimento (max − min do yaw suavizado) para considerar a
 * cabeça "virada". Um giro real esquerda↔direita produz amplitude > 0.3; o
 * jitter de um rosto parado fica < ~0.05 após a EMA, então 0.18 dá larga
 * margem contra falso-positivo de foto estática sem exigir um giro exagerado.
 */
const TURN_RANGE = 0.18;
/** Frames válidos mínimos antes de poder concluir (evita conclusão instantânea). */
const MIN_FRAMES = 4;

/**
 * Detector de "virar a cabeça". Diferente do blink (evento rápido que a
 * amostragem do face-api perdia), o giro é um MOVIMENTO SUSTENTADO: basta medir
 * a AMPLITUDE do yaw ao longo da sessão. Não precisa de calibração de pose
 * inicial — mede o quanto a cabeça se moveu lateralmente a partir de onde
 * começou, o que é exatamente o sinal de vivacidade desejado (uma foto parada
 * tem amplitude ~0).
 */
export class HeadTurnDetector {
	private yawSuave: number | null = null;
	private min = Infinity;
	private max = -Infinity;
	private framesValidos = 0;
	private confirmado = false;

	/**
	 * Alimenta um frame com os landmarks de mandíbula e nariz do face-api.
	 *
	 * @param jaw - `landmarks.getJawOutline()` (17 pontos, landmarks 0-16)
	 * @param nose - `landmarks.getNose()` (9 pontos, landmarks 27-35; ponta = índice 3)
	 */
	feed(jaw: LandmarkPoint[], nose: LandmarkPoint[]): ChallengeProgresso {
		const yaw = yawRatio(jaw, nose);

		// Sem medição confiável (landmarks ausentes → NaN): ignora o frame.
		if (Number.isFinite(yaw)) {
			this.yawSuave =
				this.yawSuave === null ? yaw : SMOOTH_ALPHA * yaw + (1 - SMOOTH_ALPHA) * this.yawSuave;
			if (this.yawSuave < this.min) this.min = this.yawSuave;
			if (this.yawSuave > this.max) this.max = this.yawSuave;
			this.framesValidos++;
		}

		const amplitude = this.max > this.min ? this.max - this.min : 0;
		if (amplitude >= TURN_RANGE && this.framesValidos >= MIN_FRAMES) {
			this.confirmado = true;
		}

		const progresso = this.confirmado ? 1 : Math.min(1, amplitude / TURN_RANGE);
		return {
			tipo: 'head_turn',
			progresso,
			concluido: this.confirmado,
			mensagem: this.confirmado
				? '✅ Movimento detectado'
				: this.framesValidos === 0
					? 'Posicione o rosto de frente para começar'
					: progresso > 0.4
						? 'Continue virando a cabeça...'
						: 'Vire a cabeça devagar para o lado'
		};
	}

	reset(): void {
		this.yawSuave = null;
		this.min = Infinity;
		this.max = -Infinity;
		this.framesValidos = 0;
		this.confirmado = false;
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
