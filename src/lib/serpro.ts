/**
 * Cliente TypeScript para o Assinador SERPRO Desktop.
 *
 * O Assinador SERPRO é um agente local gratuito que expõe um servidor WebSocket
 * em wss://127.0.0.1:65156/signer/ permitindo que páginas web assinem documentos
 * usando certificados digitais A1/A3 instalados no computador.
 *
 * Para usar, o usuário final deve instalar o Assinador SERPRO Desktop:
 * https://www.serpro.gov.br/menu/nossas-forcas/especializados/assinador-digital
 *
 * Protocolo WebSocket: comandos JSON enviados via ws.send(), respostas via ws.onmessage.
 * Nota: os nomes dos campos JSON foram obtidos da documentação pública do portal
 * https://www.assinadorserpro.estaleiro.serpro.gov.br/minimalista/tutorial/
 * Verifique a documentação oficial caso ocorram erros de protocolo.
 *
 * **Escopo deliberado: só `sign` (type `hash`).** O sistema monta o CMS no
 * servidor e manda ao Assinador apenas o SHA-256 dos SignedAttributes — é o que
 * o fluxo CAdES/PAdES exige, e o que `PainelAssinaturaToken` usa.
 *
 * Duas capacidades que o protocolo oferece foram REMOVIDAS em jul/2026 por não
 * terem nenhum chamador (ver `git log -- src/lib/serpro.ts` para o código):
 *
 * - `listCertificates()` — descobria o comando de listagem por tentativa e erro
 *   (`list`, `getCertificates`, `listarCertificados`…). Era exploração de
 *   protocolo, não funcionalidade: quem escolhe o certificado é a interface
 *   nativa do próprio Assinador, na hora de assinar;
 * - `signFile()` — assinatura com type `file`, em que o SERPRO calcula o digest
 *   dos bytes enviados. Não serve ao modelo atual, e o comentário dela dizia
 *   "é o que precisamos", contradizendo o caminho realmente em uso — dois
 *   métodos parecidos com um deles enganando o próximo leitor.
 *
 * Se um dia for preciso listar certificados ou assinar por arquivo, recupere do
 * histórico em vez de reescrever: o protocolo foi levantado por sondagem.
 */

const dev = import.meta.env.DEV;

/**
 * Resultado do comando "sign" do Assinador SERPRO.
 */
interface SerproSignResult {
	/** Assinatura RSA bruta em Base64 (campo outputData ou signature da resposta). */
	rawSignature: string;
	/** Certificado do signatário em Base64 DER, se retornado pelo SERPRO. */
	certificateBase64?: string;
	/**
	 * Nome do titular do certificado A3, extraído do campo by.alias da resposta SERPRO.
	 * Formato: "NOME COMPLETO:CPF" — o CPF deve ser removido pelo consumidor.
	 * Ausente se o SERPRO não retornou o campo 'by'.
	 */
	signerAlias?: string;
	/** Todas as mensagens recebidas (ACK + resposta real), para diagnóstico. */
	rawMessages: unknown[];
}

/**
 * Hostname real usado pelo Assinador SERPRO.
 * O instalador adiciona "127.0.0.1 assinador-desktop.serpro.gov.br" no hosts do sistema
 * e emite um certificado TLS para esse hostname (não para 127.0.0.1).
 * Fonte: https://forum.netgate.com/topic/176865/aplicativo-do-serpro
 */
const SERPRO_HOST = 'assinador-desktop.serpro.gov.br';

/**
 * Candidatos de URL WebSocket testados em sequência.
 *
 * Tentamos primeiro o hostname oficial (SERPRO v4+, certificado TLS correto),
 * depois o IP de fallback (pode funcionar em versões/configurações antigas).
 */
const SERPRO_WS_URLS = [
	`wss://${SERPRO_HOST}:65166/signer/`,
	`wss://${SERPRO_HOST}:65156/signer/`,
	`wss://${SERPRO_HOST}:65500/signer/`,
	'wss://127.0.0.1:65166/signer/',
	'wss://127.0.0.1:65156/signer/',
	'ws://127.0.0.1:65166/signer/',
	'ws://127.0.0.1:65156/signer/',
	'ws://127.0.0.1:65500/signer/'
];

// ─────────────────────────────────────────────────────────────────────────────
// Classe cliente
// ─────────────────────────────────────────────────────────────────────────────

export class SerproSignerClient {
	private ws: WebSocket | null = null;
	private pendingResolve: ((data: unknown) => void) | null = null;
	private pendingReject: ((err: Error) => void) | null = null;
	private timeoutId: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Conecta ao Assinador SERPRO local.
	 * Tenta URLs em sequência até a primeira que funcionar.
	 *
	 * @param timeoutPerUrlMs - Timeout em ms por URL (padrão 8 s; use valores menores para sondagem rápida)
	 * @param silent          - Se true, suprime logs de console (para sondagem silenciosa)
	 */
	async connect(timeoutPerUrlMs = 8_000, silent = false): Promise<void> {
		if (!silent) {
			if (dev) console.warn('[SERPRO] Iniciando tentativas de conexão WebSocket');
			if (dev) console.warn('[SERPRO] URLs a tentar:', SERPRO_WS_URLS);
		}
		const erros: string[] = [];

		for (const url of SERPRO_WS_URLS) {
			try {
				await this.tryConnect(url, timeoutPerUrlMs);
				if (!silent) {
					if (dev) console.warn(`[SERPRO] ✅ Conectado em ${url}`);
				}
				return;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				erros.push(`${url} → ${msg}`);
				if (!silent && dev) console.warn(`[SERPRO] ❌ Falhou: ${url} — ${msg}`);
			}
		}

		if (!silent) {
			console.error('[SERPRO] Todas as tentativas falharam:', erros);
		}
		throw new Error(
			'Não foi possível conectar ao Assinador SERPRO. ' +
				'Verifique se o software está instalado e em execução.\n' +
				'Detalhes no console do navegador (F12).'
		);
	}

	private tryConnect(url: string, timeoutMs = 8_000): Promise<void> {
		return new Promise((resolve, reject) => {
			if (dev) console.warn(`[SERPRO]   → Tentando ${url} ...`);
			let settled = false;
			const settle = (fn: () => void) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				fn();
			};

			const ws = new WebSocket(url);

			// Timeout cobre tanto o onopen quanto a espera pelo hello
			const timeout = setTimeout(() => {
				if (dev) console.warn(`[SERPRO]   ⏱ Timeout (${timeoutMs}ms) em ${url}`);
				ws.close();
				settle(() => reject(new Error(`Timeout ao conectar em ${url}`)));
			}, timeoutMs);

			ws.onopen = () => {
				if (dev) console.warn(`[SERPRO]   ✅ onopen em ${url}`);
				this.ws = ws;

				// O servidor SERPRO não envia mensagem alguma ao conectar —
				// fica em silêncio aguardando comandos do cliente.
				ws.onmessage = (evt) => this.handleMessage(evt);
				ws.onerror = (ev) => {
					console.error('[SERPRO] Erro pós-conexão:', ev);
					if (this.pendingReject) {
						this.pendingReject(new Error('Erro na conexão WebSocket com o Assinador SERPRO'));
						this.clearPending();
					}
				};
				ws.onclose = (ev) => {
					if (dev)
						console.warn(`[SERPRO] Conexão encerrada — code=${ev.code} reason="${ev.reason}"`);
					if (this.pendingReject) {
						this.pendingReject(
							new Error(`Conexão encerrada pelo Assinador SERPRO (code=${ev.code})`)
						);
						this.clearPending();
					}
				};

				settle(() => resolve());
			};

			ws.onerror = (ev) => {
				if (dev) console.warn(`[SERPRO]   ❌ onerror em ${url}`, ev);
				settle(() => reject(new Error(`onerror em ${url}`)));
			};

			ws.onclose = (ev) => {
				if (dev)
					console.warn(
						`[SERPRO]   🔌 onclose em ${url} — code=${ev.code} wasClean=${ev.wasClean} reason="${ev.reason}"`
					);
				settle(() => reject(new Error(`onclose code=${ev.code} em ${url}`)));
			};
		});
	}

	private handleMessage(event: MessageEvent): void {
		if (this.timeoutId) {
			clearTimeout(this.timeoutId);
			this.timeoutId = null;
		}
		if (!this.pendingResolve) {
			return;
		}
		const resolve = this.pendingResolve;
		this.clearPending();
		resolve(event.data);
	}

	private clearPending(): void {
		this.pendingResolve = null;
		this.pendingReject = null;
		if (this.timeoutId) {
			clearTimeout(this.timeoutId);
			this.timeoutId = null;
		}
	}

	/**
	 * Diagnóstico: envia um comando e coleta TODAS as mensagens recebidas
	 * até 2 s de silêncio ou o timeout total expirar.
	 *
	 * O SERPRO pode enviar uma mensagem de ACK imediatamente e depois enviar
	 * a resposta real (com dados) após interação do usuário.
	 * Retornar todas as mensagens permite diagnosticar o comportamento correto.
	 */
	async probeMulti(command: object, totalTimeoutMs = 8_000, silenceMs = 2_000): Promise<string[]> {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			throw new Error('WebSocket não está conectado');
		}
		const ws = this.ws;
		const messages: string[] = [];

		return new Promise<string[]>((resolve, reject) => {
			let silenceTimer: ReturnType<typeof setTimeout> | null = null;
			let totalTimer: ReturnType<typeof setTimeout> | null = null;

			const done = () => {
				if (silenceTimer) clearTimeout(silenceTimer);
				if (totalTimer) clearTimeout(totalTimer);
				ws.onmessage = (e) => this.handleMessage(e);
				resolve(messages);
			};

			ws.onmessage = (evt: MessageEvent) => {
				messages.push(evt.data as string);
				// Reinicia o timer de silêncio a cada mensagem recebida
				if (silenceTimer) clearTimeout(silenceTimer);
				silenceTimer = setTimeout(done, silenceMs);
			};

			totalTimer = setTimeout(() => {
				if (messages.length > 0) {
					done();
				} else {
					ws.onmessage = (e) => this.handleMessage(e);
					reject(new Error(`Timeout: nenhuma resposta em ${totalTimeoutMs}ms`));
				}
			}, totalTimeoutMs);

			if (dev) console.warn('[SERPRO] 🔬 Probe:', command);
			ws.send(JSON.stringify(command));
		});
	}

	/**
	 * Assina um hash SHA-256 usando o comando "sign" do Assinador SERPRO.
	 *
	 * O SERPRO abre sua interface nativa para o usuário selecionar o certificado
	 * e digitar o PIN. A resposta pode incluir o certificado do signatário.
	 *
	 * Protocolo documentado em serpro-signer-client.js (oficial SERPRO):
	 *   → {"command": "sign", "type": "hash", "inputData": "<base64>", "requestId": <n>}
	 *   ← {"command": "sign", "requestId": <n>, "outputData": "<sig-base64>",
	 *        "certificate?": "<cert-base64>", "actionCanceled": false}
	 *
	 * @param hashBase64 - SHA-256 dos SignedAttributes em Base64
	 * @param timeoutMs  - Tempo máximo aguardando o usuário interagir (padrão 120 s)
	 */
	async sign(hashBase64: string, timeoutMs = 120_000): Promise<SerproSignResult> {
		const requestId = Date.now();
		if (dev)
			console.warn(
				`[SERPRO] → Enviando sign (hash). Aguardando interação do usuário (${timeoutMs / 1000}s)...`
			);

		const msgs = await this.probeMulti(
			{ command: 'sign', type: 'hash', inputData: hashBase64, requestId },
			timeoutMs,
			3_000
		);

		const parsed = msgs.map((m) => {
			try {
				return JSON.parse(m as string);
			} catch {
				return m;
			}
		});
		if (dev) console.warn('[SERPRO] ← Todas as respostas do sign:', parsed);

		// Procura a mensagem real (ignora ACK genérico com command="")
		const real =
			parsed.find((p: unknown) => {
				if (typeof p !== 'object' || p === null) return false;
				const o = p as Record<string, unknown>;
				return (
					o.outputData !== undefined ||
					o.signature !== undefined ||
					o.actionCanceled === true ||
					typeof o.error === 'string'
				);
			}) ?? parsed[parsed.length - 1];

		if (!real || typeof real !== 'object') {
			if (dev) console.error('[SERPRO] Nenhuma resposta válida. Mensagens:', parsed);
			throw new Error(
				'O Assinador SERPRO não retornou resposta. Verifique se o aplicativo está em execução.'
			);
		}

		const o = real as Record<string, unknown>;

		if (typeof o.error === 'string' || o.result === 'ERROR' || o.result === 'FAILURE') {
			throw new Error(interpretarErroSerpro(o));
		}

		if (o.actionCanceled === true) {
			throw new Error('Assinatura cancelada pelo usuário no Assinador SERPRO');
		}

		const rawSignature = (o.outputData ?? o.signature) as string | undefined;
		if (!rawSignature) {
			if (dev) console.error('[SERPRO] Resposta sem assinatura:', Object.keys(o), o);
			throw new Error(
				'O Assinador SERPRO não retornou a assinatura. Verifique se o seu certificado digital está disponível e tente novamente.'
			);
		}

		// O campo 'signature' do SERPRO type:'hash' é um CMS PKCS#7 completo (não assinatura RSA bruta).
		// O certificado está embutido no CMS — não precisamos extraí-lo separadamente.
		// rawSignature = o.signature = CMS completo em base64.
		if (dev)
			console.warn(
				`[SERPRO] ✅ sign: CMS PKCS#7 completo recebido (${rawSignature.length} chars base64)`
			);

		// Extrai o nome do titular do certificado A3 (campo 'by.alias' da resposta SERPRO)
		const by = o.by as Record<string, unknown> | undefined;
		const signerAlias = typeof by?.alias === 'string' ? by.alias : undefined;
		if (signerAlias) {
			if (dev) console.warn(`[SERPRO] ✅ sign: titular do certificado: ${signerAlias}`);
		}

		return { rawSignature, certificateBase64: undefined, signerAlias, rawMessages: parsed };
	}

	/** Encerra a conexão WebSocket. */
	disconnect(): void {
		this.clearPending();
		if (this.ws) {
			this.ws.onmessage = null;
			this.ws.onerror = null;
			this.ws.onclose = null;
			this.ws.close();
			this.ws = null;
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Funções utilitárias para uso no componente Svelte
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mapeia erros técnicos do Assinador SERPRO para mensagens amigáveis em português.
 * Usado por `sign()` quando a resposta contém um campo `error`.
 */
function interpretarErroSerpro(o: Record<string, unknown>): string {
	const raw = String(o.error ?? o.causedBy ?? o.message ?? '');
	const lower = raw.toLowerCase();

	if (
		lower.includes('token') ||
		lower.includes('conectado') ||
		lower.includes('computador') ||
		lower.includes('acess')
	) {
		return 'Certificado digital não localizado. Verifique se o seu token está conectado ou se o certificado está instalado no computador.';
	}
	if (lower.includes('pin') || lower.includes('bloqueado')) {
		return 'PIN/senha incorreto ou certificado bloqueado. Verifique e tente novamente.';
	}
	if (lower.includes('certificado') && (lower.includes('expir') || lower.includes('valid'))) {
		return 'Certificado digital expirado. Entre em contato com a AC emissora para renovação.';
	}
	return raw
		? `Erro no Assinador SERPRO: ${raw}`
		: 'Erro no Assinador SERPRO. Verifique se o seu certificado digital está disponível e tente novamente.';
}

/**
 * Segmento de um parágrafo do aviso, modelado como DADOS (não HTML) para que o
 * modal seja construído via `createElement`/`textContent` — sem `innerHTML`,
 * eliminando o sink de XSS mesmo que o conteúdo passe a vir de fonte dinâmica.
 */
type SegmentoAviso = string | { strong: string } | { link: string; href: string };

interface ParagrafoAviso {
	segmentos: SegmentoAviso[];
	/** Classe do `<p>` (default: parágrafo padrão). */
	classe?: string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Ícone de alerta (estático), criado via DOM em vez de innerHTML. */
function criarIconeAlertaSerpro(): SVGElement {
	const svg = document.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('class', 'w-5 h-5 text-warning-500');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('stroke', 'currentColor');
	const path = document.createElementNS(SVG_NS, 'path');
	path.setAttribute('stroke-linecap', 'round');
	path.setAttribute('stroke-linejoin', 'round');
	path.setAttribute('stroke-width', '2');
	path.setAttribute(
		'd',
		'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'
	);
	svg.appendChild(path);
	return svg;
}

/** Converte um segmento em nó DOM seguro (texto puro, negrito ou link externo). */
function criarSegmentoAviso(seg: SegmentoAviso): Node {
	if (typeof seg === 'string') return document.createTextNode(seg);
	if ('strong' in seg) {
		const strong = document.createElement('strong');
		strong.textContent = seg.strong;
		return strong;
	}
	const a = document.createElement('a');
	// Só aceita http(s): blinda contra `javascript:`/`data:` caso o href passe a
	// vir de fonte dinâmica. Hoje os hrefs são constantes do domínio SERPRO.
	a.href = /^https?:\/\//i.test(seg.href) ? seg.href : '#';
	a.target = '_blank';
	a.rel = 'noopener noreferrer';
	a.className =
		'text-primary-600 dark:text-primary-400 font-semibold underline hover:text-primary-700 dark:hover:text-primary-300';
	a.textContent = seg.link;
	return a;
}

/**
 * Exibe um modal de aviso sobre o Assinador SERPRO.
 *
 * O corpo é descrito como DADOS (`ParagrafoAviso[]`) e renderizado via DOM,
 * nunca por `innerHTML` — não há sink de XSS ainda que o texto venha a ser
 * dinâmico no futuro.
 *
 * @param sessionKey - Chave no sessionStorage para "não mostrar novamente"
 * @param titulo - Título do modal
 * @param paragrafos - Parágrafos do corpo, como segmentos estruturados
 */
function exibirAvisoSerproModal(
	sessionKey: string,
	titulo: string,
	paragrafos: ParagrafoAviso[]
): Promise<boolean> {
	return new Promise((resolve) => {
		if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(sessionKey) === 'true') {
			resolve(true);
			return;
		}

		const modalId = 'serpro-signer-warning-modal';
		const existing = document.getElementById(modalId);
		if (existing) existing.remove();

		const overlay = document.createElement('div');
		overlay.id = modalId;
		overlay.className =
			'fixed inset-0 z-[9999] flex items-center justify-center bg-surface-950/60 p-4 backdrop-blur-sm';

		const card = document.createElement('div');
		card.className =
			'w-full max-w-sm rounded-2xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 p-6 shadow-2xl space-y-4 text-surface-900 dark:text-surface-100 font-sans';

		// Cabeçalho (ícone + título)
		const header = document.createElement('div');
		header.className = 'flex items-start gap-3';
		const iconWrap = document.createElement('div');
		iconWrap.className = 'mt-0.5 shrink-0 rounded-lg p-2 bg-warning-500/10';
		iconWrap.appendChild(criarIconeAlertaSerpro());
		const tituloWrap = document.createElement('div');
		tituloWrap.className = 'min-w-0 flex-1';
		const h3 = document.createElement('h3');
		h3.className = 'text-base font-bold text-surface-900 dark:text-surface-50';
		h3.textContent = titulo;
		tituloWrap.appendChild(h3);
		header.append(iconWrap, tituloWrap);

		// Corpo (parágrafos estruturados, renderizados via DOM)
		const corpo = document.createElement('div');
		corpo.className = 'space-y-2.5 text-sm text-surface-600 dark:text-surface-300';
		for (const paragrafo of paragrafos) {
			const p = document.createElement('p');
			p.className = paragrafo.classe ?? 'leading-relaxed';
			for (const seg of paragrafo.segmentos) p.appendChild(criarSegmentoAviso(seg));
			corpo.appendChild(p);
		}

		// "Não exibir novamente"
		const skipWrap = document.createElement('div');
		skipWrap.className = 'flex items-start gap-2 pt-1';
		const skipCheckbox = document.createElement('input');
		skipCheckbox.type = 'checkbox';
		skipCheckbox.id = 'serpro-skip-checkbox';
		skipCheckbox.className =
			'mt-0.5 w-4 h-4 rounded border-surface-300 dark:border-surface-600 text-primary-600 focus:ring-primary-500 bg-white dark:bg-surface-800 cursor-pointer';
		const skipLabel = document.createElement('label');
		skipLabel.htmlFor = 'serpro-skip-checkbox';
		skipLabel.className =
			'text-xs text-surface-500 dark:text-surface-400 select-none cursor-pointer leading-tight';
		skipLabel.textContent = 'Não exibir este aviso novamente nesta sessão';
		skipWrap.append(skipCheckbox, skipLabel);

		// Ações
		const acoes = document.createElement('div');
		acoes.className = 'flex justify-end gap-3 pt-2';
		const cancelBtn = document.createElement('button');
		cancelBtn.type = 'button';
		cancelBtn.className =
			'btn preset-outlined-surface-500 rounded-xl px-4 py-2 text-sm font-semibold transition-colors';
		cancelBtn.textContent = 'Cancelar';
		const confirmBtn = document.createElement('button');
		confirmBtn.type = 'button';
		confirmBtn.className =
			'btn preset-filled-primary-500 text-white rounded-xl px-4 py-2 text-sm font-bold shadow transition-colors';
		confirmBtn.textContent = 'Continuar';
		acoes.append(cancelBtn, confirmBtn);

		card.append(header, corpo, skipWrap, acoes);
		overlay.appendChild(card);
		document.body.appendChild(overlay);

		const cleanup = () => overlay.remove();

		confirmBtn.addEventListener('click', () => {
			if (skipCheckbox.checked && typeof sessionStorage !== 'undefined') {
				sessionStorage.setItem(sessionKey, 'true');
			}
			cleanup();
			resolve(true);
		});

		cancelBtn.addEventListener('click', () => {
			cleanup();
			resolve(false);
		});
	});
}

/**
 * Aviso padrão para assinatura de documentos.
 */
const SERPRO_DOWNLOAD_URL =
	'https://www.serpro.gov.br/links-fixos-superiores/assinador-digital/assinador-serpro';

function exibirAvisoSerpro(): Promise<boolean> {
	return exibirAvisoSerproModal('pularAvisoSerpro', 'Assinador SERPRO Necessário', [
		{
			segmentos: [
				'Para realizar a assinatura digital no computador, o aplicativo ',
				{ strong: 'Assinador SERPRO' },
				' deve estar instalado e em execução no seu sistema.'
			]
		},
		{
			segmentos: [
				'Se ainda não possui o aplicativo, ',
				{ link: 'Clique aqui para baixar', href: SERPRO_DOWNLOAD_URL },
				'.'
			]
		},
		{
			classe: 'font-medium text-warning-600 dark:text-warning-500',
			segmentos: ['Certifique-se de abrir o aplicativo antes de prosseguir.']
		}
	]);
}

/**
 * Aviso específico para login com Token A3.
 */
function exibirAvisoSerproLogin(): Promise<boolean> {
	return exibirAvisoSerproModal('pularAvisoSerproLogin', 'Login com Certificado Digital', [
		{
			segmentos: [
				'Para entrar com seu certificado digital, o aplicativo ',
				{ strong: 'Assinador SERPRO' },
				' precisa estar instalado e em execução no seu computador.'
			]
		},
		{
			segmentos: [
				'Ele será usado para confirmar sua identidade por meio do seu certificado digital, sem necessidade de senha. Se ainda não possui o aplicativo, ',
				{ link: 'clique aqui para baixar', href: SERPRO_DOWNLOAD_URL },
				'.'
			]
		},
		{
			classe: 'font-medium text-warning-600 dark:text-warning-500',
			segmentos: ['Abra o Assinador SERPRO antes de continuar.']
		}
	]);
}

/**
 * Cria e conecta um cliente SERPRO.
 * Exibe um modal de aviso prévio se não foi silenciado nesta sessão do usuário.
 * Lança erro com mensagem amigável se o Assinador não estiver rodando.
 */
export async function conectarSerpro(): Promise<SerproSignerClient> {
	const prosseguir = await exibirAvisoSerpro();
	if (!prosseguir) {
		throw new Error('Assinatura cancelada pelo usuário.');
	}

	const client = new SerproSignerClient();
	await client.connect();
	return client;
}

/**
 * Conecta ao SERPRO para uso no fluxo de login com Token A3.
 *
 * Estratégia:
 * 1. Tenta conectar silenciosamente com timeout curto (~1 s/URL) — caso o SERPRO já esteja aberto.
 * 2. Se falhar, chama `onBeforeModal` (ex.: esconder loading overlay) e exibe o aviso de login.
 * 3. Após confirmação do usuário, tenta novamente com timeout normal.
 *
 * @param onBeforeModal - Chamado imediatamente antes de exibir o modal (use para esconder loaders).
 */
export async function conectarSerproParaLogin(
	onBeforeModal?: () => void
): Promise<SerproSignerClient> {
	// Sondagem silenciosa: 1 s por URL evita espera longa quando SERPRO não está aberto.
	// Conexões a portas fechadas falham em ms; o timeout só importa para URLs que ficam penduradas.
	const silentClient = new SerproSignerClient();
	try {
		await silentClient.connect(1_000, true);
		return silentClient; // SERPRO já estava aberto — pula o modal
	} catch {
		// SERPRO não está rodando — exibir aviso de login
	}

	onBeforeModal?.();

	const prosseguir = await exibirAvisoSerproLogin();
	if (!prosseguir) {
		throw new Error('Autenticação cancelada pelo usuário.');
	}

	const client = new SerproSignerClient();
	await client.connect();
	return client;
}
