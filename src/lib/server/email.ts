/**
 * Envio de e-mail via Resend API (HTTP REST).
 *
 * Configuração necessária (wrangler.toml / .dev.vars):
 *   RESEND_API_KEY=re_...                  ← Chave de API do Resend
 *   RESEND_FROM_EMAIL=onboarding@resend.dev ← Remetente verificado
 */

import { montarHtmlEmailNotificacaoAssessorGise } from './gise-assessor-notificacao-text';
import { logger } from './logger';
import { mascararEmail } from './auth-flow';

/**
 * Escapa caracteres HTML perigosos para interpolação segura nos templates de e-mail.
 */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#x27;');
}

function getResendConfig(platform: App.Platform | undefined): { apiKey: string; from: string } {
	const e = platform?.env as Env | undefined;
	return {
		apiKey: e?.RESEND_API_KEY ?? '',
		from: e?.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev'
	};
}

function ensureResendConfig(platform: App.Platform | undefined): { apiKey: string; from: string } {
	const { apiKey, from } = getResendConfig(platform);
	if (!apiKey) {
		throw new Error('Resend API key não configurada. Defina RESEND_API_KEY no ambiente.');
	}
	return { apiKey, from };
}

interface EmailAttachment {
	filename: string;
	content: string; // Base64
}

/**
 * Helper genérico para disparar requisições HTTP para a API do Resend.
 */
async function dispararEmail(
	platform: App.Platform | undefined,
	options: {
		to: string;
		subject: string;
		html: string;
		text?: string;
		attachments?: EmailAttachment[];
	}
): Promise<{ messageId: string }> {
	const { apiKey, from } = ensureResendConfig(platform);

	const bodyPayload = {
		from: `Sistema de Escalas - PCCE <${from}>`,
		to: options.to,
		subject: options.subject,
		html: options.html,
		...(options.text ? { text: options.text } : {}),
		...(options.attachments ? { attachments: options.attachments } : {})
	};

	const response = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(bodyPayload)
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Falha ao enviar e-mail via Resend API (HTTP ${response.status}): ${errorText}`);
	}

	const data = (await response.json()) as { id: string };
	return { messageId: data.id };
}

export async function enviarSenhaProvisoria(
	destinatario: string,
	senhaProvisoria: string,
	nomeUsuario: string,
	platform: App.Platform | undefined
): Promise<void> {
	const html = `
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
            <p style="margin:0 0 8px;color:#333;font-size:15px;">Olá, <strong>${escapeHtml(nomeUsuario)}</strong>!</p>
            <p style="margin:0 0 24px;color:#555;font-size:14px;">
              Sua senha provisória de acesso ao sistema foi gerada. Use-a para fazer login e, em seguida, você será solicitado a definir uma nova senha.
            </p>
            <div style="background:#eef2ff;border:2px solid #1a3a6e;border-radius:10px;padding:24px;text-align:center;margin-bottom:24px;">
              <p style="margin:0 0 8px;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Senha Provisória</p>
              <span style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#1a3a6e;font-family:monospace;">${senhaProvisoria}</span>
            </div>
            <p style="margin:0 0 8px;color:#e53e3e;font-size:13px;font-weight:bold;">
              Troque sua senha imediatamente após o primeiro acesso.
            </p>
            <p style="margin:0;color:#666;font-size:13px;">
              Se você não solicitou este acesso, ignore este e-mail e contate o administrador.
            </p>
          </td>
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

	await dispararEmail(platform, {
		to: destinatario,
		subject: 'Senha Provisória — Primeiro Acesso ao Sistema',
		html
	});
}

export async function enviarCodigo2FA(
	destinatario: string,
	codigo: string,
	nomeUsuario: string,
	platform: App.Platform | undefined
): Promise<void> {
	const html = `
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
            <p style="margin:0 0 8px;color:#333;font-size:15px;">Olá, <strong>${escapeHtml(nomeUsuario)}</strong>!</p>
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
          </td>
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

	try {
		const info = await dispararEmail(platform, {
			to: destinatario,
			subject: 'Código de Verificação — Acesso ao Sistema',
			html
		});
		logger.info('[email/2fa] Código enviado', {
			destinatario: mascararEmail(destinatario),
			messageId: info.messageId
		});
	} catch (err) {
		logger.error('[email/2fa] Erro ao enviar', {
			destinatario: mascararEmail(destinatario),
			error: err instanceof Error ? err.message : String(err)
		});
		throw err;
	}
}

export async function enviarCodigoEmailPessoal(
	destinatario: string,
	codigo: string,
	nomeUsuario: string,
	platform: App.Platform | undefined
): Promise<void> {
	const html = `
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
            <p style="margin:0 0 8px;color:#333;font-size:15px;">Olá, <strong>${escapeHtml(nomeUsuario)}</strong>!</p>
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
          </td>
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

	try {
		const info = await dispararEmail(platform, {
			to: destinatario,
			subject: 'Verificação de E-mail Pessoal — Sistema de Escalas',
			html
		});
		logger.info('[email/verificacao-pessoal] Código enviado', {
			destinatario: mascararEmail(destinatario),
			messageId: info.messageId
		});
	} catch (err) {
		logger.error('[email/verificacao-pessoal] Erro ao enviar', {
			destinatario: mascararEmail(destinatario),
			error: err instanceof Error ? err.message : String(err)
		});
		throw err;
	}
}

export async function enviarCodigoRedefinicaoSenha(
	destinatario: string,
	codigo: string,
	nomeUsuario: string,
	platform: App.Platform | undefined
): Promise<void> {
	const html = `
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
            <p style="margin:0 0 8px;color:#333;font-size:15px;">Olá, <strong>${escapeHtml(nomeUsuario)}</strong>!</p>
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
          </td>
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

	try {
		const info = await dispararEmail(platform, {
			to: destinatario,
			subject: 'Código de Redefinição de Senha — Sistema de Escalas',
			html
		});
		logger.info('[email/redefinicao-codigo] Código enviado', {
			destinatario: mascararEmail(destinatario),
			messageId: info.messageId
		});
	} catch (err) {
		logger.error('[email/redefinicao-codigo] Erro ao enviar', {
			destinatario: mascararEmail(destinatario),
			error: err instanceof Error ? err.message : String(err)
		});
		throw err;
	}
}

export async function enviarLinkRedefinicaoSenha(
	destinatario: string,
	nomeUsuario: string,
	linkRedefinicao: string,
	platform: App.Platform | undefined
): Promise<void> {
	const html = `
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
            <p style="margin:0 0 8px;color:#333;font-size:15px;">Olá, <strong>${escapeHtml(nomeUsuario)}</strong>!</p>
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
          </td>
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

	try {
		const info = await dispararEmail(platform, {
			to: destinatario,
			subject: 'Redefinição de Senha — Sistema de Escalas',
			html
		});
		logger.info('[email/redefinicao] Link enviado', {
			destinatario: mascararEmail(destinatario),
			messageId: info.messageId
		});
	} catch (err) {
		logger.error('[email/redefinicao] Erro ao enviar', {
			destinatario: mascararEmail(destinatario),
			error: err instanceof Error ? err.message : String(err)
		});
		throw err;
	}
}

export async function enviarLinkPrimeiroAcesso(
	destinatario: string,
	nomeUsuario: string,
	linkPrimeiroAcesso: string,
	platform: App.Platform | undefined
): Promise<void> {
	const html = `
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
            <p style="margin:0 0 8px;color:#333;font-size:15px;">Olá, <strong>${escapeHtml(nomeUsuario)}</strong>!</p>
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
          </td>
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

	try {
		const info = await dispararEmail(platform, {
			to: destinatario,
			subject: 'Primeiro Acesso — Sistema de Escalas',
			html
		});
		logger.info('[email/primeiro-acesso] Link enviado', {
			destinatario: mascararEmail(destinatario),
			messageId: info.messageId
		});
	} catch (err) {
		logger.error('[email/primeiro-acesso] Erro ao enviar', {
			destinatario: mascararEmail(destinatario),
			error: err instanceof Error ? err.message : String(err)
		});
		throw err;
	}
}

export async function enviarEscalaFDSPorEmail(
	destinatario: string,
	tituloEscala: string,
	nomeRemetente: string,
	docxBuffer: Uint8Array,
	nomeArquivo: string,
	platform: App.Platform | undefined
): Promise<void> {
	const html = `
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
            <p style="margin:0 0 16px;color:#333;font-size:15px;">
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
          </td>
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

	const base64Content = Buffer.from(docxBuffer).toString('base64');

	try {
		const info = await dispararEmail(platform, {
			to: destinatario,
			subject: `Escala de FDS — ${tituloEscala}`,
			text: `Segue em anexo a Escala de Plantão do Final de Semana.\n\nTítulo: ${tituloEscala}\nEnviado por: ${nomeRemetente}`,
			html,
			attachments: [
				{
					filename: nomeArquivo,
					content: base64Content
				}
			]
		});
		logger.info('[email/fds] Escala enviada', {
			destinatario: mascararEmail(destinatario),
			titulo: tituloEscala,
			messageId: info.messageId
		});
	} catch (err) {
		logger.error('[email/fds] Erro ao enviar', {
			destinatario: mascararEmail(destinatario),
			error: err instanceof Error ? err.message : String(err)
		});
		throw err;
	}
}

export async function enviarNotificacaoAssessorGisePreenchimentoSeccional(
	destinatario: string,
	nomeAssessor: string,
	textoPlano: string,
	platform: App.Platform | undefined
): Promise<void> {
	const html = montarHtmlEmailNotificacaoAssessorGise(textoPlano);

	try {
		const info = await dispararEmail(platform, {
			to: destinatario,
			subject: 'GISE — seccional enviou a escala (resumo para WhatsApp)',
			text: textoPlano,
			html
		});
		logger.info('[email/gise-assessor] Notificação enviada', {
			destinatario: mascararEmail(destinatario),
			assessor: nomeAssessor,
			messageId: info.messageId
		});
	} catch (err) {
		logger.error('[email/gise-assessor] Erro ao enviar', {
			destinatario: mascararEmail(destinatario),
			error: err instanceof Error ? err.message : String(err)
		});
		throw err;
	}
}
