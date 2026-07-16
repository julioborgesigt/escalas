<script lang="ts">
	import type { PageProps } from './$types';
	import { Pagination } from '@skeletonlabs/skeleton-svelte';
	import { ChevronLeft, ChevronRight } from 'lucide-svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { toaster } from '$lib/toast';
	import { loading } from '$lib/loading.svelte';
	import { apiFetch, apiFetchResponse } from '$lib/api-fetch';
	import { baixarBlob } from '$lib/utils/download';
	import { digestHexParaBase64, executarFluxoAssinaturaToken } from '$lib/assinatura-token';
	import { conectarSerpro } from '$lib/serpro';
	import ModalRubrica from './[id]/_components/modais/ModalRubrica.svelte';
	import type { SignaturePadConfirmPayload } from '$lib/components/SignaturePadTypes';
	import PainelAssinaturaToken from '$lib/components/PainelAssinaturaToken.svelte';
	import CardGiseAtiva from './_components/CardGiseAtiva.svelte';
	import SecaoHistorico from './_components/SecaoHistorico.svelte';
	import ModalCriarGise from './_components/ModalCriarGise.svelte';
	import ModalDownloadExtras from './_components/ModalDownloadExtras.svelte';
	import DialogInfo from './_components/DialogInfo.svelte';
	import { fmtDate, diaSemana } from '$lib/gise/gise-formatters';

	type GiseEscala = {
		id: number;
		status: string;
		data_inicio: string;
		hora_entrada: string;
		hora_saida: string;
		totalSeccionais: number;
		seccionaisEnviadas: number;
		extrasPendentes: number;
		extrasPendentesIds: number[];
		assinaturasRelatorioExtra?: number;
		assinaturasRelatorioExtraIds?: number[];
		supervisor_id?: number | null;
		assessor_id?: number | null;
		seint1_id?: number | null;
		seint2_id?: number | null;
		temSaidaConfirmada?: boolean;
		seccionais?: { id: number; tipos?: string[]; nome?: string }[];
	};

	const { data }: PageProps = $props();

	const escalas = $derived((data.escalas as GiseEscala[]) ?? []);
	const isAdminGeral = $derived(!!data.isGeral);
	const isSeccional = $derived(!!data.isSeccional);
	const isUnidade = $derived(!!data.isUnidade);
	const isSupervisor = $derived(!!data.isSupervisor);
	const isMembro = $derived(!!data.isMembro);

	const ativas = $derived(escalas.filter((e) => e.status !== 'finalizada'));
	const historico = $derived(isAdminGeral ? escalas.filter((e) => e.status === 'finalizada') : []);

	const seccionaisList = $derived(data.seccionaisList ?? []);
	const minhaSeccionalId = $derived(data.minhaSeccionalId ?? null);
	const supervisaoExtraUnidadeId = $derived(data.supervisaoExtraUnidadeId ?? null);

	let isDesktop = $state(true);
	$effect(() => {
		const mql = window.matchMedia('(min-width: 768px)');
		isDesktop = mql.matches;
		const handler = (e: MediaQueryListEvent) => (isDesktop = e.matches);
		mql.addEventListener('change', handler);
		return () => mql.removeEventListener('change', handler);
	});

	const ITEMS_ATIVAS = 4;
	let paginaAtivas = $state(1);
	const totalPaginasAtivas = $derived(Math.max(1, Math.ceil(ativas.length / ITEMS_ATIVAS)));
	const ativasPaginadas = $derived(
		ativas.slice((paginaAtivas - 1) * ITEMS_ATIVAS, paginaAtivas * ITEMS_ATIVAS)
	);

	let menuExpandidoId = $state<number | null>(null);
	let showCriarModal = $state(false);

	// --- Download de Extras ---
	let showDownloadExtrasModal = $state(false);
	let giseParaDownloadExtras = $state<GiseEscala | null>(null);

	// --- Assinatura rápida inline ---
	type GiseParaAssinar = {
		id: number;
		dataInicio: string;
		tipo: 'escala' | 'extra';
		pendentesExtraIds: number[];
	};

	let giseParaAssinar = $state<GiseParaAssinar | null>(null);
	let mostrarRubricaGise = $state(false);
	let painelTokenGiseControl = $state<{ assinarComSerpro: () => Promise<void> } | null>(null);

	const tokenPrepararUrl = $derived(
		giseParaAssinar?.tipo === 'escala' ? `/api/gise/${giseParaAssinar.id}/preparar-assinatura` : ''
	);
	const tokenFinalizarUrl = $derived(
		giseParaAssinar?.tipo === 'escala' ? `/api/gise/${giseParaAssinar.id}/finalizar-assinatura` : ''
	);
	const tokenNomeArquivo = $derived(
		giseParaAssinar?.dataInicio
			? `gise_${giseParaAssinar.dataInicio}_confirmada.pdf`
			: 'gise_confirmada.pdf'
	);

	function iniciarAssinaturaEscala(ativa: (typeof ativas)[0]) {
		giseParaAssinar = {
			id: ativa.id,
			dataInicio: ativa.data_inicio,
			tipo: 'escala',
			pendentesExtraIds: []
		};
		if (isDesktop) {
			setTimeout(() => painelTokenGiseControl?.assinarComSerpro(), 0);
		} else {
			mostrarRubricaGise = true;
		}
	}

	function iniciarAssinaturaExtra(ativa: (typeof ativas)[0]) {
		giseParaAssinar = {
			id: ativa.id,
			dataInicio: ativa.data_inicio,
			tipo: 'extra',
			pendentesExtraIds: ativa.extrasPendentesIds
		};
		if (isDesktop) {
			// Desktop assina direto com o token SERPRO, espelhando o fluxo da
			// escala. (Antes ligava um flag de modal que nenhum template consumia,
			// então o clique não fazia nada.)
			void assinarExtrasComSerpro();
		} else {
			mostrarRubricaGise = true;
		}
	}

	function cancelarAssinatura() {
		mostrarRubricaGise = false;
		giseParaAssinar = null;
	}

	// --- Dialog informativo ---
	type DialogInfoType = {
		titulo: string;
		linhas: string[];
		acao?: { label: string; fn: () => void };
		acaoSecundaria?: { label: string; fn: () => void };
	};
	let dialogInfo = $state<DialogInfoType | null>(null);

	function clicarAssEscala(ativa: (typeof ativas)[0]) {
		if (ativa.status === 'aguardando_assinatura') {
			iniciarAssinaturaEscala(ativa);
			return;
		}
		let linhas: string[];
		if (ativa.status === 'em_definicao_supervisor') {
			linhas = [
				'O supervisor ainda não foi definido para esta escala.',
				'Aguarde a definição para liberar a assinatura.'
			];
		} else if (ativa.status === 'em_preenchimento') {
			const faltam = ativa.totalSeccionais - ativa.seccionaisEnviadas;
			linhas = [
				`Faltam ${faltam} de ${ativa.totalSeccionais} seccional(is) enviarem seus relatórios.`,
				'A assinatura será liberada quando todas as seccionais concluírem o envio.'
			];
		} else if (
			[
				'em_andamento',
				'aguardando_relatorios',
				'aguardando_assinatura_relat',
				'pronta_para_finalizar',
				'finalizada'
			].includes(ativa.status)
		) {
			dialogInfo = {
				titulo: 'Escala Assinada',
				linhas: [
					'Esta escala já foi assinada digitalmente.',
					'Para fazer o download do PDF oficial, clique no botão "Opções" do card desta escala e selecione "Escala PDF".'
				]
			};
			return;
		} else {
			linhas = ['A assinatura da escala não está disponível no momento.'];
		}
		dialogInfo = { titulo: 'Ass. Escala — Indisponível', linhas };
	}

	function clicarAssExtra(ativa: (typeof ativas)[0]) {
		const temSupervisao = !!(
			ativa.supervisor_id ||
			ativa.assessor_id ||
			ativa.seint1_id ||
			ativa.seint2_id
		);
		const totalExtras = ativa.totalSeccionais + (temSupervisao ? 1 : 0);
		const prontos = ativa.extrasPendentes;

		if (prontos > 0) {
			const jaAssinados = ativa.assinaturasRelatorioExtra ?? 0;
			const ainda = totalExtras - prontos - jaAssinados;
			const linhas: string[] = [
				`Serão assinados ${prontos} relatório(s) de extra que já estão prontos.`,
				...(ainda > 0 ? [`Ainda faltam ${ainda} relatório(s) com saída não confirmada.`] : []),
				...(jaAssinados > 0
					? [`${jaAssinados} relatório(s) já foram assinados anteriormente.`]
					: [])
			];
			dialogInfo = {
				titulo: `Ass. Extra (${prontos}/${totalExtras})`,
				linhas,
				acao: {
					label: `Assinar ${prontos} relatório(s)`,
					fn: () => {
						dialogInfo = null;
						iniciarAssinaturaExtra(ativa);
					}
				}
			};
			return;
		}

		let linhas: string[];
		const jaAssinados = ativa.assinaturasRelatorioExtra ?? 0;
		if (jaAssinados >= totalExtras) {
			linhas = ['Todos os relatórios de extra já foram assinados.'];
		} else if (!ativa.temSaidaConfirmada) {
			linhas = [
				'Nenhuma saída foi confirmada ainda.',
				'Os relatórios de extra só ficam disponíveis após a confirmação de saída de cada policial.'
			];
		} else {
			const pendSaida = totalExtras - jaAssinados;
			linhas = [
				`${pendSaida} relatório(s) ainda aguardam confirmação de saída dos policiais.`,
				'Acompanhe o andamento na página de detalhes da escala.'
			];
		}
		dialogInfo = { titulo: `Ass. Extra (0/${totalExtras})`, linhas };
	}

	function handleEscalaPdf(ativa: (typeof ativas)[0]) {
		const escalaAssinada = [
			'em_andamento',
			'aguardando_relatorios',
			'aguardando_assinatura_relat',
			'pronta_para_finalizar',
			'finalizada'
		].includes(ativa.status);

		if (escalaAssinada) {
			dialogInfo = {
				titulo: 'Download de Escala Assinada',
				linhas: [
					'Esta escala já foi assinada digitalmente.',
					'"Sem manifesto" gera o documento para impressão e distribuição.',
					'"Com manifesto" inclui a folha de auditoria (evidências da assinatura).'
				],
				acao: {
					label: 'Sem manifesto',
					fn: () => {
						dialogInfo = null;
						window.open(`/api/gise/${ativa.id}/download?format=pdf`, '_blank');
					}
				},
				acaoSecundaria: {
					label: 'Com manifesto',
					fn: () => {
						dialogInfo = null;
						window.open(`/api/gise/${ativa.id}/download?format=pdf&manifesto=true`, '_blank');
					}
				}
			};
		} else {
			dialogInfo = {
				titulo: 'Download de Escala não Assinada',
				linhas: [
					'Esta escala ainda não foi assinada digitalmente pelo supervisor.',
					'O download será de uma via preliminar (sem assinaturas).'
				],
				acao: {
					label: 'Confirmar Download',
					fn: () => {
						dialogInfo = null;
						window.open(`/api/gise/${ativa.id}/download?format=pdf`, '_blank');
					}
				}
			};
		}
	}

	function handleExtraPdf(ativa: GiseEscala) {
		if (isAdminGeral && !isSupervisor && !isSeccional) {
			giseParaDownloadExtras = ativa;
			showDownloadExtrasModal = true;
			return;
		}
		const giseId = ativa.id;
		if (isSupervisor && supervisaoExtraUnidadeId) {
			const isAssinado = !!ativa.assinaturasRelatorioExtraIds?.includes(supervisaoExtraUnidadeId);
			if (isAssinado) {
				dialogInfo = {
					titulo: 'Download de Relatório de Extra Assinado',
					linhas: [
						'Este relatório de serviço extraordinário já foi assinado digitalmente.',
						'"Sem manifesto" gera o documento para impressão e distribuição.',
						'"Com manifesto" inclui a folha de auditoria (evidências da assinatura).'
					],
					acao: {
						label: 'Sem manifesto',
						fn: () => {
							dialogInfo = null;
							window.open(
								`/api/gise/${giseId}/download?format=extraordinario&seccionalId=${supervisaoExtraUnidadeId}`,
								'_blank'
							);
						}
					},
					acaoSecundaria: {
						label: 'Com manifesto',
						fn: () => {
							dialogInfo = null;
							window.open(
								`/api/gise/${giseId}/download?format=extraordinario&seccionalId=${supervisaoExtraUnidadeId}&manifesto=true`,
								'_blank'
							);
						}
					}
				};
			} else {
				dialogInfo = {
					titulo: 'Download de Relatório de Extra não Assinado',
					linhas: [
						'Este relatório de serviço extraordinário ainda não foi assinado digitalmente.',
						'O download será de uma via preliminar (sem assinaturas).'
					],
					acao: {
						label: 'Confirmar Download',
						fn: () => {
							dialogInfo = null;
							window.open(
								`/api/gise/${giseId}/download?format=extraordinario&seccionalId=${supervisaoExtraUnidadeId}`,
								'_blank'
							);
						}
					}
				};
			}
			return;
		}
		if (isSeccional && minhaSeccionalId) {
			const isAssinado = !!ativa.assinaturasRelatorioExtraIds?.includes(minhaSeccionalId);
			if (isAssinado) {
				dialogInfo = {
					titulo: 'Download de Relatório de Extra Assinado',
					linhas: [
						'Este relatório de serviço extraordinário já foi assinado digitalmente.',
						'"Sem manifesto" gera o documento para impressão e distribuição.',
						'"Com manifesto" inclui a folha de auditoria (evidências da assinatura).'
					],
					acao: {
						label: 'Sem manifesto',
						fn: () => {
							dialogInfo = null;
							window.open(
								`/api/gise/${giseId}/download?format=extraordinario&seccionalId=${minhaSeccionalId}`,
								'_blank'
							);
						}
					},
					acaoSecundaria: {
						label: 'Com manifesto',
						fn: () => {
							dialogInfo = null;
							window.open(
								`/api/gise/${giseId}/download?format=extraordinario&seccionalId=${minhaSeccionalId}&manifesto=true`,
								'_blank'
							);
						}
					}
				};
			} else {
				dialogInfo = {
					titulo: 'Download de Relatório de Extra não Assinado',
					linhas: [
						'Este relatório de serviço extraordinário ainda não foi assinado digitalmente.',
						'O download será de uma via preliminar (sem assinaturas).'
					],
					acao: {
						label: 'Confirmar Download',
						fn: () => {
							dialogInfo = null;
							window.open(
								`/api/gise/${giseId}/download?format=extraordinario&seccionalId=${minhaSeccionalId}`,
								'_blank'
							);
						}
					}
				};
			}
			return;
		}
		dialogInfo = {
			titulo: 'Extra PDF — Indisponível',
			linhas: [
				'Não foi possível determinar qual relatório baixar. Entre na escala para acessar os relatórios.'
			]
		};
	}

	async function confirmarRubricaGise(payload: SignaturePadConfirmPayload) {
		const {
			rubrica,
			lat,
			lng,
			selfie,
			codigoEmail: codigo,
			desafioId,
			// Resultado do desafio ativo (head_turn/smile) capturado pelo SignaturePad.
			// Quando a flag exigirFotoAssinatura esta ligada no servidor, este
			// campo e OBRIGATORIO — sem ele o endpoint retorna 400 "Comprovacao
			// de presenca ativa ausente (liveness challenge)".
			liveness: livenessChallenge
		} = payload;
		const gise = giseParaAssinar;
		if (!gise) return;
		mostrarRubricaGise = false;
		loading.show('Assinando...');
		try {
			if (gise.tipo === 'escala') {
				const r = await apiFetchResponse(`/api/gise/${gise.id}/assinar-simples`, {
					method: 'POST',
					body: JSON.stringify({
						rubrica,
						latitude: lat,
						longitude: lng,
						selfieBase64: selfie,
						codigoValidação: codigo,
						desafioId,
						livenessChallenge
					})
				});
				baixarBlob(await r.blob(), tokenNomeArquivo);
				toaster.success({ title: 'Escala GISE assinada com sucesso' });
				await invalidateAll();
			} else {
				for (const seccionalId of gise.pendentesExtraIds) {
					await apiFetch(`/api/gise/${gise.id}/relatorios/${seccionalId}/assinar`, {
						method: 'POST',
						body: JSON.stringify({
							tipo: 'extraordinario',
							rubrica,
							latitude: lat,
							longitude: lng,
							selfieBase64: selfie,
							codigoValidação: codigo,
							desafioId,
							livenessChallenge
						})
					});
				}
				toaster.success({
					title: `${gise.pendentesExtraIds.length} relatório(s) de extra assinado(s)`
				});
				await invalidateAll();
			}
		} catch (e: unknown) {
			toaster.error({
				title: 'Erro ao assinar',
				description: e instanceof Error ? e.message : String(e)
			});
		} finally {
			loading.hide();
			giseParaAssinar = null;
		}
	}

	async function assinarExtrasComSerpro() {
		const gise = giseParaAssinar;
		if (!gise || gise.pendentesExtraIds.length === 0) return;
		try {
			const client = await conectarSerpro();
			loading.show('Conectando ao Assinador SERPRO...');
			const signerName = (data as { usuario?: { nome?: string } }).usuario?.nome ?? '';
			const signerCpf = (data as { usuario?: { cpf?: string } }).usuario?.cpf ?? '';
			for (let i = 0; i < gise.pendentesExtraIds.length; i++) {
				const seccionalId = gise.pendentesExtraIds[i];
				loading.show(`Preparando PDF ${i + 1} de ${gise.pendentesExtraIds.length}...`);
				await executarFluxoAssinaturaToken({
					prepararUrl: `/api/gise/${gise.id}/relatorios/${seccionalId}/preparar-assinatura`,
					finalizarUrl: `/api/gise/${gise.id}/relatorios/${seccionalId}/finalizar-assinatura`,
					payloadPreparar: { signerName, signerCpf, rubrica: null },
					obterAssinatura: async (prep) => {
						loading.show(`Assinando ${i + 1} de ${gise.pendentesExtraIds.length}...`);
						const serproRes = await client.sign(digestHexParaBase64(prep.messageDigest));
						return { serproCms: serproRes.rawSignature };
					},
					payloadFinalizar: { signerName, signerCpf },
					onFinalizando: () =>
						loading.show(`Finalizando ${i + 1} de ${gise.pendentesExtraIds.length}...`)
				});
			}
			toaster.success({
				title: `${gise.pendentesExtraIds.length} relatório(s) assinado(s) com token`
			});
			await invalidateAll();
		} catch (e: unknown) {
			toaster.error({
				title: 'Erro ao assinar com token',
				description: e instanceof Error ? e.message : String(e)
			});
		} finally {
			loading.hide();
			giseParaAssinar = null;
		}
	}
</script>

<svelte:head>
	<title>Escalas GISE - Portal de Escalas</title>
</svelte:head>

<div class="min-w-0 space-y-6">
	<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
		<div class="min-w-0">
			<h1 class="h1 text-2xl font-bold">Escala GISE</h1>
			<div class="mt-0.5 flex flex-wrap gap-x-2 gap-y-1 items-center">
				{#if isAdminGeral}
					<span
						class="text-xs font-bold px-2 py-0.5 rounded-full bg-primary-500/10 text-primary-700 dark:text-primary-400"
						>Admin Geral</span
					>
				{/if}
				{#if isSeccional}
					<span
						class="text-xs font-bold px-2 py-0.5 rounded-full bg-secondary-500/10 text-secondary-700 dark:text-secondary-400"
						>Adm Seccional</span
					>
				{/if}
				{#if isUnidade}
					<span
						class="text-xs font-bold px-2 py-0.5 rounded-full bg-info-500/10 text-info-700 dark:text-info-400"
						>Adm Unidade</span
					>
				{/if}
				{#if isSupervisor}
					<span
						class="text-xs font-bold px-2 py-0.5 rounded-full bg-warning-500/10 text-warning-700 dark:text-warning-400"
						>Supervisor</span
					>
				{/if}
				{#if isMembro && !isSupervisor}
					<span
						class="text-xs font-bold px-2 py-0.5 rounded-full bg-success-500/10 text-success-700 dark:text-success-400"
						>Membro</span
					>
				{/if}
			</div>
		</div>

		{#if isAdminGeral}
			<button
				type="button"
				class="btn w-full shrink-0 preset-filled-tertiary-500 border-2 border-tertiary-600/30 hover:border-tertiary-600 px-4 py-2.5 text-sm font-medium transition-all sm:w-auto sm:py-2 rounded-xl"
				onclick={() => (showCriarModal = true)}
			>
				+ Nova Escala GISE
			</button>
		{/if}
	</div>

	{#if isMembro && !isAdminGeral && !isSeccional && !isUnidade && !isSupervisor}
		<div
			class="rounded-2xl border border-primary-500/20 bg-primary-500/5 dark:bg-primary-500/10 p-4 sm:p-6 text-center space-y-2"
		>
			<p class="text-base font-semibold text-surface-900 dark:text-surface-100">
				Você está escalado na GISE
			</p>
			<p class="text-sm text-surface-500 dark:text-surface-400">
				Os formulários de produtividade estarão disponíveis nesta área.
			</p>
			{#if ativas.length > 0}
				<div class="mt-2 space-y-1">
					{#each ativas as ativa (ativa.id)}
						<p class="text-xs text-surface-500 dark:text-surface-400">
							Escala vigente: <span class="font-medium"
								>{diaSemana(ativa.data_inicio)}
								{fmtDate(ativa.data_inicio)}</span
							>
						</p>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	{#if ativas.length > 0 && (isAdminGeral || isSeccional || isUnidade || isSupervisor || !isMembro)}
		<h2 class="text-base font-semibold text-surface-700 dark:text-surface-300 mb-2">
			Escalas Ativas
		</h2>
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			{#each ativasPaginadas as ativa (ativa.id)}
				<CardGiseAtiva
					{ativa}
					{isSupervisor}
					{isDesktop}
					usuario={data.usuario}
					{menuExpandidoId}
					onAssEscala={() => clicarAssEscala(ativa)}
					onAssExtra={() => clicarAssExtra(ativa)}
					onEscalaPdf={() => handleEscalaPdf(ativa)}
					onExtraPdf={() => handleExtraPdf(ativa)}
					onToggleMenu={() => (menuExpandidoId = menuExpandidoId === ativa.id ? null : ativa.id)}
				/>
			{/each}
		</div>
		{#if totalPaginasAtivas > 1}
			<div
				class="mt-3 pt-3 border-t border-surface-200 dark:border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3"
			>
				<span class="text-xs text-surface-500">
					{ativas.length} escalas ativas — página {paginaAtivas} de {totalPaginasAtivas}
				</span>
				<Pagination
					count={ativas.length}
					pageSize={ITEMS_ATIVAS}
					page={paginaAtivas}
					onPageChange={(e) => (paginaAtivas = e.page)}
					siblingCount={1}
				>
					<Pagination.PrevTrigger
						class="btn btn-sm preset-outlined-surface-500"
						aria-label="Página anterior"><ChevronLeft size={16} /></Pagination.PrevTrigger
					>
					<Pagination.Context>
						{#snippet children(pagination)}
							{#each pagination().pages as p, index (p)}
								{#if p.type === 'page'}
									<Pagination.Item
										{...p}
										class="btn btn-sm min-w-[32px] {p.value === paginaAtivas
											? 'preset-filled-primary-500'
											: 'preset-outlined-surface-500'}">{p.value}</Pagination.Item
									>
								{:else}
									<Pagination.Ellipsis {index} class="px-1 opacity-50">&#8230;</Pagination.Ellipsis>
								{/if}
							{/each}
						{/snippet}
					</Pagination.Context>
					<Pagination.NextTrigger
						class="btn btn-sm preset-outlined-surface-500"
						aria-label="Próxima página"><ChevronRight size={16} /></Pagination.NextTrigger
					>
				</Pagination>
			</div>
		{/if}
	{:else if isAdminGeral || isSeccional || isUnidade || isSupervisor}
		<div
			class="rounded-2xl border border-dashed border-surface-300 dark:border-surface-700 p-4 sm:p-6 text-center"
		>
			<p class="text-surface-500 dark:text-surface-400">Nenhuma escala GISE ativa no momento.</p>
		</div>
	{/if}

	<SecaoHistorico {historico} {seccionaisList} {isAdminGeral} />
</div>

<ModalCriarGise
	bind:open={showCriarModal}
	{escalas}
	onSuccess={(count, firstId) => {
		if (count === 1 && firstId) goto(`/gise/${firstId}?edit=true`);
	}}
/>

<ModalDownloadExtras
	bind:open={showDownloadExtrasModal}
	gise={giseParaDownloadExtras}
	supervisaoExtraUnidadeId={data.supervisaoExtraUnidadeId}
/>

<ModalRubrica
	open={mostrarRubricaGise}
	exigirFoto={page.data.exigirFotoAssinatura ?? true}
	exigirGps={page.data.exigirGpsAssinatura ?? true}
	exigirCodigoEmail={page.data.exigirCodigoEmailAssinatura ?? false}
	onConfirm={confirmarRubricaGise}
	onCancel={cancelarAssinatura}
/>

<div class="sr-only" aria-hidden="true">
	<PainelAssinaturaToken
		prepararUrl={tokenPrepararUrl}
		finalizarUrl={tokenFinalizarUrl}
		nomeArquivo={tokenNomeArquivo}
		signerName={(data as { usuario?: { nome?: string } }).usuario?.nome ?? ''}
		signerCpf={(data as { usuario?: { cpf?: string } }).usuario?.cpf ?? ''}
		bind:control={painelTokenGiseControl}
		onSuccess={async () => {
			giseParaAssinar = null;
			await invalidateAll();
		}}
	/>
</div>

<DialogInfo {dialogInfo} onClose={() => (dialogInfo = null)} />
