/**
 * Envio de e-mail via Gmail SMTP com App Password.
 *
 * Configuração necessária (wrangler.toml / .dev.vars):
 *   GMAIL_USER=seu-email@gmail.com
 *   GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx   ← Senha de App do Google
 *
 * Para criar uma Senha de App:
 *   1. Acesse myaccount.google.com → Segurança → Verificação em duas etapas
 *   2. Role até "Senhas de app" e gere uma senha para "E-mail / Windows"
 *   3. Use essa senha (sem espaços) como GMAIL_APP_PASSWORD
 */

import nodemailer from 'nodemailer';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getCredenciais(platform: any): { user: string; pass: string } {
  const env = platform?.env ?? {};
  return {
    user: env.GMAIL_USER ?? '',
    pass: env.GMAIL_APP_PASSWORD ?? ''
  };
}

export async function enviarSenhaProvisoria(
  destinatario: string,
  senhaProvisoria: string,
  nomeUsuario: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  platform: any
): Promise<void> {
  const { user, pass } = getCredenciais(platform);

  if (!user || !pass) {
    throw new Error('E-mail não configurado. Defina GMAIL_USER e GMAIL_APP_PASSWORD no ambiente.');
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass }
  });

  await transporter.sendMail({
    from: `"Sistema de Escalas - PCCE" <${user}>`,
    to: destinatario,
    subject: 'Senha Provisória — Primeiro Acesso ao Sistema',
    html: `
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
            <p style="margin:0 0 8px;color:#333;font-size:15px;">Olá, <strong>${nomeUsuario}</strong>!</p>
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
</html>`
  });
}

export async function enviarCodigo2FA(
  destinatario: string,
  codigo: string,
  nomeUsuario: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  platform: any
): Promise<void> {
  const { user, pass } = getCredenciais(platform);

  if (!user || !pass) {
    throw new Error(
      'E-mail não configurado. Defina GMAIL_USER e GMAIL_APP_PASSWORD no ambiente.'
    );
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // SSL/TLS desde o início (sem STARTTLS)
    auth: { user, pass }
  });

  await transporter.sendMail({
    from: `"Sistema de Escalas - PCCE" <${user}>`,
    to: destinatario,
    subject: 'Código de Verificação — Acesso ao Sistema',
    html: `
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
            <p style="margin:0 0 8px;color:#333;font-size:15px;">Olá, <strong>${nomeUsuario}</strong>!</p>
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
</html>`
  });
}
