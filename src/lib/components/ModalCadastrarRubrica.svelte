<script lang="ts">
	/**
	 * Modal de CADASTRO de rubrica reutilizável (perfil do policial), para
	 * assinatura por Token A3 no computador. Duas formas, à la Adobe Acrobat:
	 *  - Desenhar com o mouse no quadro (proporção do campo do PDF);
	 *  - Enviar uma FOTO da assinatura feita em papel, com recorte e remoção de
	 *    fundo client-side.
	 *
	 * LGPD: todo o processamento da imagem (re-render p/ remover EXIF, recorte,
	 * remoção de fundo) ocorre NO NAVEGADOR — só o PNG transparente final, já
	 * minimizado, é enviado ao servidor. Um aceite explícito de consentimento é
	 * exigido antes de salvar (nova finalidade, Art. 8º).
	 */
	import { PenLine, Image as ImageIcon } from 'lucide-svelte';
	import { Dialog, Tabs } from '@skeletonlabs/skeleton-svelte';
	import { apiFetch } from '$lib/api-fetch';
	import { toaster } from '$lib/toast';
	import RubricaCanvas, { type RubricaCanvasControl } from './RubricaCanvas.svelte';

	let {
		open = $bindable(false),
		rubricaAtual = null,
		onSaved,
		aspecto = 2.5
	}: {
		open?: boolean;
		/** dataURL da rubrica já cadastrada (para mostrar/permitir trocar). */
		rubricaAtual?: string | null;
		onSaved?: (novaRubrica: string | null) => void;
		aspecto?: number;
	} = $props();

	let aba = $state<'desenhar' | 'imagem'>('desenhar');
	let consentimento = $state(false);
	let salvando = $state(false);

	// --- Aba desenhar ---
	let canvasControl = $state<RubricaCanvasControl | null>(null);

	// --- Aba imagem ---
	let srcDataUrl = $state<string | null>(null); // imagem já re-renderizada (sem EXIF)
	let srcW = 0;
	let srcH = 0;
	let limiarFundo = $state(170); // 0–255; pixels mais claros que isto viram transparentes
	let previewUrl = $state<string | null>(null);
	let containerEl = $state<HTMLDivElement | null>(null);

	// Caixa de recorte em frações (0–1) da imagem — resolução-independente.
	let cropX = $state(0.08);
	let cropY = $state(0.08);
	let cropW = $state(0.84);
	let cropH = $state(0.84);

	const MAX_DIM = 1600; // limita a maior dimensão da imagem processada

	$effect(() => {
		if (open) {
			// Reset ao abrir.
			aba = 'desenhar';
			consentimento = false;
			srcDataUrl = null;
			previewUrl = null;
			limiarFundo = 170;
			cropX = 0.08;
			cropY = 0.08;
			cropW = 0.84;
			cropH = 0.84;
		}
	});

	async function aoEscolherArquivo(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		if (!file.type.startsWith('image/')) {
			toaster.error({ title: 'Selecione um arquivo de imagem (JPG/PNG).' });
			return;
		}
		if (file.size > 10 * 1024 * 1024) {
			toaster.error({ title: 'Imagem muito grande (máx. 10 MB).' });
			return;
		}
		const bitmapUrl = URL.createObjectURL(file);
		try {
			const img = new Image();
			img.src = bitmapUrl;
			await img.decode();
			// Re-render num canvas → descarta EXIF (inclui GPS) e normaliza o formato.
			let w = img.naturalWidth;
			let h = img.naturalHeight;
			if (Math.max(w, h) > MAX_DIM) {
				const r = MAX_DIM / Math.max(w, h);
				w = Math.round(w * r);
				h = Math.round(h * r);
			}
			const c = document.createElement('canvas');
			c.width = w;
			c.height = h;
			const cx = c.getContext('2d')!;
			cx.drawImage(img, 0, 0, w, h);
			srcW = w;
			srcH = h;
			srcDataUrl = c.toDataURL('image/png');
			cropX = 0.08;
			cropY = 0.08;
			cropW = 0.84;
			cropH = 0.84;
			gerarPreview();
		} catch {
			toaster.error({ title: 'Não foi possível ler a imagem.' });
		} finally {
			URL.revokeObjectURL(bitmapUrl);
		}
	}

	/** Aplica recorte + remoção de fundo e gera o PNG transparente de preview. */
	function gerarPreview() {
		if (!srcDataUrl) return;
		const img = new Image();
		img.onload = () => {
			const px = Math.max(0, Math.round(cropX * srcW));
			const py = Math.max(0, Math.round(cropY * srcH));
			const pw = Math.min(srcW - px, Math.round(cropW * srcW));
			const ph = Math.min(srcH - py, Math.round(cropH * srcH));
			if (pw <= 0 || ph <= 0) return;

			const crop = document.createElement('canvas');
			crop.width = pw;
			crop.height = ph;
			const cctx = crop.getContext('2d')!;
			cctx.drawImage(img, px, py, pw, ph, 0, 0, pw, ph);

			// Remoção de fundo por luminância: pixels claros (papel) → transparentes.
			const data = cctx.getImageData(0, 0, pw, ph);
			const d = data.data;
			let minX = pw;
			let minY = ph;
			let maxX = 0;
			let maxY = 0;
			for (let i = 0; i < d.length; i += 4) {
				const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
				if (lum > limiarFundo) {
					d[i + 3] = 0; // transparente
				} else {
					// Realça o traço (escurece levemente) e marca a caixa do conteúdo.
					const idx = i / 4;
					const x = idx % pw;
					const y = (idx / pw) | 0;
					if (x < minX) minX = x;
					if (x > maxX) maxX = x;
					if (y < minY) minY = y;
					if (y > maxY) maxY = y;
				}
			}
			cctx.putImageData(data, 0, 0);

			if (maxX < minX || maxY < minY) {
				previewUrl = null;
				return;
			}

			// Recorta à caixa do traço e re-escala para a proporção do campo do PDF.
			const margem = 24;
			const recW = maxX - minX + 1;
			const recH = maxY - minY + 1;
			const outW = 1000;
			const outH = Math.round(outW / aspecto);
			const out = document.createElement('canvas');
			out.width = outW;
			out.height = outH;
			const octx = out.getContext('2d')!;
			const escala = Math.min((outW - 2 * margem) / recW, (outH - 2 * margem) / recH);
			const drawW = recW * escala;
			const drawH = recH * escala;
			octx.drawImage(
				crop,
				minX,
				minY,
				recW,
				recH,
				(outW - drawW) / 2,
				(outH - drawH) / 2,
				drawW,
				drawH
			);
			previewUrl = out.toDataURL('image/png');
		};
		img.src = srcDataUrl;
	}

	// --- Arrastar/redimensionar a caixa de recorte ---
	let dragMode: 'move' | 'resize' | null = null;
	let dragStart = { mx: 0, my: 0, x: 0, y: 0, w: 0, h: 0 };

	function iniciarDrag(mode: 'move' | 'resize', e: PointerEvent) {
		e.preventDefault();
		e.stopPropagation();
		dragMode = mode;
		dragStart = { mx: e.clientX, my: e.clientY, x: cropX, y: cropY, w: cropW, h: cropH };
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
	}

	function moverDrag(e: PointerEvent) {
		if (!dragMode || !containerEl) return;
		const rect = containerEl.getBoundingClientRect();
		const dx = (e.clientX - dragStart.mx) / rect.width;
		const dy = (e.clientY - dragStart.my) / rect.height;
		if (dragMode === 'move') {
			cropX = Math.min(Math.max(0, dragStart.x + dx), 1 - cropW);
			cropY = Math.min(Math.max(0, dragStart.y + dy), 1 - cropH);
		} else {
			cropW = Math.min(Math.max(0.1, dragStart.w + dx), 1 - cropX);
			cropH = Math.min(Math.max(0.1, dragStart.h + dy), 1 - cropY);
		}
		gerarPreview();
	}

	function fimDrag(e: PointerEvent) {
		dragMode = null;
		try {
			(e.target as HTMLElement).releasePointerCapture(e.pointerId);
		} catch {
			/* ignore */
		}
	}

	// --- Salvar / excluir ---
	function rubricaFinal(): string | null {
		if (aba === 'desenhar') return canvasControl?.toPNG() ?? null;
		return previewUrl;
	}

	async function salvar() {
		const rubrica = rubricaFinal();
		if (!rubrica) {
			toaster.error({ title: 'Desenhe ou envie uma rubrica antes de salvar.' });
			return;
		}
		if (!consentimento) {
			toaster.error({ title: 'É necessário concordar com o registro da rubrica.' });
			return;
		}
		salvando = true;
		try {
			await apiFetch('/api/perfil/rubrica', {
				method: 'POST',
				body: JSON.stringify({ rubrica, consentimento: true })
			});
			toaster.success({ title: 'Rubrica cadastrada com sucesso.' });
			onSaved?.(rubrica);
			open = false;
		} catch (e) {
			toaster.error({ title: e instanceof Error ? e.message : 'Erro ao salvar rubrica.' });
		} finally {
			salvando = false;
		}
	}

	async function excluir() {
		salvando = true;
		try {
			await apiFetch('/api/perfil/rubrica', { method: 'DELETE' });
			toaster.success({ title: 'Rubrica removida.' });
			onSaved?.(null);
			open = false;
		} catch (e) {
			toaster.error({ title: e instanceof Error ? e.message : 'Erro ao excluir rubrica.' });
		} finally {
			salvando = false;
		}
	}
</script>

<Dialog
	{open}
	onOpenChange={(e) => {
		if (!e.open && !salvando) open = false;
	}}
>
	<Dialog.Content
		class="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4 bg-surface-950/80 backdrop-blur-md overflow-y-auto"
	>
		<div
			class="card-elevated rounded-3xl shadow-2xl w-full max-w-2xl max-h-[calc(100dvh-1.5rem)] overflow-y-auto p-4 sm:p-7 space-y-5 border border-white/10"
		>
			<div class="text-center space-y-1.5">
				<Dialog.Title class="text-xl sm:text-2xl font-bold text-surface-900 dark:text-surface-50">
					Cadastrar Rubrica
				</Dialog.Title>
				<Dialog.Description class="text-sm text-surface-500">
					Sua rubrica será usada como elemento gráfico ao assinar pelo computador com certificado
					digital.
				</Dialog.Description>
			</div>

			<Tabs value={aba} onValueChange={(e) => (aba = (e.value as 'desenhar' | 'imagem') ?? aba)}>
				<Tabs.List
					class="flex items-center rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-800 p-1 gap-1"
				>
					<Tabs.Trigger
						value="desenhar"
						class="px-3 py-2 text-sm font-semibold rounded-lg flex-1 text-center cursor-pointer transition-all data-[selected]:bg-primary-500 data-[selected]:text-white"
						><PenLine class="inline w-4 h-4 -mt-0.5" aria-hidden="true" /> Desenhar</Tabs.Trigger
					>
					<Tabs.Trigger
						value="imagem"
						class="px-3 py-2 text-sm font-semibold rounded-lg flex-1 text-center cursor-pointer transition-all data-[selected]:bg-primary-500 data-[selected]:text-white"
						><ImageIcon class="inline w-4 h-4 -mt-0.5" aria-hidden="true" /> Enviar imagem</Tabs.Trigger
					>
				</Tabs.List>

				<Tabs.Content value="desenhar" class="pt-4">
					<p class="text-xs text-surface-500 mb-3">
						Desenhe sua rubrica no quadro abaixo usando o mouse (ou o dedo, em telas sensíveis ao
						toque).
					</p>
					<RubricaCanvas bind:control={canvasControl} {aspecto} />
				</Tabs.Content>

				<Tabs.Content value="imagem" class="pt-4 space-y-4">
					{#if !srcDataUrl}
						<div
							class="p-4 bg-primary-500/5 border border-dashed border-primary-500/30 rounded-2xl space-y-3"
						>
							<p class="text-sm font-semibold text-surface-700 dark:text-surface-200">
								Como obter uma boa rubrica digital
							</p>
							<ol class="text-xs text-surface-500 list-decimal list-inside space-y-1">
								<li>Assine com caneta escura em uma <strong>folha branca</strong>, sem pauta.</li>
								<li>
									Fotografe de cima, com <strong>boa luz</strong> e sem sombras, enquadrando só a assinatura.
								</li>
								<li>Envie a foto abaixo — você poderá recortar e limpar o fundo.</li>
							</ol>
							<svg viewBox="0 0 200 80" class="w-40 mx-auto opacity-70" aria-hidden="true">
								<rect
									x="2"
									y="2"
									width="196"
									height="76"
									rx="6"
									fill="white"
									stroke="#cbd5e1"
									stroke-width="2"
								/>
								<path
									d="M20 55 C 45 10, 60 70, 80 40 S 120 10, 140 50 C 150 65, 165 35, 185 45"
									fill="none"
									stroke="#0f172a"
									stroke-width="3"
									stroke-linecap="round"
								/>
							</svg>
							<label
								class="btn preset-filled-primary-500 rounded-xl font-bold w-full justify-center cursor-pointer"
							>
								Escolher imagem da assinatura
								<input type="file" accept="image/*" class="hidden" onchange={aoEscolherArquivo} />
							</label>
						</div>
					{:else}
						<div class="space-y-3">
							<p class="text-xs text-surface-500">
								Arraste a caixa para enquadrar a assinatura e ajuste a remoção de fundo.
							</p>
							<!-- Imagem + caixa de recorte -->
							<div
								bind:this={containerEl}
								class="relative w-full select-none rounded-xl overflow-hidden border border-surface-200 dark:border-surface-700 bg-[repeating-conic-gradient(#e5e7eb_0%_25%,#f9fafb_0%_50%)] bg-[length:20px_20px]"
							>
								<!-- eslint-disable-next-line svelte/no-at-html-tags -->
								<img
									src={srcDataUrl}
									alt="Assinatura enviada"
									class="w-full block pointer-events-none"
								/>
								<div
									role="presentation"
									class="absolute border-2 border-primary-500 bg-primary-500/10 cursor-move touch-none"
									style="left:{cropX * 100}%;top:{cropY * 100}%;width:{cropW * 100}%;height:{cropH *
										100}%;"
									onpointerdown={(e) => iniciarDrag('move', e)}
									onpointermove={moverDrag}
									onpointerup={fimDrag}
								>
									<div
										role="presentation"
										class="absolute -right-1.5 -bottom-1.5 w-4 h-4 bg-primary-500 rounded-full cursor-nwse-resize touch-none"
										onpointerdown={(e) => iniciarDrag('resize', e)}
										onpointermove={moverDrag}
										onpointerup={fimDrag}
									></div>
								</div>
							</div>

							<div class="space-y-1">
								<label
									for="limiar-fundo"
									class="text-3xs font-black text-surface-500 uppercase tracking-wider"
									>Remoção de fundo</label
								>
								<input
									id="limiar-fundo"
									type="range"
									min="80"
									max="240"
									bind:value={limiarFundo}
									oninput={gerarPreview}
									class="w-full"
								/>
							</div>

							{#if previewUrl}
								<div class="space-y-1">
									<span class="text-3xs font-black text-surface-500 uppercase tracking-wider"
										>Pré-visualização (fundo transparente)</span
									>
									<div
										class="rounded-xl border border-surface-200 dark:border-surface-700 bg-[repeating-conic-gradient(#e5e7eb_0%_25%,#f9fafb_0%_50%)] bg-[length:16px_16px] p-2"
									>
										<img
											src={previewUrl}
											alt="Pré-visualização da rubrica"
											class="w-full block"
											style="aspect-ratio:{aspecto};object-fit:contain;"
										/>
									</div>
								</div>
							{/if}

							<button
								type="button"
								class="btn btn-sm preset-tonal-surface rounded-lg text-xs font-bold uppercase"
								onclick={() => {
									srcDataUrl = null;
									previewUrl = null;
								}}
							>
								Trocar imagem
							</button>
						</div>
					{/if}
				</Tabs.Content>
			</Tabs>

			<!-- Consentimento LGPD -->
			<label
				class="flex items-start gap-2.5 p-3 bg-surface-100/60 dark:bg-surface-800/40 rounded-xl border border-surface-200 dark:border-surface-700 cursor-pointer"
			>
				<input type="checkbox" bind:checked={consentimento} class="mt-0.5 shrink-0" />
				<span class="text-2xs text-surface-500 leading-snug">
					Autorizo o registro e o armazenamento desta rubrica para reutilização como elemento
					gráfico nas minhas assinaturas de documentos funcionais. Posso solicitar sua exclusão a
					qualquer momento (LGPD, Lei 13.709/2018, art. 18).
				</span>
			</label>

			<div class="flex flex-wrap items-center justify-between gap-2">
				{#if rubricaAtual}
					<button
						type="button"
						class="btn btn-sm preset-outlined-error-500 rounded-xl text-xs font-bold uppercase"
						onclick={excluir}
						disabled={salvando}
					>
						Excluir rubrica
					</button>
				{:else}
					<span></span>
				{/if}
				<div class="flex items-center gap-2 ml-auto">
					<button
						type="button"
						class="btn btn-sm preset-outlined-surface-500 rounded-xl text-xs font-bold uppercase"
						onclick={() => (open = false)}
						disabled={salvando}
					>
						Cancelar
					</button>
					<button
						type="button"
						class="btn btn-sm preset-filled-primary-500 rounded-xl text-xs font-bold uppercase shadow-sm"
						onclick={salvar}
						disabled={salvando || !consentimento}
					>
						{salvando ? 'Salvando...' : 'Salvar rubrica'}
					</button>
				</div>
			</div>
		</div>
	</Dialog.Content>
</Dialog>
