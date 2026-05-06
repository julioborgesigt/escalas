<script lang="ts">
	import icon from '$lib/assets/logo.png';
	import { enhance } from '$app/forms';

	let { data, form }: { data: any; form: any } = $props();

	let aceitouTermo = $state(false);
	let aceitouLgpd = $state(false);
	let scrollouAteFim = $state(false);
	let enviando = $state(false);

	const podeAceitar = $derived(aceitouTermo && aceitouLgpd && scrollouAteFim);

	function onScroll(e: Event) {
		const el = e.currentTarget as HTMLElement;
		const fim = el.scrollHeight - el.clientHeight;
		// 8px de tolerância para evitar que mobile não chegue exatamente
		if (el.scrollTop >= fim - 8) scrollouAteFim = true;
	}
</script>

<svelte:head>
	<title>Termo de Uso — Escalas PC-CE</title>
</svelte:head>

<div class="min-h-screen bg-surface-50 dark:bg-surface-900 flex flex-col items-center justify-start p-3 sm:p-6">
	<div class="w-full max-w-3xl bg-white dark:bg-surface-800 shadow-xl border border-primary-500/20 rounded-2xl sm:rounded-3xl overflow-hidden">
		<header class="flex flex-col items-center p-4 sm:p-6 border-b border-surface-200 dark:border-white/5">
			<img src={icon} alt="Logo PC-CE" class="w-14 sm:w-20 mb-2 drop-shadow-md" />
			<h1 class="text-lg sm:text-xl font-black uppercase tracking-tighter text-surface-900 dark:text-white text-center">
				Termo de Uso e Política de Privacidade
			</h1>
			<p class="text-xs text-surface-500 mt-1">
				Versão {data.versao} · vigente desde {data.vigenteDesde}
			</p>
		</header>

		<div
			class="termo-conteudo p-4 sm:p-6 max-h-[55vh] overflow-y-auto text-sm leading-relaxed text-surface-700 dark:text-surface-200"
			onscroll={onScroll}
		>
			{@html data.conteudoHtml}
		</div>

		<form
			method="POST"
			action="?/aceitar"
			use:enhance={() => {
				enviando = true;
				return async ({ update }) => {
					await update();
					enviando = false;
				};
			}}
			class="p-4 sm:p-6 border-t border-surface-200 dark:border-white/5 space-y-3"
		>
			{#if !scrollouAteFim}
				<p class="text-[11px] text-amber-700 dark:text-amber-400 italic">
					⬆ Role o termo até o final para habilitar o aceite.
				</p>
			{/if}

			<label class="flex items-start gap-2 cursor-pointer">
				<input
					type="checkbox"
					name="aceitou_termo"
					bind:checked={aceitouTermo}
					disabled={!scrollouAteFim}
					class="mt-1 shrink-0"
				/>
				<span class="text-sm text-surface-800 dark:text-surface-200">
					Li e concordo integralmente com este Termo de Uso e Política de Privacidade.
				</span>
			</label>
			<label class="flex items-start gap-2 cursor-pointer">
				<input
					type="checkbox"
					name="aceitou_lgpd"
					bind:checked={aceitouLgpd}
					disabled={!scrollouAteFim}
					class="mt-1 shrink-0"
				/>
				<span class="text-sm text-surface-800 dark:text-surface-200">
					Autorizo a coleta de IP, geolocalização (GPS), dispositivo e selfie para fins de
					auditoria das assinaturas, conforme art. 7º, V, da LGPD.
				</span>
			</label>

			{#if form?.erro}
				<p class="text-sm text-error-600 font-bold">{form.erro}</p>
			{/if}

			<div class="flex flex-col sm:flex-row gap-2 sm:gap-3 sm:justify-end pt-2">
				<a
					href="/api/auth/logout"
					class="px-4 py-2 text-center bg-surface-200 hover:bg-surface-300 dark:bg-surface-700 dark:hover:bg-surface-600 text-surface-800 dark:text-surface-200 font-bold rounded-xl text-sm transition-colors"
				>
					Recusar e sair
				</a>
				<button
					type="submit"
					disabled={!podeAceitar || enviando}
					class="px-5 py-2.5 bg-primary-600 hover:bg-primary-700 active:bg-primary-800 disabled:bg-surface-400 disabled:cursor-not-allowed text-white font-bold rounded-xl text-sm transition-colors"
				>
					{enviando ? 'Registrando aceite…' : 'Aceitar e seguir'}
				</button>
			</div>

			<p class="text-[10px] text-surface-400 mt-2 text-center">
				Hash criptográfico do termo aceito: <code class="font-mono">{data.hash.slice(0, 16)}…</code>
				· O aceite registrará seu IP, dispositivo e data/hora no sistema.
			</p>
		</form>
	</div>
</div>

<style>
	.termo-conteudo :global(h2) {
		font-size: 1.05rem;
		font-weight: 800;
		margin-bottom: 0.25rem;
	}
	.termo-conteudo :global(h3) {
		font-size: 0.92rem;
		font-weight: 700;
		margin-top: 1rem;
		margin-bottom: 0.4rem;
	}
	.termo-conteudo :global(p) {
		margin-bottom: 0.5rem;
	}
	.termo-conteudo :global(.subtitulo) {
		font-size: 0.78rem;
		opacity: 0.7;
		margin-bottom: 0.75rem;
	}
	.termo-conteudo :global(ul) {
		list-style: disc;
		padding-left: 1.25rem;
		margin-bottom: 0.6rem;
	}
	.termo-conteudo :global(li) {
		margin-bottom: 0.2rem;
	}
	.termo-conteudo :global(code) {
		background: rgba(0, 0, 0, 0.05);
		padding: 0 0.25rem;
		border-radius: 4px;
	}
</style>
