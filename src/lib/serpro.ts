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
	 * Tenta a porta principal (65156) e o fallback (65500).
	 */
	async connect(): Promise<void> {
		console.group('[SERPRO] Iniciando tentativas de conexão WebSocket');
		console.log('[SERPRO] URLs a tentar:', SERPRO_WS_URLS);
		const erros: string[] = [];

		for (const url of SERPRO_WS_URLS) {
			try {
				await this.tryConnect(url);
				console.log(`[SERPRO] ✅ Conectado em ${url}`);
				console.groupEnd();
				return;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				erros.push(`${url} → ${msg}`);
				console.warn(`[SERPRO] ❌ Falhou: ${url} — ${msg}`);
			}
		}

		console.error('[SERPRO] Todas as tentativas falharam:', erros);
		console.groupEnd();
		throw new Error(
			'Não foi possível conectar ao Assinador SERPRO. ' +
			'Verifique se o software está instalado e em execução.\n' +
			'Detalhes no console do navegador (F12).'
		);
	}

	private tryConnect(url: string): Promise<void> {
		return new Promise((resolve, reject) => {
			console.log(`[SERPRO]   → Tentando ${url} ...`);
			let settled = false;
			const settle = (fn: () => void) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				fn();
			};

			const ws = new WebSocket(url);

			const timeout = setTimeout(() => {
				console.warn(`[SERPRO]   ⏱ Timeout (5s) em ${url}`);
				ws.close();
				settle(() => reject(new Error(`Timeout ao conectar em ${url}`)));
			}, 5_000);

			ws.onopen = () => {
				console.log(`[SERPRO]   ✅ onopen disparou para ${url}`);
				this.ws = ws;
				ws.onmessage = (event) => this.handleMessage(event);
				ws.onerror = (ev) => {
					console.error('[SERPRO] Erro após conexão:', ev);
					if (this.pendingReject) {
						this.pendingReject(new Error('Erro na conexão WebSocket com o Assinador SERPRO'));
						this.clearPending();
					}
				};
				ws.onclose = (ev) => {
					console.warn(`[SERPRO] Conexão encerrada — code=${ev.code} reason="${ev.reason}"`);
					if (this.pendingReject) {
						this.pendingReject(new Error(`Conexão encerrada pelo Assinador SERPRO (code=${ev.code})`));
						this.clearPending();
					}
				};
				settle(() => resolve());
			};

			ws.onerror = (ev) => {
				console.warn(`[SERPRO]   ❌ onerror em ${url}`, ev);
				settle(() => reject(new Error(`onerror em ${url}`)));
			};

			ws.onclose = (ev) => {
				console.warn(`[SERPRO]   🔌 onclose em ${url} — code=${ev.code} wasClean=${ev.wasClean} reason="${ev.reason}"`);
				settle(() => reject(new Error(`onclose code=${ev.code} em ${url}`)));
			};
		});
	}

	private handleMessage(event: MessageEvent): void {
		console.log('[SERPRO] ← Mensagem recebida:', event.data);
		if (this.timeoutId) {
			clearTimeout(this.timeoutId);
			this.timeoutId = null;
		}
		if (!this.pendingResolve) return;
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
		console.log('[SERPRO] → Enviando comando:', command);
		return new Promise<T>((resolve, reject) => {
			this.pendingResolve = (data) => {
				try {
					const parsed = typeof data === 'string' ? JSON.parse(data) : data;
					if (parsed?.error || parsed?.result === 'ERROR' || parsed?.result === 'FAILURE') {
						reject(
							new Error(
								parsed.message || parsed.error || 'Erro retornado pelo Assinador SERPRO'
							)
						);
					} else {
						resolve(parsed as T);
					}
				} catch {
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
	 * Lista os certificados digitais disponíveis no computador.
	 *
	 * Formato do comando WebSocket (SERPRO Desktop v4.x):
	 *   → {"command": "listCertificates"}
	 *   ← {"command": "listCertificates", "result": "SUCCESS",
	 *        "certificates": [{"alias": "...", "subjectDN": "...", "issuerDN": "..."}]}
	 *
	 * Referência: https://www.assinadorserpro.estaleiro.serpro.gov.br/minimalista/tutorial/
	 */
	async listCertificates(): Promise<SerproCertificate[]> {
		const resp = await this.sendCommand<{
			certificates?: Array<{ alias: string; subjectDN: string; issuerDN?: string; certificate?: string }>;
		}>({ command: 'listCertificates' });
		return (resp.certificates ?? []).map((c) =>
			enriquecerCert({
				alias: c.alias,
				subjectDN: c.subjectDN,
				issuerDN: c.issuerDN,
				certificate: c.certificate
			})
		);
	}

	/**
	 * Obtém o certificado em formato DER codificado em Base64 para o alias informado.
	 *
	 * Formato do comando WebSocket:
	 *   → {"command": "getCertificate", "alias": "<alias>"}
	 *   ← {"command": "getCertificate", "result": "SUCCESS", "certificate": "<base64DER>"}
	 */
	async getCertificate(alias: string): Promise<string> {
		const resp = await this.sendCommand<{ certificate?: string }>({
			command: 'getCertificate',
			alias
		});
		if (!resp.certificate) {
			throw new Error('Assinador SERPRO não retornou o certificado DER');
		}
		return resp.certificate;
	}

	/**
	 * Assina um hash SHA-256 com o certificado selecionado.
	 * Neste momento o Assinador SERPRO abre a janela de PIN para o usuário.
	 *
	 * @param alias - Identificador do certificado retornado por listCertificates()
	 * @param hashBase64 - Hash SHA-256 a ser assinado, codificado em Base64
	 * @returns Assinatura RSA bruta em Base64
	 *
	 * Formato do comando WebSocket:
	 *   → {"command": "signHash", "alias": "<alias>", "hash": "<base64>", "algorithm": "SHA-256"}
	 *   ← {"command": "signHash", "result": "SUCCESS", "signature": "<base64>"}
	 */
	async signHash(alias: string, hashBase64: string): Promise<string> {
		const resp = await this.sendCommand<{ signature?: string }>({
			command: 'signHash',
			alias,
			hash: hashBase64,
			algorithm: 'SHA-256'
		});
		if (!resp.signature) {
			throw new Error('Assinador SERPRO não retornou a assinatura');
		}
		return resp.signature;
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
 * Lista os certificados disponíveis via Assinador SERPRO.
 */
export async function listarCertificadosSerpro(
	client: SerproSignerClient
): Promise<SerproCertificate[]> {
	return client.listCertificates();
}

/**
 * Lê o certificado em Base64 DER.
 * Primeiro tenta usar o campo `certificate` da listagem; se não estiver presente,
 * envia o comando getCertificate.
 */
export async function lerCertificadoSerpro(
	client: SerproSignerClient,
	cert: SerproCertificate
): Promise<string> {
	if (cert.certificate) return cert.certificate;
	return client.getCertificate(cert.alias);
}

/**
 * Assina um hash SHA-256 (em hexadecimal) com o certificado SERPRO.
 * Internamente converte hex → Base64 antes de enviar ao Assinador.
 *
 * @param hashHex - Hash em hexadecimal (como retornado por preparar-assinatura)
 * @returns Assinatura em Base64
 */
export async function assinarHashSerpro(
	client: SerproSignerClient,
	alias: string,
	hashHex: string
): Promise<string> {
	const hashBase64 = hexParaBase64(hashHex);
	return client.signHash(alias, hashBase64);
}
