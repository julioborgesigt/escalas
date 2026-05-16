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
 */

import { logger } from '$lib/logger';

const dev = import.meta.env.DEV;

/**
 * Resultado do comando "sign" do Assinador SERPRO.
 */
export interface SerproSignResult {
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

export interface SerproCertificate {
	alias: string;
	subjectDN: string;
	issuerDN?: string;
	/**
	 * Certificado em formato DER codificado em Base64.
	 * Pode não estar presente na listagem — use getCertificate(alias) para obter.
	 */
	certificate?: string;
	/** CPF extraído do subjectDN (formato ICP-Brasil) */
	cpf?: string;
	/** Nome legível extraído do subjectDN */
	subjectName?: string;
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
	'ws://127.0.0.1:65500/signer/',
];

/**
 * URL para aceitar o certificado do SERPRO no navegador.
 * O usuário deve abrir esta URL, clicar em "Avançado" → "Prosseguir" (ou equivalente).
 * No Chrome/Edge isso pode não funcionar — use Firefox para a primeira autorização.
 */
export const SERPRO_CERT_AUTH_URL = `https://${SERPRO_HOST}:65166`;

/** Timeout em ms para cada comando WebSocket */
const COMMAND_TIMEOUT_MS = 30_000;

/**
 * Extrai CPF de uma string subjectDN no padrão ICP-Brasil.
 * Formatos comuns:
 *   CN=NOME DA PESSOA:12345678901
 *   CN=NOME DA PESSOA, C=BR  (CPF na OID 2.16.76.1.3.1 — não presente no DN)
 */
function extrairCpfDoDN(dn: string): string | undefined {
	// Formato "CN=Nome:CPF" — padrão mais comum em ICP-Brasil
	const matchColon = dn.match(/CN=[^,]+:(\d{11})/i);
	if (matchColon) return matchColon[1];
	// Formato "CPF=12345678901"
	const matchCpf = dn.match(/(?:^|,\s*)CPF=(\d{11})/i);
	if (matchCpf) return matchCpf[1];
	return undefined;
}

/**
 * Extrai o nome legível do subjectDN.
 * Remove o CPF sufixado e retorna apenas o nome.
 */
function extrairNomeDoDN(dn: string): string {
	// Busca valor do campo CN
	const match = dn.match(/(?:^|,\s*)CN=([^,]+)/i);
	if (!match) return dn;
	// Remove CPF sufixado no formato "Nome:12345678901"
	return match[1].replace(/:\d{11}$/, '').trim();
}

/**
 * Enriquece um certificado com cpf e subjectName extraídos do subjectDN.
 */
function enriquecerCert(cert: SerproCertificate): SerproCertificate {
	return {
		...cert,
		cpf: cert.cpf ?? extrairCpfDoDN(cert.subjectDN),
		subjectName: cert.subjectName ?? extrairNomeDoDN(cert.subjectDN)
	};
}

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
	 */
	async connect(): Promise<void> {
		dev && console.group('[SERPRO] Iniciando tentativas de conexão WebSocket');
		dev && console.log('[SERPRO] URLs a tentar:', SERPRO_WS_URLS);
		const erros: string[] = [];

		for (const url of SERPRO_WS_URLS) {
			try {
				await this.tryConnect(url);
				dev && console.log(`[SERPRO] ✅ Conectado em ${url}`);
				dev && console.groupEnd();
				return;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				erros.push(`${url} → ${msg}`);
				dev && console.warn(`[SERPRO] ❌ Falhou: ${url} — ${msg}`);
			}
		}

		console.error('[SERPRO] Todas as tentativas falharam:', erros);
		dev && console.groupEnd();
		throw new Error(
			'Não foi possível conectar ao Assinador SERPRO. ' +
			'Verifique se o software está instalado e em execução.\n' +
			'Detalhes no console do navegador (F12).'
		);
	}

	private tryConnect(url: string): Promise<void> {
		return new Promise((resolve, reject) => {
			dev && console.log(`[SERPRO]   → Tentando ${url} ...`);
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
				dev && console.warn(`[SERPRO]   ⏱ Timeout (8s) em ${url}`);
				ws.close();
				settle(() => reject(new Error(`Timeout ao conectar em ${url}`)));
			}, 8_000);

			ws.onopen = () => {
				dev && console.log(`[SERPRO]   ✅ onopen em ${url}`);
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
					dev && console.warn(`[SERPRO] Conexão encerrada — code=${ev.code} reason="${ev.reason}"`);
					if (this.pendingReject) {
						this.pendingReject(new Error(`Conexão encerrada pelo Assinador SERPRO (code=${ev.code})`));
						this.clearPending();
					}
				};

				settle(() => resolve());
			};

			ws.onerror = (ev) => {
				dev && console.warn(`[SERPRO]   ❌ onerror em ${url}`, ev);
				settle(() => reject(new Error(`onerror em ${url}`)));
			};

			ws.onclose = (ev) => {
				dev && console.warn(`[SERPRO]   🔌 onclose em ${url} — code=${ev.code} wasClean=${ev.wasClean} reason="${ev.reason}"`);
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
	 * Envia um comando JSON e aguarda a resposta.
	 */
	private sendCommand<T>(command: object): Promise<T> {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			return Promise.reject(new Error('WebSocket não está conectado'));
		}
		dev && console.log('[SERPRO] → Enviando comando:', command);
		return new Promise<T>((resolve, reject) => {
			this.pendingResolve = (data) => {
				try {
					const parsed = typeof data === 'string' ? JSON.parse(data) : data;
					dev && console.log('[SERPRO]   Resposta parseada:', parsed);
					if (parsed?.error || parsed?.result === 'ERROR' || parsed?.result === 'FAILURE') {
						reject(new Error(parsed.message || parsed.error || 'Erro retornado pelo Assinador SERPRO'));
					} else {
						resolve(parsed as T);
					}
				} catch (err) {
					logger.warn('[SERPRO] parse da resposta do assinador', { err: String(err) });
					reject(new Error('Resposta inválida do Assinador SERPRO'));
				}
			};
			this.pendingReject = reject;
			this.timeoutId = setTimeout(() => {
				this.clearPending();
				reject(new Error('Timeout aguardando resposta do Assinador SERPRO'));
			}, COMMAND_TIMEOUT_MS);
			this.ws!.send(JSON.stringify(command));
		});
	}

	/**
	 * Diagnóstico: envia um comando e coleta TODAS as mensagens recebidas
	 * até 2 s de silêncio ou o timeout total expirar.
	 *
	 * O SERPRO pode enviar uma mensagem de ACK imediatamente e depois enviar
	 * a resposta real (com dados) após interação do usuário.
	 * Retornar todas as mensagens permite diagnosticar o comportamento correto.
	 */
	async probeMulti(
		command: object,
		totalTimeoutMs = 8_000,
		silenceMs = 2_000
	): Promise<string[]> {
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
				if (totalTimer)   clearTimeout(totalTimer);
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

			dev && console.log('[SERPRO] 🔬 Probe:', command);
			ws.send(JSON.stringify(command));
		});
	}

	/**
	 * Lista os certificados digitais disponíveis no computador.
	 *
	 * Estratégia:
	 * 1. Envia {"command":"list"} para descobrir comandos suportados pelo servidor.
	 * 2. Tenta variações de nome de comando para listar certificados.
	 * 3. Cada probe coleta TODAS as mensagens recebidas (ACK + resposta real).
	 *
	 * Importante: a resposta {"command":"","requestId":0,"actionCanceled":false}
	 * parece ser um ACK genérico — pode vir uma segunda mensagem com os dados reais.
	 */
	async listCertificates(): Promise<SerproCertificate[]> {
		dev && console.group('[SERPRO] Descobrindo protocolo de certificados...');

		// Passo 1: listar comandos disponíveis no servidor SERPRO
		try {
			const listMsgs = await this.probeMulti({ command: 'list' });
			dev && console.log('[SERPRO] 🔬 Resposta ao comando "list" (todas as mensagens):',
				listMsgs.map(m => { try { return JSON.parse(m); } catch { return m; } })
			);
		} catch (e) {
			dev && console.warn('[SERPRO] 🔬 Comando "list" falhou:', e);
		}

		// Passo 2: testar variações de nome de comando para listar certificados
		const candidates = [
			{ command: 'listCertificates',   requestId: 1 },
			{ command: 'getCertificates',    requestId: 2 },
			{ command: 'obterCertificados',  requestId: 3 },
			{ command: 'listarCertificados', requestId: 4 },
			{ command: 'certificates',       requestId: 5 },
			{ command: 'getAliases',         requestId: 6 },
			{ command: 'aliases',            requestId: 7 },
		];

		for (const cmd of candidates) {
			try {
				const msgs = await this.probeMulti(cmd);
				const parsed = msgs.map(m => { try { return JSON.parse(m); } catch { return m; } });
				dev && console.log(`[SERPRO] 🔬 ${cmd.command} → ${msgs.length} msg(s):`, parsed);

				// Verifica TODAS as mensagens recebidas em busca de certificados
				for (const p of parsed) {
					if (typeof p !== 'object' || p === null) continue;
					const certs = (p as Record<string, unknown>).certificates
						?? (p as Record<string, unknown>).aliases
						?? (p as Record<string, unknown>).content
						?? (p as Record<string, unknown>).data;
					if (Array.isArray(certs) && certs.length > 0) {
						dev && console.log(`[SERPRO] ✅ "${cmd.command}" retornou ${certs.length} cert(s)`);
						dev && console.groupEnd();
						return (certs as Array<{ alias?: string; subjectDN?: string; issuerDN?: string; certificate?: string; thumbprint?: string }>).map(c =>
							enriquecerCert({
								alias: c.alias ?? c.thumbprint ?? '',
								subjectDN: c.subjectDN ?? '',
								issuerDN: c.issuerDN,
								certificate: c.certificate
							})
						);
					}
				}
			} catch (e) {
				dev && console.warn(`[SERPRO] 🔬 ${cmd.command} → erro:`, e);
			}
		}

		console.warn(
			'[SERPRO] ⚠️ Nenhum comando retornou certificados.\n' +
			'O protocolo SERPRO 4.x pode não suportar listagem programática de certificados.\n' +
			'A seleção de certificado deve ser feita pela UI nativa do Assinador SERPRO ' +
			'durante o comando "sign".'
		);
		dev && console.groupEnd();
		return [];
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
		dev && console.log(`[SERPRO] → Enviando sign (hash). Aguardando interação do usuário (${timeoutMs / 1000}s)...`);

		const msgs = await this.probeMulti(
			{ command: 'sign', type: 'hash', inputData: hashBase64, requestId },
			timeoutMs,
			3_000
		);

		const parsed = msgs.map(m => {
			try { return JSON.parse(m as string); } catch { return m; }
		});
		dev && console.log('[SERPRO] ← Todas as respostas do sign:', parsed);

		// Procura a mensagem real (ignora ACK genérico com command="")
		const real = parsed.find((p: unknown) => {
			if (typeof p !== 'object' || p === null) return false;
			const o = p as Record<string, unknown>;
			return o.outputData !== undefined || o.signature !== undefined || o.actionCanceled === true;
		}) ?? parsed[parsed.length - 1];

		if (!real || typeof real !== 'object') {
			throw new Error(
				`Assinador SERPRO não retornou resposta válida.\nMensagens: ${JSON.stringify(parsed)}`
			);
		}

		const o = real as Record<string, unknown>;

		if (o.actionCanceled === true) {
			throw new Error('Assinatura cancelada pelo usuário no Assinador SERPRO');
		}

		const rawSignature = (o.outputData ?? o.signature) as string | undefined;
		if (!rawSignature) {
			const campos = Object.keys(o).join(', ');
			dev && console.error('[SERPRO] Resposta sem assinatura. Campos disponíveis:', campos, o);
			throw new Error(
				`Assinador SERPRO não retornou a assinatura.\n` +
				`Campos na resposta: ${campos}.\n` +
				`Resposta completa: ${JSON.stringify(o)}`
			);
		}

		// O campo 'signature' do SERPRO type:'hash' é um CMS PKCS#7 completo (não assinatura RSA bruta).
		// O certificado está embutido no CMS — não precisamos extraí-lo separadamente.
		// rawSignature = o.signature = CMS completo em base64.
		dev && console.log(`[SERPRO] ✅ sign: CMS PKCS#7 completo recebido (${rawSignature.length} chars base64)`);

		// Extrai o nome do titular do certificado A3 (campo 'by.alias' da resposta SERPRO)
		const by = o.by as Record<string, unknown> | undefined;
		const signerAlias = typeof by?.alias === 'string' ? by.alias : undefined;
		if (signerAlias) {
			dev && console.log(`[SERPRO] ✅ sign: titular do certificado: ${signerAlias}`);
		}

		return { rawSignature, certificateBase64: undefined, signerAlias, rawMessages: parsed };
	}

	/**
	 * Assina um arquivo (bytes em Base64) usando o Assinador SERPRO com type:'file'.
	 *
	 * O SERPRO computa SHA-256(input_bytes) e usa como messageDigest no CMS — sem double-hash.
	 * Isso é o que precisamos: enviar o byte-range do PDF para que o CMS.messageDigest
	 * seja SHA-256(byte-range), valor esperado pelo validador de assinaturas PDF.
	 *
	 * @param dataBase64  - Bytes do arquivo em Base64 (ex: byte-range do PDF)
	 * @param timeoutMs   - Tempo máximo aguardando interação do usuário (padrão 120 s)
	 */
	async signFile(dataBase64: string, timeoutMs = 120_000): Promise<SerproSignResult> {
		const requestId = Date.now();
		dev && console.log(`[SERPRO] → Enviando sign (file, ${Math.round(dataBase64.length * 3 / 4 / 1024)} KB). Aguardando interação (${timeoutMs / 1000}s)...`);

		const msgs = await this.probeMulti(
			{ command: 'sign', type: 'file', inputData: dataBase64, outputDataType: 'base64', requestId },
			timeoutMs,
			3_000
		);

		const parsed = msgs.map(m => {
			try { return JSON.parse(m as string); } catch { return m; }
		});
		dev && console.log('[SERPRO] ← Todas as respostas do signFile:', parsed);

		const real = parsed.find((p: unknown) => {
			if (typeof p !== 'object' || p === null) return false;
			const o = p as Record<string, unknown>;
			return o.outputData !== undefined || o.signature !== undefined || o.actionCanceled === true;
		}) ?? parsed[parsed.length - 1];

		if (!real || typeof real !== 'object') {
			throw new Error(`Assinador SERPRO não retornou resposta válida.\nMensagens: ${JSON.stringify(parsed)}`);
		}

		const o = real as Record<string, unknown>;

		if (o.actionCanceled === true) {
			throw new Error('Assinatura cancelada pelo usuário no Assinador SERPRO');
		}

		dev && console.log('[SERPRO] Campos disponíveis na resposta signFile:', Object.keys(o));

		const rawSignature = (o.outputData ?? o.signature) as string | undefined;
		if (!rawSignature) {
			throw new Error(
				`Assinador SERPRO não retornou assinatura.\n` +
				`Campos: ${Object.keys(o).join(', ')}\nResposta: ${JSON.stringify(o)}`
			);
		}

		const certificateBase64 = (
			o.certificate ?? o.signerCertificate ?? o.cert
		) as string | undefined;

		return { rawSignature, certificateBase64, rawMessages: parsed };
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
 * Converte uma string hexadecimal em Base64.
 */
function hexParaBase64(hex: string): string {
	const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin);
}

/**
 * Cria e conecta um cliente SERPRO.
 * Lança erro com mensagem amigável se o Assinador não estiver rodando.
 */
export async function conectarSerpro(): Promise<SerproSignerClient> {
	const client = new SerproSignerClient();
	await client.connect();
	return client;
}

/**
 * Assina um hash SHA-256 (hexadecimal) usando o Assinador SERPRO.
 *
 * O SERPRO exibe sua interface nativa para seleção de certificado e PIN.
 * A resposta deve incluir a assinatura e (esperamos) o certificado do signatário.
 *
 * @param client  - Cliente SERPRO conectado
 * @param hashHex - Hash em hexadecimal dos SignedAttributes (retornado por preparar-assinatura)
 * @returns rawSignature e certificateBase64 para uso em finalizar-assinatura
 */
/**
 * Assina os bytes do byte-range do PDF usando o Assinador SERPRO com type:'file'.
 *
 * O SERPRO computa SHA-256(byte-range) e usa como messageDigest no CMS resultante.
 * O CMS é então embutido diretamente no placeholder /Contents do PDF preparado.
 *
 * @param client           - Cliente SERPRO conectado
 * @param dataToSignBase64 - Bytes do byte-range do PDF em Base64 (de preparar-assinatura)
 * @returns cmsBase64 - CMS SignedData completo retornado pelo SERPRO
 */
export async function assinarSerpro(
	client: SerproSignerClient,
	dataToSignBase64: string
): Promise<{ cmsBase64: string }> {
	const result = await client.signFile(dataToSignBase64);
	// result.rawSignature = campo 'signature' ou 'outputData' da resposta SERPRO = CMS completo
	return { cmsBase64: result.rawSignature };
}
