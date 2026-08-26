<script lang="ts">
	/**
	 * Pad de ASSINATURA AVANÇADA em tela (Lei 14.063/2020 art. 4º II) — usado em
	 * todos os pontos de assinatura sem certificado: escala, GISE, relatórios e
	 * termos de presença.
	 *
	 * A assinatura avançada não tem certificado ICP-Brasil, então sua
	 * oponibilidade vem do CONJUNTO de evidências coletadas aqui, em passos
	 * (`step`), cada um ligável por configuração:
	 *
	 *   `signature` → declaração de vontade: o titular lê o que será registrado
	 *                 e confirma (é o único passo que nunca se desliga)
	 *   `camera`    → foto com prova de vida (`exigirFoto`)
	 *   `password`  → reinserir a senha de acesso (piso da cerimônia)
	 *   `email_code`→ código enviado por e-mail (`exigirCodigoEmail`)
	 *
	 * mais GPS (`exigirGps`), IP e user-agent, capturados pelo servidor no POST.
	 * As flags vêm das Configurações Gerais: o operador decide o nível de
	 * exigência, e desligar uma delas enfraquece a prova, não o fluxo.
	 */
	import Camera from '@lucide/svelte/icons/camera';
	import Check from '@lucide/svelte/icons/check';
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import type {
		SignaturePadLivenessResultado,
		SignaturePadConfirmPayload,
		SignaturePadStep
	} from './SignaturePadTypes';
	import { apiFetch } from '$lib/api-fetch';
	import { toaster } from '$lib/toast';
	import {
		apagarReauth,
		ehErroReauthAssinatura,
		ERRO_REAUTH_AUSENTE,
		gravarReauth,
		lerReauthGuardado
	} from '$lib/assinatura-reauth';
	import Spinner from './Spinner.svelte';
	import IconTooltip from './IconTooltip.svelte';
	import CodigoTimer from './CodigoTimer.svelte';
	import { useFaceLiveness } from '$lib/composables/useFaceLiveness.svelte';
	import { mensagemDeErro } from '$lib/utils/erro';
	import { formatarCPF } from '$lib/utils/formato';

	let {
		onConfirm,
		onCancel,
		message = '',
		exigirFoto = true,
		exigirGps = true,
		exigirCodigoEmail = false,
		step = $bindable('signature'),
		credenciaisCombinadas = true,
		cpfUsuario = null
	}: {
		onConfirm: (payload: SignaturePadConfirmPayload) => void | Promise<void>;
		onCancel: () => void;
		message?: string;
		exigirFoto?: boolean;
		exigirGps?: boolean;
		exigirCodigoEmail?: boolean;
		step?: SignaturePadStep;
		/** Desktop: senha e 2FA na mesma etapa, em vez de telas sequenciais. */
		credenciaisCombinadas?: boolean;
		/** CPF formatado exibido na etapa combinada (somente leitura). */
		cpfUsuario?: string | null;
	} = $props();

	// Prova de vida (câmera + face-api + challenge), extraída para composable.
	const liveness = useFaceLiveness({ exigirFoto: () => exigirFoto });

	let capturingLocation = $state(false);
	let coords = $state<{ lat: number; lng: number } | null>(null);
	let locationError = $state<string | null>(null);

	// Estados do Email Code
	let solicitandoCodigo = $state(false);
	let codigoInput = $state('');
	let codigoError = $state<string | null>(null);
	let emailMascarado = $state('');
	let desafioId = $state<string | null>(null);
	// IMPORTANTE: o resultado do liveness precisa ser capturado AQUI (no momento
	// da foto) e não recalculado em confirmarCodigo. Quando step muda para
	// 'email_code', o $effect abaixo chama aoVoltarDaCamera() (challenge zerado)
	// — se chamássemos montarLivenessResultado() depois, devolveria null e o
	// servidor rejeitaria com "liveness ausente".
	let pendingSignature = $state<{
		lat: number | undefined;
		lng: number | undefined;
		selfieBase64: string | null;
		liveness: SignaturePadLivenessResultado | null;
		reauthId: string | null;
	} | null>(null);

	let senhaInput = $state('');
	let senhaError = $state<string | null>(null);
	let confirmandoSenha = $state(false);
	let emitindo = $state(false);
	let mostrarSenha = $state(false);

	const reauthJaConfirmado = $derived(Boolean(lerReauthGuardado()));
	const cpfFormatado = $derived(cpfUsuario ? formatarCPF(cpfUsuario) : '');
	/** Etapas só de autenticação — layout mais compacto, sem o aviso jurídico. */
	const etapaAuth = $derived(
		step === 'password' || step === 'credenciais' || step === 'email_code'
	);

	$effect(() => {
		if (step === 'camera') {
			liveness.entrarNaCamera();
		} else {
			// se voltar para a tela de assinatura
			liveness.aoVoltarDaCamera();
		}
		return () => liveness.limparRecursos();
	});

	// Iniciar captura de localização ao abrir (somente se exigido)
	$effect(() => {
		if (exigirGps) {
			if ('geolocation' in navigator) {
				capturingLocation = true;
				navigator.geolocation.getCurrentPosition(
					(pos) => {
						coords = {
							lat: pos.coords.latitude,
							lng: pos.coords.longitude
						};
						capturingLocation = false;
					},
					(err) => {
						console.warn('Erro ao capturar localização:', err);
						locationError =
							'Não foi possível capturar sua localização. Por favor, permita o acesso ao GPS.';
						capturingLocation = false;
					},
					{ enableHighAccuracy: true, timeout: 10000 }
				);
			} else {
				locationError = 'GPS não disponível neste dispositivo.';
			}
		}
	});

	function confirmarSemFoto() {
		processarAssinatura(coords?.lat, coords?.lng, null);
	}

	async function confirm() {
		const selfieBase64 = await liveness.capturarSelfie();
		// undefined = captura ABORTADA (rosto sumiu/múltiplos no último
		// milissegundo) — o overlay de erro já foi exibido pelo composable.
		if (selfieBase64 === undefined) return;
		processarAssinatura(coords?.lat, coords?.lng, selfieBase64);
	}

	async function processarAssinatura(
		lat: number | undefined,
		lng: number | undefined,
		selfieBase64: string | null
	) {
		// Snapshot do liveness ANTES de qualquer mudança de step. A transição
		// para 'email_code' dispara o $effect que zera o challenge, então
		// recalcular depois devolve null.
		const livenessResultado = liveness.montarLivenessResultado();
		pendingSignature = {
			lat,
			lng,
			selfieBase64,
			liveness: livenessResultado,
			reauthId: lerReauthGuardado()
		};
		if (credenciaisCombinadas) {
			step = 'credenciais';
			return;
		}
		if (!pendingSignature.reauthId) {
			step = 'password';
			return;
		}
		await avancarAposSenha();
	}

	/**
	 * Tela de senha (desktop): só confirma senha e, se precisar de 2FA, DISPARA
	 * o e-mail aqui — nunca ao abrir o passo. Depois vai para `email_code`.
	 */
	async function confirmarCredenciaisCombinadas() {
		senhaError = null;
		codigoError = null;

		const reauthAtual = pendingSignature?.reauthId ?? lerReauthGuardado();
		if (!reauthAtual) {
			if (!senhaInput) {
				senhaError = 'Digite sua senha de acesso.';
				return;
			}
			confirmandoSenha = true;
			try {
				const data = await apiFetch<{ reauthId: string }>('/api/auth/reautenticar-assinatura', {
					method: 'POST',
					body: JSON.stringify({ senha: senhaInput })
				});
				gravarReauth(data.reauthId);
				if (pendingSignature) pendingSignature.reauthId = data.reauthId;
				senhaInput = '';
			} catch (e: unknown) {
				senhaError = mensagemDeErro(e, 'Senha incorreta');
				return;
			} finally {
				confirmandoSenha = false;
			}
		} else if (pendingSignature && !pendingSignature.reauthId) {
			pendingSignature.reauthId = reauthAtual;
		}

		await avancarAposSenha();
	}

	async function avancarAposSenha() {
		if (exigirCodigoEmail) {
			// Recusa de senha no POST acontece ANTES de consumir o 2FA. Se o
			// titular já digitou o código, reabre este passo em vez de queimar
			// outro e-mail.
			if (desafioId && codigoInput.length === 6) {
				step = 'email_code';
				return;
			}
			const ok = await enviarOuReenviarCodigo();
			if (ok) step = 'email_code';
		} else {
			await emitirConfirmacao();
		}
	}

	async function confirmarSenha() {
		if (!senhaInput) {
			senhaError = 'Digite sua senha de acesso.';
			return;
		}
		confirmandoSenha = true;
		senhaError = null;
		try {
			const data = await apiFetch<{ reauthId: string }>('/api/auth/reautenticar-assinatura', {
				method: 'POST',
				body: JSON.stringify({ senha: senhaInput })
			});
			gravarReauth(data.reauthId);
			if (pendingSignature) pendingSignature.reauthId = data.reauthId;
			senhaInput = '';
			await avancarAposSenha();
		} catch (e: unknown) {
			senhaError = mensagemDeErro(e, 'Senha incorreta');
		} finally {
			confirmandoSenha = false;
		}
	}

	async function emitirConfirmacao(extras?: { codigoEmail?: string; desafioId?: string }) {
		if (!pendingSignature) return;
		emitindo = true;
		try {
			await onConfirm({
				lat: pendingSignature.lat,
				lng: pendingSignature.lng,
				selfie: pendingSignature.selfieBase64,
				liveness: pendingSignature.liveness,
				reauthId: pendingSignature.reauthId ?? undefined,
				...extras
			});
		} catch (e: unknown) {
			if (ehErroReauthAssinatura(e)) {
				apagarReauth();
				pendingSignature.reauthId = null;
				senhaInput = '';
				senhaError = mensagemDeErro(e, ERRO_REAUTH_AUSENTE);
				step = credenciaisCombinadas ? 'credenciais' : 'password';
				return;
			}
			codigoError = mensagemDeErro(e);
		} finally {
			emitindo = false;
		}
	}

	async function enviarOuReenviarCodigo() {
		solicitandoCodigo = true;
		codigoError = null;
		codigoInput = '';
		try {
			const data = await apiFetch<{ emailMascarado?: string; desafioId?: string }>(
				'/api/auth/solicitar-codigo-assinatura',
				{ method: 'POST' }
			);
			emailMascarado = data.emailMascarado ?? '';
			desafioId = data.desafioId ?? null;
			return true;
		} catch (e: unknown) {
			const msg = mensagemDeErro(e, 'Erro desconhecido');
			codigoError = msg;
			// Se o erro for de login/sessão, avisar de forma mais incisiva (toast
			// de erro no canto — bloqueia menos que alert() e respeita o tema).
			if (msg.includes('Sessão inválida')) {
				toaster.create({ title: 'Sessão expirada', description: msg, type: 'error' });
			}
			return false;
		} finally {
			solicitandoCodigo = false;
		}
	}

	async function confirmarCodigo() {
		if (codigoInput.length !== 6) {
			codigoError = 'O código deve conter 6 dígitos.';
			return;
		}
		if (pendingSignature && desafioId) {
			await emitirConfirmacao({ codigoEmail: codigoInput, desafioId });
		}
	}

	function startCaptureSequence() {
		liveness.iniciarContagem(confirm);
	}
</script>

<!-- Indicador de GPS — mostrado no painel de evidências da etapa de confirmação. -->
{#snippet gpsIndicator()}
	{#if exigirGps}
		<div
			class="absolute bottom-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-white/80 dark:bg-surface-900/80 backdrop-blur-sm border border-surface-200 dark:border-surface-700"
		>
			{#if capturingLocation}
				<span class="w-2 h-2 rounded-full bg-warning-500 animate-pulse"></span>
				<span class="text-3xs font-black uppercase text-warning-600">Capturando GPS...</span>
			{:else if coords}
				<span class="w-2 h-2 rounded-full bg-success-500"></span>
				<span class="text-3xs font-black uppercase text-success-600">GPS Localizado</span>
			{:else}
				<span class="w-2 h-2 rounded-full bg-error-500"></span>
				<span class="text-3xs font-black uppercase text-error-600">GPS Falhou</span>
			{/if}
		</div>
	{/if}
{/snippet}

<div class="space-y-4">
	{#if message}
		<p class="text-3xs font-bold text-surface-600 dark:text-surface-400 uppercase text-center mb-1">
			{message}
		</p>
	{/if}

	{#if codigoError && step !== 'email_code' && step !== 'credenciais'}
		<div
			class="p-4 bg-error-500/10 border-2 border-error-500/30 rounded-2xl animate-in fade-in slide-in-from-top-2 duration-300"
		>
			<div class="flex items-center gap-3">
				<div class="bg-error-500 rounded-full p-1.5 shadow-lg shadow-error-500/30">
					<svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="3"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</div>
				<div class="flex-1">
					<p class="text-xs font-black text-error-600 uppercase tracking-widest leading-tight">
						Erro na Assinatura
					</p>
					<p class="text-3xs font-bold text-error-700/80 leading-snug">
						{codigoError}
					</p>
				</div>
			</div>
		</div>
	{/if}

	<div class="flex flex-col gap-4">
		<!-- Etapa `signature`: declaração de vontade. Não há nada a desenhar — o que
		     o titular precisa ver antes de confirmar é O QUE o ato vai registrar,
		     que é o que sustenta a assinatura avançada (Lei 14.063/2020 art. 4º II).
		     A lista acompanha as flags: desligar uma evidência tira a linha dela. -->
		<div class="space-y-2 {step !== 'signature' ? 'hidden' : ''}">
			<span
				class="text-3xs font-bold text-surface-600 dark:text-surface-400 uppercase tracking-wider"
				>O que será registrado</span
			>
			<div
				class="relative rounded-xl border-2 border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900/40 p-4 pb-10"
			>
				<ul class="space-y-2.5 text-sm text-surface-700 dark:text-surface-300">
					<li class="flex items-start gap-2.5">
						<Check class="w-4 h-4 mt-0.5 shrink-0 text-primary-500" aria-hidden="true" />
						<span
							>Sua <strong>identificação</strong> (nome, matrícula e CPF) e a sessão autenticada.</span
						>
					</li>
					{#if exigirFoto}
						<li class="flex items-start gap-2.5">
							<Check class="w-4 h-4 mt-0.5 shrink-0 text-primary-500" aria-hidden="true" />
							<span>Sua <strong>fotografia</strong>, com desafio de prova de vida.</span>
						</li>
					{/if}
					{#if exigirGps}
						<li class="flex items-start gap-2.5">
							<Check class="w-4 h-4 mt-0.5 shrink-0 text-primary-500" aria-hidden="true" />
							<span>Sua <strong>localização geográfica</strong> no momento da assinatura.</span>
						</li>
					{/if}
					<li class="flex items-start gap-2.5">
						<Check class="w-4 h-4 mt-0.5 shrink-0 text-primary-500" aria-hidden="true" />
						<span>
							<strong>Data e hora</strong>, endereço IP e dispositivo, mais o
							<strong>hash</strong> do documento assinado.
						</span>
					</li>
				</ul>
				{@render gpsIndicator()}
			</div>
		</div>

		{#if step === 'camera'}
			<!-- Camera Preview -->
			<div
				class="w-full bg-surface-100 dark:bg-surface-800 border-2 border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden flex flex-col pt-3 items-center relative aspect-[3/4] min-h-[400px] object-cover"
			>
				<span
					class="text-3xs font-bold text-surface-600 dark:text-surface-400 uppercase tracking-wider items-center mb-3 px-2 flex gap-1.5"
				>
					<span
						class="w-2.5 h-2.5 rounded-full {liveness.stream
							? 'bg-error-500 animate-pulse'
							: 'bg-surface-300'}"
					></span>
					Prova de Vida
				</span>
				<video
					bind:this={liveness.videoElement}
					autoplay
					playsinline
					muted
					class="w-full h-[90%] object-cover bg-surface-200 dark:bg-surface-900 {liveness.faceDetected
						? liveness.isMoving
							? 'ring-4 ring-warning-500/50'
							: 'ring-4 ring-success-500/50'
						: 'ring-2 ring-warning-500/30'}"
				></video>

				<!-- Banner do challenge ativo (liveness) — barra foto/vídeo pré-gravado -->
				{#if liveness.challengeAtual && liveness.faceDetected}
					{@const ok = liveness.challengeProgresso?.concluido ?? false}
					<div
						class="absolute top-12 left-4 right-4 z-30 px-3 py-2 rounded-xl backdrop-blur-md border-2 transition-all duration-200 pointer-events-auto shadow-lg {ok
							? 'bg-success-500/20 border-success-400/60 text-success-50'
							: 'bg-primary-900/70 border-primary-400/60 text-white'}"
					>
						<div class="flex items-center justify-between gap-2">
							<div class="flex-1 min-w-0">
								<p class="text-3xs font-black uppercase tracking-widest opacity-80">
									Desafio de presença
								</p>
								<p class="text-sm font-bold leading-tight truncate">
									{#if ok}<Check class="inline w-4 h-4 -mt-0.5" aria-hidden="true" /> Desafio concluído{:else}{liveness
											.challengeAtual.instrucao}{/if}
								</p>
								{#if !ok && liveness.challengeProgresso}
									<p class="text-3xs opacity-90 mt-0.5">
										{liveness.challengeProgresso.mensagem}
									</p>
								{:else if !ok}
									<p class="text-3xs opacity-70 mt-0.5">{liveness.challengeAtual.hint}</p>
								{/if}
							</div>
							{#if !ok}
								<IconTooltip label="Trocar para outro desafio">
									<button
										type="button"
										onclick={liveness.trocarChallenge}
										class="text-3xs uppercase font-bold px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 transition-colors shrink-0"
									>
										Trocar
									</button>
								</IconTooltip>
							{/if}
						</div>
						{#if liveness.challengeProgresso && !ok}
							<!-- Barra de progresso -->
							<div class="mt-1.5 h-1 bg-white/15 rounded-full overflow-hidden">
								<div
									class="h-full bg-primary-300 transition-all duration-200"
									style="width: {liveness.challengeProgresso.progresso * 100}%"
								></div>
							</div>
						{/if}
					</div>
				{/if}

				<!-- Efeito de Flash -->
				{#if liveness.isFlashActive}
					<div
						class="absolute inset-0 bg-white z-50 animate-flash opacity-0 pointer-events-none"
					></div>
				{/if}

				<!-- Overlay de Contagem Regressiva -->
				{#if liveness.countdown > 0}
					<div
						class="absolute inset-0 flex items-center justify-center bg-black/30 z-40 backdrop-blur-[2px]"
					>
						<span
							class="text-8xl font-black text-white drop-shadow-[0_0_20px_rgba(0,0,0,0.5)] animate-ping-once"
						>
							{liveness.countdown}
						</span>
					</div>
				{/if}

				{#if liveness.lastErrorCode}
					<div
						class="absolute inset-x-4 top-2 bg-error-600/95 text-white backdrop-blur-md px-4 py-3 rounded-2xl text-center shadow-xl z-50 animate-bounce"
					>
						<p class="text-3xs font-black uppercase tracking-widest">
							{liveness.lastErrorCode}
						</p>
					</div>
				{/if}

				<!-- Indicador Liveness na Câmera -->
				<div
					class="absolute bottom-4 left-0 right-0 max-w-xs mx-auto px-4 z-20 pointer-events-none"
				>
					{#if liveness.faceLoadError}
						<div
							class="bg-error-500/90 text-white backdrop-blur-md px-4 py-2 rounded-xl text-center shadow-[0_0_15px_rgba(0,0,0,0.3)]"
						>
							<p class="text-3xs font-bold uppercase tracking-wide">
								{liveness.faceLoadError}
							</p>
						</div>
					{:else}
						<div
							class="{liveness.faceDetected
								? 'bg-success-600/90'
								: 'bg-surface-900/90'} text-white backdrop-blur-md px-4 py-2.5 rounded-2xl flex items-center justify-center gap-2 shadow-[0_4px_20px_rgba(0,0,0,0.5)] transition-all duration-300"
						>
							{#if liveness.faceDetected}
								<Check class="w-4 h-4 text-white" strokeWidth={3} aria-hidden="true" />
							{:else}
								<Spinner size="xs" />
							{/if}
							<p
								class="text-2xs font-black uppercase tracking-widest {liveness.isMoving
									? 'text-warning-300'
									: 'text-white'}"
							>
								{liveness.faceStatusMessage}
							</p>
						</div>
					{/if}
				</div>
				{#if liveness.cameraError}
					<div
						class="absolute inset-0 bg-surface-900/80 flex items-center justify-center p-4 text-center z-10 backdrop-blur-sm"
					>
						<p class="text-sm font-bold text-error-400 uppercase">
							{liveness.cameraError}
						</p>
					</div>
				{/if}
			</div>
		{/if}

		{#if step === 'password'}
			<div
				class="flex flex-col items-center justify-center p-6 bg-surface-100/50 dark:bg-surface-800/40 rounded-2xl border-2 border-primary-500/20 text-center min-h-[300px]"
			>
				<div class="w-16 h-16 rounded-full bg-primary-500/10 flex items-center justify-center mb-4">
					<svg
						class="w-8 h-8 text-primary-500"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
						/>
					</svg>
				</div>
				<h3 class="h3 font-bold mb-2">Confirme sua senha</h3>
				<p class="text-sm text-surface-600 dark:text-surface-400 mb-4 max-w-xs">
					A sessão sozinha não basta. Digite a senha de acesso para assinar — sem matrícula.
				</p>

				<div class="w-full max-w-xs space-y-4">
					<input
						type="password"
						autocomplete="current-password"
						placeholder="Senha de acesso"
						aria-label="Senha de acesso"
						bind:value={senhaInput}
						onkeydown={(e) => {
							if (e.key === 'Enter') confirmarSenha();
						}}
						class="input w-full h-12 rounded-2xl bg-white dark:bg-surface-900 border-2 {senhaError
							? 'border-error-500'
							: 'border-surface-300 dark:border-surface-600'} px-4"
					/>

					{#if senhaError}
						<p class="text-xs font-bold text-error-500 uppercase tracking-wider">{senhaError}</p>
					{/if}
				</div>
			</div>
		{/if}

		{#if step === 'credenciais'}
			<!-- Senha + canal (e-mail). O código SÓ é pedido na etapa seguinte,
			     depois do Assinar confirmar a senha e disparar o envio. -->
			<div class="flex flex-col gap-3">
				{#if cpfFormatado}
					<input
						type="text"
						readonly
						value={cpfFormatado}
						aria-label="Identificação"
						class="input w-full h-11 rounded-lg bg-surface-200/70 dark:bg-surface-800/70 border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-300 font-mono"
						tabindex="-1"
					/>
				{/if}

				{#if !reauthJaConfirmado}
					<div class="relative">
						<input
							type={mostrarSenha ? 'text' : 'password'}
							autocomplete="current-password"
							placeholder="Senha de acesso"
							aria-label="Senha de acesso"
							bind:value={senhaInput}
							onkeydown={(e) => {
								if (e.key === 'Enter') confirmarCredenciaisCombinadas();
							}}
							class="input w-full h-11 rounded-lg bg-white dark:bg-surface-900 border {senhaError
								? 'border-error-500'
								: 'border-surface-300 dark:border-surface-600'} pr-11"
						/>
						<button
							type="button"
							class="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300"
							onclick={() => (mostrarSenha = !mostrarSenha)}
							aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
						>
							{#if mostrarSenha}
								<EyeOff class="w-4 h-4" aria-hidden="true" />
							{:else}
								<Eye class="w-4 h-4" aria-hidden="true" />
							{/if}
						</button>
					</div>
					{#if senhaError}
						<p class="text-xs font-bold text-error-500">{senhaError}</p>
					{/if}
				{:else}
					<p
						class="text-3xs font-bold uppercase tracking-wider text-success-600 dark:text-success-400 flex items-center gap-1.5"
					>
						<Check class="w-3.5 h-3.5" aria-hidden="true" /> Senha confirmada recentemente
					</p>
				{/if}

				{#if exigirCodigoEmail}
					<p class="text-sm text-surface-600 dark:text-surface-400">
						Receber código de assinatura por:
					</p>
					<div
						class="flex items-center gap-2 text-sm font-medium text-surface-800 dark:text-surface-200"
					>
						<span
							class="w-3.5 h-3.5 rounded-full border-2 border-success-500 bg-success-500 shrink-0"
							aria-hidden="true"
						></span>
						E-mail
					</div>
				{/if}
			</div>
		{/if}

		{#if step === 'email_code'}
			{#if credenciaisCombinadas}
				<div class="flex flex-col gap-3">
					<input
						type="text"
						inputmode="numeric"
						maxlength="6"
						placeholder="Insira o código"
						aria-label="Código de verificação de 6 dígitos enviado ao seu e-mail"
						autocomplete="one-time-code"
						bind:value={codigoInput}
						onkeydown={(e) => {
							if (e.key === 'Enter') confirmarCodigo();
						}}
						class="input w-full h-12 rounded-lg bg-white dark:bg-surface-900 border text-center font-mono tracking-widest {codigoError
							? 'border-error-500'
							: 'border-surface-300 dark:border-surface-600'}"
					/>
					{#if codigoError}
						<p class="text-xs font-bold text-error-500">{codigoError}</p>
					{/if}
					<CodigoTimer
						{emailMascarado}
						onReenviar={async () => {
							await enviarOuReenviarCodigo();
						}}
					/>
				</div>
			{:else}
				<div
					class="flex flex-col items-center justify-center p-6 bg-surface-100/50 dark:bg-surface-800/40 rounded-2xl border-2 border-primary-500/20 text-center min-h-[300px]"
				>
					<div
						class="w-16 h-16 rounded-full bg-primary-500/10 flex items-center justify-center mb-4"
					>
						<svg
							class="w-8 h-8 text-primary-500"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
							/>
						</svg>
					</div>
					<h3 class="h3 font-bold mb-2">Confirme sua Identidade</h3>

					<div class="w-full max-w-xs space-y-4">
						<input
							type="text"
							inputmode="numeric"
							maxlength="6"
							placeholder="000000"
							aria-label="Código de verificação de 6 dígitos enviado ao seu e-mail"
							autocomplete="one-time-code"
							bind:value={codigoInput}
							class="input text-center text-3xl tracking-[0.5em] font-mono h-16 rounded-2xl bg-white dark:bg-surface-900 border-2 {codigoError
								? 'border-error-500 uppercase'
								: 'border-surface-300 dark:border-surface-600'}"
						/>

						{#if codigoError}
							<p class="text-xs font-bold text-error-500 uppercase tracking-wider">{codigoError}</p>
						{/if}

						<CodigoTimer
							{emailMascarado}
							onReenviar={async () => {
								await enviarOuReenviarCodigo();
							}}
						/>
					</div>
				</div>
			{/if}
		{/if}
	</div>

	{#if locationError && !coords && !capturingLocation}
		<p class="text-3xs font-bold text-error-500 text-center uppercase tracking-tight italic">
			{locationError}
		</p>
	{/if}

	{#if !etapaAuth}
		<!-- O aviso de consentimento lista só o que este nível de segurança (config
		     do Super Admin) de fato captura: GPS e/ou selfie; metadados sempre. -->
		<div class="p-3 bg-primary-500/5 border border-dashed border-primary-500/20 rounded-xl">
			<p
				class="text-3xs font-medium text-surface-600 dark:text-surface-400 leading-tight text-center"
			>
				Ao assinar, declaro a veracidade destas informações e autorizo o registro de
				{#if exigirGps && exigirFoto}
					minha <strong>localização geográfica</strong>, <strong>fotografia (prova de vida)</strong> e
				{:else if exigirGps}
					minha <strong>localização geográfica</strong> e
				{:else if exigirFoto}
					minha <strong>fotografia (prova de vida)</strong> e
				{/if}
				<strong>metadados técnicos</strong> para fins de validade jurídica desta assinatura (Lei 14.063/20).
			</p>
		</div>
	{/if}

	<div class="flex flex-wrap justify-between items-center gap-2 mt-4">
		{#if step === 'signature'}
			<div class="flex items-center gap-2 ml-auto">
				<button
					type="button"
					class="btn preset-outlined-surface-500 rounded-xl text-3xs sm:text-xs font-bold uppercase px-3 py-2 sm:px-4 sm:py-2 hover:bg-surface-50 dark:hover:bg-surface-900 transition-colors"
					onclick={onCancel}
				>
					Cancelar
				</button>
				<button
					type="button"
					class="btn preset-filled-primary-500 rounded-xl text-3xs sm:text-xs font-bold uppercase px-3 py-2 sm:px-4 sm:py-2 shadow-sm shadow-primary-500/20 transition-all w-max"
					disabled={solicitandoCodigo}
					onclick={() => (exigirFoto ? (step = 'camera') : confirmarSemFoto())}
				>
					{#if solicitandoCodigo}
						Enviando...
					{:else}
						{#if exigirFoto}Avançar <Camera
								class="inline w-4 h-4 -mt-0.5"
								aria-hidden="true"
							/>{:else}Confirmar <Check class="inline w-4 h-4 -mt-0.5" aria-hidden="true" />{/if}
					{/if}
				</button>
			</div>
		{:else if step === 'camera'}
			<button
				type="button"
				class="btn preset-outlined-surface-500 rounded-xl text-xs font-bold uppercase px-4 py-2 hover:bg-surface-50 dark:hover:bg-surface-900 transition-colors"
				onclick={() => (step = 'signature')}
			>
				Voltar
			</button>

			{@const challengeOk = !liveness.challengeAtual || liveness.challengeProgresso?.concluido}
			<button
				type="button"
				class="btn {liveness.faceDetected && !liveness.isMoving && challengeOk
					? 'preset-filled-primary-500'
					: 'bg-surface-300 dark:bg-surface-700 text-surface-500 opacity-60'} rounded-2xl text-sm font-bold uppercase px-6 py-3 shadow-lg shadow-primary-500/20 transition-all ml-auto"
				onclick={startCaptureSequence}
				disabled={capturingLocation ||
					liveness.capturingImage ||
					!!liveness.cameraError ||
					!liveness.stream ||
					!liveness.faceDetected ||
					!challengeOk}
			>
				{#if !liveness.faceDetected}
					Aguardando Rosto...
				{:else if !challengeOk}
					Cumpra o desafio…
				{:else if liveness.countdown > 0}
					Prepare-se ({liveness.countdown})
				{:else if liveness.capturingImage}
					Fotografando...
				{:else}
					Tirar Foto e Assinar
				{/if}
			</button>
		{:else if step === 'password'}
			<button
				type="button"
				class="btn preset-outlined-surface-500 rounded-xl text-xs font-bold uppercase px-4 py-2 hover:bg-surface-50 dark:hover:bg-surface-900 transition-colors"
				onclick={() => (step = exigirFoto ? 'camera' : 'signature')}
				disabled={confirmandoSenha}
			>
				Voltar
			</button>

			<button
				type="button"
				class="btn preset-filled-primary-500 rounded-xl text-sm font-bold uppercase px-6 py-3 shadow-lg shadow-primary-500/20 transition-all ml-auto"
				onclick={confirmarSenha}
				disabled={confirmandoSenha || !senhaInput}
			>
				{#if confirmandoSenha}
					<Spinner size="sm" />
				{:else}
					Continuar
				{/if}
			</button>
		{:else if step === 'credenciais'}
			<div class="flex flex-col gap-2 w-full mt-2">
				<button
					type="button"
					class="btn preset-filled-primary-500 w-full rounded-lg text-sm font-bold uppercase py-3"
					onclick={confirmarCredenciaisCombinadas}
					disabled={confirmandoSenha ||
						emitindo ||
						solicitandoCodigo ||
						(!reauthJaConfirmado && !senhaInput)}
				>
					{#if confirmandoSenha || solicitandoCodigo}
						{solicitandoCodigo ? 'Enviando código...' : 'Confirmando...'}
					{:else}
						Assinar
					{/if}
				</button>
				<button
					type="button"
					class="btn preset-outlined-surface-500 w-full rounded-lg text-xs font-bold uppercase py-2"
					onclick={() => (step = exigirFoto ? 'camera' : 'signature')}
					disabled={confirmandoSenha || emitindo || solicitandoCodigo}
				>
					Voltar
				</button>
			</div>
		{:else if step === 'email_code'}
			{#if credenciaisCombinadas}
				<div class="flex flex-col gap-2 w-full mt-2">
					<button
						type="button"
						class="btn preset-filled-primary-500 w-full rounded-lg text-sm font-bold uppercase py-3"
						onclick={confirmarCodigo}
						disabled={solicitandoCodigo || emitindo || codigoInput.length !== 6}
					>
						{#if emitindo}
							Assinando...
						{:else}
							Assinar
						{/if}
					</button>
					<button
						type="button"
						class="btn preset-outlined-surface-500 w-full rounded-lg text-xs font-bold uppercase py-2"
						onclick={() => (step = 'credenciais')}
						disabled={solicitandoCodigo || emitindo}
					>
						Voltar
					</button>
				</div>
			{:else}
				<button
					type="button"
					class="btn preset-outlined-surface-500 rounded-xl text-xs font-bold uppercase px-4 py-2 hover:bg-surface-50 dark:hover:bg-surface-900 transition-colors"
					onclick={onCancel}
					disabled={solicitandoCodigo || emitindo}
				>
					Cancelar
				</button>

				<button
					type="button"
					class="btn preset-filled-primary-500 rounded-xl text-sm font-bold uppercase px-6 py-3 shadow-lg shadow-primary-500/20 transition-all ml-auto"
					onclick={confirmarCodigo}
					disabled={solicitandoCodigo || emitindo || codigoInput.length !== 6}
				>
					{#if emitindo}
						Assinando...
					{:else}
						Assinar
					{/if}
				</button>
			{/if}
		{/if}
	</div>
</div>

<style>
	@keyframes flash {
		0% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}
	.animate-flash {
		animation: flash 0.3s ease-out forwards;
	}

	@keyframes ping-once {
		0% {
			transform: scale(0.5);
			opacity: 0;
		}
		50% {
			transform: scale(1.1);
			opacity: 1;
		}
		100% {
			transform: scale(1);
			opacity: 0.8;
		}
	}
	.animate-ping-once {
		animation: ping-once 0.5s ease-out forwards;
	}
</style>
