import * as fs from 'fs';
import * as path from 'path';

const devVarsPath = path.resolve('.dev.vars');

function parseDevVars(content: string) {
	const env: Record<string, string> = {};
	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eqIndex = trimmed.indexOf('=');
		if (eqIndex === -1) continue;
		const key = trimmed.substring(0, eqIndex).trim();
		const val = trimmed.substring(eqIndex + 1).trim();
		env[key] = val;
	}
	return env;
}

async function main() {
	if (!fs.existsSync(devVarsPath)) {
		console.error('Erro: Arquivo .dev.vars não encontrado!');
		return;
	}

	const content = fs.readFileSync(devVarsPath, 'utf-8');
	const env = parseDevVars(content);

	const apiToken = env.CLOUDFLARE_API_TOKEN;
	const accountId = env.CLOUDFLARE_ACCOUNT_ID;

	console.log('--- Configurações encontradas no .dev.vars ---');
	console.log('CLOUDFLARE_ACCOUNT_ID:', accountId || 'NÃO DEFINIDO');
	console.log('CLOUDFLARE_API_TOKEN:', apiToken ? `Definido (tamanho: ${apiToken.length})` : 'NÃO DEFINIDO');

	if (!apiToken || !accountId) {
		console.error('Erro: CLOUDFLARE_API_TOKEN ou CLOUDFLARE_ACCOUNT_ID está ausente no .dev.vars!');
		return;
	}

	const CF_FROM = 'sistema@nao-responda.escalaspcce.com.br';
	const CF_FROM_NAME = 'Sistema de Escalas - PCCE (Teste)';
	// Vamos enviar para o email que estiver configurado no resend/ou um fixo para teste
	const to = env.RESEND_FROM_EMAIL || 'test@example.com'; 

	console.log('\n--- Enviando e-mail de teste ---');
	console.log('Remetente (From):', `${CF_FROM_NAME} <${CF_FROM}>`);
	console.log('Destinatário (To):', to);

	const bodyPayload = {
		from: { address: CF_FROM, name: CF_FROM_NAME },
		to: to,
		subject: 'Teste de Envio de Email - Cloudflare REST API',
		html: '<h1>Funcionou!</h1><p>Este é um e-mail de teste disparado via REST API da Cloudflare.</p>',
		text: 'Funcionou! Este é um e-mail de teste disparado via REST API da Cloudflare.'
	};

	const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`;
	console.log('\nURL de destino:', url);
	console.log('Payload:', JSON.stringify(bodyPayload, null, 2));

	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiToken}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(bodyPayload)
		});

		console.log('\n--- Resposta da API ---');
		console.log('Status HTTP:', response.status, response.statusText);
		
		const responseText = await response.text();
		console.log('Corpo da Resposta:\n', responseText);

		if (response.ok) {
			const data = JSON.parse(responseText);
			console.log('\nResultado do envio:', data.success ? 'SUCESSO!' : 'FALHA!');
		} else {
			console.log('\nErro no envio do e-mail.');
		}
	} catch (error) {
		console.error('Erro ao fazer a requisição fetch:', error);
	}
}

main();
