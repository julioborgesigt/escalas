/**
 * Máquina de captura da rubrica manuscrita (canvas + mouse/touch),
 * extraída de SignaturePad.svelte.
 *
 * O componente faz `bind:this={rubrica.canvas}` e liga os handlers de
 * desenho; `exportar()` devolve o dataURL comprimido (JPEG sobre fundo
 * branco, ≤ maxKb) pronto para o payload de assinatura.
 */
export function useRubricaCanvas() {
	let canvas = $state<HTMLCanvasElement | null>(null);
	let ctx: CanvasRenderingContext2D | null = null;
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

	function getCoord(e: MouseEvent | TouchEvent) {
		const rect = canvas!.getBoundingClientRect();
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

	function startDrawing(e: MouseEvent | TouchEvent) {
		if (!ctx) return;
		drawing = true;
		const { x, y } = getCoord(e);
		ctx.beginPath();
		ctx.moveTo(x, y);
	}

	function draw(e: MouseEvent | TouchEvent) {
		if (!drawing || !ctx) return;
		e.preventDefault();
		const { x, y } = getCoord(e);
		ctx.lineTo(x, y);
		ctx.stroke();
	}

	function stopDrawing() {
		drawing = false;
	}

	function clear() {
		if (!ctx || !canvas) return;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
	}

	/**
	 * Comprime a rubrica para JPEG ≤ maxKb: achata sobre fundo branco (JPEG
	 * não tem alfa) e desce a qualidade em degraus; se ainda passar do teto,
	 * reduz a escala em 15% e repete.
	 */
	function exportar(maxKb = 100): string {
		const src = canvas!;
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

	return {
		get canvas() {
			return canvas;
		},
		set canvas(v: HTMLCanvasElement | null) {
			canvas = v;
		},
		startDrawing,
		draw,
		stopDrawing,
		clear,
		exportar
	};
}
