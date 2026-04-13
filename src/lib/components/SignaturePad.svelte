<script lang="ts">
	import { csrfHeaders } from '$lib/csrf';
	let faceapi: any = $state(null);

	let {
		onConfirm,
		onCancel,
		message = '',
		exigirFoto = true,
		exigirGps = true,
		exigirCodigoEmail = false
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

	let step = $state<'signature' | 'camera' | 'email_code'>('signature');

	// Face Liveness states
	let faceDetected = $state(false);
	let isFaceModelLoaded = $state(false);
	let faceDetectionInterval: any = null;
	let faceStatusMessage = $state('Inicializando IA...');
	let faceLoadError = $state<string | null>(null);

	// Novos estados para estabilidade e contagem
	let countdown = $state(0);
	let isMoving = $state(false);
	let lastBox = $state<any>(null);
	let isFlashActive = $state(false);
	let stableFrames = $state(0); // Contador para evitar flickering
	let lastErrorCode = $state<string | null>(null); // Erros de captura final

	// Estados do Email Code
	let solicitandoCodigo = $state(false);
	let codigoInput = $state('');
	let codigoError = $state<string | null>(null);
	let emailMascarado = $state('');
	let desafioId = $state<string | null>(null);
	let pendingSignature = $state<{
		dataUrl: string;
		lat: number | undefined;
		lng: number | undefined;
		selfieBase64: string | null;
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
		}

		return () => {
			if (stream) {
				stream.getTracks().forEach((track) => track.stop());
			}
			if (faceDetectionInterval) clearInterval(faceDetectionInterval);
		};
	});

	async function initFaceDetection() {
		try {
			if (!faceapi && typeof window !== 'undefined') {
				faceapi = await import('@vladmandic/face-api');
			}
			if (faceapi && !isFaceModelLoaded) {
				await faceapi.nets.tinyFaceDetector.loadFromUri(
					'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/'
				);
				isFaceModelLoaded = true;
			}
			startDetectionLoop();
		} catch (e: any) {
			console.error('Erro ao carregar face-api:', e);
			faceLoadError = 'Falha ao baixar modelo facial. Verifique internet.';
		}
	}

	function startDetectionLoop() {
		if (faceDetectionInterval) clearInterval(faceDetectionInterval);
		faceDetectionInterval = setInterval(async () => {
			if (videoElement && !videoElement.paused && isFaceModelLoaded) {
				try {
					const detections = await faceapi.detectAllFaces(
						videoElement,
						new faceapi.TinyFaceDetectorOptions({
							inputSize: 224,
							scoreThreshold: 0.5
						})
					);
					if (detections.length === 1) {
						faceDetected = true;
						const box = detections[0].box;

						if (lastBox) {
							const dx = box.x - lastBox.x;
							const dy = box.y - lastBox.y;
							const dist = Math.sqrt(dx * dx + dy * dy);
							const movedValue = dist > 12;

							if (movedValue) {
								isMoving = true;
								stableFrames = 0;
								faceStatusMessage = 'Mantenha o celular firme! ✋';
							} else {
								stableFrames++;
								if (stableFrames >= 3) {
									isMoving = false;
									faceStatusMessage = 'Rosto Detectado ✅';
								}
							}
						} else {
							faceStatusMessage = 'Rosto Detectado ✅';
						}
						lastBox = box;
					} else if (detections.length === 0) {
						faceDetected = false;
						stableFrames = 0;
						faceStatusMessage = 'Posicione seu rosto na frente da câmera.';
						isMoving = false;
					} else {
						faceDetected = false;
						stableFrames = 0;
						faceStatusMessage = 'Apenas 1 rosto é permitido!';
						isMoving = false;
					}
				} catch (e) {
					// Ignora erros ocasionais
				}
			}
		}, 400); // Intervalo reduzido para 400ms para melhor detecção de movimento
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

		if (videoElement && stream) {
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

	async function processarAssinatura(
		dataUrl: string,
		lat: number | undefined,
		lng: number | undefined,
		selfieBase64: string | null
	) {
		if (exigirCodigoEmail) {
			pendingSignature = { dataUrl, lat, lng, selfieBase64 };
			const ok = await enviarOuReenviarCodigo();
			if (ok) step = 'email_code';
		} else {
			onConfirm(dataUrl, lat, lng, selfieBase64);
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
		} catch (e: any) {
			codigoError = e.message;
			// Se o erro for de login/sessão, podemos alertar de forma mais incisiva
			if (e.message.includes('Sessão inválida')) {
				alert(e.message);
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
			onConfirm(
				pendingSignature.dataUrl,
				pendingSignature.lat,
				pendingSignature.lng,
				pendingSignature.selfieBase64,
				codigoInput,
				desafioId
			);
		}
	}

	function startCaptureSequence() {
		if (countdown > 0) return;

		// Inicia contagem de 3 segundos para dar tempo ao usuário de estabilizar o celular
		countdown = 3;
		const timer = setInterval(() => {
			countdown--;
			if (countdown === 0) {
				clearInterval(timer);
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
							<span class="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
							<span class="text-[0.55rem] font-black uppercase text-amber-600"
								>Capturando GPS...</span
							>
						{:else if coords}
							<span class="w-2 h-2 rounded-full bg-success-500"></span>
							<span class="text-[0.55rem] font-black uppercase text-success-600"
								>GPS Localizado</span
							>
						{:else}
							<span class="w-2 h-2 rounded-full bg-error-500"></span>
							<span class="text-[0.55rem] font-black uppercase text-error-600">GPS Falhou</span>
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
						class="absolute inset-x-4 top-12 bg-error-600/90 text-white backdrop-blur-md px-4 py-3 rounded-2xl text-center shadow-xl z-50 animate-bounce"
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
								<span
									class="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"
								></span>
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

				{#if solicitandoCodigo}
					<p class="text-sm font-medium text-surface-500">Enviando código de verificação...</p>
					<div class="mt-6">
						<span
							class="inline-block w-8 h-8 border-4 border-primary-500/30 border-t-primary-500 rounded-full animate-spin"
						></span>
					</div>
				{:else}
					<p class="text-sm text-surface-600 dark:text-surface-400 mb-6 max-w-sm">
						Enviamos um código de 6 dígitos para o seu e-mail cadastrado <strong
							>({emailMascarado || '...'})</strong
						>. Digite-o abaixo para concluir a assinatura.
					</p>

					<div class="w-full max-w-xs space-y-4">
						<input
							type="text"
							inputmode="numeric"
							maxlength="6"
							placeholder="000000"
							bind:value={codigoInput}
							class="input text-center text-3xl tracking-[0.5em] font-mono h-16 rounded-2xl bg-white dark:bg-surface-900 border-2 {codigoError
								? 'border-error-500 uppercase'
								: 'border-surface-300 dark:border-surface-600 placeholder:opacity-50'}"
						/>

						{#if codigoError}
							<p class="text-xs font-bold text-error-500 uppercase tracking-wider">{codigoError}</p>
						{/if}

						<button
							type="button"
							class="text-xs font-semibold text-primary-600 dark:text-primary-400 underline decoration-primary-500/30 hover:decoration-primary-500 transition-all"
							onclick={enviarOuReenviarCodigo}
						>
							Não recebeu? Reenviar código
						</button>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	{#if locationError && !coords && !capturingLocation}
		<p class="text-[0.6rem] font-bold text-error-500 text-center uppercase tracking-tight italic">
			{locationError}
		</p>
	{/if}

	<div class="p-3 bg-primary-500/5 border border-dashed border-primary-500/20 rounded-xl">
		<p class="text-[0.55rem] font-medium text-surface-500 leading-tight text-center">
			Ao assinar, declaro a veracidade destas informações e autorizo o registro de minha <strong
				>localização geográfica</strong
			>,
			<strong>fotografia (prova de vida)</strong>
			e <strong>metadados técnicos</strong> para fins de validade jurídica desta assinatura (Lei 14.063/20).
		</p>
	</div>

	<div class="flex flex-wrap justify-between items-center gap-2 mt-4">
		{#if step === 'signature'}
			<button type="button"
				class="btn preset-tonal-surface rounded-xl text-xs font-bold uppercase px-4 py-2 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
				onclick={clear}
			>
				Limpar
			</button>

			<div class="flex items-center gap-2 ml-auto">
				<button type="button"
					class="btn preset-outlined-surface-500 rounded-xl text-[0.65rem] sm:text-xs font-bold uppercase px-3 py-2 sm:px-4 sm:py-2 hover:bg-surface-50 dark:hover:bg-surface-900 transition-colors"
					onclick={onCancel}
				>
					Cancelar
				</button>
				<button type="button"
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
			<button type="button"
				class="btn preset-outlined-surface-500 rounded-xl text-xs font-bold uppercase px-4 py-2 hover:bg-surface-50 dark:hover:bg-surface-900 transition-colors"
				onclick={() => (step = 'signature')}
			>
				Voltar
			</button>

			<button type="button"
				class="btn {faceDetected && !isMoving
					? 'preset-filled-primary-500'
					: 'bg-surface-300 dark:bg-surface-700 text-surface-500 opacity-60'} rounded-2xl text-sm font-bold uppercase px-6 py-3 shadow-lg shadow-primary-500/20 active:scale-95 transition-all ml-auto"
				onclick={startCaptureSequence}
				disabled={capturingLocation || capturingImage || !!cameraError || !stream || !faceDetected}
			>
				{#if !faceDetected}
					Aguardando Rosto...
				{:else if countdown > 0}
					Prepare-se ({countdown})
				{:else if capturingImage}
					Fotografando...
				{:else}
					Tirar Foto e Assinar
				{/if}
			</button>
		{:else if step === 'email_code'}
			<button type="button"
				class="btn preset-outlined-surface-500 rounded-xl text-xs font-bold uppercase px-4 py-2 hover:bg-surface-50 dark:hover:bg-surface-900 transition-colors"
				onclick={onCancel}
				disabled={solicitandoCodigo}
			>
				Cancelar
			</button>

			<button type="button"
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
