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
	 *   `signature` → rubrica (desenhada ou a cadastrada)
	 *   `camera`    → foto com prova de vida (`exigirFoto`)
	 *   `password`  → reinserir a senha de acesso (piso da cerimônia)
	 *   `email_code`→ código enviado por e-mail (`exigirCodigoEmail`)
	 *
	 * mais GPS (`exigirGps`), IP e user-agent, capturados pelo servidor no POST.
	 * As flags vêm das Configurações Gerais: o operador decide o nível de
	 * exigência, e desligar uma delas enfraquece a prova, não o fluxo.
	 *
	 * `rubricaSalva` é reaproveitada por padrão quando existe — assinar várias
	 * escalas seguidas não deve obrigar a redesenhar. O usuário pode alternar
	 * para desenhar outra a qualquer momento; como o pad é remontado a cada
	 * abertura do modal, basta o valor inicial.
	 */
	import { untrack } from 'svelte';
	import Camera from '@lucide/svelte/icons/camera';
	import Check from '@lucide/svelte/icons/check';
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
	import { useRubricaCanvas } from '$lib/composables/useRubricaCanvas.svelte';
	import { useFaceLiveness } from '$lib/composables/useFaceLiveness.svelte';
	import { mensagemDeErro } from '$lib/utils/erro';

	let {
		onConfirm,
		onCancel,
		message = '',
		exigirFoto = true,
		exigirGps = true,
		exigirCodigoEmail = false,
		rubricaSalva = null,
		step = $bindable('signature')
	}: {
		onConfirm: (payload: SignaturePadConfirmPayload) => void | Promise<void>;
		onCancel: () => void;
		message?: string;
		exigirFoto?: boolean;
		exigirGps?: boolean;
		exigirCodigoEmail?: boolean;
		/** Rubrica já cadastrada pelo usuário (dataURL). Quando presente, o pad
		    reutiliza-a por padrão — evita obrigar o desenho na tela a cada assinatura. */
		rubricaSalva?: string | null;
		step?: SignaturePadStep;
	} = $props();

	// Reutiliza a rubrica cadastrada por padrão quando ela existe; o usuário
	// continua podendo alternar para desenhar uma nova a qualquer momento.
	// O pad é montado a cada abertura do modal, então basta o valor inicial.
	let usarRubricaSalva = $state(untrack(() => !!rubricaSalva));

	function alternarRubricaSalva() {
		usarRubricaSalva = !usarRubricaSalva;
	}

	/** Fonte da rubrica no momento de confirmar: a cadastrada (se reutilizada) ou
	    o desenho atual do canvas. */
	function rubricaSelecionada(): string {
		return usarRubricaSalva && rubricaSalva ? rubricaSalva : rubrica.exportar(100);
	}

	// Máquinas de captura, extraídas para composables: desenho da rubrica
	// (canvas + mouse/touch) e prova de vida (câmera + face-api + challenge).
	const rubrica = useRubricaCanvas();
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
		dataUrl: string;
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
		processarAssinatura(rubricaSelecionada(), coords?.lat, coords?.lng, null);
	}

	async function confirm() {
		const selfieBase64 = await liveness.capturarSelfie();
		// undefined = captura ABORTADA (rosto sumiu/múltiplos no último
		// milissegundo) — o overlay de erro já foi exibido pelo composable.
		if (selfieBase64 === undefined) return;
		processarAssinatura(rubricaSelecionada(), coords?.lat, coords?.lng, selfieBase64);
	}

	async function processarAssinatura(
		dataUrl: string,
		lat: number | undefined,
		lng: number | undefined,
		selfieBase64: string | null
	) {
		// Snapshot do liveness ANTES de qualquer mudança de step. A transição
		// para 'email_code' dispara o $effect que zera o challenge, então
		// recalcular depois devolve null.
		const livenessResultado = liveness.montarLivenessResultado();
		pendingSignature = {
			dataUrl,
			lat,
			lng,
			selfieBase64,
			liveness: livenessResultado,
			reauthId: lerReauthGuardado()
		};
		if (!pendingSignature.reauthId) {
			step = 'password';
			return;
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
				rubrica: pendingSignature.dataUrl,
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
				step = 'password';
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

<!-- Indicador de GPS — usado tanto na área de desenho quanto na pré-visualização
     da rubrica cadastrada. -->
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

	{#if codigoError && step !== 'email_code'}
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
		<div class="space-y-2 {step !== 'signature' ? 'hidden' : ''}">
			<div class="flex justify-between items-end">
				<span
					class="text-3xs font-bold text-surface-600 dark:text-surface-400 uppercase tracking-wider"
					>Sua Rubrica</span
				>
				{#if rubricaSalva}
					<button
						type="button"
						class="text-3xs font-bold uppercase tracking-wider text-primary-600 dark:text-primary-400 hover:underline"
						onclick={alternarRubricaSalva}
					>
						{usarRubricaSalva ? 'Desenhar nova rubrica' : 'Usar rubrica cadastrada'}
					</button>
				{/if}
			</div>
			{#if usarRubricaSalva && rubricaSalva}
				<!-- Reutilizando a rubrica cadastrada: sem obrigar novo desenho na tela. -->
				<div
					class="bg-white border-2 border-primary-300 dark:border-primary-700 rounded-xl overflow-hidden relative min-h-[280px] flex items-center justify-center p-4"
				>
					<span
						class="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 rounded-full bg-primary-500/10 border border-primary-500/20 text-3xs font-black uppercase text-primary-600 dark:text-primary-400"
					>
						<Check class="w-3 h-3" aria-hidden="true" /> Rubrica cadastrada
					</span>
					<img
						src={rubricaSalva}
						alt="Sua rubrica cadastrada"
						width="600"
						height="240"
						class="max-h-[240px] max-w-full object-contain"
					/>
					{@render gpsIndicator()}
				</div>
			{:else}
				<div
					class="bg-white border-2 border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden touch-none relative min-h-[280px]"
				>
					<canvas
						bind:this={rubrica.canvas}
						width="500"
						height="280"
						aria-label="Área de desenho da assinatura manuscrita — desenhe sua assinatura com o dedo ou mouse"
						class="w-full h-[280px] cursor-crosshair touch-none"
						onmousedown={rubrica.startDrawing}
						onmousemove={rubrica.draw}
						onmouseup={rubrica.stopDrawing}
						onmouseleave={rubrica.stopDrawing}
						ontouchstart={rubrica.startDrawing}
						ontouchmove={rubrica.draw}
						ontouchend={rubrica.stopDrawing}
					></canvas>

					{@render gpsIndicator()}
				</div>
			{/if}
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
								<svg
									class="w-4 h-4 text-white"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="3"
										d="M5 13l4 4L19 7"
									/></svg
								>
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

		{#if step === 'email_code'}
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
							: 'border-surface-300 dark:border-surface-600 placeholder:opacity-50'}"
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
	</div>

	{#if locationError && !coords && !capturingLocation}
		<p class="text-3xs font-bold text-error-500 text-center uppercase tracking-tight italic">
			{locationError}
		</p>
	{/if}

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

	<div class="flex flex-wrap justify-between items-center gap-2 mt-4">
		{#if step === 'signature'}
			{#if usarRubricaSalva && rubricaSalva}
				<span class="text-3xs font-medium text-surface-400 italic self-center">
					Usando sua rubrica cadastrada
				</span>
			{:else}
				<button
					type="button"
					class="btn preset-tonal-surface rounded-xl text-xs font-bold uppercase px-4 py-2 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
					onclick={rubrica.clear}
				>
					Limpar
				</button>
			{/if}

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
		{:else if step === 'email_code'}
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
