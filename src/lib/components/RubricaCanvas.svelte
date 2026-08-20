<script lang="ts" module>
	/**
	 * Controle exposto pelo componente para o pai (via `bind:control`).
	 * Mantido como objeto (em vez de eventos) para o pai poder consultar/comandar
	 * o canvas imperativamente no momento de confirmar.
	 */
	export type RubricaCanvasControl = {
		/** Limpa o traçado. */
		clear: () => void;
		/** `true` se nada foi desenhado ainda. */
		isEmpty: () => boolean;
		/**
		 * Exporta a rubrica como PNG **transparente** (dataURL), recortada à
		 * caixa do traçado e re-escalada para a proporção alvo do campo do PDF.
		 * Retorna `null` se o canvas estiver vazio.
		 */
		toPNG: () => string | null;
	};
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { recortarCentralizarTraco } from '$lib/utils/rubrica-imagem';
	/**
	 * Primitivo de desenho de rubrica — partilhado entre o cadastro no desktop
	 * (`ModalCadastrarRubrica`) e, futuramente, o fluxo em tela. Diferente do
	 * `SignaturePad` (que achata fundo branco e embute câmera/GPS/liveness), aqui
	 * o objetivo é só produzir um PNG **transparente** com o traçado, pronto para
	 * ser carimbado sobre o PDF.
	 *
	 * A proporção alvo (2.0:1, era 2.5:1) acompanha o campo de rubrica dos
	 * documentos/relatórios da GISE (largura ~130pt do `preparar-assinatura`),
	 * com folga: os dois estilos de carimbo (`'rubrica'` e `'selo-icp'`, em
	 * `pdf-signing-prepare.ts`) ajustam a rubrica ao campo por CONTAIN — nunca
	 * distorcem, só usam menos altura do campo se a proporção não bater exato.
	 * 2.0 dá mais espaço vertical para o traço sem arriscar estourar a caixa.
	 */
	let {
		// eslint-disable-next-line no-useless-assignment
		control = $bindable<RubricaCanvasControl | null>(null),
		/** Proporção alvo largura/altura do PNG exportado (campo do PDF). */
		aspecto = 2.0,
		/** Cor do traçado. */
		cor = '#0f172a'
	}: {
		control?: RubricaCanvasControl | null;
		aspecto?: number;
		cor?: string;
	} = $props();

	// Resolução interna do canvas (alta p/ nitidez); proporção = `aspecto`.
	// `aspecto` é configuração fixa por montagem — lido uma vez (untrack).
	const CW = 1000;
	const CH = Math.round(CW / untrack(() => aspecto));

	let canvas = $state<HTMLCanvasElement | null>(null);
	let ctx: CanvasRenderingContext2D | null = null;
	let drawing = false;
	let vazio = $state(true);

	$effect(() => {
		if (!canvas) return;
		const c = canvas.getContext('2d');
		if (!c) return;
		ctx = c;
		ctx.lineWidth = 4;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.strokeStyle = cor;
	});

	function pos(e: MouseEvent | TouchEvent) {
		const rect = canvas!.getBoundingClientRect();
		const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
		const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
		// Mapeia coordenadas da tela para a resolução interna do canvas.
		return {
			x: ((clientX - rect.left) / rect.width) * CW,
			y: ((clientY - rect.top) / rect.height) * CH
		};
	}

	function start(e: MouseEvent | TouchEvent) {
		if (!ctx) return;
		drawing = true;
		const { x, y } = pos(e);
		ctx.beginPath();
		ctx.moveTo(x, y);
	}

	function move(e: MouseEvent | TouchEvent) {
		if (!drawing || !ctx) return;
		e.preventDefault();
		const { x, y } = pos(e);
		ctx.lineTo(x, y);
		ctx.stroke();
		vazio = false;
	}

	function end() {
		drawing = false;
	}

	function limpar() {
		if (!ctx) return;
		ctx.clearRect(0, 0, CW, CH);
		vazio = true;
	}

	/**
	 * Recorta o canvas à caixa que contém pixels com alpha > 0 e re-escala o
	 * conteúdo para um PNG na proporção `aspecto`, com uma pequena margem.
	 */
	function exportarPNG(): string | null {
		if (!canvas || !ctx || vazio) return null;
		const img = ctx.getImageData(0, 0, CW, CH);
		let minX = CW;
		let minY = CH;
		let maxX = 0;
		let maxY = 0;
		const d = img.data;
		for (let y = 0; y < CH; y++) {
			for (let x = 0; x < CW; x++) {
				if (d[(y * CW + x) * 4 + 3] > 10) {
					if (x < minX) minX = x;
					if (x > maxX) maxX = x;
					if (y < minY) minY = y;
					if (y > maxY) maxY = y;
				}
			}
		}
		if (maxX < minX || maxY < minY) return null; // nada desenhado

		return recortarCentralizarTraco(canvas, { minX, minY, maxX, maxY }, aspecto);
	}

	$effect(() => {
		control = {
			clear: limpar,
			isEmpty: () => vazio,
			toPNG: exportarPNG
		};
	});
</script>

<div class="space-y-2">
	<div
		class="relative bg-white rounded-xl border-2 border-dashed border-surface-300 dark:border-surface-600 overflow-hidden"
		style="aspect-ratio: {aspecto};"
	>
		<canvas
			bind:this={canvas}
			width={CW}
			height={CH}
			aria-label="Quadro para desenhar a rubrica com o mouse ou o dedo"
			class="w-full h-full cursor-crosshair touch-none block"
			onmousedown={start}
			onmousemove={move}
			onmouseup={end}
			onmouseleave={end}
			ontouchstart={start}
			ontouchmove={move}
			ontouchend={end}
		></canvas>
		{#if vazio}
			<div
				class="absolute inset-0 flex items-center justify-center pointer-events-none text-surface-300 dark:text-surface-600 text-sm font-medium uppercase tracking-wider"
			>
				Assine aqui
			</div>
		{/if}
	</div>
	<div class="flex justify-end">
		<button
			type="button"
			class="btn btn-sm preset-tonal-surface rounded-lg text-xs font-bold uppercase"
			onclick={limpar}
			disabled={vazio}
		>
			Limpar
		</button>
	</div>
</div>
