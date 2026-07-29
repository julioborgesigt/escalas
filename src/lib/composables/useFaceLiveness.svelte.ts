/**
 * Máquina de prova de vida (câmera + face-api + challenge ativo), extraída
 * de SignaturePad.svelte.
 *
 * Responsabilidades:
 *  - abrir/fechar a câmera frontal e carregar os modelos do face-api
 *    (self-hostados em `static/face-api/`);
 *  - loop de detecção (~150ms) com histerese de estabilidade e alimentação
 *    do challenge sorteado (head_turn/smile) — barra foto/vídeo pré-gravado;
 *  - contagem regressiva de 3s e captura final da selfie (com re-checagem
 *    de rosto no último milissegundo);
 *  - consolidação do resultado do challenge para o manifesto.
 *
 * O componente faz `bind:this={liveness.videoElement}`, chama
 * `entrarNaCamera()`/`aoVoltarDaCamera()` no `$effect` do `step` e registra
 * `limparRecursos()` como cleanup.
 */
import {
	sortearChallenge,
	HeadTurnDetector,
	SmileDetector,
	type ChallengeDefinicao,
	type ChallengeProgresso
} from '$lib/liveness-challenge';
import type { SignaturePadLivenessResultado } from '$lib/components/SignaturePadTypes';

export function useFaceLiveness(opts: { exigirFoto: () => boolean }) {
	let faceapi: typeof import('@vladmandic/face-api') | null = $state(null);

	let videoElement = $state<HTMLVideoElement | null>(null);
	let stream = $state<MediaStream | null>(null);
	let cameraError = $state<string | null>(null);
	let capturingImage = $state(false);

	let faceDetected = $state(false);
	let isFaceModelLoaded = $state(false);
	let faceDetectionInterval: ReturnType<typeof setInterval> | null = null;
	let countdownTimer: ReturnType<typeof setInterval> | null = null;
	let faceStatusMessage = $state('Inicializando IA...');
	let faceLoadError = $state<string | null>(null);

	// Estabilidade e contagem
	let countdown = $state(0);
	let isMoving = $state(false);
	let lastBox = $state<{ x: number; y: number } | null>(null);
	let isFlashActive = $state(false);
	let stableFrames = $state(0); // Frames consecutivos abaixo do limiar (histerese p/ entrar em "estável")
	let movingFrames = $state(0); // Frames consecutivos acima do limiar (histerese p/ entrar em "movendo")
	let lastErrorCode = $state<string | null>(null); // Erros de captura final

	// Liveness ATIVA (challenge-response) — barra foto/vídeo pré-gravado.
	// Sorteia 1 challenge (head_turn ou smile) por sessão. O usuário precisa
	// cumprir antes do botão "tirar foto" ser liberado.
	let challengeAtual = $state<ChallengeDefinicao | null>(null);
	let challengeProgresso = $state<ChallengeProgresso | null>(null);
	// Epoch ms (não Date/ISO): evita instâncias mutáveis de Date em estado
	// reativo (svelte/prefer-svelte-reactivity); a conversão para ISO acontece
	// só na borda, em montarLivenessResultado.
	let challengeIniciadoEm = $state<number | null>(null);
	let challengeConcluidoEm = $state<number | null>(null);
	let challengeTentativas = $state(0);
	const headTurnDetector = new HeadTurnDetector();
	const smileDetector = new SmileDetector();

	function entrarNaCamera() {
		if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
			navigator.mediaDevices
				.getUserMedia({
					video: {
						facingMode: 'user',
						width: { ideal: 1280 },
						height: { ideal: 720 }
					}
				})
				.then((s) => {
					stream = s;
					if (videoElement) {
						videoElement.srcObject = s;
						videoElement.onloadedmetadata = () => {
							videoElement?.play().catch(() => {});
							initFaceDetection();
						};
					}
				})
				.catch((err) => {
					console.warn('Camera error:', err);
					cameraError = 'Por favor, autorize a câmera. A Prova de Vida é obrigatória.';
				});
		} else {
			cameraError = 'Navegador não suporta acesso à câmera.';
		}
	}

	/** Ao voltar para a tela de assinatura: para o loop e re-sorteia na próxima entrada. */
	function aoVoltarDaCamera() {
		if (faceDetectionInterval) clearInterval(faceDetectionInterval);
		challengeAtual = null;
		challengeProgresso = null;
		challengeIniciadoEm = null;
		challengeConcluidoEm = null;
		challengeTentativas = 0;
		headTurnDetector.reset();
		smileDetector.reset();
	}

	/** Cleanup do `$effect` (re-run e unmount): solta câmera e timers. */
	function limparRecursos() {
		if (stream) {
			stream.getTracks().forEach((track) => track.stop());
		}
		if (faceDetectionInterval) clearInterval(faceDetectionInterval);
		if (countdownTimer) clearInterval(countdownTimer);
	}

	async function initFaceDetection() {
		try {
			if (!faceapi && typeof window !== 'undefined') {
				faceapi = await import('@vladmandic/face-api');
			}
			if (faceapi && !isFaceModelLoaded) {
				// Self-hostado em `static/face-api/` — servido pela CDN do Cloudflare
				// Pages. Removemos a dependência de `cdn.jsdelivr.net`.
				//
				// Carrega 3 modelos:
				//  - tinyFaceDetector: presença e localização do rosto
				//  - faceLandmark68Net: 68 pontos faciais (mandíbula+nariz p/ head_turn)
				//  - faceExpressionNet: probabilidades de happy/sad/etc (smile challenge)
				await Promise.all([
					faceapi.nets.tinyFaceDetector.loadFromUri('/face-api/'),
					faceapi.nets.faceLandmark68Net.loadFromUri('/face-api/'),
					faceapi.nets.faceExpressionNet.loadFromUri('/face-api/')
				]);
				isFaceModelLoaded = true;
			}

			// Sortear challenge da sessão (cada vez que entra na step camera).
			if (!challengeAtual) {
				challengeAtual = sortearChallenge();
				challengeIniciadoEm = Date.now();
				challengeTentativas = 1;
				headTurnDetector.reset();
				smileDetector.reset();
			}

			startDetectionLoop();
		} catch (e: unknown) {
			console.error('Erro ao carregar face-api:', e);
			faceLoadError = 'Falha ao baixar modelo facial. Verifique internet.';
		}
	}

	/**
	 * Re-sorteia um novo challenge (chamado pelo botão "trocar desafio").
	 * Útil quando o usuário tem dificuldade em executar o sorteado (ex.: smile
	 * com máscara).
	 */
	function trocarChallenge() {
		const anterior = challengeAtual?.tipo;
		// Re-sorteia até pegar um diferente do anterior.
		let novo = sortearChallenge();
		let tentativas = 0;
		while (novo.tipo === anterior && tentativas < 5) {
			novo = sortearChallenge();
			tentativas++;
		}
		challengeAtual = novo;
		challengeProgresso = null;
		challengeIniciadoEm = Date.now();
		challengeConcluidoEm = null;
		challengeTentativas += 1;
		headTurnDetector.reset();
		smileDetector.reset();
	}

	function startDetectionLoop() {
		if (faceDetectionInterval) clearInterval(faceDetectionInterval);
		// Guarda de reentrância: com amostragem rápida (150ms) uma detecção lenta
		// em aparelho modesto poderia empilhar chamadas. Se ainda há uma rodando,
		// o tick atual é ignorado (a cadência cai naturalmente, sem pile-up).
		let emAndamento = false;
		faceDetectionInterval = setInterval(async () => {
			if (!videoElement || videoElement.paused || !isFaceModelLoaded || !faceapi) return;
			if (emAndamento) return;
			emAndamento = true;
			try {
				// Pipeline MÍNIMA por desafio: head_turn só precisa dos 68 landmarks
				// (mandíbula + nariz); o smile só das expressões. Rodar apenas a rede
				// necessária mantém a cadência alta. inputSize 224 basta para ambos —
				// head_turn usa geometria grosseira de pose, não detalhe fino (era o
				// blink, aposentado, que pedia 320 p/ olhos nítidos).
				const tipo = challengeAtual?.tipo;
				const opts2 = new faceapi.TinyFaceDetectorOptions({
					inputSize: 224,
					scoreThreshold: 0.5
				});

				let box: { x: number; y: number; width: number } | null = null;
				let jaw: { x: number; y: number }[] | null = null;
				let nose: { x: number; y: number }[] | null = null;
				let happy: number | null = null;

				if (tipo === 'smile') {
					const det = await faceapi.detectSingleFace(videoElement, opts2).withFaceExpressions();
					if (det) {
						box = det.detection.box;
						happy = det.expressions.happy ?? 0;
					}
				} else {
					// head_turn (e fallback enquanto o challenge ainda não sorteou): landmarks.
					const det = await faceapi.detectSingleFace(videoElement, opts2).withFaceLandmarks();
					if (det) {
						box = det.detection.box;
						jaw = det.landmarks.getJawOutline();
						nose = det.landmarks.getNose();
					}
				}

				if (!box) {
					faceDetected = false;
					stableFrames = 0;
					movingFrames = 0;
					faceStatusMessage = 'Posicione seu rosto na frente da câmera.';
					isMoving = false;
					return;
				}

				faceDetected = true;

				// Durante o head_turn ATIVO o rosto SE MOVE de propósito — não faz
				// sentido alertar "segure firme" nem marcar isMoving (que bloquearia o
				// feedback visual de pronto). Após o desafio concluir, a checagem de
				// estabilidade volta a valer para a foto final (+ countdown de 3s).
				const headTurnAtivo =
					challengeAtual?.tipo === 'head_turn' && !challengeProgresso?.concluido;

				if (lastBox) {
					const dx = box.x - lastBox.x;
					const dy = box.y - lastBox.y;
					const dist = Math.sqrt(dx * dx + dy * dy);
					// Limiar RELATIVO ao tamanho do rosto: ~9% da largura do box.
					// Absoluto em pixels falha quando o usuário se aproxima/afasta
					// (face grande tolera mais ruído; face pequena, menos).
					// Floor de 14px evita que rostos muito pequenos disparem com qualquer jitter.
					const threshold = Math.max(14, box.width * 0.09);
					const movedValue = dist > threshold;

					if (movedValue && !headTurnAtivo) {
						movingFrames++;
						stableFrames = 0;
						// Histerese: só declara "movendo" após 2 frames consecutivos
						// acima do limiar. Um único frame ruidoso (comum no face-api)
						// não basta para piscar o alerta.
						if (movingFrames >= 2) {
							isMoving = true;
							faceStatusMessage = 'Mantenha o celular firme!';
						}
					} else {
						movingFrames = 0;
						stableFrames++;
						if (stableFrames >= 2) {
							isMoving = false;
							faceStatusMessage = headTurnAtivo
								? 'Vire a cabeça conforme o desafio'
								: 'Rosto detectado';
						}
					}
				} else {
					faceStatusMessage = headTurnAtivo
						? 'Vire a cabeça conforme o desafio'
						: 'Rosto detectado';
				}
				lastBox = box;

				// Alimentar o challenge ativo com os dados desta frame.
				if (challengeAtual && !challengeProgresso?.concluido) {
					if (challengeAtual.tipo === 'head_turn' && jaw && nose) {
						challengeProgresso = headTurnDetector.feed(jaw, nose);
					} else if (challengeAtual.tipo === 'smile' && happy !== null) {
						challengeProgresso = smileDetector.feed(happy);
					}
					if (challengeProgresso?.concluido && !challengeConcluidoEm) {
						challengeConcluidoEm = Date.now();
					}
				}
			} catch {
				// Ignora erros ocasionais (pipeline pesado pode falhar em frames específicos)
			} finally {
				emAndamento = false;
			}
			// ~150ms: cadência alta para acompanhar com fluidez o giro da cabeça e o
			// sorriso. Os desafios sobreviventes são sustentados (≥ 1s), então não
			// dependem de pegar um frame instantâneo — só de amostrar o movimento.
		}, 150);
	}

	/**
	 * Captura final da selfie (com verificação de último milissegundo).
	 *
	 * Retornos: `string` (selfie JPEG base64), `null` (sem câmera ativa —
	 * prossegue sem selfie, como no original) ou `undefined` (ABORTADO:
	 * rosto sumiu/múltiplos rostos — `lastErrorCode` já foi exibido e o
	 * chamador deve interromper o fluxo de assinatura).
	 */
	async function capturarSelfie(): Promise<string | null | undefined> {
		capturingImage = true;
		lastErrorCode = null;
		let selfieBase64: string | null = null;

		if (videoElement && stream && faceapi) {
			// VERIFICAÇÃO DE ÚLTIMO MILISSEGUNDO: O rosto ainda está lá?
			// Isso evita que o usuário "fuja" da câmera no final do countdown
			const finalDetection = await faceapi.detectAllFaces(
				videoElement,
				new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 })
			);

			if (finalDetection.length !== 1) {
				lastErrorCode =
					finalDetection.length === 0
						? 'Rosto não detectado no momento da foto!'
						: 'Múltiplos rostos detectados no momento da foto!';
				capturingImage = false;
				countdown = 0; // Reseta tentativa
				return undefined;
			}

			const sc = document.createElement('canvas');
			// Força a proporção 3:4 (retrato) para garantir padronização perfeita entre entrada e saída
			const uiRatio = 0.75;

			// Resolução aumentada para 600x800 para maior nitidez
			const ch = 800;
			const cw = 600;
			sc.width = cw;
			sc.height = ch;

			const sctx = sc.getContext('2d');
			if (sctx) {
				// Object Cover: desenha o vídeo cobrindo perfeitamente o canvas da UI
				const videoRatio = videoElement.videoWidth / videoElement.videoHeight;
				let drawWidth = cw;
				let drawHeight = ch;
				let offsetX = 0;
				let offsetY = 0;

				if (videoRatio > uiRatio) {
					// Vídeo da câmera é mais "esticado" (widescreen) que o canvas da tela
					drawWidth = ch * videoRatio;
					offsetX = (cw - drawWidth) / 2;
				} else {
					// Vídeo da câmera é mais alto/quadrado que o canvas da tela
					drawHeight = cw / videoRatio;
					offsetY = (ch - drawHeight) / 2;
				}

				sctx.drawImage(videoElement, offsetX, offsetY, drawWidth, drawHeight);

				// Efeito visual de flash
				isFlashActive = true;
				setTimeout(() => (isFlashActive = false), 150);

				// Qualidade aumentada de 0.82 para 0.88 para maior clareza
				selfieBase64 = sc.toDataURL('image/jpeg', 0.88);
			}
		}

		return selfieBase64;
	}

	/**
	 * Resultado consolidado do challenge ativo (liveness), pronto para
	 * persistência no manifesto. Quando exigirFoto=false, fica `null`.
	 */
	function montarLivenessResultado(): SignaturePadLivenessResultado | null {
		if (!opts.exigirFoto() || !challengeAtual) return null;
		const inicio = challengeIniciadoEm ?? Date.now();
		const fim = challengeConcluidoEm ?? Date.now();
		// Date efêmero, só para formatar ISO na borda do manifesto — nunca fica
		// em estado reativo (daí o disable pontual da regra).
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());
		return {
			tipo: challengeAtual.tipo,
			cumprido: !!challengeProgresso?.concluido,
			tentativas: challengeTentativas,
			iniciadoEm: iso(challengeIniciadoEm),
			concluidoEm: iso(challengeConcluidoEm),
			duracaoMs: Math.max(0, fim - inicio)
		};
	}

	/** Contagem de 3s antes da foto; `aoDisparar` roda quando chega a zero. */
	function iniciarContagem(aoDisparar: () => void) {
		if (countdown > 0) return;
		// Liveness ativa: bloqueia captura enquanto o challenge sorteado não
		// foi cumprido. Sem isso, o face-api só atestou "tem rosto na frente"
		// — o que passa em foto/vídeo pré-gravado.
		if (opts.exigirFoto() && challengeAtual && !challengeProgresso?.concluido) {
			lastErrorCode = `Cumpra o desafio antes de tirar a foto: ${challengeAtual.instrucao}`;
			return;
		}

		// Inicia contagem de 3 segundos para dar tempo ao usuário de estabilizar o celular
		countdown = 3;
		countdownTimer = setInterval(() => {
			countdown--;
			if (countdown === 0) {
				if (countdownTimer) clearInterval(countdownTimer);
				countdownTimer = null;
				aoDisparar();
			}
		}, 1000);
	}

	return {
		get videoElement() {
			return videoElement;
		},
		set videoElement(v: HTMLVideoElement | null) {
			videoElement = v;
		},
		get stream() {
			return stream;
		},
		get cameraError() {
			return cameraError;
		},
		get capturingImage() {
			return capturingImage;
		},
		get faceDetected() {
			return faceDetected;
		},
		get faceStatusMessage() {
			return faceStatusMessage;
		},
		get faceLoadError() {
			return faceLoadError;
		},
		get countdown() {
			return countdown;
		},
		get isMoving() {
			return isMoving;
		},
		get isFlashActive() {
			return isFlashActive;
		},
		get lastErrorCode() {
			return lastErrorCode;
		},
		get challengeAtual() {
			return challengeAtual;
		},
		get challengeProgresso() {
			return challengeProgresso;
		},
		entrarNaCamera,
		aoVoltarDaCamera,
		limparRecursos,
		trocarChallenge,
		capturarSelfie,
		montarLivenessResultado,
		iniciarContagem
	};
}
