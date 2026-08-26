<script lang="ts">
	/**
	 * Modal ÚNICO da cerimônia de assinatura avançada em tela.
	 *
	 * Escala ordinária, GISE, relatório extraordinário e presença (entrada/saída)
	 * entram por aqui. O documento só muda textos, o `onConfirm` e se o rodapé
	 * de Token A3 aparece — a cerimônia (rubrica → evidências → senha+2FA) é a mesma.
	 *
	 * Montar outro `ModalShell`+`SignaturePad` à mão é o sinal de que o padrão
	 * voltou a divergir; use este componente.
	 */
	import type { Snippet } from 'svelte';
	import ModalShell from './ModalShell.svelte';
	import SignaturePad from './SignaturePad.svelte';
	import RodapeOpcaoTokenAssinatura from './RodapeOpcaoTokenAssinatura.svelte';
	import Spinner from './Spinner.svelte';
	import {
		textosEtapaAssinatura,
		type SignaturePadConfirmPayload,
		type SignaturePadStep
	} from './SignaturePadTypes';

	type Largura = 'sm' | 'md' | 'lg' | '2xl';
	type Camada = 'base' | 'empilhado' | 'duplo' | 'topo';
	type Familia = 'escalas' | 'gise' | 'assinatura';
	type Padding = 'padrao' | 'compacto' | 'mobile';

	let {
		open = $bindable(false),
		onConfirm,
		onCancel,
		exigirFoto = true,
		exigirGps = true,
		exigirCodigoEmail = false,
		rubricaSalva = null,
		cpfUsuario = null,
		credenciaisCombinadas = true,
		message = '',
		tituloRubrica = 'Assinatura Digital em Tela',
		descricaoRubrica,
		tituloCamera = 'Prova de Vida',
		onAssinarToken = null,
		tokenDisabled = false,
		pending = false,
		pendingLabel = null,
		largura = '2xl',
		camada = 'empilhado',
		familia = 'assinatura',
		padding = 'compacto',
		portal = false,
		notaRodape = null,
		rodape = null
	}: {
		open?: boolean;
		onConfirm: (payload: SignaturePadConfirmPayload) => void | Promise<void>;
		onCancel: () => void;
		exigirFoto?: boolean;
		exigirGps?: boolean;
		exigirCodigoEmail?: boolean;
		rubricaSalva?: string | null;
		cpfUsuario?: string | null;
		credenciaisCombinadas?: boolean;
		/** Legenda interna do pad (ex.: "Rubrica do Organizador"). */
		message?: string;
		/** Título do modal na etapa de rubrica. */
		tituloRubrica?: string;
		/** Descrição do modal na etapa de rubrica — nomeia o documento. */
		descricaoRubrica: string;
		tituloCamera?: string;
		/** Se definido, mostra "Ou / Certificado Digital" nas etapas iniciais. */
		onAssinarToken?: (() => void) | null;
		tokenDisabled?: boolean;
		pending?: boolean;
		/** Quando `pending` e este texto existem, o pad vira spinner (ex.: presença). */
		pendingLabel?: string | null;
		largura?: Largura;
		camada?: Camada;
		familia?: Familia;
		padding?: Padding;
		portal?: boolean;
		notaRodape?: string | null;
		rodape?: Snippet | null;
	} = $props();

	let signatureStep = $state<SignaturePadStep>('signature');

	$effect(() => {
		if (open) {
			signatureStep = 'signature';
		}
	});

	const textos = $derived(
		textosEtapaAssinatura(signatureStep, descricaoRubrica, { tituloRubrica, tituloCamera })
	);
	const mostrarOpcaoToken = $derived(
		Boolean(onAssinarToken) &&
			!pending &&
			(signatureStep === 'signature' || signatureStep === 'credenciais')
	);
</script>

<ModalShell
	{open}
	title={textos.titulo}
	description={textos.descricao}
	{largura}
	{camada}
	{padding}
	{familia}
	{portal}
	{pending}
	onOpenChange={(novoOpen) => {
		open = novoOpen;
		if (!novoOpen) onCancel();
	}}
>
	{#if open}
		{#if pending && pendingLabel}
			<div class="flex flex-col items-center gap-4 py-10">
				<Spinner size="lg" class="text-primary-500" />
				<p
					class="text-sm font-semibold text-surface-600 dark:text-surface-400 uppercase tracking-wider"
				>
					{pendingLabel}
				</p>
			</div>
		{:else}
			<SignaturePad
				{onConfirm}
				{onCancel}
				{exigirFoto}
				{exigirGps}
				{exigirCodigoEmail}
				{rubricaSalva}
				{credenciaisCombinadas}
				{cpfUsuario}
				{message}
				bind:step={signatureStep}
			/>
			{#if mostrarOpcaoToken && onAssinarToken}
				<RodapeOpcaoTokenAssinatura {onAssinarToken} disabled={tokenDisabled} />
			{/if}
		{/if}
	{/if}

	{#if notaRodape}
		<p class="text-sm text-surface-600 dark:text-surface-400 text-center italic">
			{notaRodape}
		</p>
	{/if}
	{#if rodape}
		{@render rodape()}
	{/if}
</ModalShell>
