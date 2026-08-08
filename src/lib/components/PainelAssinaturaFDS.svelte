<script lang="ts">
	/**
	 * Painel da escala de FDS, que NÃO tem assinatura digital: aqui o ato é
	 * "finalizar e enviar por e-mail à DPIS". `PainelAssinaturaEscala` escolhe
	 * entre este e o `PainelAssinaturaDigital` pelo `isFDS` — o fluxo de PKI
	 * (plantão/expediente) não passa por este arquivo.
	 *
	 * Finalizar, reabrir e reenviar são form actions do `+page.server.ts` da
	 * escala (`?/finalizar`, `?/desfinalizar`, `?/reenviarEmail`) — daí o `fetch`
	 * cru com `FormData` no reenvio automático, que é o caso em que
	 * `$lib/api-fetch` não se aplica.
	 *
	 * Reabrir uma escala já enviada é ação com efeito EXTERNO: o e-mail que a
	 * DPIS recebeu continua valendo, e o reenvio manda um segundo documento pelo
	 * mesmo canal. Por isso reabrir e reenviar passam por diálogo de confirmação.
	 * A única tentativa não confirmada é o reenvio AUTOMÁTICO, e ela só dispara
	 * quando o finalizar deu certo mas o e-mail falhou (`emailEnviado === false`)
	 * — ou seja, quando a DPIS ainda não recebeu nada. Uma tentativa, e se falhar
	 * degrada para um aviso pedindo o botão manual.
	 *
	 * `podeEditar=false` — admin_seccional visitando escala de outra unidade —
	 * esconde finalizar/reabrir/reenviar, mas mantém os downloads.
	 */
	import { untrack } from 'svelte';
	import ModalShell from './ModalShell.svelte';
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import type { ActionResult } from '@sveltejs/kit';
	import { toaster } from '$lib/toast';
	import { postFormAction } from '$lib/post-form-action';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';

	let {
		escalaId,
		policiaisCount,
		podeEditar = true,
		finalizadaEm = $bindable(null),
		emailEnvioInicial = null
	}: {
		escalaId: string;
		policiaisCount: number;
		/** Quem só visualiza (ex.: admin_seccional de outra unidade) não finaliza/reabre/reenvia. */
		podeEditar?: boolean;
		finalizadaEm?: string | null;
		emailEnvioInicial?: string | null;
	} = $props();

	const EMAIL_PADRAO_FDS = 'dpis@policiacivil.ce.gov.br';

	let pendingFinalizar = $state(false);
	let pendingReenviar = $state(false);
	let pendingDesfinalizar = $state(false);
	let pendingReenvioAuto = $state(false);
	let mensagemDemora = $state('');
	let timerDemora: ReturnType<typeof setTimeout> | null = null;

	let dialogEnvioAberto = $state(false);
	let dialogReenvioAberto = $state(false);
	let dialogDesfinalizarAberto = $state(false);

	let emailModal = $state(EMAIL_PADRAO_FDS);
	let emailEnvioSalvo = $state<string | null>(untrack(() => emailEnvioInicial));

	function abrirModalFinalizar() {
		emailModal = emailEnvioSalvo || EMAIL_PADRAO_FDS;
		dialogEnvioAberto = true;
	}

	function abrirModalReenviar() {
		if (pendingReenvioAuto) return;
		emailModal = emailEnvioSalvo || EMAIL_PADRAO_FDS;
		dialogReenvioAberto = true;
	}

	async function tentarReenvioAutomatico(email: string) {
		if (pendingReenviar) return;
		pendingReenvioAuto = true;
		try {
			const fd = new FormData();
			fd.append('email_destino', email);
			const json = await postFormAction(`${page.url.pathname}?/reenviarEmail`, fd);
			if (json.type === 'success') {
				toaster.create({
					title: 'E-mail reenviado com sucesso!',
					description: `Enviado para ${email}`,
					type: 'success'
				});
			} else {
				throw new Error(
					json.type === 'failure'
						? String((json.data as { error?: string } | undefined)?.error ?? 'Falha')
						: 'Falha'
				);
			}
		} catch {
			toaster.create({
				title: 'Reenvio automático falhou',
				description: 'Use o botão "Reenviar E-mail" para tentar novamente.',
				type: 'warning'
			});
		} finally {
			pendingReenvioAuto = false;
		}
	}

	function handleFinalizar() {
		if (timerDemora) {
			clearTimeout(timerDemora);
			timerDemora = null;
		}
		pendingFinalizar = true;
		dialogEnvioAberto = false;
		mensagemDemora = '';
		timerDemora = setTimeout(() => {
			if (pendingFinalizar)
				mensagemDemora = 'Isto está demorando mais que o esperado, aguarde o envio do e-mail...';
		}, 5000);
		return async ({ result }: { result: ActionResult }) => {
			if (timerDemora) {
				clearTimeout(timerDemora);
				timerDemora = null;
			}
			mensagemDemora = '';
			pendingFinalizar = false;
			if (result.type === 'success') {
				finalizadaEm = new Date().toISOString();
				const email = result.data?.emailDestino ?? emailModal;
				emailEnvioSalvo = email;
				if (result.data?.emailEnviado === false) {
					toaster.create({
						title: 'Escala finalizada',
						description: 'Falha no envio do e-mail. Tentando reenviar automaticamente...',
						type: 'warning'
					});
					await tentarReenvioAutomatico(email);
				} else {
					toaster.create({
						title: 'Escala enviada com sucesso!',
						description: `E-mail enviado para ${email}`,
						type: 'success'
					});
				}
			} else {
				const msg = result.type === 'failure' ? result.data?.error : undefined;
				toaster.create({ title: msg || 'Erro ao finalizar', type: 'error' });
			}
		};
	}

	function handleReenviar() {
		pendingReenviar = true;
		dialogReenvioAberto = false;
		return async ({ result }: { result: ActionResult }) => {
			pendingReenviar = false;
			if (result.type === 'success') {
				emailEnvioSalvo = result.data?.emailDestino ?? emailModal;
				toaster.create({
					title: 'E-mail reenviado com sucesso!',
					description: `Escala enviada para ${result.data?.emailDestino ?? emailModal}`,
					type: 'success'
				});
			} else {
				const msg = result.type === 'failure' ? result.data?.error : undefined;
				toaster.create({ title: msg || 'Erro ao reenviar', type: 'error' });
			}
		};
	}

	function handleDesfinalizar() {
		pendingDesfinalizar = true;
		dialogDesfinalizarAberto = false;
		return async ({ result }: { result: ActionResult }) => {
			pendingDesfinalizar = false;
			if (result.type === 'success') {
				finalizadaEm = null;
				toaster.create({ title: 'Envio desfeito. A escala pode ser editada.', type: 'info' });
			} else {
				const msg = result.type === 'failure' ? result.data?.error : undefined;
				toaster.create({
					title: msg || 'Erro ao reabrir para edição',
					type: 'error'
				});
			}
		};
	}
</script>

{#if finalizadaEm}
	<!-- Banner: FDS enviada -->
	<div
		class="mb-6 p-4 sm:p-5 bg-success-500/10 border border-success-500/30 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm"
	>
		<div class="flex items-center gap-4">
			<div class="bg-success-500/20 p-3 rounded-xl">
				<CheckCircle2 class="w-6 h-6 text-success-600 dark:text-success-400" aria-hidden="true" />
			</div>
			<div>
				<h3 class="font-bold text-success-800 dark:text-success-400 text-lg">Escala Enviada</h3>
				<p class="text-sm text-success-700 dark:text-success-300 mt-0.5">
					Finalizada em {new Date(finalizadaEm).toLocaleDateString('pt-BR', {
						day: '2-digit',
						month: '2-digit',
						year: 'numeric',
						hour: '2-digit',
						minute: '2-digit'
					})}.
					{#if emailEnvioSalvo}<span class="opacity-70">· {emailEnvioSalvo}</span>{/if}
				</p>
				{#if pendingReenvioAuto}
					<p class="text-xs text-warning-600 dark:text-warning-400 mt-1 animate-pulse">
						Reenviando e-mail automaticamente, aguarde...
					</p>
				{/if}
			</div>
		</div>
		<div class="flex flex-wrap gap-2 justify-end">
			{#each ['DOCX', 'XLSX', 'PDF'] as format (format)}
				<a
					class="btn btn-sm bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-white/5 text-3xs font-bold uppercase px-3 no-underline rounded-lg"
					href={`/api/escalas/${escalaId}/download?format=${format.toLowerCase()}`}
					target="_blank">{format}</a
				>
			{/each}
			{#if podeEditar}
				<button
					type="button"
					class="btn btn-sm preset-outlined-primary-500 font-bold"
					onclick={abrirModalReenviar}
					disabled={pendingReenviar || pendingReenvioAuto}
				>
					{pendingReenvioAuto
						? 'Reenviando...'
						: pendingReenviar
							? 'Enviando...'
							: 'Reenviar E-mail'}
				</button>
				<button
					type="button"
					class="btn btn-sm preset-outlined-error-500 font-bold"
					onclick={() => (dialogDesfinalizarAberto = true)}
					disabled={pendingDesfinalizar}
				>
					Reabrir para edição
				</button>
			{/if}
		</div>
	</div>
{:else if podeEditar}
	<!-- Painel: FDS não enviada -->
	<div
		class="mb-6 p-4 sm:p-5 card-glass rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4"
	>
		<div>
			<h3 class="font-semibold text-base text-surface-700 dark:text-surface-200">
				Finalizar Envio da Escala
			</h3>
			<p
				class="text-xs mt-1 transition-colors {mensagemDemora
					? 'text-warning-600 dark:text-warning-400'
					: 'text-surface-600 dark:text-surface-400'}"
			>
				{mensagemDemora || 'Confirme o e-mail de destino e envie a escala em formato Word.'}
			</p>
		</div>
		<button
			type="button"
			class="btn preset-filled-primary-500 font-bold px-6 w-full sm:w-auto shrink-0"
			onclick={abrirModalFinalizar}
			disabled={pendingFinalizar || policiaisCount === 0}
		>
			{pendingFinalizar ? (mensagemDemora ? 'Aguardando...' : 'Enviando...') : 'Finalizar Envio'}
		</button>
	</div>
	{#if policiaisCount === 0}
		<p class="text-xs text-warning-600 dark:text-warning-400 -mt-4 mb-4 px-1">
			Adicione ao menos um policial antes de finalizar.
		</p>
	{/if}
{/if}

{#snippet descricaoEnvio()}
	A escala será enviada como arquivo <strong>.docx</strong> para o e-mail abaixo. Verifique antes de confirmar.
{/snippet}

{#snippet descricaoReenvio()}
	A escala será reenviada como arquivo <strong>.docx</strong>. Confirme ou altere o e-mail de
	destino.
{/snippet}

<!-- Modal: confirmar e-mail para finalizar envio -->
<ModalShell
	bind:open={dialogEnvioAberto}
	title="Confirmar Envio"
	description={descricaoEnvio}
	largura="md"
	camada="base"
	familia="escalas"
	pending={pendingFinalizar}
>
	<form method="POST" action="?/finalizar" use:enhance={handleFinalizar} class="space-y-4">
		<label class="label">
			<span class="label-text font-semibold">E-mail de destino</span>
			<input
				type="email"
				name="email_destino"
				class="input"
				bind:value={emailModal}
				required
				placeholder="destinatario@policiacivil.ce.gov.br"
			/>
		</label>
		<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 pt-2">
			<button
				type="button"
				class="btn preset-outlined-surface-500"
				onclick={() => (dialogEnvioAberto = false)}
			>
				Cancelar
			</button>
			<button
				type="submit"
				class="btn preset-filled-primary-500 font-bold"
				disabled={pendingFinalizar}
			>
				{pendingFinalizar ? 'Enviando...' : 'Confirmar e Enviar'}
			</button>
		</div>
	</form>
</ModalShell>

<!-- Modal: reenviar e-mail -->
<ModalShell
	bind:open={dialogReenvioAberto}
	title="Reenviar E-mail"
	description={descricaoReenvio}
	largura="md"
	camada="base"
	familia="escalas"
	pending={pendingReenviar}
>
	<form method="POST" action="?/reenviarEmail" use:enhance={handleReenviar} class="space-y-4">
		<label class="label">
			<span class="label-text font-semibold">E-mail de destino</span>
			<input
				type="email"
				name="email_destino"
				class="input"
				bind:value={emailModal}
				required
				placeholder="destinatario@policiacivil.ce.gov.br"
			/>
		</label>
		<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 pt-2">
			<button
				type="button"
				class="btn preset-outlined-surface-500"
				onclick={() => (dialogReenvioAberto = false)}
			>
				Cancelar
			</button>
			<button
				type="submit"
				class="btn preset-filled-primary-500 font-bold"
				disabled={pendingReenviar}
			>
				{pendingReenviar ? 'Reenviando...' : 'Reenviar'}
			</button>
		</div>
	</form>
</ModalShell>

<!-- Diálogo confirmar desfinalizar -->
<ModalShell
	bind:open={dialogDesfinalizarAberto}
	title="Reabrir para edição?"
	description="A escala voltará ao estado de rascunho e poderá ser editada novamente."
	largura="sm"
	camada="base"
	familia="escalas"
	pending={pendingDesfinalizar}
>
	<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
		<button
			type="button"
			class="btn preset-outlined-surface-500"
			onclick={() => (dialogDesfinalizarAberto = false)}
		>
			Cancelar
		</button>
		<form method="POST" action="?/desfinalizar" use:enhance={handleDesfinalizar} class="contents">
			<button
				type="submit"
				class="btn preset-filled-warning-500 font-bold"
				disabled={pendingDesfinalizar}
			>
				{pendingDesfinalizar ? 'Desfazendo...' : 'Reabrir Escala'}
			</button>
		</form>
	</div>
</ModalShell>
