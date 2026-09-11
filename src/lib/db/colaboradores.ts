/**
 * Colaboradores — a terceira identidade (servidora administrativa e
 * colaboradora terceirizada), criada só pelo Super Admin (decisão 23 do plano
 * do módulo de diárias).
 *
 * O que este módulo NÃO faz, de propósito: não abre sessão, não autentica e
 * não decide o que um colaborador alcança. Isso é `$lib/auth` (tipo de sessão
 * `colaborador`) e a designação do módulo de diárias — que só passam a existir
 * no passo seguinte da fase 2. Aqui é só o cadastro.
 *
 * E-mail é o identificador de login: gravado NORMALIZADO (minúsculas, sem
 * espaços), porque é por ele que o login procura e o índice único compara —
 * "Ana@x.gov.br" e "ana@x.gov.br" são a mesma conta ou são duas, e a resposta
 * tem de ser a mesma no cadastro e no login. CPF passa por
 * `prepararCpfParaDB`, o MESMO caminho de `policiais` (cifra + índice cego).
 */
import { and, asc, eq } from 'drizzle-orm';
import { colaboradores, sessoes } from '../server/schema';
import type { Colaborador } from '../server/schema';
import { prepararCpfParaDB, type CpfCriptoEnv } from '../crypto/cpf-cripto';
import { linhasAfetadas, type Database } from './core';

/** O que a tela do Super Admin informa ao criar. A senha já vem em hash. */
export type NovoColaborador = {
	nome: string;
	email: string;
	/** Hash PBKDF2 (ver `hashSenha`) — nunca a senha em claro. */
	senhaHash: string;
	cpf?: string | null;
	vinculo?: string;
	criadoPor: { id: number; nome: string };
};

/** O colaborador sem os campos sensíveis — o que listagens e telas recebem. */
export type ColaboradorResumo = Omit<Colaborador, 'senha' | 'cpf' | 'cpf_index'>;

/** E-mail como o banco o guarda e como o login o procura. */
export function normalizarEmailColaborador(email: string): string {
	return email.trim().toLowerCase();
}

function semSensiveis(c: Colaborador): ColaboradorResumo {
	const resto: Partial<Colaborador> = { ...c };
	delete resto.senha;
	delete resto.cpf;
	delete resto.cpf_index;
	return resto as ColaboradorResumo;
}

/** Todos, ativos e desativados, por nome — a tela de gestão mostra os dois. */
export async function listarColaboradores(db: Database): Promise<ColaboradorResumo[]> {
	const linhas = await db.select().from(colaboradores).orderBy(asc(colaboradores.nome)).all();
	return linhas.map(semSensiveis);
}

/** Por id, sem os campos sensíveis. */
export async function buscarColaborador(
	db: Database,
	id: number
): Promise<ColaboradorResumo | null> {
	const c = await db.select().from(colaboradores).where(eq(colaboradores.id, id)).get();
	return c ? semSensiveis(c) : null;
}

/**
 * Por e-mail, linha COMPLETA — é o caminho do login, que precisa do hash da
 * senha. Só ativos: desativado não autentica, como em `policiais`.
 */
export async function buscarColaboradorAtivoPorEmail(
	db: Database,
	email: string
): Promise<Colaborador | null> {
	const c = await db
		.select()
		.from(colaboradores)
		.where(
			and(eq(colaboradores.email, normalizarEmailColaborador(email)), eq(colaboradores.ativo, 1))
		)
		.get();
	return c ?? null;
}

/**
 * Cria a conta. `primeiro_acesso = 1`: a pessoa troca a senha provisória e
 * aceita o termo antes de qualquer outra coisa, pelo mesmo portão dos
 * policiais. E-mail duplicado estoura o índice único — quem chama traduz para
 * 409 (`ehViolacaoUnique`).
 */
export async function criarColaborador(
	db: Database,
	dados: NovoColaborador,
	env: CpfCriptoEnv | undefined
): Promise<ColaboradorResumo> {
	const { cpf, cpf_index } = await prepararCpfParaDB(dados.cpf, env);
	const inserido = await db
		.insert(colaboradores)
		.values({
			nome: dados.nome.trim(),
			email: normalizarEmailColaborador(dados.email),
			senha: dados.senhaHash,
			cpf,
			cpf_index,
			vinculo: (dados.vinculo ?? '').trim(),
			criado_por_id: dados.criadoPor.id,
			criado_por_nome: dados.criadoPor.nome
		})
		.returning()
		.get();
	return semSensiveis(inserido);
}

/**
 * Desativa ou reativa. Desativar também APAGA as sessões da conta: a validação
 * de sessão já recusa conta inativa no próximo request, mas o cache de edge
 * pode servir a sessão por até um TTL — apagar a linha encurta essa janela ao
 * mínimo que o cache permite, como `definirAtivo` faz com policial.
 *
 * @returns `false` quando o id não existe
 */
export async function definirColaboradorAtivo(
	db: Database,
	id: number,
	ativo: boolean
): Promise<boolean> {
	const r = await db
		.update(colaboradores)
		.set({ ativo: ativo ? 1 : 0 })
		.where(eq(colaboradores.id, id));
	if (linhasAfetadas(r) === 0) return false;
	if (!ativo) {
		await db
			.delete(sessoes)
			.where(and(eq(sessoes.tipo, 'colaborador'), eq(sessoes.usuario_id, id)));
	}
	return true;
}
