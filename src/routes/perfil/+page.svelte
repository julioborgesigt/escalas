<script lang="ts">
	/**
	 * "Meu perfil" — o que o próprio servidor vê sobre si, e as duas únicas
	 * coisas que ele muda daqui.
	 *
	 * A distinção central mudou de lado em ago/2026. O servidor nunca editou o
	 * próprio cadastro; agora ele também não o SOLICITA. Telefone, classe, regime
	 * e lotação aparecem em somente leitura, e quem pede a correção é o
	 * administrador da unidade ou da seccional dele, na ficha administrativa — com
	 * justificativa e sujeito à aprovação do Admin Geral. Por isso o quadro de
	 * dados cadastrais diz PARA QUEM reclamar: uma tela que só mostra o dado
	 * errado, sem dizer quem o conserta, é um beco.
	 *
	 * O que continua sendo do titular: o e-mail pessoal (troca com senha + código
	 * enviado ao novo endereço) e a chave de assinatura. Os dois vão por API e
	 * refletem na hora — daí o espelho local em `$state` depois do sucesso.
	 */
	import type { PageProps } from './$types';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { cartaoChaveVisivel } from '$lib/chave-assinatura-ui';
	import CartaoPasskey from './_components/CartaoPasskey.svelte';
	import ModalAlterarEmailPessoal from './_components/ModalAlterarEmailPessoal.svelte';
	import { limparTelefone } from '$lib/utils/formato';

	const { data }: PageProps = $props();

	const perfil = $derived(data.perfil);

	const REGIME_ROTULO: Record<string, string> = {
		plantao: 'Plantão',
		expediente: 'Expediente',
		ambos: 'Plantão e expediente'
	};

	const telefone = $derived(limparTelefone(perfil.telefone));
	const regime = $derived(perfil.regime ? (REGIME_ROTULO[perfil.regime] ?? perfil.regime) : '');

	// --- E-mail pessoal (cadastro/troca com OTP; espelho local pós-sucesso) ---
	let alterandoEmail = $state(false);
	let emailPessoal = $state(untrack(() => data.perfil.email_pessoal ?? null));
	let emailPessoalVerificado = $state(untrack(() => !!data.perfil.email_pessoal_verificado));
</script>

<svelte:head><title>Meu perfil</title></svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="h1 text-2xl font-bold">Meu perfil</h1>
		<p class="text-sm text-surface-600 dark:text-surface-400 mt-1">
			Dados do seu cadastro. O e-mail pessoal é o único que você altera por aqui.
		</p>
	</div>

	<!-- Identificação (somente leitura) -->
	<section class="card-elevated rounded-2xl p-4 sm:p-6">
		<h2
			class="font-semibold text-sm uppercase tracking-wider text-surface-600 dark:text-surface-400 mb-4"
		>
			Identificação
		</h2>
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
			<div>
				<span class="label-text text-xs text-surface-600 dark:text-surface-400 block">Nome</span>
				<p class="font-semibold">{perfil.nome}</p>
			</div>
			<div>
				<span class="label-text text-xs text-surface-600 dark:text-surface-400 block"
					>Matrícula</span
				>
				<p class="font-semibold">{perfil.matricula}</p>
			</div>
			<div>
				<span class="label-text text-xs text-surface-600 dark:text-surface-400 block">Cargo</span>
				<p class="font-semibold">{perfil.cargo}</p>
			</div>
			<div>
				<span class="label-text text-xs text-surface-600 dark:text-surface-400 block"
					>E-mail funcional</span
				>
				<p class="font-semibold">{perfil.email || '—'}</p>
			</div>
			<div class="sm:col-span-2">
				<span class="label-text text-xs text-surface-600 dark:text-surface-400 block"
					>E-mail pessoal</span
				>
				<div class="flex items-center gap-2 flex-wrap">
					<p class="font-semibold">
						{emailPessoal || '—'}
						{#if emailPessoal}
							<span
								class="ml-1 text-3xs font-bold uppercase px-1.5 py-0.5 rounded {emailPessoalVerificado
									? 'bg-success-500/15 text-success-700 dark:text-success-400'
									: 'bg-warning-500/15 text-warning-700 dark:text-warning-400'}"
							>
								{emailPessoalVerificado ? 'Verificado' : 'Não verificado'}
							</span>
						{/if}
					</p>
					<button
						type="button"
						class="btn btn-sm preset-outlined-primary-500 text-xs"
						onclick={() => (alterandoEmail = true)}
					>
						{emailPessoal ? 'Alterar' : 'Cadastrar'}
					</button>
				</div>
				{#if emailPessoal}
					<p class="text-2xs text-surface-600 dark:text-surface-400 mt-1">
						A troca exige sua senha e um código enviado ao novo endereço.
					</p>
				{/if}
			</div>
		</div>
	</section>

	<!-- Chave de assinatura (passkey): responde "o que preciso ter cadastrado
	     para assinar?". Só existe na tela com a exigência ligada (ver
	     `cartaoChaveVisivel`). -->
	{#if cartaoChaveVisivel(page.data)}
		<CartaoPasskey credencialAtual={data.passkey} />
	{/if}

	<!-- Dados cadastrais: leitura, com o caminho da correção. -->
	<section class="card-elevated rounded-2xl p-4 sm:p-6">
		<h2
			class="font-semibold text-sm uppercase tracking-wider text-surface-600 dark:text-surface-400 mb-1"
		>
			Dados cadastrais
		</h2>
		<p class="text-xs text-surface-600 dark:text-surface-400 mb-4">
			Estes dados são mantidos pela administração. Encontrou algo desatualizado? Procure o
			<strong>administrador da sua unidade ou da sua seccional</strong>: é ele quem registra o
			pedido de correção, que passa pela aprovação do Administrador Geral.
		</p>

		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
			<div>
				<span class="label-text text-xs text-surface-600 dark:text-surface-400 block">Telefone</span
				>
				<p class="font-semibold tabular-nums">{telefone || '—'}</p>
			</div>
			<div>
				<span class="label-text text-xs text-surface-600 dark:text-surface-400 block">Classe</span>
				<p class="font-semibold">{perfil.classe || '—'}</p>
			</div>
			<div>
				<span class="label-text text-xs text-surface-600 dark:text-surface-400 block"
					>Regime de trabalho</span
				>
				<p class="font-semibold">{regime || '—'}</p>
			</div>
			<div>
				<span class="label-text text-xs text-surface-600 dark:text-surface-400 block">Lotação</span>
				<p class="font-semibold">{perfil.lotacao || '—'}</p>
			</div>
		</div>
	</section>
</div>

<ModalAlterarEmailPessoal
	bind:open={alterandoEmail}
	emailAtual={emailPessoal}
	onConfirmado={(novo) => {
		emailPessoal = novo;
		emailPessoalVerificado = true;
	}}
/>
