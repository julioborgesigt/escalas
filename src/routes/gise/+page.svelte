<script lang="ts">
	/**
	 * Lista de ESCALAS GISE — porta de entrada do módulo.
	 *
	 * Divide em dois blocos: as ATIVAS (tudo que não está `finalizada`, em cards
	 * grandes com o andamento de cada uma) e o HISTÓRICO, que só o Admin Geral
	 * vê, paginado. Para os demais papéis a página é um painel do que está
	 * acontecendo agora, não um arquivo.
	 *
	 * O que cada usuário recebe já vem filtrado pelo `load` (por vínculo:
	 * supervisor, membro, seccional participante) — esta tela não faz controle de
	 * acesso, só de apresentação.
	 *
	 * Também é ponto de assinatura: o supervisor pode assinar daqui os relatórios
	 * de extra pendentes sem abrir a escala, com rubrica ou token SERPRO. É por
	 * isso que uma tela de listagem importa `PainelAssinaturaToken` e
	 * `ModalRubrica`.
	 */
	import type { PageProps } from './$types';
	import Paginador from '$lib/components/Paginador.svelte';
	import { goto } from '$app/navigation';
	import { invalidateShared } from '$lib/cross-tab-invalidate';
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
	import { fmtDate, diaSemana } from '$lib/gise/formatters';
	import { rubricaValida, useInvalidateOnFocus } from '$lib/composables';
	import { fetchSyncEstado } from '$lib/sync-estado';
	import { MediaQuery } from 'svelte/reactivity';
	import { untrack } from 'svelte';

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
		/** Operação da escala; `null` só em linha anterior à migração 0048. */
		operacao_id?: number | null;
	};

	const { data }: PageProps = $props();

	const escalas = $derived((data.escalas as GiseEscala[]) ?? []);
	const isAdminGeral = $derived(!!data.isGeral);
	const isSeccional = $derived(!!data.isSeccional);
	const isUnidade = $derived(!!data.isUnidade);
	const isSupervisor = $derived(!!data.isSupervisor);
	const isMembro = $derived(!!data.isMembro);

	/**
	 * Filtro por OPERAÇÃO — a razão de a aba não ser mais "Escalas GISE".
	 *
	 * A GISE virou uma operação entre várias (CRAJUBAR, EDGE…), que podem estar
	 * ativas ao mesmo tempo. Em vez de uma aba por operação, uma aba só com este
	 * recorte: sem ele a lista mistura escalas de operações diferentes, com
	 * formulários e metas diferentes, sem nada que as distinga.
	 *
	 * É filtro de LEITURA, aplicado no cliente sobre a lista que a tela já recebe
	 * inteira. O escopo de quem vê o quê continua no servidor.
	 */
	const operacoes = $derived(data.operacoes ?? []);
	let filtroOperacaoId = $state<number | null>(null);
	const nomeDaOperacao = $derived(new Map(operacoes.map((o) => [o.id, o.sigla || o.nome])));

	const escalasFiltradas = $derived(
		filtroOperacaoId === null ? escalas : escalas.filter((e) => e.operacao_id === filtroOperacaoId)
	);

	const ativas = $derived(escalasFiltradas.filter((e) => e.status !== 'finalizada'));
	const historico = $derived(
		isAdminGeral ? escalasFiltradas.filter((e) => e.status === 'finalizada') : []
	);

	useInvalidateOnFocus('app:gise-list', {
		isHot: () => ativas.length > 0,
		probe: async () => {
			try {
				const e = await fetchSyncEstado();
				return e.giseList?.stamp ?? null;
			} catch {
				return null;
			}
		}
	});

	const seccionaisList = $derived(data.seccionaisList ?? []);
	const minhaSeccionalId = $derived(data.minhaSeccionalId ?? null);
	const supervisaoExtraUnidadeId = $derived(data.supervisaoExtraUnidadeId ?? null);
	// Rubrica salva do supervisor — reutilizada no modal aberto pelos cards (o
	// pad abria vazio porque a listagem não carregava a rubrica, só o detalhe).
	const minhaRubrica = $derived(rubricaValida(data.minhaRubrica));

	// A listagem não carrega o assinante de cada documento; aproxima a regra de
	// `podeBaixarComManifesto` (escala GISE e rel. da supervisão são assinados
	// pelo supervisor): Admin Geral/Super, ou supervisor DPC. O servidor segue
	// sendo quem decide — quem não passa lá recebe a cópia de conferência.
	const podeManifestoProvavel = $derived(
		page.data.usuario?.tipo === 'admin' || (isSupervisor && page.data.usuario?.cargo === 'DPC')
	);

	// MediaQuery (svelte/reactivity) substitui o matchMedia + listener manual;
	// fallback `true` = desktop-first no SSR, como o $state(true) anterior.
	const desktopQuery = new MediaQuery('(min-width: 768px)', true);
	const isDesktop = $derived(desktopQuery.current);

	const ITEMS_ATIVAS = 4;
	let paginaAtivas = $state(1);
	const totalPaginasAtivas = $derived(Math.max(1, Math.ceil(ativas.length / ITEMS_ATIVAS)));
	const ativasPaginadas = $derived(
		ativas.slice((paginaAtivas - 1) * ITEMS_ATIVAS, paginaAtivas * ITEMS_ATIVAS)
	);

	// Trocar o filtro de operação reinicia a paginação: manter a página 3 numa
	// lista que encolheu para 4 itens mostra tela vazia com "página 3 de 1".
	$effect(() => {
		filtroOperacaoId;
		untrack(() => (paginaAtivas = 1));
	});

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
				linhas: podeManifestoProvavel
					? [
							'Esta escala já foi assinada digitalmente.',
							'"Sem manifesto" gera o documento para impressão e distribuição.',
							'"Com manifesto" inclui a folha de auditoria (evidências da assinatura).'
						]
					: [
							'Esta escala já foi assinada digitalmente.',
							'O download gera o documento assinado para impressão e distribuição.'
						],
				acao: {
					label: podeManifestoProvavel ? 'Sem manifesto' : 'Baixar PDF',
					fn: () => {
						dialogInfo = null;
						window.open(`/api/gise/${ativa.id}/download?format=pdf`, '_blank');
					}
				},
				...(podeManifestoProvavel
					? {
							acaoSecundaria: {
								label: 'Com manifesto',
								fn: () => {
									dialogInfo = null;
									window.open(`/api/gise/${ativa.id}/download?format=pdf&manifesto=true`, '_blank');
								}
							}
						}
					: {})
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
					linhas: podeManifestoProvavel
						? [
								'Este relatório de serviço extraordinário já foi assinado digitalmente.',
								'"Sem manifesto" gera o documento para impressão e distribuição.',
								'"Com manifesto" inclui a folha de auditoria (evidências da assinatura).'
							]
						: [
								'Este relatório de serviço extraordinário já foi assinado digitalmente.',
								'O download gera o documento assinado para impressão e distribuição.'
							],
					acao: {
						label: podeManifestoProvavel ? 'Sem manifesto' : 'Baixar Rel. Extra',
						fn: () => {
							dialogInfo = null;
							window.open(
								`/api/gise/${giseId}/download?format=extraordinario&seccionalId=${supervisaoExtraUnidadeId}`,
								'_blank'
							);
						}
					},
					...(podeManifestoProvavel
						? {
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
							}
						: {})
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
					linhas: podeManifestoProvavel
						? [
								'Este relatório de serviço extraordinário já foi assinado digitalmente.',
								'"Sem manifesto" gera o documento para impressão e distribuição.',
								'"Com manifesto" inclui a folha de auditoria (evidências da assinatura).'
							]
						: [
								'Este relatório de serviço extraordinário já foi assinado digitalmente.',
								'O download gera o documento assinado para impressão e distribuição.'
							],
					acao: {
						label: podeManifestoProvavel ? 'Sem manifesto' : 'Baixar Rel. Extra',
						fn: () => {
							dialogInfo = null;
							window.open(
								`/api/gise/${giseId}/download?format=extraordinario&seccionalId=${minhaSeccionalId}`,
								'_blank'
							);
						}
					},
					...(podeManifestoProvavel
						? {
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
							}
						: {})
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
				await invalidateShared('app:gise-list');
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
				await invalidateShared('app:gise-list');
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
			const signerName = data.usuario?.nome ?? '';
			const signerCpf = data.usuario?.cpf ?? '';
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
			await invalidateShared('app:gise-list');
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
						class="text-xs font-bold px-2 py-0.5 rounded-full bg-tertiary-500/10 text-tertiary-700 dark:text-tertiary-400"
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
				class="btn w-full shrink-0 preset-filled-tertiary-500 text-white border-2 border-tertiary-600/30 hover:border-tertiary-600 px-4 py-2.5 text-sm font-medium transition-all sm:w-auto sm:py-2 rounded-xl"
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
			<p class="text-sm text-surface-600 dark:text-surface-400">
				Os formulários de produtividade estarão disponíveis nesta área.
			</p>
			{#if ativas.length > 0}
				<div class="mt-2 space-y-1">
					{#each ativas as ativa (ativa.id)}
						<p class="text-xs text-surface-600 dark:text-surface-400">
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

	<!-- Filtro por operação: a aba lista TODAS as operações juntas, e este é o
	     recorte para ver só uma. Só aparece com mais de uma operação — com uma
	     só, o filtro seria um controle que não filtra nada. -->
	{#if operacoes.length > 1}
		<div class="mb-4 flex flex-wrap items-center gap-2">
			<span
				class="text-3xs font-semibold uppercase tracking-widest text-surface-600 dark:text-surface-400"
			>
				Operação
			</span>
			<button
				type="button"
				class="rounded-full px-3 py-1 text-2xs font-semibold transition-colors {filtroOperacaoId ===
				null
					? 'bg-primary-500 text-white'
					: 'bg-surface-200 text-surface-700 dark:bg-surface-800 dark:text-surface-300'}"
				onclick={() => (filtroOperacaoId = null)}
			>
				Todas
			</button>
			{#each operacoes as op (op.id)}
				<button
					type="button"
					class="rounded-full px-3 py-1 text-2xs font-semibold transition-colors {filtroOperacaoId ===
					op.id
						? 'bg-primary-500 text-white'
						: 'bg-surface-200 text-surface-700 dark:bg-surface-800 dark:text-surface-300'}"
					onclick={() => (filtroOperacaoId = op.id)}
				>
					{op.sigla || op.nome}
				</button>
			{/each}
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
					operacaoNome={ativa.operacao_id ? (nomeDaOperacao.get(ativa.operacao_id) ?? '') : ''}
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
				<span class="text-xs text-surface-600 dark:text-surface-400">
					{ativas.length} escalas ativas — página {paginaAtivas} de {totalPaginasAtivas}
				</span>
				<Paginador
					count={ativas.length}
					pageSize={ITEMS_ATIVAS}
					page={paginaAtivas}
					onPageChange={(p) => (paginaAtivas = p)}
				/>
			</div>
		{/if}
	{:else if isAdminGeral || isSeccional || isUnidade || isSupervisor}
		<div
			class="rounded-2xl border border-dashed border-surface-300 dark:border-surface-700 p-4 sm:p-6 text-center"
		>
			<p class="text-surface-600 dark:text-surface-400">Nenhuma escala GISE ativa no momento.</p>
		</div>
	{/if}

	<SecaoHistorico {historico} {seccionaisList} {isAdminGeral} />
</div>

<ModalCriarGise
	bind:open={showCriarModal}
	{escalas}
	operacoes={operacoes.filter((o) => o.ativo)}
	onSuccess={(count, firstId) => {
		if (count === 1 && firstId) goto(`/gise/${firstId}?edit=true`);
	}}
/>

<ModalDownloadExtras
	bind:open={showDownloadExtrasModal}
	gise={giseParaDownloadExtras}
	supervisaoExtraUnidadeId={data.supervisaoExtraUnidadeId}
	podeManifesto={podeManifestoProvavel}
/>

<ModalRubrica
	open={mostrarRubricaGise}
	exigirFoto={page.data.exigirFotoAssinatura ?? true}
	exigirGps={page.data.exigirGpsAssinatura ?? true}
	exigirCodigoEmail={page.data.exigirCodigoEmailAssinatura ?? false}
	rubricaSalva={minhaRubrica}
	onConfirm={confirmarRubricaGise}
	onCancel={cancelarAssinatura}
/>

<div class="sr-only" aria-hidden="true">
	<PainelAssinaturaToken
		prepararUrl={tokenPrepararUrl}
		finalizarUrl={tokenFinalizarUrl}
		nomeArquivo={tokenNomeArquivo}
		signerName={data.usuario?.nome ?? ''}
		signerCpf={data.usuario?.cpf ?? ''}
		bind:control={painelTokenGiseControl}
		onSuccess={async () => {
			giseParaAssinar = null;
			await invalidateShared('app:gise-list');
		}}
	/>
</div>

<DialogInfo {dialogInfo} onClose={() => (dialogInfo = null)} />
