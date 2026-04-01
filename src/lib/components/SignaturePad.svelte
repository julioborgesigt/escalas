<script lang="ts">
	let faceapi: any = $state(null);


	let { onConfirm, onCancel, message = "" } = $props();

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
	
	let step = $state<'signature' | 'camera'>('signature');

	// Face Liveness states
	let faceDetected = $state(false);
	let isFaceModelLoaded = $state(false);
	let faceDetectionInterval: any = null;
	let faceStatusMessage = $state('Inicializando IA...');
	let faceLoadError = $state<string | null>(null);

	$effect(() => {
		if (step === 'camera') {
			if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
				navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } })
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
						console.warn("Camera error:", err);
						cameraError = "Por favor, autorize a câmera. A Prova de Vida é obrigatória.";
					});
			} else {
				cameraError = "Navegador não suporta acesso à câmera.";
			}
		} else {
			// se voltar para a tela de assinatura
			if (faceDetectionInterval) clearInterval(faceDetectionInterval);
		}
		
		return () => {
			if (stream) {
				stream.getTracks().forEach(track => track.stop());
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
				await faceapi.nets.tinyFaceDetector.loadFromUri('https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/');
				isFaceModelLoaded = true;
			}
			startDetectionLoop();
		} catch (e: any) {
			console.error("Erro ao carregar face-api:", e);
			faceLoadError = "Falha ao baixar modelo facial. Verifique internet.";
		}
	}

	function startDetectionLoop() {
		if (faceDetectionInterval) clearInterval(faceDetectionInterval);
		faceDetectionInterval = setInterval(async () => {
			if (videoElement && !videoElement.paused && isFaceModelLoaded) {
				try {
					const detections = await faceapi.detectAllFaces(
						videoElement,
						new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 })
					);
					if (detections.length === 1) {
						faceDetected = true;
						faceStatusMessage = "Rosto Detectado ✅";
					} else if (detections.length === 0) {
						faceDetected = false;
						faceStatusMessage = "Posicione seu rosto na frente da câmera.";
					} else {
						faceDetected = false;
						faceStatusMessage = "Apenas 1 rosto é permitido!";
					}
				} catch (e) {
					// Ignora erros ocasionais de cross-origin taint / canvas context
				}
			}
		}, 800);
	}

	$effect(() => {
		if (canvas) {
			ctx = canvas.getContext('2d')!;
			ctx.strokeStyle = '#000';
			ctx.lineWidth = 2.5;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
		}
		
		// Iniciar captura de localização ao abrir
		if ("geolocation" in navigator) {
			capturingLocation = true;
			navigator.geolocation.getCurrentPosition(
				(pos) => {
					coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
					capturingLocation = false;
				},
				(err) => {
					console.warn("Erro ao capturar localização:", err);
					locationError = "Não foi possível capturar sua localização. Por favor, permita o acesso ao GPS.";
					capturingLocation = false;
				},
				{ enableHighAccuracy: true, timeout: 10000 }
			);
		} else {
			locationError = "GPS não disponível neste dispositivo.";
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

	async function confirm() {
		capturingImage = true;
		
		let selfieBase64 = null;
		if (videoElement && stream) {
			const sc = document.createElement("canvas");
			// Usa a proporção exata que o usuário está enxergando no preview
			const uiRatio = videoElement.clientWidth / videoElement.clientHeight;
			
			// Aumentado a resolução máxima de 320 para 480
			const MAX_DIM = 480; 
			let cw, ch;
			if (uiRatio > 1) {
				cw = MAX_DIM;
				ch = MAX_DIM / uiRatio;
			} else {
				ch = MAX_DIM;
				cw = MAX_DIM * uiRatio;
			}
			sc.width = cw;
			sc.height = ch;

			const sctx = sc.getContext("2d");
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
				// Aumentado qualidade do JPEG de 0.6 para 0.82 para melhor qualidade sem inchar muito
				selfieBase64 = sc.toDataURL("image/jpeg", 0.82);
			}
		}

		const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
		onConfirm(dataUrl, coords?.lat, coords?.lng, selfieBase64);
	}
</script>

<div class="space-y-4">
	{#if message}
		<p class="text-[0.65rem] font-bold text-surface-500 uppercase text-center mb-1">{message}</p>
	{/if}

	<div class="flex flex-col gap-4">
		<div class="space-y-2 {step !== 'signature' ? 'hidden' : ''}">
				<div class="flex justify-between items-end">
					<span class="text-[0.6rem] font-bold text-surface-500 uppercase tracking-wider">Sua Rubrica</span>
				</div>
				<div class="bg-white border-2 border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden touch-none relative min-h-[320px]">
					<canvas
					bind:this={canvas}
					width="400"
					height="320"
					class="w-full h-[320px] cursor-crosshair touch-none"
					onmousedown={startDrawing}
					onmousemove={draw}
					onmouseup={stopDrawing}
					onmouseleave={stopDrawing}
					ontouchstart={startDrawing}
					ontouchmove={draw}
					ontouchend={stopDrawing}
				></canvas>

				<!-- Indicador de GPS -->
				<div class="absolute bottom-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-white/80 dark:bg-surface-900/80 backdrop-blur-sm border border-surface-200 dark:border-surface-700">
					{#if capturingLocation}
						<span class="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
						<span class="text-[0.55rem] font-black uppercase text-amber-600">Capturando GPS...</span>
					{:else if coords}
						<span class="w-2 h-2 rounded-full bg-success-500"></span>
						<span class="text-[0.55rem] font-black uppercase text-success-600">GPS Localizado</span>
					{:else}
						<span class="w-2 h-2 rounded-full bg-error-500"></span>
						<span class="text-[0.55rem] font-black uppercase text-error-600">GPS Falhou</span>
					{/if}
				</div>
				</div>
			</div>
		
		{#if step === 'camera'}
			<!-- Camera Preview -->
			<div class="w-full bg-surface-100 dark:bg-surface-800 border-2 border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden flex flex-col pt-3 items-center relative aspect-[3/4] md:aspect-[4/5] min-h-[350px] object-cover">
				<span class="text-[0.65rem] font-bold text-surface-500 uppercase tracking-wider items-center mb-3 px-2 flex gap-1.5">
					<span class="w-2.5 h-2.5 rounded-full {stream ? 'bg-error-500 animate-pulse' : 'bg-surface-300'}"></span>
					Prova de Vida
				</span>
				<video 
					bind:this={videoElement} 
					autoplay 
					playsinline 
					muted 
					class="w-full h-[90%] object-cover bg-surface-200 dark:bg-surface-900 {faceDetected ? 'ring-4 ring-success-500/50' : 'ring-2 ring-warning-500/30'}"
				></video>

				<!-- Indicador Liveness na Câmera -->
				<div class="absolute bottom-4 left-0 right-0 max-w-xs mx-auto px-4 z-20 pointer-events-none">
					{#if faceLoadError}
						<div class="bg-error-500/90 text-white backdrop-blur-md px-4 py-2 rounded-xl text-center shadow-[0_0_15px_rgba(0,0,0,0.3)]">
							<p class="text-[0.65rem] font-bold uppercase tracking-wide">{faceLoadError}</p>
						</div>
					{:else}
						<div class="{faceDetected ? 'bg-success-600/90' : 'bg-surface-900/90'} text-white backdrop-blur-md px-4 py-2.5 rounded-2xl flex items-center justify-center gap-2 shadow-[0_4px_20px_rgba(0,0,0,0.5)] transition-all duration-300">
							{#if faceDetected}
								<svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" /></svg>
							{:else}
								<span class="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
							{/if}
							<p class="text-[0.7rem] font-black uppercase tracking-widest">{faceStatusMessage}</p>
						</div>
					{/if}
				</div>
				{#if cameraError}
					<div class="absolute inset-0 bg-surface-900/80 flex items-center justify-center p-4 text-center z-10 backdrop-blur-sm">
						<p class="text-sm font-bold text-error-400 uppercase">{cameraError}</p>
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
			Ao assinar, declaro a veracidade destas informações e autorizo o registro de minha <strong>localização geográfica</strong>, <strong>fotografia (prova de vida)</strong> e <strong>metadados técnicos</strong> para fins de validade jurídica desta assinatura (Lei 14.063/20).
		</p>
	</div>

	<div class="flex flex-wrap justify-between items-center gap-4 mt-4">
		{#if step === 'signature'}
			<button class="btn preset-tonal-surface rounded-xl text-xs font-bold uppercase px-4 py-2 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors" onclick={clear}>
				Limpar
			</button>
			
			<div class="flex items-center gap-2 ml-auto">
				<button class="btn preset-outlined-surface-500 rounded-xl text-[0.65rem] sm:text-xs font-bold uppercase px-3 py-2 sm:px-4 sm:py-2 hover:bg-surface-50 dark:hover:bg-surface-900 transition-colors" onclick={onCancel}>
					Cancelar
				</button>
				<button 
					class="btn preset-filled-primary-500 rounded-xl text-[0.65rem] sm:text-xs font-bold uppercase px-3 py-2 sm:px-4 sm:py-2 shadow-sm shadow-primary-500/20 active:scale-95 transition-all w-max" 
					onclick={() => step = 'camera'}
				>
					Avançar 📸
				</button>
			</div>
		{:else}
			<button class="btn preset-outlined-surface-500 rounded-xl text-xs font-bold uppercase px-4 py-2 hover:bg-surface-50 dark:hover:bg-surface-900 transition-colors" onclick={() => step = 'signature'}>
				Voltar
			</button>
			
			<button 
				class="btn {faceDetected ? 'preset-filled-primary-500' : 'bg-surface-300 dark:bg-surface-700 text-surface-500 opacity-60'} rounded-2xl text-sm font-bold uppercase px-6 py-3 shadow-lg shadow-primary-500/20 active:scale-95 transition-all ml-auto" 
				onclick={confirm}
				disabled={capturingLocation || capturingImage || !!cameraError || !stream || !faceDetected}
			>
				{#if !faceDetected}
					Aguardando Rosto...
				{:else if capturingImage}
					Fotografando...
				{:else}
					Tirar Foto e Assinar
				{/if}
			</button>
		{/if}
	</div>
</div>
