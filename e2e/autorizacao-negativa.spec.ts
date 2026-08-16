/**
 * Cobertura NEGATIVA das operações materiais — as duas perguntas que nenhum
 * teste de caminho feliz responde.
 *
 * O guard de CI (`scripts/guard-autorizacao.mjs`) prova que toda operação
 * material CONTÉM uma decisão de autorização. Ele lê o código; não executa
 * nada. Duas coisas ficam fora do alcance dele, e são estas as que este spec
 * cobre:
 *
 *   1. **A decisão acontece antes do trabalho?** Um handler que faz o parse do
 *      corpo, procura o recurso ou toca o banco ANTES de conferir a sessão
 *      responde 400/404/500 ao anônimo. Contém o gate, e mesmo assim conta o
 *      que existe. O guard vê o gate; só a requisição revela a ordem.
 *   2. **O gate olha o RECURSO ou só o usuário?** "Está logado" e "é admin de
 *      alguma unidade" passam no guard e continuam deixando trocar o `[id]` na
 *      URL pelo de outra unidade — foi assim em FLW-ESC-002, e é o que
 *      FLW-ACL-002 e FLW-GISE-004 descrevem.
 *
 * Cobre os dois tipos de operação material, porque o risco não está só na API:
 * das 113, **70 são form actions**, e é lá que moram FLW-ESC-001, 002 e 003.
 *
 * A tabela NÃO é escrita à mão: vem de `src/routes/**`, varrida em tempo de
 * teste. Rota nova entra sozinha. Tabela escrita à mão só cobre o que alguém
 * lembrou de acrescentar — e o handler novo, que é o caso perigoso, é
 * justamente o que ninguém lembra.
 *
 * As rotas públicas de propósito vêm de `PUBLICAS`, declarada junto do guard.
 * Duas listas divergiriam, e a que divergisse em silêncio seria a do teste.
 */
import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURE } from './global-setup';
import { seedSession, headersDeSessaoMutacao, headersFormAction, queryD1Local } from './session';
// @ts-expect-error — script de guard em .mjs, sem tipos; só a lista importa.
import { PUBLICAS } from '../scripts/guard-autorizacao.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR_ROTAS = join(RAIZ, 'src', 'routes');

type Metodo = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface Operacao {
	/** Caminho do arquivo relativo à raiz — a chave usada em PUBLICAS. */
	arquivo: string;
	/** URL com os `[param]` ainda no lugar. */
	padrao: string;
	/** Método HTTP (API) ou nome da form action. */
	alvo: string;
	tipo: 'api' | 'action';
}

/** `src/routes/gise/[id]/_actions/x.ts` → `/gise/[id]` (a action é da rota pai). */
function urlDaRota(dirArquivo: string): string {
	const rel = relative(DIR_ROTAS, dirArquivo).replaceAll('\\', '/');
	const semActions = rel.replace(/\/?_actions$/, '');
	// Grupos de layout `(grupo)` não aparecem na URL.
	const segmentos = semActions
		.split('/')
		.filter((s) => s && !(s.startsWith('(') && s.endsWith(')')));
	return '/' + segmentos.join('/');
}

/** Varre `src/routes/**` e devolve toda operação material declarada. */
function operacoesMateriais(): Operacao[] {
	const achadas: Operacao[] = [];
	const andar = (dir: string) => {
		for (const entrada of readdirSync(dir)) {
			const caminho = join(dir, entrada);
			if (statSync(caminho).isDirectory()) {
				andar(caminho);
				continue;
			}
			const ehApi = entrada === '+server.ts';
			const ehPagina = entrada === '+page.server.ts';
			const ehModuloAction = dir.endsWith('_actions') && entrada.endsWith('.ts');
			if (!ehApi && !ehPagina && !ehModuloAction) continue;

			const src = readFileSync(caminho, 'utf8');
			const arquivo = relative(RAIZ, caminho).replaceAll('\\', '/');
			const padrao = urlDaRota(dir);

			if (ehApi) {
				for (const m of src.matchAll(/export const (POST|PUT|PATCH|DELETE)\b/g)) {
					achadas.push({ arquivo, padrao, alvo: m[1], tipo: 'api' });
				}
			} else {
				for (const m of src.matchAll(/^\s+([a-zA-Z][\w]*): async/gm)) {
					achadas.push({ arquivo, padrao, alvo: m[1], tipo: 'action' });
				}
			}
		}
	};
	andar(DIR_ROTAS);
	return achadas.sort((a, b) => (a.padrao + a.alvo).localeCompare(b.padrao + b.alvo));
}

/** Rota que o anônimo pode alcançar de propósito (login, 2FA, certificado). */
function ehPublica(o: Operacao): boolean {
	return (PUBLICAS as string[]).includes(o.arquivo);
}

/**
 * Preenche os `[param]` com ids de fixture que EXISTEM. Id inexistente daria
 * 404 e o teste passaria sem ter exercido o gate — o objetivo é justamente
 * bater num recurso real ao qual o chamador não tem direito.
 */
function comIdsDeFixture(padrao: string): string {
	return (
		padrao
			// `escalaAssinavel` está EDITÁVEL — sem documento e não finalizada. A
			// primeira versão deste spec apontava para `escalaA`, que tem documento
			// assinado: as actions de conteúdo paravam no 409 de imutabilidade antes
			// de chegar à permissão, e o teste passava mesmo com a checagem de lotação
			// REMOVIDA do servidor. Alvo protegido por outro motivo não testa este.
			.replace('/escalas/[id]', `/escalas/${FIXTURE.escalaAssinavel.id}`)
			.replace('/gise/[id]', `/gise/${FIXTURE.gise.id}`)
			.replace('/policiais/[id]', `/policiais/${FIXTURE.policialA.id}`)
			.replace('[giseId]', String(FIXTURE.gise.id))
			.replace('[seccionalId]', String(FIXTURE.seccional.id))
			.replace(/\[[^\]]+\]/g, '1')
	);
}

function url(o: Operacao): string {
	const base = comIdsDeFixture(o.padrao);
	// `finalizar-assinatura-avancada` da presença lê `?tipo=` na URL, não o
	// corpo. Sem a query o handler recusava 400 ANTES da participação — o
	// policial de outra unidade "passava" no gate errado.
	const comQuery =
		o.tipo === 'api' && o.padrao.includes('/presenca/finalizar-assinatura')
			? `${base}?tipo=entrada`
			: base;
	return o.tipo === 'api' ? comQuery : `${base}?/${o.alvo}`;
}

/**
 * Corpo mínimo para as operações que VALIDAM antes de autorizar.
 *
 * A maioria recusa o corpo vazio na cara — o gate vem primeiro e nem lê o
 * `FormData`. Estas leem, e com `{}` respondiam 400: uma recusa que não prova
 * nada sobre permissão e MASCARA a ausência do gate. Foi assim que a primeira
 * versão deste spec passou com a checagem de seccional removida do servidor.
 *
 * Os valores só precisam atravessar a validação; apontam para recursos reais da
 * fixture, para que o que sobre seja exatamente a decisão de permissão.
 */
const CORPO_MINIMO: Record<string, Record<string, string>> = {
	'/gise/[id]?/adicionarMembro': {
		secId: String(FIXTURE.giseSeccional.id),
		equipe_id: String(FIXTURE.giseEquipe.id),
		policial_id: String(FIXTURE.policialB.id)
	},
	// Id REAL do membro semeado: com um id inexistente a action pararia no
	// "não encontrado" e o teste não chegaria a exercer a permissão.
	'/gise/[id]?/removerMembro': { memId: idDoMembroFixture() },
	'/gise/[id]?/finalizarSeccional': { secId: String(FIXTURE.giseSeccional.id) },
	'/gise/[id]?/salvarHorariosSec': {
		secId: String(FIXTURE.giseSeccional.id),
		hora_entrada: '08:00',
		hora_saida: '16:00'
	},
	'/gise/[id]?/selecionarUnidade': { slotId: '1', unidadeId: String(FIXTURE.unidadeB.id) },
	'/res-gise/relatorio/[giseId]?/salvarResposta': { respostas: '{}' }
};

/** Id da linha `gise_membros` semeada pelo global-setup ('0' se o D1 falhar). */
function idDoMembroFixture(): string {
	const r = queryD1Local<{ id: number }>(
		`SELECT id FROM gise_membros WHERE equipe_id = ${FIXTURE.giseEquipe.id} LIMIT 1`
	);
	return String(r?.[0]?.id ?? 0);
}

/** PDF base64 grande o bastante para o schema (min 100 chars). */
const PDF_FALSO = Buffer.from('%PDF-1.7\n'.repeat(40)).toString('base64');

/** Data URL de imagem que satisfaz o schema da rubrica. */
const RUBRICA_FALSA = 'data:image/png;base64,iVBORw0KGgo=';

/** Corpo JSON mínimo das rotas de assinatura, que fazem Zod antes do gate. */
const CORPO_JSON: Record<string, Record<string, unknown>> = {
	'/api/escalas/[id]/finalizar-assinatura': {
		intencao: 'a'.repeat(64),
		preparedPdf: PDF_FALSO,
		signerName: 'Fulano de Tal',
		signerCpf: '39053344705'
	},
	'/api/escalas/[id]/finalizar-assinatura-avancada': {
		intencao: 'a'.repeat(64),
		preparedPdf: PDF_FALSO,
		assercao: {
			credentialId: 'AAAA',
			clientDataJSON: 'AAAA',
			authenticatorData: 'AAAA',
			assinatura: 'AAAA'
		}
	},
	'/api/gise/[id]/finalizar-assinatura': {
		intencao: 'a'.repeat(64),
		preparedPdf: PDF_FALSO,
		signerName: 'Fulano de Tal',
		signerCpf: '39053344705',
		assinanteEmail: 'fulano@e2e.local',
		rubrica: RUBRICA_FALSA,
		latitude: -3.73,
		longitude: -38.52
	},
	'/api/gise/[id]/presenca/finalizar-assinatura': {
		intencao: 'a'.repeat(64),
		preparedPdf: PDF_FALSO,
		signerName: 'Fulano de Tal',
		signerCpf: '39053344705',
		assinanteEmail: 'fulano@e2e.local',
		latitude: -3.73,
		longitude: -38.52,
		tipo: 'entrada'
	},
	'/api/gise/[id]/presenca/finalizar-assinatura-avancada': {
		intencao: 'a'.repeat(64),
		preparedPdf: PDF_FALSO,
		assercao: {
			credentialId: 'AAAA',
			clientDataJSON: 'AAAA',
			authenticatorData: 'AAAA',
			assinatura: 'AAAA'
		}
	},
	'/api/gise/[id]/presenca/preparar-assinatura': {
		tipo: 'entrada',
		signerName: 'Fulano de Tal',
		signerCpf: '39053344705'
	},
	'/api/gise/[id]/presenca/preparar-assinatura-avancada': {
		tipo: 'entrada',
		rubrica: RUBRICA_FALSA
	},
	'/api/gise/[id]/relatorios/[seccionalId]/assinar': {
		rubrica: 'data:image/png;base64,iVBORw0KGgo=',
		signerName: 'Fulano de Tal'
	}
};

async function chamar(request: APIRequestContext, o: Operacao, headers: Record<string, string>) {
	if (o.tipo === 'action') {
		// Form action: multipart vazio, salvo quando a action valida antes de
		// autorizar. Se o gate estiver no lugar, o corpo nem chega a ser lido.
		const multipart = CORPO_MINIMO[`${o.padrao}?/${o.alvo}`] ?? {};
		return request.post(url(o), { headers, multipart });
	}
	const opcoes = {
		headers: { 'content-type': 'application/json', ...headers },
		data: CORPO_JSON[o.padrao] ?? {}
	};
	if (o.alvo === 'POST') return request.post(url(o), opcoes);
	if (o.alvo === 'PUT') return request.put(url(o), opcoes);
	if (o.alvo === 'PATCH') return request.patch(url(o), opcoes);
	return request.delete(url(o), opcoes);
}

/**
 * Como a operação terminou, em vocabulário único para os dois tipos.
 *
 * Form action não usa o status HTTP: com `x-sveltekit-action`, o SvelteKit
 * serializa o `ActionResult` em JSON sob HTTP 200, e o desfecho real está no
 * `type`. Ler o status HTTP aqui daria 200 para TODA action — inclusive a que
 * executou —, e o teste passaria justamente onde deveria gritar.
 *
 * `redirect` conta como recusa porque o gate global de `hooks.server.ts` manda
 * o anônimo para `/login` antes de a action rodar; nenhuma action deste projeto
 * redireciona em caso de sucesso.
 */
async function desfecho(
	res: Awaited<ReturnType<typeof chamar>>,
	tipo: 'api' | 'action'
): Promise<{ recusou: boolean; como: string }> {
	if (tipo === 'api') {
		const s = res.status();
		// A mensagem entra no relato: "400" sozinho não diz se foi corpo mal
		// formado (ajuste o teste) ou o gate na ordem errada (ajuste a rota).
		const msg =
			s === 401 || s === 403 ? '' : `  «${(await res.text().catch(() => '')).slice(0, 120)}»`;
		return { recusou: s === 401 || s === 403, como: `${s}${msg}` };
	}
	const corpo = (await res.json().catch(() => null)) as {
		type?: string;
		status?: number;
		data?: string;
	} | null;
	if (!corpo?.type) return { recusou: false, como: `resposta ilegível (HTTP ${res.status()})` };
	if (corpo.type === 'redirect') return { recusou: true, como: 'redirect (gate global)' };
	if (corpo.type === 'failure') {
		const s = corpo.status ?? 0;
		if (s !== 401 && s !== 403) {
			return { recusou: false, como: `failure ${s}  «${String(corpo.data ?? '').slice(0, 120)}»` };
		}
		return { recusou: s === 401 || s === 403, como: `failure ${s}` };
	}
	// `success` = executou. `error` = chegou a trabalhar e quebrou.
	return { recusou: false, como: corpo.type };
}

/** Soma de documentos assinados: o efeito irreversível que nenhuma recusa pode produzir. */
function totalDocumentos(): number | null {
	const r = queryD1Local<{ n: number }>(
		'SELECT (SELECT COUNT(*) FROM escala_documentos) + (SELECT COUNT(*) FROM gise_documentos) AS n'
	);
	return r?.[0]?.n ?? null;
}

const todas = operacoesMateriais();
const protegidas = todas.filter((o) => !ehPublica(o));

test.describe('Autorização negativa', () => {
	test('a varredura encontrou as operações (a tabela não pode estar vazia)', () => {
		// Sem isto, um erro de caminho faria a suíte inteira "passar" sem exercer
		// uma requisição sequer. Silêncio não é aprovação.
		expect(todas.filter((o) => o.tipo === 'api').length).toBeGreaterThan(30);
		expect(todas.filter((o) => o.tipo === 'action').length).toBeGreaterThan(50);
		expect(protegidas.length).toBeGreaterThan(90);
	});

	test('anônimo é recusado ANTES de qualquer trabalho, em toda operação material', async ({
		request
	}) => {
		const antes = totalDocumentos();
		const falhas: string[] = [];

		for (const o of protegidas) {
			// CSRF válido (double-submit consigo mesmo) e sessão INEXISTENTE: assim
			// a recusa que sobra é a de autenticação, não a do guard de CSRF.
			const headers =
				o.tipo === 'api'
					? headersDeSessaoMutacao('sessao-que-nao-existe')
					: headersFormAction('sessao-que-nao-existe');
			const res = await chamar(request, o, headers);

			// Recusa é 401/403 (API) ou redirect/failure 401/403 (action). 400
			// significa que o corpo foi lido antes; 404, que o recurso foi procurado
			// antes; 5xx, que o handler chegou a trabalhar. `success` é a operação
			// tendo acontecido.
			const d = await desfecho(res, o.tipo);
			if (!d.recusou) falhas.push(`${d.como}  ${url(o)}`);
		}

		expect(
			falhas,
			'operações que não recusaram o anônimo com 401/403 — o gate precisa vir ' +
				'antes de parse, busca e efeito:\n' +
				falhas.join('\n')
		).toEqual([]);

		const depois = totalDocumentos();
		if (antes !== null && depois !== null) expect(depois).toBe(antes);
	});

	test('policial de outra unidade é recusado em todo recurso alheio', async ({ request }) => {
		// `policialB` mora na unidade B, não tem papel administrativo, não
		// participa da GISE fixture e não está escalado em nada de A. Toda
		// operação abaixo recebe um id de recurso REAL da unidade A: é o
		// troca-o-[id]-na-URL.
		const token = seedSession(FIXTURE.policialB.id, 'policial');
		test.skip(!token, 'D1 local indisponível');

		const comId = protegidas.filter((o) => o.padrao.includes('['));
		expect(comId.length, 'sem rotas parametrizadas não há o que exercer').toBeGreaterThan(10);

		const antes = totalDocumentos();
		const falhas: string[] = [];

		for (const o of comId) {
			const headers = o.tipo === 'api' ? headersDeSessaoMutacao(token!) : headersFormAction(token!);
			const res = await chamar(request, o, headers);
			const d = await desfecho(res, o.tipo);
			if (d.recusou) continue;

			// Só 404 é aceito além do 401/403 — o gate que esconde a existência do
			// recurso. 400/409/422 NÃO entram: significam que a rota olhou o corpo
			// ou o estado antes da permissão, e é assim que um alvo protegido por
			// outro motivo mascara a ausência do gate certo.
			const escondeu = o.tipo === 'api' ? res.status() === 404 : /^failure 404\b/.test(d.como);
			if (!escondeu) falhas.push(`${d.como}  ${url(o)}`);
		}

		expect(
			falhas,
			'operações que NÃO recusaram um policial sem vínculo com o recurso:\n' + falhas.join('\n')
		).toEqual([]);

		const depois = totalDocumentos();
		if (antes !== null && depois !== null) {
			expect(depois, 'nenhum documento pode ter sido criado ou apagado').toBe(antes);
		}
	});
});
