<script lang="ts">
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { csrfHeaders } from '$lib/csrf';
	import { toaster } from '$lib/toast';
	import CodigoTimer from '$lib/components/CodigoTimer.svelte';

	/**
	 * Cadastro/TROCA do e-mail pessoal pelo "Meu perfil", em duas etapas:
	 *  1. novo e-mail (+ senha de acesso quando é TROCA — exigida pelo servidor);
	 *  2. código OTP de 6 dígitos enviado ao NOVO endereço.
	 * Na troca, o servidor ainda envia um aviso de segurança ao e-mail funcional.
	 */
	let {
		open = $bindable(false),
		emailAtual,
		onConfirmado
	}: {
		open: boolean;
		emailAtual: string | null;
		onConfirmado: (novoEmail: string) => void;
	} = $props();

	const ehTroca = $derived(!!emailAtual);

	let etapa = $state<'dados' | 'codigo'>('dados');
	let novoEmail = $state('');
	let senha = $state('');
	let codigo = $state('');
	let desafioId = $state('');
	let emailMascarado = $state('');
	let enviando = $state(false);
	let erro = $state('');

	$effect(() => {
		if (open) {
			etapa = 'dados';
			novoEmail = '';
			senha = '';
			codigo = '';
			desafioId = '';
			emailMascarado = '';
			erro = '';
		}
	});

	async function enviarCodigo(): Promise<void> {
		erro = '';
		enviando = true;
		try {
			const res = await fetch('/api/auth/solicitar-verificacao-email-pessoal', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
				body: JSON.stringify({
					email: novoEmail.trim(),
					...(senha ? { senha } : {})
				})
			});
			const json = (await res.json().catch(() => ({}))) as {
				desafioId?: string;
				emailMascarado?: string;
				error?: string;
			};
			if (!res.ok || !json.desafioId) {
				erro = json.error || 'Erro ao enviar o código. Tente novamente.';
				return;
			}
			desafioId = json.desafioId;
			emailMascarado = json.emailMascarado ?? '';
			etapa = 'codigo';
		} catch {
			erro = 'Erro de rede. Tente novamente.';
		} finally {
			enviando = false;
		}
	}

	async function confirmarCodigo() {
		erro = '';
		enviando = true;
		try {
			const res = await fetch('/api/auth/confirmar-verificacao-email-pessoal', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
				body: JSON.stringify({ desafioId, codigo: codigo.trim(), email: novoEmail.trim() })
			});
			const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
			if (!res.ok || !json.ok) {
				erro = json.error || 'Código inválido. Tente novamente.';
				return;
			}
			open = false;
			toaster.create({
				title: ehTroca ? 'E-mail pessoal alterado' : 'E-mail pessoal cadastrado',
				description: ehTroca
					? 'Enviamos um aviso de segurança para o seu e-mail funcional.'
					: undefined,
				type: 'success'
			});
			onConfirmado(novoEmail.trim().toLowerCase());
		} catch {
			erro = 'Erro de rede. Tente novamente.';
		} finally {
			enviando = false;
		}
	}
</script>

<Dialog
	{open}
	onOpenChange={(e) => {
		if (!e.open) open = false;
	}}
>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="card p-5 sm:p-6 max-w-md w-full max-h-[calc(100dvh-2rem)] overflow-y-auto bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
		>
			<Dialog.Title class="h3 font-bold mb-1">
				{ehTroca ? 'Trocar e-mail pessoal' : 'Cadastrar e-mail pessoal'}
			</Dialog.Title>
			<Dialog.Description class="text-sm text-surface-500 dark:text-surface-400 mb-5">
				{etapa === 'dados'
					? 'O e-mail pessoal é o seu canal de recuperação de senha.'
					: 'Digite o código de 6 dígitos enviado ao novo endereço.'}
			</Dialog.Description>

			{#if etapa === 'dados'}
				<div class="space-y-4 mb-5">
					<label class="label">
						<span class="label-text">Novo e-mail pessoal</span>
						<input
							type="email"
							class="input"
							bind:value={novoEmail}
							placeholder="nome@provedor.com"
							autocomplete="email"
							maxlength="254"
						/>
					</label>
					{#if ehTroca}
						<label class="label">
							<span class="label-text">Sua senha de acesso</span>
							<input
								type="password"
								class="input"
								bind:value={senha}
								placeholder="Confirme sua senha para autorizar a troca"
								autocomplete="current-password"
								maxlength="128"
							/>
							<span class="text-[0.68rem] text-surface-500 dark:text-surface-400 mt-1 block">
								Por segurança, a troca do canal de recuperação exige sua senha. Um aviso será
								enviado ao seu e-mail funcional.
							</span>
						</label>
					{/if}
				</div>
			{:else}
				<div class="space-y-4 mb-5">
					<input
						type="text"
						inputmode="numeric"
						maxlength="6"
						class="input text-center text-2xl font-bold tracking-[0.5em]"
						bind:value={codigo}
						placeholder="••••••"
						autocomplete="one-time-code"
					/>
					<CodigoTimer {emailMascarado} onReenviar={enviarCodigo} />
				</div>
			{/if}

			{#if erro}
				<p class="text-sm text-error-600 dark:text-error-400 mb-4" role="alert">{erro}</p>
			{/if}

			<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
				<button
					type="button"
					class="btn preset-outlined-surface-500"
					onclick={() => (open = false)}
				>
					Cancelar
				</button>
				{#if etapa === 'dados'}
					<button
						type="button"
						class="btn preset-filled-primary-500 font-bold disabled:opacity-40"
						disabled={enviando || !novoEmail.trim() || (ehTroca && !senha)}
						onclick={enviarCodigo}
					>
						{enviando ? 'Enviando…' : 'Enviar código'}
					</button>
				{:else}
					<button
						type="button"
						class="btn preset-filled-primary-500 font-bold disabled:opacity-40"
						disabled={enviando || codigo.trim().length !== 6}
						onclick={confirmarCodigo}
					>
						{enviando ? 'Confirmando…' : 'Confirmar'}
					</button>
				{/if}
			</div>
		</div>
	</Dialog.Content>
</Dialog>
