<script lang="ts" module>
	/**
	 * Regras de força exibidas no checklist — espelham a validação server-side
	 * dos schemas de senha (`alterarSenhaSchema` / `confirmarRedefinicaoSchema`).
	 * Exportada para as páginas usarem no gating do submit sem duplicar a cadeia
	 * de `$derived` (antes copiada em /alterar-senha e /redefinir-senha).
	 */
	export function validarForcaSenha(novaSenha: string, confirmarSenha: string) {
		const temMinimo = novaSenha.length >= 8;
		const temMaiuscula = /[A-Z]/.test(novaSenha);
		const temMinuscula = /[a-z]/.test(novaSenha);
		const temNumero = /[0-9]/.test(novaSenha);
		const senhaOk = temMinimo && temMaiuscula && temMinuscula && temNumero;
		const confirmaOk = confirmarSenha.length > 0 && novaSenha === confirmarSenha;
		return { temMinimo, temMaiuscula, temMinuscula, temNumero, senhaOk, confirmaOk };
	}
</script>

<script lang="ts">
	/**
	 * Campos "Nova senha" + checklist de requisitos + "Confirmar nova senha"
	 * (com feedback visual de igualdade), compartilhados entre /alterar-senha
	 * e /redefinir-senha. O submit/gating fica na página dona do formulário.
	 */
	let {
		novaSenha = $bindable(''),
		confirmarSenha = $bindable(''),
		placeholderNova = undefined,
		placeholderConfirmar = undefined,
		nameConfirmar = undefined
	}: {
		novaSenha?: string;
		confirmarSenha?: string;
		placeholderNova?: string;
		placeholderConfirmar?: string;
		/** `name` do input de confirmação — só quando a action lê esse campo. */
		nameConfirmar?: string;
	} = $props();

	const forca = $derived(validarForcaSenha(novaSenha, confirmarSenha));
</script>

<label class="label">
	<span class="label-text font-medium">Nova senha</span>
	<input
		class="input"
		type="password"
		name="nova_senha"
		bind:value={novaSenha}
		placeholder={placeholderNova}
		required
	/>
</label>

<!-- Requisitos de senha -->
<div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs px-0.5">
	{#snippet req(ok: boolean, label: string)}
		<div
			class="flex items-center gap-1.5 {ok
				? 'text-success-600 dark:text-success-400'
				: 'text-surface-600 dark:text-surface-400'}"
		>
			{#if ok}
				<svg
					class="w-3.5 h-3.5 shrink-0"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2.5"
					><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg
				>
			{:else}
				<svg
					class="w-3.5 h-3.5 shrink-0 opacity-50"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"><circle cx="12" cy="12" r="9" /></svg
				>
			{/if}
			{label}
		</div>
	{/snippet}
	{@render req(forca.temMinimo, 'Mínimo 8 caracteres')}
	{@render req(forca.temMaiuscula, 'Letra maiúscula (A-Z)')}
	{@render req(forca.temMinuscula, 'Letra minúscula (a-z)')}
	{@render req(forca.temNumero, 'Pelo menos um número')}
</div>

<label class="label">
	<span class="label-text font-medium">Confirmar nova senha</span>
	<div class="relative">
		<input
			class="input {confirmarSenha.length > 0
				? forca.confirmaOk
					? 'border-success-500 focus:ring-success-500'
					: 'border-error-500 focus:ring-error-500'
				: ''}"
			type="password"
			name={nameConfirmar}
			bind:value={confirmarSenha}
			placeholder={placeholderConfirmar}
			required
		/>
		{#if confirmarSenha.length > 0}
			<div class="absolute inset-y-0 right-3 flex items-center pointer-events-none">
				{#if forca.confirmaOk}
					<svg
						class="w-4 h-4 text-success-500"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2.5"
						><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg
					>
				{:else}
					<svg
						class="w-4 h-4 text-error-500"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2.5"
						><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg
					>
				{/if}
			</div>
		{/if}
	</div>
</label>
