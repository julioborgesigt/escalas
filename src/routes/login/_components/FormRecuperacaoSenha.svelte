<script lang="ts">
	/**
	 * Fluxo 4: recuperação de senha em três passos (`recuperacaoEtapa`).
	 * Respostas genéricas — não revela se a matrícula/login existe.
	 */
	import { Inbox, Lock, Mail } from '@lucide/svelte';
	import { loading as loadingService } from '$lib/loading.svelte';
	import CodigoTimer from '$lib/components/CodigoTimer.svelte';
	import { Steps, Tabs } from '@skeletonlabs/skeleton-svelte';

	let {
		tipo = $bindable(),
		identificadorRec = $bindable(),
		codigoRec = $bindable(),
		recuperacaoEtapa,
		recuperacaoResultado,
		currentRecStep,
		emailMascaradoRec,
		solicitarRecuperacao,
		confirmarRecuperacao,
		onVoltar,
		onVoltarIdentificador
	}: {
		tipo: 'policial' | 'admin';
		identificadorRec: string;
		codigoRec: string;
		recuperacaoEtapa: 'identificador' | 'codigo' | 'concluida';
		recuperacaoResultado: 'codigo' | 'link';
		currentRecStep: number;
		emailMascaradoRec: string;
		solicitarRecuperacao: () => Promise<void>;
		confirmarRecuperacao: () => Promise<void>;
		onVoltar: () => void;
		onVoltarIdentificador: () => void;
	} = $props();
</script>

<Steps step={currentRecStep} count={3} class="mb-6">
	<Steps.List class="flex items-center justify-center gap-2">
		{#each ['Identificação', 'Código', 'Concluído'] as label, i (i)}
			<Steps.Item index={i}>
				<Steps.Trigger
					tabindex={-1}
					class="flex items-center gap-2 text-xs font-semibold data-[current]:text-primary-500 data-[complete]:text-success-500 text-surface-400 pointer-events-none"
				>
					<Steps.Indicator
						class="w-6 h-6 rounded-full border-2 flex items-center justify-center text-3xs"
						>{i + 1}</Steps.Indicator
					>
					<span class="hidden sm:inline">{label}</span>
				</Steps.Trigger>
				{#if i < 2}
					<Steps.Separator class="w-6 sm:w-12 h-px bg-surface-300 dark:bg-surface-700" />
				{/if}
			</Steps.Item>
		{/each}
	</Steps.List>
</Steps>
{#if recuperacaoEtapa === 'identificador'}
	<div class="text-center mb-6">
		<Lock
			class="w-12 h-12 mx-auto mb-3 text-surface-600 dark:text-surface-400"
			aria-hidden="true"
		/>
		<p class="font-semibold mb-1">Recuperar senha</p>
		<p class="text-sm text-surface-600 dark:text-surface-400">
			Informe {tipo === 'policial' ? 'sua matrícula' : 'seu login'} para receber um código de validação
			por e-mail.
		</p>
	</div>

	<div class="flex flex-col gap-5">
		<Tabs
			value={tipo}
			onValueChange={(e) => {
				tipo = e.value as 'policial' | 'admin';
				identificadorRec = '';
			}}
			class="w-full mb-4"
		>
			<Tabs.List
				class="flex items-center rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-800 p-1 gap-1 w-full"
			>
				<Tabs.Trigger
					value="policial"
					class="px-3 py-2 text-sm font-semibold rounded-lg flex-1 text-center cursor-pointer select-none transition-all duration-200 text-surface-600 dark:text-surface-400 data-[selected]:bg-primary-500 data-[selected]:text-white data-[selected]:shadow-md data-[selected]:shadow-primary-500/25 hover:text-surface-700 dark:hover:text-surface-200"
					>Policial</Tabs.Trigger
				>
				<Tabs.Trigger
					value="admin"
					class="px-3 py-2 text-sm font-semibold rounded-lg flex-1 text-center cursor-pointer select-none transition-all duration-200 text-surface-600 dark:text-surface-400 data-[selected]:bg-primary-500 data-[selected]:text-white data-[selected]:shadow-md data-[selected]:shadow-primary-500/25 hover:text-surface-700 dark:hover:text-surface-200"
					>Administrador</Tabs.Trigger
				>
			</Tabs.List>
		</Tabs>

		<label class="label">
			<span class="label-text">{tipo === 'policial' ? 'Matrícula' : 'Login'}</span>
			<input
				class="input"
				type="text"
				bind:value={identificadorRec}
				placeholder={tipo === 'policial' ? 'Digite sua matrícula' : 'Digite seu login'}
				maxlength={tipo === 'policial' ? 8 : undefined}
			/>
		</label>

		<button
			type="button"
			class="btn preset-filled-primary-500 w-full py-3 flex items-center justify-center gap-2"
			disabled={loadingService.active || !identificadorRec.trim()}
			onclick={solicitarRecuperacao}
		>
			{loadingService.active ? 'Enviando...' : 'Enviar código de validação'}
		</button>

		<button type="button" class="btn preset-outlined w-full" onclick={onVoltar}> ← Voltar </button>
	</div>
{:else if recuperacaoEtapa === 'codigo'}
	<div class="text-center mb-6">
		<Mail
			class="w-12 h-12 mx-auto mb-3 text-surface-600 dark:text-surface-400"
			aria-hidden="true"
		/>
		<p class="font-semibold mb-1">Código de validação</p>
	</div>

	<div class="flex flex-col gap-5">
		<label class="label">
			<span class="label-text text-center block">Código de validação</span>
			<input
				class="input text-center text-3xl font-bold tracking-[0.4em] py-3"
				type="text"
				value={codigoRec}
				oninput={(e) => (codigoRec = e.currentTarget.value.replace(/\D/g, '').slice(0, 6))}
				placeholder="000000"
				maxlength="6"
				inputmode="numeric"
				autocomplete="one-time-code"
			/>
		</label>

		<CodigoTimer emailMascarado={emailMascaradoRec} onReenviar={solicitarRecuperacao} />

		<button
			type="button"
			class="btn preset-filled-primary-500 w-full py-3 flex items-center justify-center gap-2"
			disabled={loadingService.active || codigoRec.length !== 6}
			onclick={confirmarRecuperacao}
		>
			{loadingService.active ? 'Validando...' : 'Confirmar código'}
		</button>

		<button type="button" class="btn preset-outlined w-full" onclick={onVoltarIdentificador}>
			← Voltar
		</button>
	</div>
{:else}
	<div class="text-center">
		<Inbox
			class="w-12 h-12 mx-auto mb-4 text-surface-600 dark:text-surface-400"
			aria-hidden="true"
		/>
		<p class="font-semibold mb-2">
			{recuperacaoResultado === 'link' ? 'Link enviado!' : 'Código enviado!'}
		</p>
		<p class="text-sm text-surface-600 dark:text-surface-400 mb-6">
			{#if recuperacaoResultado === 'link'}
				Dentro de instantes você receberá em seu e-mail funcional um link de redefinição de senha.
				Verifique também sua caixa de spam.
			{:else}
				Você receberá um código de validação em instantes.
			{/if}
		</p>
		<button type="button" class="btn preset-filled-primary-500 w-full" onclick={onVoltar}>
			Ir para o login
		</button>
	</div>
{/if}
