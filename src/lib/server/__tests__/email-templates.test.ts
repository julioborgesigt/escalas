/**
 * GOLDENS dos e-mails transacionais.
 *
 * Cada remetente de `email.ts` monta um HTML completo (cabeçalho institucional,
 * corpo e rodapé). O template é o que o servidor entrega ao policial fora do
 * sistema — quebra silenciosa aqui só aparece na caixa de entrada de alguém.
 *
 * O harness injeta um binding `EMAIL` falso no `platform`, captura o assunto e o
 * HTML de cada remetente e compara o SHA-256 com o golden versionado em
 * `fixtures/email-templates.json`.
 *
 * Para regravar após uma mudança INTENCIONAL de template:
 *   UPDATE_EMAIL_GOLDENS=1 npx vitest run email-templates
 * e confira o HTML resultante antes de commitar o JSON.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	enviarCodigo2FA,
	enviarCodigoEmailPessoal,
	enviarAvisoTrocaEmailPessoal,
	enviarAvisoChaveAssinatura,
	enviarCodigoRedefinicaoSenha,
	enviarLinkRedefinicaoSenha,
	enviarLinkPrimeiroAcesso,
	enviarNotificacaoAssessorGisePreenchimentoSeccional,
	enviarEscalaFDSPorEmail
} from '../email';
import { CORPORACAO_PROSA } from '$lib/institucional';

const GOLDENS_PATH = join(
	dirname(fileURLToPath(import.meta.url)),
	'fixtures',
	'email-templates.json'
);
const UPDATE = process.env.UPDATE_EMAIL_GOLDENS === '1';

type Capturado = { subject: string; html: string };

/** `platform` com binding EMAIL que só guarda a mensagem em vez de enviar. */
function platformCapturando(alvo: { msg?: Capturado }) {
	return {
		env: {
			EMAIL: {
				async send(m: { subject: string; html: string }) {
					alvo.msg = { subject: m.subject, html: m.html };
					return { messageId: 'golden' };
				}
			}
		}
	} as unknown as App.Platform;
}

async function capturar(fn: (p: App.Platform) => Promise<void>): Promise<Capturado> {
	const alvo: { msg?: Capturado } = {};
	await fn(platformCapturando(alvo));
	if (!alvo.msg) throw new Error('remetente não chamou o binding EMAIL');
	return alvo.msg;
}

const REMETENTES: Array<[string, (p: App.Platform) => Promise<void>]> = [
	['codigo2FA', (p) => enviarCodigo2FA('fulano@pc.ce.gov.br', '123456', 'FULANO DE TAL', p)],
	[
		'codigoEmailPessoal',
		(p) => enviarCodigoEmailPessoal('fulano@pessoal.com', '654321', 'FULANO DE TAL', p)
	],
	[
		'avisoTrocaEmailPessoal',
		(p) =>
			enviarAvisoTrocaEmailPessoal('antigo@pessoal.com', 'FULANO DE TAL', 'novo@pessoal.com', p)
	],
	[
		'avisoChaveCadastrada',
		(p) =>
			enviarAvisoChaveAssinatura(
				'fulano@pc.ce.gov.br',
				'FULANO DE TAL',
				'cadastrada',
				'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHw',
				p,
				'16/08/2026, 16:50'
			)
	],
	[
		'avisoChaveSubstituida',
		(p) =>
			enviarAvisoChaveAssinatura(
				'fulano@pc.ce.gov.br',
				'FULANO DE TAL',
				'substituida',
				'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHw',
				p,
				'16/08/2026, 16:50'
			)
	],
	[
		'avisoChaveRevogada',
		(p) =>
			enviarAvisoChaveAssinatura(
				'fulano@pc.ce.gov.br',
				'FULANO DE TAL',
				'revogada',
				'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHw',
				p,
				'16/08/2026, 16:50'
			)
	],
	[
		'codigoRedefinicaoSenha',
		(p) => enviarCodigoRedefinicaoSenha('fulano@pessoal.com', '999888', 'FULANO DE TAL', p)
	],
	[
		'linkRedefinicaoSenha',
		(p) =>
			enviarLinkRedefinicaoSenha(
				'fulano@pessoal.com',
				'https://escalas.example/redefinir?t=abc',
				'FULANO DE TAL',
				p
			)
	],
	[
		'linkPrimeiroAcesso',
		(p) =>
			enviarLinkPrimeiroAcesso(
				'fulano@pessoal.com',
				'https://escalas.example/primeiro-acesso?t=abc',
				'FULANO DE TAL',
				p
			)
	],
	[
		'notificacaoAssessorGise',
		(p) =>
			enviarNotificacaoAssessorGisePreenchimentoSeccional(
				'assessor@pc.ce.gov.br',
				'ASSESSOR TESTE',
				'A 1ª Seccional enviou o preenchimento.\nFaltam: 2ª Seccional.',
				p
			)
	]
];

describe('templates de e-mail (goldens)', () => {
	it('mantém assunto e HTML de cada remetente', async () => {
		const atuais: Record<string, { subject: string; sha256: string; tamanho: number }> = {};

		for (const [nome, fn] of REMETENTES) {
			const { subject, html } = await capturar(fn);
			atuais[nome] = {
				subject,
				sha256: createHash('sha256').update(html).digest('hex'),
				tamanho: html.length
			};
		}

		if (UPDATE) {
			mkdirSync(dirname(GOLDENS_PATH), { recursive: true });
			writeFileSync(GOLDENS_PATH, JSON.stringify(atuais, null, '\t') + '\n');
			return;
		}

		expect(existsSync(GOLDENS_PATH), 'rode com UPDATE_EMAIL_GOLDENS=1 para criar').toBe(true);
		const goldens = JSON.parse(readFileSync(GOLDENS_PATH, 'utf8'));
		expect(atuais).toEqual(goldens);
	});

	it('o envio da escala de FDS leva texto puro e o .docx em base64', async () => {
		// Os goldens acima comparam só assunto + HTML; este é o único remetente
		// com ANEXO, e o caminho que monta o anexo não passa por eles.
		const capturado: { msg?: Record<string, unknown> } = {};
		const platform = {
			env: {
				EMAIL: {
					async send(m: Record<string, unknown>) {
						capturado.msg = m;
						return { messageId: 'golden' };
					}
				}
			}
		} as unknown as App.Platform;

		await enviarEscalaFDSPorEmail(
			'chefe@pc.ce.gov.br',
			'ESCALA FDS 01/02 DE MARÇO',
			'FULANO DE TAL',
			new Uint8Array([0x50, 0x4b, 0x03, 0x04]), // assinatura de .docx (zip)
			'escala-fds.docx',
			platform
		);

		const m = capturado.msg!;
		expect(m.subject).toBe('Escala de FDS — ESCALA FDS 01/02 DE MARÇO');
		expect(String(m.text)).toContain('ESCALA FDS 01/02 DE MARÇO');
		expect(m.attachments).toEqual([
			{
				disposition: 'attachment',
				filename: 'escala-fds.docx',
				content: Buffer.from([0x50, 0x4b, 0x03, 0x04]).toString('base64'),
				type: 'application/octet-stream'
			}
		]);
	});

	it('todo template traz o cabeçalho institucional e escapa o nome do usuário', async () => {
		const { html } = await capturar((p) =>
			enviarCodigo2FA('x@y.com', '111222', '<script>alert(1)</script>', p)
		);
		expect(html).toContain(CORPORACAO_PROSA);
		expect(html).not.toContain('<script>alert(1)</script>');
		expect(html).toContain('&lt;script&gt;');
	});
});
