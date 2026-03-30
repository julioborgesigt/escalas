<script lang="ts">
	let { onConfirm, onCancel, message = "" } = $props();

	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D;
	let drawing = false;
	let capturingLocation = $state(false);
	let coords = $state<{ lat: number; lng: number } | null>(null);
	let locationError = $state<string | null>(null);

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

	function confirm() {
		const dataUrl = canvas.toDataURL('image/png');
		onConfirm(dataUrl, coords?.lat, coords?.lng);
	}
</script>

<div class="space-y-4">
	{#if message}
		<p class="text-[0.65rem] font-bold text-surface-500 uppercase text-center mb-1">{message}</p>
	{/if}

	<div class="bg-white border-2 border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden touch-none relative">
		<canvas
			bind:this={canvas}
			width="400"
			height="200"
			class="w-full h-[200px] cursor-crosshair"
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

	{#if locationError && !coords && !capturingLocation}
		<p class="text-[0.6rem] font-bold text-error-500 text-center uppercase tracking-tight italic">
			{locationError}
		</p>
	{/if}

	<div class="p-3 bg-primary-500/5 border border-dashed border-primary-500/20 rounded-xl">
		<p class="text-[0.55rem] font-medium text-surface-500 leading-tight text-center">
			Ao assinar, declaro a veracidade destas informações e autorizo o registro de minha <strong>localização geográfica</strong> e <strong>metadados técnicos</strong> para fins de validade jurídica desta assinatura (Lei 14.063/20).
		</p>
	</div>

	<div class="flex flex-wrap justify-between items-center gap-4 mt-4">
		<button class="btn preset-tonal-surface rounded-xl text-xs font-bold uppercase px-4 py-2 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors" onclick={clear}>
			Limpar
		</button>
		
		<div class="flex items-center gap-3">
			<button class="btn preset-outlined-surface-500 rounded-xl text-xs font-bold uppercase px-4 py-2 hover:bg-surface-50 dark:hover:bg-surface-900 transition-colors" onclick={onCancel}>
				Cancelar
			</button>
			<button 
				class="btn preset-filled-primary-500 rounded-2xl text-sm font-bold uppercase px-6 py-3 shadow-lg shadow-primary-500/20 active:scale-95 transition-all disabled:opacity-50" 
				onclick={confirm}
				disabled={capturingLocation}
			>
				Confirmar Rubrica
			</button>
		</div>
	</div>
</div>
