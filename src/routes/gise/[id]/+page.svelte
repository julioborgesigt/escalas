<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { untrack } from 'svelte';
	import { toaster } from '$lib/toast';
	import { initWebPKI, listarCertificados, assinarHash, lerCertificado, type WebPKICertificate } from '$lib/webpki';
	import { conectarSerpro, type SerproSignerClient } from '$lib/serpro';

	let { data } = $props();

	const gise = $derived(data.gise);
	const policiais = $derived(data.policiais ?? []);
	const todasUnidades = $derived(data.todasUnidades ?? []);
	const papelGise = $derived(data.papelGise);
	const minhaSeccionalId = $derived(data.minhaSeccionalId);

	const isAdminGeral = $derived(papelGise === 'admin_geral');
	const isSeccional = $derived(papelGise === 'admin_seccional');
	const isSupervisor = $derived(papelGise === 'supervisor');

	// Minha seccional (para Admin Seccional)
	const minhaSeccional = $derived(
		isSeccional ? gise?.seccionais?.find((s: any) => s.seccional_id === minhaSeccionalId) : null
	);

	// Estado de UI
	let salvando = $state(false);
	let assinando = $state(false);
	let finalizando = $state(false);
	let showFinalizarConfirm = $state(false);

	// Edição de supervisores (Admin Geral / Admin Seccional)
	let editandoSupervisores = $state(false);
	let supSabadoId = $state<number | null>(null);
	let supDomingoId = $state<number | null>(null);

	// Equipe selecionada para adicionar membro
	let equipeParaAdicionar = $state<number | null>(null);
	let policialParaAdicionar = $state<number | ''>('');
	let diaParaAdicionar = $state<'sabado' | 'domingo' | 'ambos'>('ambos');

	// Edição de slots de equipe
	let editandoEquipe = $state<number | null>(null);
	let editSlotsDpc = $state(0);
	let editSlotsOip = $state(0);

	// Reabrir escala
	let reabrindo = $state(false);
	let showReabrirConfirm = $state(false);

	// Adicionar equipe
	let adicionandoEquipeSec = $state<number | null>(null);
	let novaEquipeTipo = $state<'operacional' | 'seint'>('operacional');
	let novaEquipeDpc = $state(1);
	let novaEquipeOip = $state(3);

	// Unidade operacional (Admin Seccional)
	let unidadeOperacionalId = $state<number | null>(null);

	$effect(() => {
		if (gise) {
			supSabadoId = gise.supervisor_sabado_id ?? null;
			supDomingoId = gise.supervisor_domingo_id ?? null;
			if (minhaSeccional) {
				unidadeOperacionalId = minhaSeccional.unidade_operacional_id ?? null;
			}
		}
	});

	function statusLabel(status: string) {
		const m: Record<string, string> = {
			em_preenchimento: 'Em Preenchimento',
			aguardando_assinatura: 'Aguardando Assinatura',
			assinada: 'Assinada',
			finalizada: 'Finalizada'
		};
		return m[status] ?? status;
	}
	function statusColor(status: string) {
		const m: Record<string, string> = {
			em_preenchimento: 'bg-warning-500/15 text-warning-700 dark:text-warning-400',
			aguardando_assinatura: 'bg-primary-500/15 text-primary-700 dark:text-primary-400',
			assinada: 'bg-success-500/15 text-success-700 dark:text-success-400',
			finalizada: 'bg-surface-500/15 text-surface-600 dark:text-surface-400'
		};
		return m[status] ?? '';
	}
	function fmtDate(iso: string) {
		const [y, m, d] = iso.split('-');
		return `${d}/${m}/${y}`;
	}

	const dpcs = $derived(policiais.filter((p: any) => p.cargo === 'DPC'));

	async function salvarSupervisores() {
		salvando = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					supervisor_sabado_id: supSabadoId,
					supervisor_domingo_id: supDomingoId
				})
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			toaster.success({ title: 'Supervisores salvos' });
			editandoSupervisores = false;
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvando = false;
		}
	}

	async function salvarUnidadeOperacional(secId: number) {
		salvando = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}/seccionais/${secId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ unidade_operacional_id: unidadeOperacionalId })
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			toaster.success({ title: 'Unidade operacional salva' });
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvando = false;
		}
	}

	async function adicionarMembro(secId: number) {
		if (!equipeParaAdicionar || !policialParaAdicionar) return;
		salvando = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}/seccionais/${secId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					adicionar_membro: {
						equipe_id: equipeParaAdicionar,
						policial_id: Number(policialParaAdicionar),
						dia: diaParaAdicionar
					}
				})
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			toaster.success({ title: 'Membro adicionado' });
			equipeParaAdicionar = null;
			policialParaAdicionar = '';
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvando = false;
		}
	}

	async function removerMembro(memId: number) {
		try {
			const res = await fetch(`/api/gise/${gise.id}/membros/${memId}`, { method: 'DELETE' });
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		}
	}

	async function finalizarSeccional(secId: number) {
		salvando = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}/seccionais/${secId}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '{}'
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			if (json.gise_status === 'aguardando_assinatura') {
				toaster.success({ title: 'Todas as seccionais finalizadas!', description: 'Escala aguardando assinatura do Supervisor.' });
			} else {
				toaster.success({ title: 'Seccional finalizada', description: 'Aguardando demais seccionais.' });
			}
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvando = false;
		}
	}

	// === Documento assinado ===
	let documentoAssinadoInfo = $state<{ existe: boolean; assinante_nome?: string; assinante_cpf?: string; data?: string } | null>(null);
	let assinandoSimples = $state(false);
	let etapaAssinatura = $state('');

	// Web PKI
	let certificados = $state<WebPKICertificate[]>([]);
	let certSelecionado = $state('');
	let lendoCertificados = $state(false);
	let tentouLerCertificados = $state(false);
	let pkInstance = $state<any>(null);

	// SERPRO
	let serproClient = $state<SerproSignerClient | null>(null);
	let serproSignerName = $state(untrack(() => data.usuario?.nome ?? ''));
	let serproSignerCpf = $state('');

	// Carregar info do documento ao montar
	$effect(() => {
		if (gise?.id) {
			fetch(`/api/gise/${gise.id}/documento-assinado/info`)
				.then(r => r.ok ? r.json() : null)
				.then(info => {
					if (info?.existe) documentoAssinadoInfo = info;
					else documentoAssinadoInfo = null;
				})
				.catch(() => {});
		}
	});

	async function assinarSimples() {
		assinandoSimples = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}/assinar-simples`, { method: 'POST' });
			if (!res.ok) {
				const err = await res.json();
				throw new Error(err.error || 'Erro ao confirmar escala');
			}
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'gise_confirmada.pdf';
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
			documentoAssinadoInfo = { existe: true, assinante_nome: data.usuario?.nome || 'Supervisor' };
			toaster.success({ title: 'Escala assinada e PDF gerado!' });
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			assinandoSimples = false;
		}
	}

	async function carregarCertificadosLocais() {
		lendoCertificados = true;
		tentouLerCertificados = false;
		try {
			const pki = pkInstance || (await initWebPKI());
			pkInstance = pki;
			certificados = await listarCertificados(pki);
			if (certificados.length === 1) {
				certSelecionado = certificados[0].thumbprint;
				serproSignerName = certificados[0].subjectName;
				serproSignerCpf = certificados[0].cpf || '';
			}
		} catch (err) {
			toaster.error({ title: err instanceof Error ? err.message : 'Erro ao inicializar Web PKI' });
		} finally {
			lendoCertificados = false;
			tentouLerCertificados = true;
		}
	}

	async function finalizarEBaixarPdfGise(
		signerName: string,
		signerCpf: string,
		getSignature: (hash: string) => Promise<{ rawSignature: string; certificateBase64: string }>
	) {
		etapaAssinatura = 'Gerando PDF e preparando assinatura...';
		const prepRes = await fetch(`/api/gise/${gise.id}/preparar-assinatura`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ signerName, signerCpf })
		});
		if (!prepRes.ok) { const err = await prepRes.json(); throw new Error(err.error || 'Erro ao preparar PDF'); }
		const { signedAttrsHashHex, preparedPdf, messageDigest, signingTimeISO, verificationHash } = await prepRes.json();

		const { rawSignature, certificateBase64 } = await getSignature(signedAttrsHashHex);

		etapaAssinatura = 'Finalizando PDF assinado...';
		const finRes = await fetch(`/api/gise/${gise.id}/finalizar-assinatura`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ preparedPdf, rawSignature, certificateBase64, messageDigest, signingTimeISO, signerName, signerCpf, verificationHash })
		});
		if (!finRes.ok) { const err = await finRes.json(); throw new Error(err.error || 'Erro ao finalizar assinatura'); }

		etapaAssinatura = 'Baixando PDF assinado...';
		const blob = await finRes.blob();
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = finRes.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'gise_assinada.pdf';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		documentoAssinadoInfo = { existe: true, assinante_nome: signerName, assinante_cpf: signerCpf, data: new Date().toISOString() };
	}

	async function assinarComWebPKI() {
		if (certificados.length === 0) {
			assinando = true;
			etapaAssinatura = 'Conectando ao Web PKI...';
			await carregarCertificadosLocais();
			assinando = false;
			etapaAssinatura = '';
			if (certificados.length === 0) return;
			if (certificados.length > 1) { toaster.warning({ title: 'Selecione um dos certificados carregados' }); return; }
		}
		if (!certSelecionado) { toaster.error({ title: 'Selecione um certificado' }); return; }
		assinando = true;
		try {
			const pki = await initWebPKI();
			const cert = certificados.find(c => c.thumbprint === certSelecionado);
			etapaAssinatura = 'Lendo certificado...';
			const certificateBase64 = await lerCertificado(pki, certSelecionado);
			await finalizarEBaixarPdfGise(
				cert?.subjectName ?? '',
				cert?.cpf ?? '',
				async (hash) => {
					etapaAssinatura = 'Aguardando assinatura no eToken (digite o PIN)...';
					const rawSignature = await assinarHash(pki, certSelecionado, hash);
					return { rawSignature, certificateBase64 };
				}
			);
			toaster.success({ title: 'PDF assinado com sucesso!' });
			await invalidateAll();
		} catch (err) {
			toaster.error({ title: err instanceof Error ? err.message : 'Erro na assinatura' });
		} finally {
			assinando = false;
			etapaAssinatura = '';
		}
	}

	async function assinarComSerpro() {
		assinando = true;
		etapaAssinatura = 'Conectando ao Assinador SERPRO...';
		try {
			const client = serproClient ?? (await conectarSerpro());
			serproClient = client;

			etapaAssinatura = 'Gerando PDF e preparando assinatura...';
			const prepRes = await fetch(`/api/gise/${gise.id}/preparar-assinatura`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ signerName: serproSignerName || undefined, signerCpf: serproSignerCpf || undefined })
			});
			if (!prepRes.ok) { const err = await prepRes.json(); throw new Error(err.error || 'Erro ao preparar PDF'); }
			const { preparedPdf, messageDigest: messageDigestHex, verificationHash } = await prepRes.json();

			const messageDigestBase64 = btoa(
				messageDigestHex.match(/.{2}/g)!.map((h: string) => String.fromCharCode(parseInt(h, 16))).join('')
			);

			etapaAssinatura = 'Selecione o certificado e assine no Assinador SERPRO...';
			const result = await client.sign(messageDigestBase64);
			const serproCms = result.rawSignature;
			const certName = result.signerAlias?.replace(/:[\d]+$/, '').trim();
			const certCpfMatch = result.signerAlias?.match(/:([\d]{11})$/);
			const certCpf = certCpfMatch ? certCpfMatch[1] : '';

			etapaAssinatura = 'Finalizando PDF assinado...';
			const finRes = await fetch(`/api/gise/${gise.id}/finalizar-assinatura`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ preparedPdf, serproCms, signerName: certName || serproSignerName, signerCpf: certCpf || serproSignerCpf, verificationHash })
			});
			if (!finRes.ok) { const err = await finRes.json(); throw new Error(err.error || 'Erro ao finalizar assinatura'); }

			etapaAssinatura = 'Baixando PDF assinado...';
			const blob = await finRes.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = finRes.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'gise_assinada.pdf';
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
			documentoAssinadoInfo = { existe: true, assinante_nome: certName || serproSignerName, assinante_cpf: certCpf || serproSignerCpf, data: new Date().toISOString() };

			toaster.success({ title: 'PDF assinado com sucesso!' });
			await invalidateAll();
		} catch (err) {
			toaster.error({ title: err instanceof Error ? err.message : 'Erro no Assinador SERPRO' });
			serproClient?.disconnect();
			serproClient = null;
		} finally {
			assinando = false;
			etapaAssinatura = '';
			serproClient?.disconnect();
			serproClient = null;
		}
	}

	async function finalizarGise() {
		finalizando = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}/finalizar`, { method: 'POST' });
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			toaster.success({ title: 'Escala finalizada!', description: `Nova escala criada (ID ${json.nova_gise_id})` });
			showFinalizarConfirm = false;
			goto(`/gise/${json.nova_gise_id}`);
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			finalizando = false;
		}
	}

	async function salvarSlotsEquipe(equipeId: number) {
		salvando = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}/equipes/${equipeId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ slots_dpc: editSlotsDpc, slots_oip: editSlotsOip })
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			toaster.success({ title: 'Vagas atualizadas' });
			editandoEquipe = null;
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvando = false;
		}
	}

	async function reabrirEscala() {
		reabrindo = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}/reabrir`, { method: 'POST' });
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			toaster.success({ title: 'Escala reaberta', description: 'A assinatura foi revogada. A escala pode ser editada novamente.' });
			showReabrirConfirm = false;
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			reabrindo = false;
		}
	}

	async function adicionarEquipe(secId: number) {
		salvando = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}/seccionais/${secId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					adicionar_equipe: {
						tipo: novaEquipeTipo,
						slots_dpc: novaEquipeDpc,
						slots_oip: novaEquipeOip
					}
				})
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			toaster.success({ title: 'Equipe adicionada' });
			adicionandoEquipeSec = null;
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvando = false;
		}
	}

	const podeFinalizar = $derived(isAdminGeral && gise?.status === 'assinada');
	const podeAssinar = $derived(isSupervisor && gise?.status === 'aguardando_assinatura');
	const podeEditar = $derived(
		gise?.status !== 'finalizada' && gise?.status !== 'assinada'
	);
	const podeReabrir = $derived(
		isAdminGeral && (gise?.status === 'assinada' || gise?.status === 'finalizada')
	);
	const podeDownload = $derived(
		(isAdminGeral || isSeccional) &&
		(gise?.status === 'assinada' || gise?.status === 'finalizada')
	);

	function downloadGise(format: string) {
		if (!gise) return;
		window.open(`/api/gise/${gise.id}/download?format=${format}`, '_blank');
	}

	// Filtra delegacias (unidades tipo delegacia) para unidade operacional
	const delegacias = $derived(todasUnidades.filter((u: any) => u.tipo === 'delegacia'));
</script>

<div class="space-y-6">
	<!-- Cabeçalho -->
	<div class="flex items-start justify-between flex-wrap gap-3">
		<div>
			<button
				class="text-xs text-surface-500 hover:text-primary-500 transition-colors mb-1 flex items-center gap-1"
				onclick={() => goto('/gise')}
			>
				← Voltar
			</button>
			{#if gise}
				<h1 class="text-2xl font-bold text-surface-900 dark:text-surface-50">
					Escala GISE — {fmtDate(gise.data_inicio)} a {fmtDate(gise.data_fim)}
				</h1>
				<div class="flex items-center gap-2 mt-1">
					<span class="text-xs px-2 py-0.5 rounded-full font-semibold {statusColor(gise.status)}">
						{statusLabel(gise.status)}
					</span>
					<span class="text-xs text-surface-500">{gise.hora_entrada}h às {gise.hora_saida}h</span>
				</div>
			{/if}
		</div>

		<div class="flex items-center gap-2 flex-wrap">
			{#if (isAdminGeral || isSeccional) && gise}
				{#if documentoAssinadoInfo}
					<a
						href={`/api/gise/${gise.id}/documento-assinado`}
						class="btn preset-filled-success-500 text-sm px-4 py-2 rounded-xl flex items-center gap-1.5"
						target="_blank"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
						PDF Assinado
					</a>
				{/if}
				{#if podeDownload}
					<button
						class="btn preset-tonal-success text-sm px-4 py-2 rounded-xl flex items-center gap-1.5"
						onclick={() => downloadGise('xlsx')}
					>
						Baixar XLSX
					</button>
				{/if}
				<button
					class="btn preset-tonal-primary text-sm px-4 py-2 rounded-xl flex items-center gap-1.5"
					onclick={() => downloadGise('pdf')}
				>
					PDF sem Assinatura
				</button>
			{/if}
			{#if podeReabrir}
				<button
					class="btn preset-tonal-warning text-sm px-4 py-2 rounded-xl"
					onclick={() => (showReabrirConfirm = true)}
				>
					Reabrir para Edição
				</button>
			{/if}
			{#if podeFinalizar}
				<button
					class="btn preset-filled-error-500 text-sm px-4 py-2 rounded-xl"
					onclick={() => (showFinalizarConfirm = true)}
				>
					Marcar como Finalizada
				</button>
			{/if}
		</div>
	</div>

	{#if !gise}
		<p class="text-surface-500">Escala não encontrada.</p>
	{:else}
		<!-- Supervisores -->
		<div class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900 p-5">
			<div class="flex items-center justify-between mb-3">
				<h2 class="font-semibold text-surface-900 dark:text-surface-50">Supervisores</h2>
				{#if (isAdminGeral || isSeccional) && podeEditar && !editandoSupervisores}
					<button
						class="text-xs text-primary-600 hover:text-primary-500 transition-colors"
						onclick={() => (editandoSupervisores = true)}
					>
						Editar
					</button>
				{/if}
			</div>

			{#if editandoSupervisores}
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
					<div>
						<label for="supSabado" class="text-xs font-medium text-surface-600 dark:text-surface-400 block mb-1">Supervisor Sábado (DPC)</label>
						<select
							id="supSabado"
							bind:value={supSabadoId}
							class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
						>
							<option value={null}>Não definido</option>
							{#each dpcs as p}
								<option value={p.id}>{p.nome} ({p.matricula})</option>
							{/each}
						</select>
					</div>
					<div>
						<label for="supDomingo" class="text-xs font-medium text-surface-600 dark:text-surface-400 block mb-1">Supervisor Domingo (DPC)</label>
						<select
							id="supDomingo"
							bind:value={supDomingoId}
							class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
						>
							<option value={null}>Não definido</option>
							{#each dpcs as p}
								<option value={p.id}>{p.nome} ({p.matricula})</option>
							{/each}
						</select>
					</div>
				</div>
				<div class="flex gap-2">
					<button
						class="btn preset-filled-primary-500 text-xs px-3 py-1.5 rounded-lg"
						onclick={salvarSupervisores}
						disabled={salvando}
					>
						{salvando ? 'Salvando...' : 'Salvar'}
					</button>
					<button
						class="btn preset-tonal-surface text-xs px-3 py-1.5 rounded-lg"
						onclick={() => (editandoSupervisores = false)}
					>
						Cancelar
					</button>
				</div>
			{:else}
				<div class="grid grid-cols-2 gap-4 text-sm">
					<div>
						<p class="text-xs text-surface-500 mb-0.5">Sábado</p>
						<p class="font-medium text-surface-900 dark:text-surface-100">
							{gise.supervisor_sabado_nome ?? '—'}
						</p>
					</div>
					<div>
						<p class="text-xs text-surface-500 mb-0.5">Domingo</p>
						<p class="font-medium text-surface-900 dark:text-surface-100">
							{gise.supervisor_domingo_nome ?? '—'}
						</p>
					</div>
				</div>
			{/if}
		</div>

		<!-- Seccionais -->
		<div>
			<h2 class="font-semibold text-surface-900 dark:text-surface-50 mb-3">
				Seccionais ({gise.seccionais?.length ?? 0})
			</h2>

			{#each (gise.seccionais ?? []) as sec}
				<!-- Mostrar só a seccional do Admin Seccional, ou todas para Admin Geral / Supervisor -->
				{#if isAdminGeral || isSupervisor || sec.seccional_id === minhaSeccionalId}
					<div class="rounded-2xl border border-surface-200 dark:border-surface-800 mb-4 overflow-hidden">
						<!-- Cabeçalho da seccional -->
						<div class="flex items-center justify-between px-5 py-3 bg-surface-100 dark:bg-surface-800">
							<div class="flex items-center gap-3">
								<span class="font-semibold text-surface-900 dark:text-surface-50 text-sm">
									{sec.seccional_nome}
								</span>
								<span class="text-[0.65rem] px-1.5 py-0.5 rounded-full font-bold {sec.status === 'preenchida' ? 'bg-success-500/20 text-success-700 dark:text-success-400' : 'bg-warning-500/20 text-warning-600 dark:text-warning-400'}">
									{sec.status === 'preenchida' ? 'Preenchida' : 'Pendente'}
								</span>
							</div>

							<!-- Finalizar seccional (Admin Seccional) -->
							{#if (isSeccional && sec.seccional_id === minhaSeccionalId || isAdminGeral) && sec.status === 'pendente' && podeEditar}
								<button
									class="text-xs btn preset-tonal-success px-3 py-1 rounded-lg"
									onclick={() => finalizarSeccional(sec.id)}
									disabled={salvando}
								>
									Finalizar envio
								</button>
							{/if}
						</div>

						<div class="p-5 space-y-4">
							<!-- Unidade Operacional -->
							{#if isSeccional && sec.seccional_id === minhaSeccionalId && podeEditar}
								<div>
									<label for="unidadeOperacional" class="text-xs font-medium text-surface-600 dark:text-surface-400 block mb-1">
										Unidade Operacional
									</label>
									<div class="flex gap-2">
										<select
											id="unidadeOperacional"
											bind:value={unidadeOperacionalId}
											class="flex-1 px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
										>
											<option value={null}>Selecionar unidade...</option>
											{#each delegacias as u}
												<option value={u.id}>{u.nome}</option>
											{/each}
										</select>
										<button
											class="btn preset-filled-primary-500 text-xs px-3 py-1.5 rounded-xl"
											onclick={() => salvarUnidadeOperacional(sec.id)}
											disabled={salvando}
										>
											Salvar
										</button>
									</div>
								</div>
							{:else if sec.unidade_operacional_nome}
								<p class="text-xs text-surface-500">
									Unidade Operacional: <span class="font-semibold text-surface-900 dark:text-surface-100">{sec.unidade_operacional_nome}</span>
								</p>
							{/if}

							<!-- Equipes -->
							{#each (sec.equipes ?? []) as equipe}
								<div class="rounded-xl border border-surface-200 dark:border-surface-700 p-4">
									<div class="flex items-center justify-between mb-3">
										<div class="flex items-center gap-2">
											<span class="text-sm font-semibold text-surface-900 dark:text-surface-100 capitalize">
												Equipe {equipe.tipo === 'operacional' ? 'Operacional' : 'SEINT'}
											</span>
											{#if editandoEquipe === equipe.id}
												<div class="flex items-center gap-1.5">
													<label for="edit-dpc-{equipe.id}" class="text-xs text-surface-500">DPC:</label>
													<input id="edit-dpc-{equipe.id}" type="number" min="0" max="20" bind:value={editSlotsDpc}
														class="w-14 px-2 py-1 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-xs text-center" />
													<label for="edit-oip-{equipe.id}" class="text-xs text-surface-500">OIP:</label>
													<input id="edit-oip-{equipe.id}" type="number" min="0" max="20" bind:value={editSlotsOip}
														class="w-14 px-2 py-1 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-xs text-center" />
													<button
														class="btn preset-filled-primary-500 text-xs px-2 py-1 rounded-lg"
														onclick={() => salvarSlotsEquipe(equipe.id)}
														disabled={salvando}
													>Salvar</button>
													<button
														class="btn preset-tonal-surface text-xs px-2 py-1 rounded-lg"
														onclick={() => (editandoEquipe = null)}
													>×</button>
												</div>
											{:else}
												<span class="text-xs text-surface-500">
													{equipe.slots_dpc} DPC + {equipe.slots_oip} OIP
												</span>
												{#if isAdminGeral && podeEditar}
													<button
														class="text-xs text-primary-600 hover:text-primary-500 transition-colors"
														onclick={() => { editandoEquipe = equipe.id; editSlotsDpc = equipe.slots_dpc; editSlotsOip = equipe.slots_oip; }}
													>
														Editar vagas
													</button>
												{/if}
											{/if}
										</div>
										{#if isAdminGeral && podeEditar}
											<button
												class="text-xs text-error-600 hover:text-error-500"
												onclick={async () => {
													const r = await fetch(`/api/gise/${gise.id}/equipes/${equipe.id}`, { method: 'DELETE' });
													if (r.ok) { toaster.success({ title: 'Equipe removida' }); await invalidateAll(); }
													else { const j = await r.json(); toaster.error({ title: j.error }); }
												}}
											>
												Remover equipe
											</button>
										{/if}
									</div>

									<!-- Membros -->
									{#if equipe.membros?.length}
										<div class="space-y-1 mb-3">
											{#each equipe.membros as m}
												<div class="flex items-center justify-between text-xs px-3 py-1.5 rounded-lg bg-surface-100 dark:bg-surface-800">
													<div class="flex items-center gap-2">
														<span class="font-semibold text-surface-900 dark:text-surface-100">{m.policial_nome}</span>
														<span class="text-surface-500">{m.policial_cargo} · {m.policial_matricula}</span>
														<span class="text-[0.6rem] px-1 py-0.5 rounded bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-400 capitalize">{m.dia}</span>
													</div>
													{#if podeEditar && (isAdminGeral || (isSeccional && sec.seccional_id === minhaSeccionalId))}
														<button
															class="text-error-500 hover:text-error-400 transition-colors"
															onclick={() => removerMembro(m.id)}
														>×</button>
													{/if}
												</div>
											{/each}
										</div>
									{:else}
										<p class="text-xs text-surface-400 italic mb-3">Nenhum membro alocado</p>
									{/if}

									<!-- Adicionar membro -->
									{#if podeEditar && (isAdminGeral || (isSeccional && sec.seccional_id === minhaSeccionalId))}
										{#if equipeParaAdicionar === equipe.id}
											<div class="flex flex-wrap gap-2 items-end">
												<div class="flex-1 min-w-32">
													<select
														bind:value={policialParaAdicionar}
														class="w-full px-2 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-xs"
													>
														<option value="">Selecionar policial...</option>
														{#each policiais as p}
															<option value={p.id}>{p.nome} ({p.cargo} · {p.matricula})</option>
														{/each}
													</select>
												</div>
												<select
													bind:value={diaParaAdicionar}
													class="px-2 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-xs"
												>
													<option value="ambos">Sáb + Dom</option>
													<option value="sabado">Só Sáb</option>
													<option value="domingo">Só Dom</option>
												</select>
												<button
													class="btn preset-filled-primary-500 text-xs px-2 py-1.5 rounded-lg"
													onclick={() => adicionarMembro(sec.id)}
													disabled={!policialParaAdicionar || salvando}
												>Adicionar</button>
												<button
													class="btn preset-tonal-surface text-xs px-2 py-1.5 rounded-lg"
													onclick={() => { equipeParaAdicionar = null; policialParaAdicionar = ''; }}
												>×</button>
											</div>
										{:else}
											<button
												class="text-xs text-primary-600 hover:text-primary-500 transition-colors"
												onclick={() => { equipeParaAdicionar = equipe.id; policialParaAdicionar = ''; }}
											>
												+ Adicionar policial
											</button>
										{/if}
									{/if}
								</div>
							{/each}

							<!-- Adicionar equipe (Admin Geral) -->
							{#if isAdminGeral && podeEditar}
								{#if adicionandoEquipeSec === sec.id}
									<div class="flex flex-wrap gap-2 items-end mt-3 p-3 rounded-xl border border-dashed border-surface-300 dark:border-surface-600">
										<div>
											<label for="novaEquipeTipo-{sec.id}" class="text-xs font-medium text-surface-600 dark:text-surface-400 block mb-1">Tipo</label>
											<select id="novaEquipeTipo-{sec.id}" bind:value={novaEquipeTipo}
												onchange={() => { if (novaEquipeTipo === 'operacional') { novaEquipeDpc = 1; novaEquipeOip = 3; } else { novaEquipeDpc = 0; novaEquipeOip = 2; } }}
												class="px-2 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-xs">
												<option value="operacional">Operacional</option>
												<option value="seint">SEINT</option>
											</select>
										</div>
										<div>
											<label for="novaEquipeDpc-{sec.id}" class="text-xs font-medium text-surface-600 dark:text-surface-400 block mb-1">DPC</label>
											<input id="novaEquipeDpc-{sec.id}" type="number" min="0" max="20" bind:value={novaEquipeDpc}
												class="w-14 px-2 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-xs text-center" />
										</div>
										<div>
											<label for="novaEquipeOip-{sec.id}" class="text-xs font-medium text-surface-600 dark:text-surface-400 block mb-1">OIP</label>
											<input id="novaEquipeOip-{sec.id}" type="number" min="0" max="20" bind:value={novaEquipeOip}
												class="w-14 px-2 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-xs text-center" />
										</div>
										<button
											class="btn preset-filled-primary-500 text-xs px-3 py-1.5 rounded-lg"
											onclick={() => adicionarEquipe(sec.id)}
											disabled={salvando}
										>Adicionar</button>
										<button
											class="btn preset-tonal-surface text-xs px-2 py-1.5 rounded-lg"
											onclick={() => (adicionandoEquipeSec = null)}
										>Cancelar</button>
									</div>
								{:else}
									<button
										class="text-xs text-primary-600 hover:text-primary-500 transition-colors mt-2"
										onclick={() => { adicionandoEquipeSec = sec.id; novaEquipeTipo = 'operacional'; novaEquipeDpc = 1; novaEquipeOip = 3; }}
									>
										+ Adicionar equipe
									</button>
								{/if}
							{/if}
						</div>
					</div>
				{/if}
			{/each}
		</div>

		<!-- Banner: Escala Assinada -->
		{#if documentoAssinadoInfo}
			<div class="rounded-2xl border-2 border-success-500/30 bg-success-500/10 p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
				<div>
					<h3 class="font-bold text-success-700 dark:text-success-400 flex items-center gap-2">
						<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
						Escala GISE Oficialmente Assinada
					</h3>
					<p class="text-sm text-surface-600 dark:text-surface-300 mt-1">
						Assinado por <strong>{documentoAssinadoInfo.assinante_nome || ''}</strong>.
					</p>
				</div>
				<div class="flex gap-2">
					<a
						href={`/api/gise/${gise.id}/documento-assinado`}
						class="btn preset-filled-success-500 text-sm px-4 py-2 rounded-xl"
						target="_blank"
					>
						Baixar PDF Assinado
					</a>
				</div>
			</div>
		{/if}

		<!-- Aviso: Supervisor aguardando seccionais -->
		{#if isSupervisor && gise.status === 'em_preenchimento'}
			<div class="rounded-2xl border border-warning-500/30 bg-warning-500/5 p-5 text-center">
				<p class="text-warning-700 dark:text-warning-400 text-sm font-medium">
					A escala ainda não está concluída pelas seccionais.
				</p>
			</div>
		{/if}

		<!-- Seção de assinatura (Supervisor) -->
		{#if podeAssinar && !documentoAssinadoInfo}
			<div class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900 p-5 space-y-4">
				<!-- Assinatura Simples (Confirmação) -->
				<div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
					<div>
						<h3 class="font-semibold text-surface-900 dark:text-surface-50">Confirmar Escala GISE</h3>
						<p class="text-xs text-surface-500 mt-1">Gera um PDF com confirmação administrativa (sem certificado digital).</p>
					</div>
					<button
						class="btn preset-filled-primary-500 text-sm px-4 py-2 rounded-xl"
						disabled={assinandoSimples}
						onclick={assinarSimples}
					>
						{assinandoSimples ? 'Gerando PDF...' : 'Confirmar Escala'}
					</button>
				</div>

				<hr class="border-surface-200 dark:border-surface-700" />

				<!-- Assinatura Digital -->
				<h3 class="font-semibold text-surface-900 dark:text-surface-50 text-sm">
					Assinatura Digital (eToken / Certificado A3)
				</h3>

				<!-- Seletor de certificados -->
				<div class="p-4 bg-surface-100/50 dark:bg-surface-800/50 rounded-xl border border-surface-200 dark:border-white/10">
					<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
						<h4 class="font-semibold text-sm flex items-center gap-2">
							<svg class="w-4 h-4 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
							</svg>
							Leitura de Tokens
						</h4>
						<button
							class="btn text-xs preset-outlined-primary-500 px-3 py-1.5 rounded-lg"
							onclick={carregarCertificadosLocais}
							disabled={lendoCertificados}
						>
							{lendoCertificados ? 'Lendo tokens...' : 'Ler Tokens Plugados'}
						</button>
					</div>

					{#if certificados.length > 0}
						<select
							bind:value={certSelecionado}
							onchange={(e) => { const c = certificados.find(x => x.thumbprint === e.currentTarget.value); if (c) { serproSignerName = c.subjectName; serproSignerCpf = c.cpf || ''; } }}
							class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm mt-2"
						>
							<option value="">Selecione...</option>
							{#each certificados as cert (cert.thumbprint)}
								<option value={cert.thumbprint}>
									{cert.subjectName}{cert.cpf ? ` (CPF: ${cert.cpf})` : ''} - Emissor: {cert.issuerName}
								</option>
							{/each}
						</select>
					{:else if tentouLerCertificados}
						<p class="text-xs text-error-500 mt-2 bg-error-500/10 p-2 rounded">
							Nenhum certificado encontrado. Verifique se o token está conectado e a extensão <strong>Lacuna Web PKI</strong> está instalada.
						</p>
					{:else}
						<p class="text-xs text-surface-500 mt-1">
							Clique no botão para listar os certificados disponíveis.
						</p>
					{/if}
				</div>

				<div class="flex gap-2 items-center flex-wrap">
					<button
						class="btn preset-filled-success-500 text-sm px-4 py-2 rounded-xl"
						onclick={assinarComWebPKI}
						disabled={assinando || !certSelecionado}
					>
						{#if assinando && certificados.length > 0}
							<span class="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></span>
							{etapaAssinatura}
						{:else}
							Assinar com Web PKI
						{/if}
					</button>

					<button
						class="btn preset-filled-tertiary-500 text-sm px-4 py-2 rounded-xl"
						onclick={assinarComSerpro}
						disabled={assinando || !certSelecionado}
					>
						{#if assinando && serproClient}
							<span class="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></span>
							{etapaAssinatura}
						{:else}
							Assinar com SERPRO
						{/if}
					</button>

					{#if certificados.length > 0 && !assinando}
						<button
							class="btn preset-tonal-surface text-xs px-3 py-1.5 rounded-lg"
							onclick={() => { certificados = []; certSelecionado = ''; tentouLerCertificados = false; }}
						>
							Limpar lista
						</button>
					{/if}
				</div>
			</div>
		{/if}
	{/if}
</div>

<!-- Confirmar Reabrir -->
{#if showReabrirConfirm}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
		<div class="bg-surface-50 dark:bg-surface-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
			<h2 class="text-lg font-bold text-surface-900 dark:text-surface-50">Reabrir Escala GISE</h2>
			<p class="text-sm text-surface-600 dark:text-surface-400">
				A assinatura digital será <strong>revogada</strong> e todas as seccionais voltarão ao status pendente.
				Será necessário que as seccionais reenviem e o supervisor assine novamente.
			</p>
			<div class="flex justify-end gap-3">
				<button class="btn preset-tonal-surface text-sm px-4 py-2 rounded-xl" onclick={() => (showReabrirConfirm = false)}>
					Cancelar
				</button>
				<button
					class="btn preset-filled-warning-500 text-sm px-4 py-2 rounded-xl"
					onclick={reabrirEscala}
					disabled={reabrindo}
				>
					{reabrindo ? 'Reabrindo...' : 'Confirmar Reabertura'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Confirmar Finalizar -->
{#if showFinalizarConfirm}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
		<div class="bg-surface-50 dark:bg-surface-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
			<h2 class="text-lg font-bold text-surface-900 dark:text-surface-50">Finalizar Escala GISE</h2>
			<p class="text-sm text-surface-600 dark:text-surface-400">
				A escala será marcada como <strong>Finalizada</strong> e o sistema criará automaticamente a escala do próximo final de semana.
			</p>
			<div class="flex justify-end gap-3">
				<button class="btn preset-tonal-surface text-sm px-4 py-2 rounded-xl" onclick={() => (showFinalizarConfirm = false)}>
					Cancelar
				</button>
				<button
					class="btn preset-filled-error-500 text-sm px-4 py-2 rounded-xl"
					onclick={finalizarGise}
					disabled={finalizando}
				>
					{finalizando ? 'Finalizando...' : 'Confirmar'}
				</button>
			</div>
		</div>
	</div>
{/if}
