<script lang="ts">
	import type {
		SignaturePadLivenessResultado,
		SignaturePadConfirmPayload
	} from './SignaturePadTypes';
	import { csrfHeaders } from '$lib/csrf';
	import { toaster } from '$lib/toast';
	import Spinner from './Spinner.svelte';
	import IconTooltip from './IconTooltip.svelte';
	import CodigoTimer from './CodigoTimer.svelte';
	import {
		sortearChallenge,
		HeadTurnDetector,
		SmileDetector,
		type ChallengeDefinicao,
		type ChallengeProgresso
	} from '$lib/liveness-challenge';
	let faceapi: typeof import('@vladmandic/face-api') | null = $state(null);

	let {
		onConfirm,
		onCancel,
		message = '',
		exigirFoto = true,
		exigirGps = true,
		exigirCodigoEmail = false,
		step = $bindable('signature')
	}: {
		onConfirm: (payload: SignaturePadConfirmPayload) => void | Promise<void>;
		onCancel: () => void;
		message?: string;
		exigirFoto?: boolean;
		exigirGps?: boolean;
		exigirCodigoEmail?: boolean;
		step?: 'signature' | 'camera' | 'email_code';
	} = $props();

	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D;
	let drawing = false;
	let capturingLocation = $state(false);
	let coords = $state<{ lat: number; lng: number } | null>(null);
	let locationError = $state<string | null>(null);

	// Selfie states
	let videoElement = $state<HTMLVideoElement | null>(null);
	let stream = $state<MediaStream | null>(null);
	let cameraError = $state<string | null>(null);
	let capturingImage = $state(false);

	// Face Liveness states
	let faceDetected = $state(false);
	let isFaceModelLoaded = $state(false);
	let faceDetectionInterval: ReturnType<typeof setInterval> | null = null;
	let countdownTimer: ReturnType<typeof setInterval> | null = null;
	let faceStatusMessage = $state('Inicializando IA...');
	let faceLoadError = $state<string | null>(null);

	// Novos estados para estabilidade e contagem
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
	let challengeIniciadoEm = $state<string | null>(null);
	let challengeConcluidoEm = $state<string | null>(null);
	let challengeTentativas = $state(0);
	const headTurnDetector = new HeadTurnDetector();
	const smileDetector = new SmileDetector();

	// Estados do Email Code
	let solicitandoCodigo = $state(false);
	let codigoInput = $state('');
	let codigoError = $state<string | null>(null);
	let emailMascarado = $state('');
	let desafioId = $state<string | null>(null);
	// IMPORTANTE: `liveness` precisa ser capturado AQUI (no momento da foto) e não
	// recalculado em confirmarCodigo. Quando step muda para 'email_code', o
	// $effect reseta challengeAtual=null — se chamássemos montarLivenessResultado()
	// depois, devolveria null e o servidor rejeitaria com "liveness ausente".
	let pendingSignature = $state<{
		dataUrl: string;
		lat: number | undefined;
		lng: number | undefined;
		selfieBase64: string | null;
		liveness: SignaturePadLivenessResultado | null;
	} | null>(null);

	$effect(() => {
		if (step === 'camera') {
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
		} else {
			// se voltar para a tela de assinatura
			if (faceDetectionInterval) clearInterval(faceDetectionInterval);
			// Reset do challenge para que próxima entrada na câmera sorteie novo
			challengeAtual = null;
			challengeProgresso = null;
			challengeIniciadoEm = null;
			challengeConcluidoEm = null;
			challengeTentativas = 0;
			headTurnDetector.reset();
			smileDetector.reset();
		}

		return () => {
			if (stream) {
				stream.getTracks().forEach((track) => track.stop());
			}
			if (faceDetectionInterval) clearInterval(faceDetectionInterval);
			if (countdownTimer) clearInterval(countdownTimer);
		};
	});

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
				challengeIniciadoEm = new Date().toISOString();
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
		challengeIniciadoEm = new Date().toISOString();
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
				const opts = new faceapi.TinyFaceDetectorOptions({
					inputSize: 224,
					scoreThreshold: 0.5
				});

				let box: { x: number; y: number; width: number } | null = null;
				let jaw: { x: number; y: number }[] | null = null;
				let nose: { x: number; y: number }[] | null = null;
				let happy: number | null = null;

				if (tipo === 'smile') {
					const det = await faceapi.detectSingleFace(videoElement, opts).withFaceExpressions();
					if (det) {
						box = det.detection.box;
						happy = det.expressions.happy ?? 0;
					}
				} else {
					// head_turn (e fallback enquanto o challenge ainda não sorteou): landmarks.
					const det = await faceapi.detectSingleFace(videoElement, opts).withFaceLandmarks();
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
							faceStatusMessage = 'Mantenha o celular firme! ✋';
						}
					} else {
						movingFrames = 0;
						stableFrames++;
						if (stableFrames >= 2) {
							isMoving = false;
							faceStatusMessage = headTurnAtivo
								? 'Vire a cabeça conforme o desafio'
								: 'Rosto Detectado ✅';
						}
					}
				} else {
					faceStatusMessage = headTurnAtivo
						? 'Vire a cabeça conforme o desafio'
						: 'Rosto Detectado ✅';
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
						challengeConcluidoEm = new Date().toISOString();
					}
				}
			} catch (e) {
				// Ignora erros ocasionais (pipeline pesado pode falhar em frames específicos)
			} finally {
				emAndamento = false;
			}
			// ~150ms: cadência alta para acompanhar com fluidez o giro da cabeça e o
			// sorriso. Os desafios sobreviventes são sustentados (≥ 1s), então não
			// dependem de pegar um frame instantâneo — só de amostrar o movimento.
		}, 150);
	}

	$effect(() => {
		if (canvas) {
			ctx = canvas.getContext('2d')!;
			ctx.strokeStyle = '#000';
			ctx.lineWidth = 2.5;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
		}

		// Iniciar captura de localização ao abrir (somente se exigido)
		if (exigirGps) {
			if ('geolocation' in navigator) {
				capturingLocation = true;
				navigator.geolocation.getCurrentPosition(
					(pos) => {
						coords = {
							lat: pos.coords.latitude,
							lng: pos.coords.longitude
						};
						capturingLocation = false;
					},
					(err) => {
						console.warn('Erro ao capturar localização:', err);
						locationError =
							'Não foi possível capturar sua localização. Por favor, permita o acesso ao GPS.';
						capturingLocation = false;
					},
					{ enableHighAccuracy: true, timeout: 10000 }
				);
			} else {
				locationError = 'GPS não disponível neste dispositivo.';
			}
		}
	});

	function startDrawing(e: MouseEvent | TouchEvent) {
		drawing = true;
		const { x, y } = getCoord(e);
		ctx.beginPath();
		ctx.moveTo(x, y);
	}

	function draw(e: MouseEvent | TouchEvent) {
		if (!drawing) return;
		e.preventDefault();
		const { x, y } = getCoord(e);
		ctx.lineTo(x, y);
		ctx.stroke();
	}

	function stopDrawing() {
		drawing = false;
	}

	function getCoord(e: MouseEvent | TouchEvent) {
		const rect = canvas.getBoundingClientRect();
		if ('touches' in e) {
			return {
				x: e.touches[0].clientX - rect.left,
				y: e.touches[0].clientY - rect.top
			};
		}
		return {
			x: (e as MouseEvent).clientX - rect.left,
			y: (e as MouseEvent).clientY - rect.top
		};
	}

	function clear() {
		ctx.clearRect(0, 0, canvas.width, canvas.height);
	}

	function comprimirRubrica(src: HTMLCanvasElement, maxKb = 100): string {
		const maxBytes = maxKb * 1024;

		function flatCanvas(
			source: HTMLCanvasElement,
			w = source.width,
			h = source.height
		): HTMLCanvasElement {
			const c = document.createElement('canvas');
			c.width = w;
			c.height = h;
			const c2d = c.getContext('2d')!;
			c2d.fillStyle = '#ffffff';
			c2d.fillRect(0, 0, w, h);
			c2d.drawImage(source, 0, 0, w, h);
			return c;
		}

		function base64Size(dataUrl: string): number {
			const b64 = dataUrl.split(',')[1] ?? '';
			return Math.ceil((b64.length * 3) / 4);
		}

		const flat = flatCanvas(src);
		for (const q of [0.92, 0.88, 0.84, 0.8, 0.76, 0.72, 0.68]) {
			const jpg = flat.toDataURL('image/jpeg', q);
			if (base64Size(jpg) <= maxBytes) return jpg;
		}

		const scale = 0.85;
		const small = flatCanvas(src, Math.round(src.width * scale), Math.round(src.height * scale));
		for (const q of [0.92, 0.88, 0.84, 0.8, 0.76]) {
			const jpg = small.toDataURL('image/jpeg', q);
			if (base64Size(jpg) <= maxBytes) return jpg;
		}

		return small.toDataURL('image/jpeg', 0.75);
	}

	function confirmarSemFoto() {
		const thumbCanvas = document.createElement('canvas');
		thumbCanvas.width = 150;
		thumbCanvas.height = 60;
		const thumbCtx = thumbCanvas.getContext('2d')!;
		thumbCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, 150, 60);
		const dataUrl = comprimirRubrica(canvas, 100);
		processarAssinatura(dataUrl, coords?.lat, coords?.lng, null);
	}

	async function confirm() {
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
				return;
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

		// Redimensiona a rúbrica para 150x60 antes de exportar como PNG.
		// Isso reduz o peso de ~500KB para ~15KB sem gerar quadros pretos no PDF,
		// problema conhecido quando jsPDF recebe JPEG de formato canvas.
		const thumbCanvas = document.createElement('canvas');
		thumbCanvas.width = 150;
		thumbCanvas.height = 60;
		const thumbCtx = thumbCanvas.getContext('2d')!;
		thumbCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, 150, 60);
		const dataUrl = comprimirRubrica(canvas, 100);
		processarAssinatura(dataUrl, coords?.lat, coords?.lng, selfieBase64);
	}

	/**
	 * Resultado consolidado do challenge ativo (liveness), pronto para
	 * persistência no manifesto. Quando exigirFoto=false, fica `null`.
	 */
	function montarLivenessResultado() {
		if (!exigirFoto || !challengeAtual) return null;
		const inicio = challengeIniciadoEm ? new Date(challengeIniciadoEm).getTime() : Date.now();
		const fim = challengeConcluidoEm ? new Date(challengeConcluidoEm).getTime() : Date.now();
		return {
			tipo: challengeAtual.tipo,
			cumprido: !!challengeProgresso?.concluido,
			tentativas: challengeTentativas,
			iniciadoEm: challengeIniciadoEm,
			concluidoEm: challengeConcluidoEm,
			duracaoMs: Math.max(0, fim - inicio)
		};
	}

	async function processarAssinatura(
		dataUrl: string,
		lat: number | undefined,
		lng: number | undefined,
		selfieBase64: string | null
	) {
		// Snapshot do liveness ANTES de qualquer mudança de step. A transição
		// para 'email_code' dispara o $effect que zera challengeAtual, então
		// recalcular depois devolve null.
		const liveness = montarLivenessResultado();
		if (exigirCodigoEmail) {
			pendingSignature = { dataUrl, lat, lng, selfieBase64, liveness };
			const ok = await enviarOuReenviarCodigo();
			if (ok) step = 'email_code';
		} else {
			onConfirm({ rubrica: dataUrl, lat, lng, selfie: selfieBase64, liveness });
		}
	}

	async function enviarOuReenviarCodigo() {
		solicitandoCodigo = true;
		codigoError = null;
		codigoInput = '';
		try {
			const res = await fetch('/api/auth/solicitar-codigo-assinatura', {
				method: 'POST',
				headers: { ...csrfHeaders(), 'Content-Type': 'application/json' }
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || data.message || 'Falha ao solicitar código');

			emailMascarado = data.emailMascarado;
			desafioId = data.desafioId;
			return true;
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : 'Erro desconhecido';
			codigoError = msg;
			// Se o erro for de login/sessão, avisar de forma mais incisiva (toast
			// de erro no canto — bloqueia menos que alert() e respeita o tema).
			if (msg.includes('Sessão inválida')) {
				toaster.create({ title: 'Sessão expirada', description: msg, type: 'error' });
			}
			return false;
		} finally {
			solicitandoCodigo = false;
		}
	}

	function confirmarCodigo() {
		if (codigoInput.length !== 6) {
			codigoError = 'O código deve conter 6 dígitos.';
			return;
		}
		if (pendingSignature && desafioId) {
			onConfirm({
				rubrica: pendingSignature.dataUrl,
				lat: pendingSignature.lat,
				lng: pendingSignature.lng,
				selfie: pendingSignature.selfieBase64,
				codigoEmail: codigoInput,
				desafioId,
				liveness: pendingSignature.liveness
			});
		}
	}

	function startCaptureSequence() {
		if (countdown > 0) return;
		// Liveness ativa: bloqueia captura enquanto o challenge sorteado não
		// foi cumprido. Sem isso, o face-api só atestou "tem rosto na frente"
		// — o que passa em foto/vídeo pré-gravado.
		if (exigirFoto && challengeAtual && !challengeProgresso?.concluido) {
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
				confirm();
			}
		}, 1000);
	}
</script>

<div class="space-y-4">
	{#if message}
		<p class="text-[0.65rem] font-bold text-surface-500 uppercase text-center mb-1">
			{message}
		</p>
	{/if}

	{#if codigoError && step !== 'email_code'}
		<div
			class="p-4 bg-error-500/10 border-2 border-error-500/30 rounded-2xl animate-in fade-in slide-in-from-top-2 duration-300"
		>
			<div class="flex items-center gap-3">
				<div class="bg-error-500 rounded-full p-1.5 shadow-lg shadow-error-500/30">
					<svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="3"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</div>
				<div class="flex-1">
					<p class="text-xs font-black text-error-600 uppercase tracking-widest leading-tight">
						Erro na Assinatura
					</p>
					<p class="text-[0.65rem] font-bold text-error-700/80 leading-snug">
						{codigoError}
					</p>
				</div>
			</div>
		</div>
	{/if}

	<div class="flex flex-col gap-4">
		<div class="space-y-2 {step !== 'signature' ? 'hidden' : ''}">
			<div class="flex justify-between items-end">
				<span class="text-[0.6rem] font-bold text-surface-500 uppercase tracking-wider"
					>Sua Rubrica</span
				>
			</div>
			<div
				class="bg-white border-2 border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden touch-none relative min-h-[280px]"
			>
				<canvas
					bind:this={canvas}
					width="500"
					height="280"
					aria-label="Área de desenho da assinatura manuscrita — desenhe sua assinatura com o dedo ou mouse"
					class="w-full h-[280px] cursor-crosshair touch-none"
					onmousedown={startDrawing}
					onmousemove={draw}
					onmouseup={stopDrawing}
					onmouseleave={stopDrawing}
					ontouchstart={startDrawing}
					ontouchmove={draw}
					ontouchend={stopDrawing}
				></canvas>

				<!-- Indicador de GPS -->
				{#if exigirGps}
					<div
						class="absolute bottom-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-white/80 dark:bg-surface-900/80 backdrop-blur-sm border border-surface-200 dark:border-surface-700"
					>
						{#if capturingLocation}
							<span class="w-2 h-2 rounded-full bg-warning-500 animate-pulse"></span>
							<span class="text-[0.6rem] font-black uppercase text-warning-600"
								>Capturando GPS...</span
							>
						{:else if coords}
							<span class="w-2 h-2 rounded-full bg-success-500"></span>
							<span class="text-[0.6rem] font-black uppercase text-success-600">GPS Localizado</span
							>
						{:else}
							<span class="w-2 h-2 rounded-full bg-error-500"></span>
							<span class="text-[0.6rem] font-black uppercase text-error-600">GPS Falhou</span>
						{/if}
					</div>
				{/if}
			</div>
		</div>

		{#if step === 'camera'}
			<!-- Camera Preview -->
			<div
				class="w-full bg-surface-100 dark:bg-surface-800 border-2 border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden flex flex-col pt-3 items-center relative aspect-[3/4] min-h-[400px] object-cover"
			>
				<span
					class="text-[0.65rem] font-bold text-surface-500 uppercase tracking-wider items-center mb-3 px-2 flex gap-1.5"
				>
					<span
						class="w-2.5 h-2.5 rounded-full {stream
							? 'bg-error-500 animate-pulse'
							: 'bg-surface-300'}"
					></span>
					Prova de Vida
				</span>
				<video
					bind:this={videoElement}
					autoplay
					playsinline
					muted
					class="w-full h-[90%] object-cover bg-surface-200 dark:bg-surface-900 {faceDetected
						? isMoving
							? 'ring-4 ring-warning-500/50'
							: 'ring-4 ring-success-500/50'
						: 'ring-2 ring-warning-500/30'}"
				></video>

				<!-- Banner do challenge ativo (liveness) — barra foto/vídeo pré-gravado -->
				{#if challengeAtual && faceDetected}
					{@const ok = challengeProgresso?.concluido ?? false}
					<div
						class="absolute top-12 left-4 right-4 z-30 px-3 py-2 rounded-xl backdrop-blur-md border-2 transition-all duration-200 pointer-events-auto shadow-lg {ok
							? 'bg-success-500/20 border-success-400/60 text-success-50'
							: 'bg-primary-900/70 border-primary-400/60 text-white'}"
					>
						<div class="flex items-center justify-between gap-2">
							<div class="flex-1 min-w-0">
								<p class="text-[0.6rem] font-black uppercase tracking-widest opacity-80">
									Desafio de presença
								</p>
								<p class="text-sm font-bold leading-tight truncate">
									{ok ? '✅ Desafio concluído' : challengeAtual.instrucao}
								</p>
								{#if !ok && challengeProgresso}
									<p class="text-[0.65rem] opacity-90 mt-0.5">
										{challengeProgresso.mensagem}
									</p>
								{:else if !ok}
									<p class="text-[0.65rem] opacity-70 mt-0.5">{challengeAtual.hint}</p>
								{/if}
							</div>
							{#if !ok}
								<IconTooltip label="Trocar para outro desafio">
									<button
										type="button"
										onclick={trocarChallenge}
										class="text-[0.6rem] uppercase font-bold px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 transition-colors shrink-0"
									>
										Trocar
									</button>
								</IconTooltip>
							{/if}
						</div>
						{#if challengeProgresso && !ok}
							<!-- Barra de progresso -->
							<div class="mt-1.5 h-1 bg-white/15 rounded-full overflow-hidden">
								<div
									class="h-full bg-primary-300 transition-all duration-200"
									style="width: {challengeProgresso.progresso * 100}%"
								></div>
							</div>
						{/if}
					</div>
				{/if}

				<!-- Efeito de Flash -->
				{#if isFlashActive}
					<div
						class="absolute inset-0 bg-white z-50 animate-flash opacity-0 pointer-events-none"
					></div>
				{/if}

				<!-- Overlay de Contagem Regressiva -->
				{#if countdown > 0}
					<div
						class="absolute inset-0 flex items-center justify-center bg-black/30 z-40 backdrop-blur-[2px]"
					>
						<span
							class="text-8xl font-black text-white drop-shadow-[0_0_20px_rgba(0,0,0,0.5)] animate-ping-once"
						>
							{countdown}
						</span>
					</div>
				{/if}

				{#if lastErrorCode}
					<div
						class="absolute inset-x-4 top-2 bg-error-600/95 text-white backdrop-blur-md px-4 py-3 rounded-2xl text-center shadow-xl z-50 animate-bounce"
					>
						<p class="text-[0.65rem] font-black uppercase tracking-widest">
							{lastErrorCode}
						</p>
					</div>
				{/if}

				<!-- Indicador Liveness na Câmera -->
				<div
					class="absolute bottom-4 left-0 right-0 max-w-xs mx-auto px-4 z-20 pointer-events-none"
				>
					{#if faceLoadError}
						<div
							class="bg-error-500/90 text-white backdrop-blur-md px-4 py-2 rounded-xl text-center shadow-[0_0_15px_rgba(0,0,0,0.3)]"
						>
							<p class="text-[0.65rem] font-bold uppercase tracking-wide">
								{faceLoadError}
							</p>
						</div>
					{:else}
						<div
							class="{faceDetected
								? 'bg-success-600/90'
								: 'bg-surface-900/90'} text-white backdrop-blur-md px-4 py-2.5 rounded-2xl flex items-center justify-center gap-2 shadow-[0_4px_20px_rgba(0,0,0,0.5)] transition-all duration-300"
						>
							{#if faceDetected}
								<svg
									class="w-4 h-4 text-white"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="3"
										d="M5 13l4 4L19 7"
									/></svg
								>
							{:else}
								<Spinner size="xs" />
							{/if}
							<p
								class="text-[0.7rem] font-black uppercase tracking-widest {isMoving
									? 'text-warning-300'
									: 'text-white'}"
							>
								{faceStatusMessage}
							</p>
						</div>
					{/if}
				</div>
				{#if cameraError}
					<div
						class="absolute inset-0 bg-surface-900/80 flex items-center justify-center p-4 text-center z-10 backdrop-blur-sm"
					>
						<p class="text-sm font-bold text-error-400 uppercase">
							{cameraError}
						</p>
					</div>
				{/if}
			</div>
		{/if}

		{#if step === 'email_code'}
			<div
				class="flex flex-col items-center justify-center p-6 bg-surface-100/50 dark:bg-surface-800/40 rounded-2xl border-2 border-primary-500/20 text-center min-h-[300px]"
			>
				<div class="w-16 h-16 rounded-full bg-primary-500/10 flex items-center justify-center mb-4">
					<svg
						class="w-8 h-8 text-primary-500"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
						/>
					</svg>
				</div>
				<h3 class="h3 font-bold mb-2">Confirme sua Identidade</h3>

				<div class="w-full max-w-xs space-y-4">
					<input
						type="text"
						inputmode="numeric"
						maxlength="6"
						placeholder="000000"
						aria-label="Código de verificação de 6 dígitos enviado ao seu e-mail"
						autocomplete="one-time-code"
						bind:value={codigoInput}
						class="input text-center text-3xl tracking-[0.5em] font-mono h-16 rounded-2xl bg-white dark:bg-surface-900 border-2 {codigoError
							? 'border-error-500 uppercase'
							: 'border-surface-300 dark:border-surface-600 placeholder:opacity-50'}"
					/>

					{#if codigoError}
						<p class="text-xs font-bold text-error-500 uppercase tracking-wider">{codigoError}</p>
					{/if}

					<CodigoTimer
						{emailMascarado}
						onReenviar={async () => {
							await enviarOuReenviarCodigo();
						}}
					/>
				</div>
			</div>
		{/if}
	</div>

	{#if locationError && !coords && !capturingLocation}
		<p class="text-[0.6rem] font-bold text-error-500 text-center uppercase tracking-tight italic">
			{locationError}
		</p>
	{/if}

	<div class="p-3 bg-primary-500/5 border border-dashed border-primary-500/20 rounded-xl">
		<p class="text-[0.6rem] font-medium text-surface-500 leading-tight text-center">
			Ao assinar, declaro a veracidade destas informações e autorizo o registro de minha <strong
				>localização geográfica</strong
			>,
			<strong>fotografia (prova de vida)</strong>
			e <strong>metadados técnicos</strong> para fins de validade jurídica desta assinatura (Lei 14.063/20).
		</p>
	</div>

	<div class="flex flex-wrap justify-between items-center gap-2 mt-4">
		{#if step === 'signature'}
			<button
				type="button"
				class="btn preset-tonal-surface rounded-xl text-xs font-bold uppercase px-4 py-2 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
				onclick={clear}
			>
				Limpar
			</button>

			<div class="flex items-center gap-2 ml-auto">
				<button
					type="button"
					class="btn preset-outlined-surface-500 rounded-xl text-[0.65rem] sm:text-xs font-bold uppercase px-3 py-2 sm:px-4 sm:py-2 hover:bg-surface-50 dark:hover:bg-surface-900 transition-colors"
					onclick={onCancel}
				>
					Cancelar
				</button>
				<button
					type="button"
					class="btn preset-filled-primary-500 rounded-xl text-[0.65rem] sm:text-xs font-bold uppercase px-3 py-2 sm:px-4 sm:py-2 shadow-sm shadow-primary-500/20 active:scale-95 transition-all w-max"
					disabled={solicitandoCodigo}
					onclick={() => (exigirFoto ? (step = 'camera') : confirmarSemFoto())}
				>
					{#if solicitandoCodigo}
						Enviando...
					{:else}
						{exigirFoto ? 'Avançar 📸' : 'Confirmar ✔'}
					{/if}
				</button>
			</div>
		{:else if step === 'camera'}
			<button
				type="button"
				class="btn preset-outlined-surface-500 rounded-xl text-xs font-bold uppercase px-4 py-2 hover:bg-surface-50 dark:hover:bg-surface-900 transition-colors"
				onclick={() => (step = 'signature')}
			>
				Voltar
			</button>

			{@const challengeOk = !challengeAtual || challengeProgresso?.concluido}
			<button
				type="button"
				class="btn {faceDetected && !isMoving && challengeOk
					? 'preset-filled-primary-500'
					: 'bg-surface-300 dark:bg-surface-700 text-surface-500 opacity-60'} rounded-2xl text-sm font-bold uppercase px-6 py-3 shadow-lg shadow-primary-500/20 active:scale-95 transition-all ml-auto"
				onclick={startCaptureSequence}
				disabled={capturingLocation ||
					capturingImage ||
					!!cameraError ||
					!stream ||
					!faceDetected ||
					!challengeOk}
			>
				{#if !faceDetected}
					Aguardando Rosto...
				{:else if !challengeOk}
					Cumpra o desafio…
				{:else if countdown > 0}
					Prepare-se ({countdown})
				{:else if capturingImage}
					Fotografando...
				{:else}
					Tirar Foto e Assinar
				{/if}
			</button>
		{:else if step === 'email_code'}
			<button
				type="button"
				class="btn preset-outlined-surface-500 rounded-xl text-xs font-bold uppercase px-4 py-2 hover:bg-surface-50 dark:hover:bg-surface-900 transition-colors"
				onclick={onCancel}
				disabled={solicitandoCodigo}
			>
				Cancelar
			</button>

			<button
				type="button"
				class="btn preset-filled-primary-500 rounded-xl text-sm font-bold uppercase px-6 py-3 shadow-lg shadow-primary-500/20 active:scale-95 transition-all ml-auto"
				onclick={confirmarCodigo}
				disabled={solicitandoCodigo || codigoInput.length !== 6}
			>
				Assinar
			</button>
		{/if}
	</div>
</div>

<style>
	@keyframes flash {
		0% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}
	.animate-flash {
		animation: flash 0.3s ease-out forwards;
	}

	@keyframes ping-once {
		0% {
			transform: scale(0.5);
			opacity: 0;
		}
		50% {
			transform: scale(1.1);
			opacity: 1;
		}
		100% {
			transform: scale(1);
			opacity: 0.8;
		}
	}
	.animate-ping-once {
		animation: ping-once 0.5s ease-out forwards;
	}
</style>
