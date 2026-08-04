/**
 * Guard de CI: **toda operação material do servidor recusa alguém.**
 *
 * Operação material = handler de mutação de API (`POST`/`PUT`/`PATCH`/`DELETE`
 * em `+server.ts`) ou form action do SvelteKit. São 114 hoje, e a decisão de
 * autorização é tomada de treze formas diferentes — `requireAdmin`,
 * `isAdminGeral`, `verificarPermissaoEscala`, `resolverParticipacaoGisePolicial`,
 * comparação de lotação escrita à mão, além de preâmbulos locais a um arquivo
 * só (`autorizarAcao`, `carregarEscalaComPermissao`).
 *
 * Por isso o guard NÃO procura o nome de um helper: procuraria uma lista que
 * nunca está completa, e um handler novo com um resolvedor novo passaria batido
 * justamente por ser novo. Ele olha o RESULTADO observável, que é fechado:
 *
 *   nível 2 — recusa por PERMISSÃO (`fail(403)`, `forbidden()`, `requireAdmin`…)
 *   nível 1 — só exige SESSÃO (`fail(401)`, `unauthorized()`, `requireAuth`)
 *   nível 0 — não recusa ninguém
 *
 * Nível 0 e 1 existem legitimamente: login não tem sessão para exigir, trocar a
 * própria senha não tem segundo sujeito para autorizar, e webhook se autentica
 * por segredo compartilhado, não por cookie. O que o guard exige é que cada um
 * desses esteja DECLARADO abaixo com o motivo. A diferença entre "público de
 * propósito" e "esqueceram o guard" não está no código — só na cabeça de quem
 * escreveu. Aqui ela fica escrita.
 *
 * Reprova em três situações:
 *   1. operação nível 0/1 que não está na lista → gap novo;
 *   2. entrada da lista que virou nível 2 ou sumiu → lista velha mentindo;
 *   3. handler declarado que o parser não conseguiu ler → ponto cego.
 *
 * (3) é o que impede o guard de dar falso verde: rota que ele não enxerga é
 * rota que ele não protege, e silêncio não é aprovação.
 *
 * Uso: node scripts/guard-autorizacao.mjs
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Operações que legitimamente NÃO recusam por permissão, com o motivo.
 * Chave: `<arquivo> → <nome>`.
 *
 * Encolher esta lista é progresso. Crescer, sem um motivo desta natureza, é o
 * que o guard existe para pegar.
 */
const DECLARADAS = {
	// ---- Pré-autenticação: não há sessão para exigir ----
	'src/routes/api/auth/login/+server.ts → POST': 'login: cria a sessão',
	'src/routes/api/auth/logout/+server.ts → POST': 'logout: destrói a própria sessão',
	'src/routes/api/auth/primeiro-acesso/+server.ts → POST': 'primeiro acesso: antes da senha',
	'src/routes/api/auth/reenviar-codigo/+server.ts → POST': 'reenvia o 2FA do login em curso',
	'src/routes/api/auth/solicitar-redefinicao/+server.ts → POST': 'esqueci a senha: sem sessão',
	'src/routes/api/auth/confirmar-redefinicao/+server.ts → POST':
		'redefinição por token de uso único; o token É a credencial',
	'src/routes/api/auth/certificado/iniciar/+server.ts → POST':
		'desafio de login por Token A3: antes de saber quem é',
	'src/routes/login/+page.server.ts → login': 'login: cria a sessão',
	'src/routes/login/+page.server.ts → solicitarPrimeiroAcesso': 'primeiro acesso: antes da senha',
	'src/routes/redefinir-senha/+page.server.ts → redefinir':
		'redefinição por token de uso único; o token É a credencial',

	// ---- Autosserviço: o recurso é o próprio usuário, não há segundo sujeito ----
	'src/routes/aceitar-termo/+page.server.ts → aceitar': 'aceita o próprio termo de uso',
	'src/routes/alterar-senha/+page.server.ts → alterar': 'troca a própria senha (confere a atual)',
	'src/routes/perfil/+page.server.ts → solicitar': 'solicita alteração do próprio cadastro',
	'src/routes/api/lgpd/solicitar/+server.ts → POST': 'exerce direito LGPD sobre os próprios dados',
	'src/routes/api/auth/solicitar-codigo-assinatura/+server.ts → POST':
		'envia o código 2FA para o e-mail do próprio usuário logado',

	// ---- Webhook: autenticado por segredo compartilhado + HMAC, não por sessão ----
	'src/routes/api/webhook/limpeza-retencao/+server.ts → POST': 'segredo compartilhado (cron)',
	'src/routes/api/webhook/reset-policiais/+server.ts → POST':
		'segredo compartilhado + 2ª credencial de reset',
	'src/routes/api/webhook/sync-policiais/+server.ts → POST': 'segredo compartilhado (Apps Script)',
	'src/routes/api/webhook/sync-unidades/+server.ts → POST': 'segredo compartilhado (Apps Script)',

	// ---- Stub ----
	'src/routes/api/gise/[id]/assinar/+server.ts → POST': 'endpoint aposentado: responde 410 a todos'
};

const RE_403 = /fail\(403|forbidden\(|status:\s*403|error\(403|requireAdmin\(|requireSuperAdmin\(/;
const RE_401 = /fail\(401|unauthorized\(|requireAuth\(|error\(401/;

/** Do índice da chave `{`, devolve o bloco balanceado. */
function blocoBalanceado(src, iAbre) {
	let profundidade = 0;
	for (let i = iAbre; i < src.length; i++) {
		if (src[i] === '{') profundidade++;
		else if (src[i] === '}') {
			profundidade--;
			if (profundidade === 0) return src.slice(iAbre, i + 1);
		}
	}
	return src.slice(iAbre);
}

const arquivos = execSync(
	"find src/routes -name '+server.ts' -o -name '+page.server.ts' -o -path '*_actions/*.ts'",
	{ encoding: 'utf8' }
)
	.split('\n')
	.filter(Boolean)
	.sort();

const operacoes = [];
/** Contagem frouxa das DECLARAÇÕES, para conferir contra o que foi lido. */
let declaradas = 0;

for (const arquivo of arquivos) {
	const src = readFileSync(arquivo, 'utf8');
	declaradas += [...src.matchAll(/export const (?:POST|PUT|PATCH|DELETE)\b/g)].length;
	declaradas += [...src.matchAll(/^\s+([a-zA-Z][\w]*): async/gm)].length;

	// O preâmbulo (helpers acima do primeiro handler) conta: é onde moram
	// `autorizarAcao` e `carregarEscalaComPermissao`, cujo `fail(403)` vale para
	// todas as actions que os chamam.
	const iPrimeiro = src.search(/export const (?:actions|POST|PUT|PATCH|DELETE)\b/);
	const preambulo = iPrimeiro > 0 ? src.slice(0, iPrimeiro) : '';

	for (const m of src.matchAll(/export const (POST|PUT|PATCH|DELETE)[^=]*=\s*async\s*\(/g)) {
		const iAbre = src.indexOf('{', src.indexOf('=>', m.index));
		operacoes.push({ arquivo, nome: m[1], corpo: blocoBalanceado(src, iAbre) + preambulo });
	}

	const decl = src.match(/export const (?:actions\w*)[^=]*=\s*\{/);
	if (decl) {
		const bloco = blocoBalanceado(src, src.indexOf('{', decl.index + decl[0].length - 1));
		let profundidade = 0;
		for (let i = 0; i < bloco.length; i++) {
			if (bloco[i] === '{') profundidade++;
			else if (bloco[i] === '}') profundidade--;
			else if (profundidade === 1) {
				const nm = bloco.slice(i).match(/^(\w+):\s*async\s*\(/);
				if (nm) {
					const iAbre = bloco.indexOf('{', bloco.indexOf('=>', i));
					const corpo = blocoBalanceado(bloco, iAbre);
					operacoes.push({ arquivo, nome: nm[1], corpo: corpo + preambulo });
					i = iAbre + corpo.length - 1;
					profundidade = 1;
				}
			}
		}
	}
}

const problemas = [];

// (3) Ponto cego: declaração que o parser não leu.
if (operacoes.length !== declaradas) {
	problemas.push({
		arquivo: 'scripts/guard-autorizacao.mjs',
		msg:
			`o parser leu ${operacoes.length} operações, mas há ${declaradas} declaradas — ` +
			'alguma escapou. Rota que o guard não enxerga é rota que ele não protege; ' +
			'ajuste o parser antes de confiar neste resultado'
	});
}

const vistas = new Set();
for (const op of operacoes) {
	const chave = `${op.arquivo} → ${op.nome}`;
	const nivel = RE_403.test(op.corpo) ? 2 : RE_401.test(op.corpo) ? 1 : 0;
	if (nivel === 2) {
		// (2) Promovida a nível 2 e ainda na lista: a lista mente.
		if (chave in DECLARADAS) {
			problemas.push({
				arquivo: op.arquivo,
				msg: `"${op.nome}" agora recusa por permissão — remova a dispensa de DECLARADAS`
			});
		}
		continue;
	}
	vistas.add(chave);
	// (1) Gap novo.
	if (!(chave in DECLARADAS)) {
		problemas.push({
			arquivo: op.arquivo,
			msg:
				`"${op.nome}" ${nivel === 0 ? 'não recusa ninguém' : 'só exige sessão'} — ` +
				'autorize a operação ou declare o motivo em scripts/guard-autorizacao.mjs'
		});
	}
}

// (2) Entrada da lista que não corresponde a operação nenhuma.
for (const chave of Object.keys(DECLARADAS)) {
	if (!vistas.has(chave)) {
		problemas.push({
			arquivo: chave.split(' → ')[0],
			msg: `dispensa obsoleta em DECLARADAS: "${chave}" não existe mais`
		});
	}
}

if (problemas.length > 0) {
	console.error('\n[guard-autorizacao] operação material sem decisão de autorização:\n');
	for (const { arquivo, msg } of problemas) {
		console.error(`::error file=${arquivo}::${msg}`);
		console.error(`  ${arquivo} — ${msg}`);
	}
	console.error(
		'\nEsconder o botão na tela não é autorização: o POST direto tem de morrer no\n' +
			'servidor. Ver README → "Autorização das operações materiais".\n'
	);
	process.exit(1);
}

console.log(
	`[guard-autorizacao] ${operacoes.length} operações materiais — ` +
		`${operacoes.length - vistas.size} recusam por permissão, ` +
		`${vistas.size} dispensadas com motivo declarado.`
);
