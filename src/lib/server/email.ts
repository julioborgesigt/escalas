/**
 * Envio de e-mail com PROVEDOR PADRÃO configurável e fallback automático:
 *   - O provedor padrão (Cloudflare ou Resend) é definido em Configurações Gerais
 *     (`email.provedor_padrao`; default 'cloudflare').
 *   - O OUTRO provedor assume automaticamente quando o padrão falha — inclusive
 *     quando a cota do padrão é extrapolada (erro/429 cai no fallback).
 *
 * Configuração necessária (wrangler.toml / .dev.vars):
 *   EMAIL binding            ← Cloudflare Email Sending
 *   RESEND_API_KEY=re_...    ← Chave de API do Resend
 *   RESEND_FROM_EMAIL=...    ← Remetente verificado no Resend
 *
 * Cada remetente monta só o CORPO da mensagem; a moldura visual vem de
 * `layoutEmail` e o envio + log padronizado, de `enviarERegistrar`. O HTML
 * resultante é congelado por goldens (`__tests__/email-templates.test.ts`).
 */

import { montarHtmlEmailNotificacaoAssessorGise } from './gise/gise-assessor-notificacao-text';
import { logger } from './logger';
import { mascararEmail } from '$lib/utils/pii';
import { getDB, buscarProvedorEmailPadrao, type EmailProvedor } from '$lib/db';

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#x27;');
}

const CF_FROM = 'sistema@nao-responda.escalaspcce.com.br';
const CF_FROM_NAME = 'Sistema de Escalas - PCCE';

interface EmailAttachment {
	filename: string;
	content: string; // Base64
}

interface EmailOptions {
	to: string;
	subject: string;
	html: string;
	text?: string;
	attachments?: EmailAttachment[];
}

// ─── Cloudflare Email Sending ────────────────────────────────────────────────

async function dispararEmailCloudflare(
	platform: App.Platform | undefined,
	options: EmailOptions
): Promise<{ messageId: string }> {
	const env = platform?.env as Env | undefined;

	// Se houver o binding nativo de e-mail (Workers/Pages em prod), prioriza-o
	if (env?.EMAIL && typeof env.EMAIL === 'object' && 'send' in env.EMAIL) {
		const result = await (
			env.EMAIL as { send(m: Record<string, unknown>): Promise<{ messageId?: string }> }
		).send({
			from: { email: CF_FROM, name: CF_FROM_NAME },
			to: [{ email: options.to }],
			subject: options.subject,
			html: options.html,
			...(options.text ? { text: options.text } : {}),
			...(options.attachments?.length
				? {
						attachments: options.attachments.map((a) => ({
							disposition: 'attachment' as const,
							filename: a.filename,
							content: a.content,
							type: 'application/octet-stream'
						}))
					}
				: {})
		});

		return { messageId: result.messageId ?? 'cf-ok' };
	}

	// Caso contrário, tenta enviar via REST API utilizando as credenciais fornecidas
	const apiToken = env?.CLOUDFLARE_API_TOKEN;
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID;

	logger.info('[email/cloudflare] REST API config state', {
		hasApiToken: !!apiToken,
		apiTokenLength: apiToken ? apiToken.length : 0,
		hasAccountId: !!accountId,
		accountId
	});

	if (!apiToken || !accountId) {
		throw new Error('CF_EMAIL_BINDING_ABSENT');
	}

	const bodyPayload = {
		from: { address: CF_FROM, name: CF_FROM_NAME },
		to: options.to,
		subject: options.subject,
		html: options.html,
		...(options.text ? { text: options.text } : {}),
		...(options.attachments?.length
			? {
					attachments: options.attachments.map((a) => ({
						disposition: 'attachment',
						filename: a.filename,
						content: a.content,
						type: 'application/octet-stream'
					}))
				}
			: {})
	};

	const response = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiToken}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(bodyPayload)
		}
	);

	if (!response.ok) {
		const errorText = await response.text();
		logger.error('[email/cloudflare] REST API error response', {
			status: response.status,
			statusText: response.statusText,
			errorText
		});
		throw new Error(
			`Falha ao enviar e-mail via Cloudflare REST API (HTTP ${response.status}): ${errorText}`
		);
	}

	const data = (await response.json()) as {
		success: boolean;
		result: { delivered: string[] } | null;
	};

	logger.info('[email/cloudflare] REST API success response', { data });

	if (!data.success) {
		throw new Error('Falha na resposta do Cloudflare REST API');
	}

	return { messageId: 'cf-rest-ok' };
}

// ─── Resend (fallback) ────────────────────────────────────────────────────────

async function dispararEmailResend(
	platform: App.Platform | undefined,
	options: EmailOptions
): Promise<{ messageId: string }> {
	const e = platform?.env as Env | undefined;
	const apiKey = e?.RESEND_API_KEY ?? '';
	const from = e?.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev';

	if (!apiKey)
		throw new Error('Resend API key não configurada. Defina RESEND_API_KEY no ambiente.');

	const bodyPayload = {
		from: `${CF_FROM_NAME} <${from}>`,
		to: options.to,
		subject: options.subject,
		html: options.html,
		...(options.text ? { text: options.text } : {}),
		...(options.attachments ? { attachments: options.attachments } : {})
	};

	const response = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(bodyPayload)
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`Falha ao enviar e-mail via Resend API (HTTP ${response.status}): ${errorText}`
		);
	}

	const data = (await response.json()) as { id: string };
	return { messageId: data.id };
}

// ─── Dispatcher com fallback ─────────────────────────────────────────────────

type EnvioFn = (p: App.Platform | undefined, o: EmailOptions) => Promise<{ messageId: string }>;

/**
 * Provedor PADRÃO é configurável (Configurações Gerais → `email.provedor_padrao`);
 * default 'cloudflare'. O OUTRO provedor assume automaticamente como fallback
 * quando o padrão falha — inclusive quando a cota do padrão é extrapolada
 * (o provedor devolve erro/429, que cai no catch abaixo).
 */
async function dispararEmail(
	platform: App.Platform | undefined,
	options: EmailOptions
): Promise<{ messageId: string }> {
	let preferido: EmailProvedor = 'cloudflare';
	try {
		preferido = await buscarProvedorEmailPadrao(getDB(platform));
	} catch {
		// Sem DB/config acessível: mantém o padrão histórico (cloudflare).
	}

	const cloudflare: [string, EnvioFn] = ['Cloudflare', dispararEmailCloudflare];
	const resend: [string, EnvioFn] = ['Resend', dispararEmailResend];
	const [[primNome, primFn], [secNome, secFn]] =
		preferido === 'resend' ? [resend, cloudflare] : [cloudflare, resend];

	try {
		const result = await primFn(platform, options);
		logger.debug(`[email] Enviado via ${primNome} (provedor padrão)`);
		return result;
	} catch (errPrim) {
		const motivo = errPrim instanceof Error ? errPrim.message : String(errPrim);
		// Binding do CF ausente é silencioso (config esperada em alguns ambientes);
		// qualquer outra falha — inclusive cota estourada — loga e cai no fallback.
		if (motivo !== 'CF_EMAIL_BINDING_ABSENT') {
			logger.warn(
				`[email] Falha no provedor padrão (${primNome}); usando ${secNome} como fallback`,
				{
					motivo
				}
			);
		}
		return secFn(platform, options);
	}
}

/**
 * Moldura comum dos e-mails transacionais: cabeçalho institucional, cartão
 * branco centralizado e rodapé. Os sete remetentes usavam cópias byte a byte
 * destas 28 linhas — mudar a identidade visual exigia editar todas.
 *
 * `corpo` entra dentro da célula de conteúdo (já com `padding:32px`) e é HTML
 * confiável, montado aqui no servidor; texto vindo do usuário passa por
 * `escapeHtml` antes.
 */
function layoutEmail(corpo: string): string {
	return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:32px 0;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#1a3a6e;padding:24px 32px;">
            <p style="margin:0;color:#ffffff;font-size:18px;font-weight:bold;">Polícia Civil do Ceará</p>
            <p style="margin:4px 0 0;color:#a0b4d6;font-size:13px;">Sistema de Escalas de Plantão</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
${corpo}          </td>
        </tr>
        <tr>
          <td style="background:#f8f9fc;padding:16px 32px;border-top:1px solid #eee;">
            <p style="margin:0;color:#999;font-size:11px;">Sistema de Escalas de Plantão — Polícia Civil do Ceará</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Envia e registra o resultado com o mesmo formato de log em todos os
 * remetentes: sucesso com `messageId`, falha com a mensagem do erro — sempre
 * com o destinatário MASCARADO (o log não guarda e-mail em claro).
 *
 * Relança em caso de falha: quem chama decide se o envio é crítico (bloqueia a
 * ação) ou best-effort (só loga).
 *
 * `extras` cobre os envios que não são só assunto + HTML: `text` (alternativa em
 * texto puro, para quem lê o e-mail sem HTML), `attachments` e `logExtra` com
 * campos adicionais de log. Sem isso, cada um desses remetentes reescrevia o
 * try/catch inteiro e o formato do log podia divergir em silêncio.
 */
async function enviarERegistrar(
	platform: App.Platform | undefined,
	tag: string,
	destinatario: string,
	subject: string,
	html: string,
	acao = 'enviado',
	extras?: {
		text?: string;
		attachments?: EmailOptions['attachments'];
		logExtra?: Record<string, unknown>;
	}
): Promise<void> {
	try {
		const info = await dispararEmail(platform, {
			to: destinatario,
			subject,
			html,
			...(extras?.text ? { text: extras.text } : {}),
			...(extras?.attachments ? { attachments: extras.attachments } : {})
		});
		logger.info(`[email/${tag}] ${acao}`, {
			destinatario: mascararEmail(destinatario),
			...(extras?.logExtra ?? {}),
			messageId: info.messageId
		});
	} catch (err) {
		logger.error(`[email/${tag}] Erro ao enviar`, {
			destinatario: mascararEmail(destinatario),
			error: err instanceof Error ? err.message : String(err)
		});
		throw err;
	}
}

/**
 * Código de 2FA para entrar no sistema, enviado ao e-mail INSTITUCIONAL.
 * Crítico: relança em caso de falha, porque sem o código ninguém entra — a rota
 * de login precisa saber que o envio não aconteceu.
 */
export async function enviarCodigo2FA(
	destinatario: string,
	codigo: string,
	nomeUsuario: string,
	platform: App.Platform | undefined
): Promise<void> {
	const html =
		layoutEmail(`            <p style="margin:0 0 8px;color:#333;font-size:15px;">Olá, <strong>${escapeHtml(nomeUsuario)}</strong>!</p>
            <p style="margin:0 0 24px;color:#555;font-size:14px;">
              Seu código de verificação para acesso ao sistema é:
            </p>
            <div style="background:#eef2ff;border:2px solid #1a3a6e;border-radius:10px;padding:24px;text-align:center;margin-bottom:24px;">
              <span style="font-size:40px;font-weight:bold;letter-spacing:10px;color:#1a3a6e;">${codigo}</span>
            </div>
            <p style="margin:0 0 8px;color:#666;font-size:13px;">
              ⏱ Este código expira em <strong>10 minutos</strong>.
            </p>
            <p style="margin:0;color:#666;font-size:13px;">
              🔒 Se você não tentou fazer login, ignore este e-mail.
            </p>
`);

	await enviarERegistrar(
		platform,
		'2fa',
		destinatario,
		'Código de Verificação — Acesso ao Sistema',
		html,
		'Código enviado'
	);
}

/**
 * Código para o titular confirmar um e-mail PESSOAL como canal de recuperação.
 * Vai para o endereço sendo verificado, que é justamente o que ainda não se
 * pode considerar confiável — daí o código, e não um simples aviso.
 */
export async function enviarCodigoEmailPessoal(
	destinatario: string,
	codigo: string,
	nomeUsuario: string,
	platform: App.Platform | undefined
): Promise<void> {
	const html =
		layoutEmail(`            <p style="margin:0 0 8px;color:#333;font-size:15px;">Olá, <strong>${escapeHtml(nomeUsuario)}</strong>!</p>
            <p style="margin:0 0 24px;color:#555;font-size:14px;">
              Para confirmar seu e-mail pessoal no sistema como canal de recuperação de senha, use o código abaixo:
            </p>
            <div style="background:#eef2ff;border:2px solid #1a3a6e;border-radius:10px;padding:24px;text-align:center;margin-bottom:24px;">
              <p style="margin:0 0 8px;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Código de Verificação</p>
              <span style="font-size:40px;font-weight:bold;letter-spacing:10px;color:#1a3a6e;">${codigo}</span>
            </div>
            <p style="margin:0 0 8px;color:#666;font-size:13px;">
              ⏱ Este código expira em <strong>10 minutos</strong>.
            </p>
            <p style="margin:0;color:#666;font-size:13px;">
              🔒 Se você não solicitou isso, ignore este e-mail.
            </p>
`);

	await enviarERegistrar(
		platform,
		'verificacao-pessoal',
		destinatario,
		'Verificação de E-mail Pessoal — Sistema de Escalas',
		html,
		'Código enviado'
	);
}

/**
 * Aviso informativo ao E-MAIL FUNCIONAL quando o e-mail pessoal (canal de
 * recuperação de senha) é TROCADO pelo perfil. Deixa rastro visível ao
 * titular: se ele não reconhecer a troca, procura o administrador.
 */
export async function enviarAvisoTrocaEmailPessoal(
	destinatarioFuncional: string,
	nomeUsuario: string,
	novoEmailMascarado: string,
	platform: App.Platform | undefined
): Promise<void> {
	const html =
		layoutEmail(`            <p style="margin:0 0 8px;color:#333;font-size:15px;">Olá, <strong>${escapeHtml(nomeUsuario)}</strong>!</p>
            <p style="margin:0 0 16px;color:#555;font-size:14px;">
              O <strong>e-mail pessoal</strong> cadastrado na sua conta (usado para recuperação de senha)
              acaba de ser <strong>alterado</strong> para <strong>${escapeHtml(novoEmailMascarado)}</strong>.
            </p>
            <p style="margin:0 0 8px;color:#666;font-size:13px;">
              ✅ Se foi você, nenhuma ação é necessária.
            </p>
            <p style="margin:0;color:#666;font-size:13px;">
              🔒 Se você <strong>não reconhece</strong> esta alteração, troque sua senha imediatamente e
              comunique o administrador do sistema.
            </p>
`);

	await enviarERegistrar(
		platform,
		'aviso-troca-email-pessoal',
		destinatarioFuncional,
		'Aviso de segurança: e-mail pessoal alterado — Sistema de Escalas',
		html,
		'Aviso enviado'
	);
}

/**
 * Código de redefinição de senha, enviado ao e-mail pessoal já verificado.
 * Alternativa ao link para quem abre o e-mail em outro aparelho.
 */
export async function enviarCodigoRedefinicaoSenha(
	destinatario: string,
	codigo: string,
	nomeUsuario: string,
	platform: App.Platform | undefined
): Promise<void> {
	const html =
		layoutEmail(`            <p style="margin:0 0 8px;color:#333;font-size:15px;">Olá, <strong>${escapeHtml(nomeUsuario)}</strong>!</p>
            <p style="margin:0 0 24px;color:#555;font-size:14px;">
              Use o código abaixo para autorizar o envio do link de redefinição de senha:
            </p>
            <div style="background:#eef2ff;border:2px solid #1a3a6e;border-radius:10px;padding:24px;text-align:center;margin-bottom:24px;">
              <p style="margin:0 0 8px;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Código de Redefinição</p>
              <span style="font-size:40px;font-weight:bold;letter-spacing:10px;color:#1a3a6e;">${codigo}</span>
            </div>
            <p style="margin:0 0 8px;color:#666;font-size:13px;">
              ⏱ Este código expira em <strong>10 minutos</strong>.
            </p>
            <p style="margin:0;color:#666;font-size:13px;">
              🔒 Se você não solicitou a redefinição de senha, ignore este e-mail.
            </p>
`);

	await enviarERegistrar(
		platform,
		'redefinicao-codigo',
		destinatario,
		'Código de Redefinição de Senha — Sistema de Escalas',
		html,
		'Código enviado'
	);
}

/**
 * Link de redefinição de senha. A URL carrega o token em claro — é a
 * credencial: quem tem o link redefine a senha, e por isso o e-mail traz o
 * prazo de validade e o aviso de ignorar se não foi o titular que pediu.
 */
export async function enviarLinkRedefinicaoSenha(
	destinatario: string,
	nomeUsuario: string,
	linkRedefinicao: string,
	platform: App.Platform | undefined
): Promise<void> {
	const html =
		layoutEmail(`            <p style="margin:0 0 8px;color:#333;font-size:15px;">Olá, <strong>${escapeHtml(nomeUsuario)}</strong>!</p>
            <p style="margin:0 0 24px;color:#555;font-size:14px;">
              Recebemos uma solicitação de redefinição de senha para a sua conta no Sistema de Escalas de Plantão.
              Clique no botão abaixo para definir uma nova senha:
            </p>
            <div style="text-align:center;margin-bottom:24px;">
              <a href="${linkRedefinicao}"
                 style="display:inline-block;background:#1a3a6e;color:#ffffff;font-size:15px;font-weight:bold;
                        text-decoration:none;padding:14px 32px;border-radius:8px;">
                Redefinir minha senha
              </a>
            </div>
            <p style="margin:0 0 8px;color:#666;font-size:13px;">
              ⏱ Este link expira em <strong>1 hora</strong>.
            </p>
            <p style="margin:0 0 8px;color:#666;font-size:13px;">
              Se o botão não funcionar, copie e cole este link no navegador:
            </p>
            <p style="margin:0 0 16px;font-size:12px;word-break:break-all;">
              <a href="${linkRedefinicao}" style="color:#1a3a6e;">${linkRedefinicao}</a>
            </p>
            <p style="margin:0;color:#e53e3e;font-size:13px;font-weight:bold;">
              🔒 Se você não solicitou a redefinição de senha, ignore este e-mail. Sua senha permanece a mesma.
            </p>
`);

	await enviarERegistrar(
		platform,
		'redefinicao',
		destinatario,
		'Redefinição de Senha — Sistema de Escalas',
		html,
		'Link enviado'
	);
}

/**
 * Link de primeiro acesso, o único caminho de entrada de quem foi cadastrado
 * (`criarPolicial` grava senha aleatória). Mesma natureza do link de
 * redefinição: a URL é a credencial.
 */
export async function enviarLinkPrimeiroAcesso(
	destinatario: string,
	nomeUsuario: string,
	linkPrimeiroAcesso: string,
	platform: App.Platform | undefined
): Promise<void> {
	const html =
		layoutEmail(`            <p style="margin:0 0 8px;color:#333;font-size:15px;">Olá, <strong>${escapeHtml(nomeUsuario)}</strong>!</p>
            <p style="margin:0 0 24px;color:#555;font-size:14px;">
              Sua conta no Sistema de Escalas de Plantão foi criada. Clique no botão abaixo para definir sua senha e ativar o acesso:
            </p>
            <div style="text-align:center;margin-bottom:24px;">
              <a href="${linkPrimeiroAcesso}"
                 style="display:inline-block;background:#1a3a6e;color:#ffffff;font-size:15px;font-weight:bold;
                        text-decoration:none;padding:14px 32px;border-radius:8px;">
                Definir minha senha
              </a>
            </div>
            <p style="margin:0 0 8px;color:#666;font-size:13px;">
              ⏱ Este link expira em <strong>1 hora</strong>.
            </p>
            <p style="margin:0 0 8px;color:#666;font-size:13px;">
              Se o botão não funcionar, copie e cole este link no navegador:
            </p>
            <p style="margin:0 0 16px;font-size:12px;word-break:break-all;">
              <a href="${linkPrimeiroAcesso}" style="color:#1a3a6e;">${linkPrimeiroAcesso}</a>
            </p>
            <p style="margin:0;color:#e53e3e;font-size:13px;font-weight:bold;">
              🔒 Se você não esperava este e-mail, entre em contato com o administrador do sistema.
            </p>
`);

	await enviarERegistrar(
		platform,
		'primeiro-acesso',
		destinatario,
		'Primeiro Acesso — Sistema de Escalas',
		html,
		'Link enviado'
	);
}

/**
 * Envia a escala de fim de semana com o `.docx` ANEXADO — único remetente com
 * anexo. O buffer é convertido para base64 aqui porque é o formato que os dois
 * provedores esperam, e vai acompanhado de uma versão em texto puro, já que
 * este e-mail costuma ser reencaminhado.
 */
export async function enviarEscalaFDSPorEmail(
	destinatario: string,
	tituloEscala: string,
	nomeRemetente: string,
	docxBuffer: Uint8Array,
	nomeArquivo: string,
	platform: App.Platform | undefined
): Promise<void> {
	const html = layoutEmail(`            <p style="margin:0 0 16px;color:#333;font-size:15px;">
              Segue em anexo a <strong>Escala de Plantão do Final de Semana</strong>:
            </p>
            <div style="background:#eef2ff;border-left:4px solid #1a3a6e;border-radius:6px;padding:16px 20px;margin-bottom:24px;">
              <p style="margin:0;color:#1a3a6e;font-size:14px;font-weight:bold;">${escapeHtml(tituloEscala)}</p>
            </div>
            <p style="margin:0 0 8px;color:#555;font-size:13px;">
              Enviado por: <strong>${escapeHtml(nomeRemetente)}</strong>
            </p>
            <p style="margin:0;color:#888;font-size:12px;">
              O arquivo <em>.docx</em> está disponível em anexo.
            </p>
`);

	// O provedor recebe o anexo em base64, não em bytes.
	const base64Content = Buffer.from(docxBuffer).toString('base64');

	await enviarERegistrar(
		platform,
		'fds',
		destinatario,
		`Escala de FDS — ${tituloEscala}`,
		html,
		'Escala enviada',
		{
			text: `Segue em anexo a Escala de Plantão do Final de Semana.\n\nTítulo: ${tituloEscala}\nEnviado por: ${nomeRemetente}`,
			attachments: [{ filename: nomeArquivo, content: base64Content }],
			logExtra: { titulo: tituloEscala }
		}
	);
}

/**
 * Avisa o assessor que uma seccional enviou sua composição, com o resumo em
 * TEXTO PURO pronto para ele copiar no WhatsApp — o `text` aqui não é fallback
 * do HTML, é o produto principal do e-mail.
 */
export async function enviarNotificacaoAssessorGisePreenchimentoSeccional(
	destinatario: string,
	nomeAssessor: string,
	textoPlano: string,
	platform: App.Platform | undefined
): Promise<void> {
	const html = montarHtmlEmailNotificacaoAssessorGise(textoPlano);

	await enviarERegistrar(
		platform,
		'gise-assessor',
		destinatario,
		'GISE — seccional enviou a escala (resumo para WhatsApp)',
		html,
		'Notificação enviada',
		{ text: textoPlano, logExtra: { assessor: nomeAssessor } }
	);
}
