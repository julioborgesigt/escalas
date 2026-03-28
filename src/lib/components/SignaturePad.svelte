<script lang="ts">
	let { onConfirm, onCancel } = $props();

	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D;
	let drawing = false;

	$effect(() => {
		if (canvas) {
			ctx = canvas.getContext('2d')!;
			ctx.strokeStyle = '#000';
			ctx.lineWidth = 2.5;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
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
		// Check if canvas is empty (optional but good)
		const dataUrl = canvas.toDataURL('image/png');
		onConfirm(dataUrl);
	}
</script>

<div class="space-y-4">
	<div class="bg-white border-2 border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden touch-none">
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
	</div>

	<div class="flex flex-wrap justify-between items-center gap-4 mt-4">
		<button class="btn preset-tonal-surface rounded-xl text-xs font-bold uppercase px-4 py-2 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors" onclick={clear}>
			Limpar
		</button>
		
		<div class="flex items-center gap-3">
			<button class="btn preset-outlined-surface-500 rounded-xl text-xs font-bold uppercase px-4 py-2 hover:bg-surface-50 dark:hover:bg-surface-900 transition-colors" onclick={onCancel}>
				Cancelar
			</button>
			<button class="btn preset-filled-primary-500 rounded-2xl text-sm font-bold uppercase px-6 py-3 shadow-lg shadow-primary-500/20 active:scale-95 transition-all" onclick={confirm}>
				Confirmar Rubrica
			</button>
		</div>
	</div>
</div>
