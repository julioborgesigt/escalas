/**
 * A validação de PROPRIEDADE do token A3 — o CPF do certificado tem de ser o
 * do usuário logado.
 *
 * É a regra que deu origem ao `signature-service`. O cabeçalho do módulo conta:
 * seis endpoints duplicavam a finalização e as cópias divergiram, com o admin
 * geral **dispensado da checagem de CPF em escalas mas não em GISE**. A
 * extração unificou a política e escreveu, em letras maiúsculas, que NÃO há
 * bypass para admin. Uma varredura de mutação mostrou que nada guardava isso:
 * remover a negação de `if (!user.cpf)` ou inverter `dadosToken.cpf !== user.cpf`
 * deixava a suíte inteira verde.
 *
 * Sem a checagem, quem tiver um token A3 qualquer assina como o usuário logado
 * — e o manifesto do documento registra o nome do titular do certificado, não
 * o de quem apertou o botão. Em perícia, é a diferença entre uma assinatura
 * oponível e um documento que atribui autoria a quem não assinou.
 *
 * `validarPropriedadeToken` é interna, então o teste entra pelo caminho
 * público, `finalizarQualificadaDoPayload`. Os colaboradores de fora — extração
 * do certificado, embutimento do CMS e a verificação CAdES — são mockados: o
 * que está sob teste é a POLÍTICA, e cada um deles já tem teste próprio
 * (`cades-finalizer-aceitacao`, `pdf-signing-prepare`).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/** O que os colaboradores devolvem — cada teste ajusta o que precisa. */
const cenario = {
	dadosCertificado: { nome: 'FULANO DE TAL', cpf: '39053344705' } as {
		nome: string;
		cpf: string;
	} | null,
	erroExtracao: null as Error | null,
	verificacao: {
		ok: true,
		pdfFinal: new Uint8Array([1, 2, 3]),
		metadata: {},
		tipoCarimboTempo: 'servidor',
		signerName: 'FULANO DE TAL',
		signerCpf: '39053344705',
		padesLt: null
	} as Record<string, unknown>
};

vi.mock('../pdf-signing', () => ({
	extrairDadosCertificado: () => {
		if (cenario.erroExtracao) throw cenario.erroExtracao;
		return cenario.dadosCertificado;
	},
	embedSerproCms: async () => new Uint8Array([1, 2, 3])
}));

vi.mock('../cades-finalizer', () => ({
	verificarECarimbarAssinatura: async () => cenario.verificacao
}));

const { finalizarQualificadaDoPayload } = await import('../signature-service');

const CPF = '39053344705';
const PDF_B64 = Buffer.from('%PDF-1.7\n').toString('base64');

function usuario(over: Record<string, unknown> = {}) {
	return { id: 1, tipo: 'policial' as const, nome: 'Fulano de Tal', cpf: CPF, ...over };
}

async function finalizar(user: ReturnType<typeof usuario>) {
	return finalizarQualificadaDoPayload(user, { preparedPdf: PDF_B64, serproCms: 'ZmFrZQ==' });
}

/** Lê status + mensagem da `Response` de erro. */
async function erro(r: { ok: false; response: Response }) {
	const body = (await r.response.clone().json()) as { error: string };
	return { status: r.response.status, error: body.error };
}

beforeEach(() => {
	cenario.dadosCertificado = { nome: 'FULANO DE TAL', cpf: CPF };
	cenario.erroExtracao = null;
	cenario.verificacao = {
		ok: true,
		pdfFinal: new Uint8Array([1, 2, 3]),
		metadata: {},
		tipoCarimboTempo: 'servidor',
		signerName: 'FULANO DE TAL',
		signerCpf: CPF,
		padesLt: null
	};
});

describe('propriedade do token — a linha de base', () => {
	it('token do próprio usuário é aceito', async () => {
		const r = await finalizar(usuario());
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.arquivoHash).toMatch(/^[0-9a-f]{64}$/);
	});

	/**
	 * A comparação de nome normaliza (acento, caixa, espaço) — senão "FULANO DE
	 * TAL" no certificado e "Fulano de Tal" no cadastro seriam pessoas
	 * diferentes.
	 */
	it('nome com acento e caixa diferentes ainda é o mesmo titular', async () => {
		cenario.dadosCertificado = { nome: 'JOSÉ DA SILVA', cpf: CPF };
		const r = await finalizar(usuario({ nome: 'jose da silva' }));
		expect(r.ok).toBe(true);
	});
});

describe('propriedade do token — cada recusa sozinha', () => {
	/**
	 * O caso que o módulo existe para impedir. Sem CPF cadastrado não há como
	 * provar que o token é de quem está logado — e a política diz explicitamente
	 * que admin antigo sem CPF cadastra antes de assinar, em vez de ser
	 * dispensado.
	 */
	it('usuário sem CPF cadastrado é recusado', async () => {
		for (const semCpf of [{ cpf: null }, { cpf: undefined }, { cpf: '' }]) {
			const r = await finalizar(usuario(semCpf));
			expect(r.ok).toBe(false);
			if (r.ok) return;
			const { status, error } = await erro(r);
			expect(status).toBe(400);
			expect(error).toMatch(/não possui CPF/);
		}
	});

	/** Admin geral não tem bypass — a política é única, e isto a prende. */
	it('admin geral sem CPF também é recusado', async () => {
		const r = await finalizar(usuario({ tipo: 'admin', cpf: null }));
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect((await erro(r)).error).toMatch(/não possui CPF/);
	});

	it('CPF do token diferente do cadastrado é recusado', async () => {
		cenario.dadosCertificado = { nome: 'FULANO DE TAL', cpf: '11144477735' };
		const r = await finalizar(usuario());
		expect(r.ok).toBe(false);
		if (r.ok) return;
		const { status, error } = await erro(r);
		expect(status).toBe(400);
		expect(error).toMatch(/CPF incompatível/);
	});

	/** Admin geral com CPF divergente também morre aqui. */
	it('admin geral com CPF divergente é recusado', async () => {
		cenario.dadosCertificado = { nome: 'OUTRA PESSOA', cpf: '11144477735' };
		const r = await finalizar(usuario({ tipo: 'admin' }));
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect((await erro(r)).error).toMatch(/CPF incompatível/);
	});

	it('nome do token diferente do cadastrado é recusado', async () => {
		cenario.dadosCertificado = { nome: 'BELTRANO DE SOUZA', cpf: CPF };
		const r = await finalizar(usuario());
		expect(r.ok).toBe(false);
		if (r.ok) return;
		const { status, error } = await erro(r);
		expect(status).toBe(400);
		expect(error).toMatch(/Nome incompatível/);
	});

	/**
	 * Nome vazio de um dos lados NÃO recusa: certificado sem CN utilizável é
	 * caso conhecido, e o CPF já provou a propriedade. A conjunção
	 * `nomeLogado && nomeToken && ...` é o que escreve isso — trocá-la por `||`
	 * transformaria ausência de nome em recusa.
	 */
	it('nome ausente em um dos lados não recusa — o CPF já provou', async () => {
		cenario.dadosCertificado = { nome: '', cpf: CPF };
		expect((await finalizar(usuario())).ok).toBe(true);

		cenario.dadosCertificado = { nome: 'FULANO DE TAL', cpf: CPF };
		expect((await finalizar(usuario({ nome: '' }))).ok).toBe(true);
	});
});

describe('propriedade do token — quando o certificado não se deixa ler', () => {
	/**
	 * Extração falhando devolve `null`, e aí a validação de propriedade é
	 * PULADA: não há dados para comparar. É decisão do desenho, e fica escrita
	 * aqui porque não é óbvia — quem endurecer isso um dia vai querer ver este
	 * teste mudar junto, não descobrir a mudança em produção.
	 */
	it('falha ao extrair o certificado não bloqueia a finalização', async () => {
		cenario.erroExtracao = new Error('CMS ilegível');
		const r = await finalizar(usuario({ cpf: null }));
		expect(r.ok).toBe(true);
	});

	it('sem serproCms a assinatura é recusada antes de qualquer extração', async () => {
		const r = await finalizarQualificadaDoPayload(usuario(), {
			preparedPdf: PDF_B64,
			serproCms: null
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		const { status, error } = await erro(r);
		expect(status).toBe(400);
		expect(error).toMatch(/serproCms/);
	});
});

/**
 * A cadeia de fallback decide QUAL NOME vai no documento assinado: o que o
 * verificador leu do CMS, senão o do token, senão o da sessão. Trocar qualquer
 * `||` por `&&` faria o nome virar vazio ou saltar para o último da fila — num
 * artefato que atribui autoria, isso não é detalhe de formatação.
 *
 * O nome da sessão é sempre o mesmo titular aqui (variando só a grafia): nome
 * divergente seria recusado pela validação de propriedade acima, e o teste
 * morreria pelo motivo errado.
 */
describe('propriedade do token — de onde vem o nome que vai no documento', () => {
	it('a verificação manda quando traz os dados', async () => {
		const r = await finalizar(usuario());
		expect(r.ok && r.signerName).toBe('FULANO DE TAL');
		expect(r.ok && r.signerCpf).toBe(CPF);
	});

	it('sem dados da verificação, o token responde', async () => {
		cenario.verificacao = { ...cenario.verificacao, signerName: '', signerCpf: '' };
		const r = await finalizar(usuario());
		expect(r.ok && r.signerName).toBe('FULANO DE TAL'); // veio do certificado
		expect(r.ok && r.signerCpf).toBe(CPF);
	});

	it('sem verificação e sem token legível, sobra a sessão', async () => {
		cenario.verificacao = { ...cenario.verificacao, signerName: '', signerCpf: '' };
		cenario.erroExtracao = new Error('CMS ilegível');
		const r = await finalizar(usuario({ nome: 'Fulano de Tal' }));
		expect(r.ok && r.signerName).toBe('Fulano de Tal');
		expect(r.ok && r.signerCpf).toBe(CPF);
	});

	/** Nenhuma das três fontes: o CPF sai string vazia, não `undefined`. */
	it('sem fonte alguma de CPF, devolve string vazia', async () => {
		cenario.verificacao = { ...cenario.verificacao, signerName: '', signerCpf: '' };
		cenario.erroExtracao = new Error('CMS ilegível');
		const r = await finalizar(usuario({ cpf: null }));
		expect(r.ok && r.signerCpf).toBe('');
	});
});

describe('propriedade do token — o mapeamento de erro do payload', () => {
	/**
	 * `status >= 500 → UPSTREAM`, senão `VALIDATION`. Estava copiado em quatro
	 * endpoints antes de virar esta linha, e o `>=` é a fronteira: 500 é falha
	 * de terceiro (SERPRO, OCSP), 4xx é dado do cliente.
	 */
	it('falha 5xx da verificação vira UPSTREAM; 4xx vira VALIDATION', async () => {
		const casos = [
			[500, 'upstream'],
			[502, 'upstream'],
			[422, 'validation'],
			[400, 'validation']
		] as const;
		for (const [status, tipoEsperado] of casos) {
			cenario.verificacao = { ok: false, status, error: `falha ${status}` };
			const r = await finalizar(usuario());
			expect(r.ok).toBe(false);
			if (r.ok) return;
			const body = (await r.response.clone().json()) as { errorType: string };
			expect(r.response.status, `status ${status}`).toBe(status);
			expect(body.errorType, `status ${status}`).toBe(tipoEsperado);
		}
	});
});
