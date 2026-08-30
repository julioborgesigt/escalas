/**
 * Fachada da camada de dados do PLANO OPERACIONAL.
 *
 * Mesma divisão das fachadas vizinhas (`gise/`, `operacoes/`): os módulos são
 * por assunto — `crud` (o plano), `equipes`, `membros`, `custo-parametros` (os
 * valores versionados) — e este arquivo é o único ponto de importação, de onde
 * `src/lib/db.ts` reexporta.
 *
 * A autorização NÃO mora aqui. Quem responde "esse usuário pode mexer nesse
 * plano?" é `$lib/server/planos/permissao`, e é por lá que toda rota entra.
 *
 * O CÁLCULO também não mora aqui: as regras puras (faixa, horas, custo) estão
 * em `$lib/planos/`, sem acesso a banco, para poderem ser testadas sozinhas.
 * Este módulo lê e grava; ele não decide quanto custa.
 */
export {
	criarPlano,
	buscarPlano,
	buscarPlanoPorNumero,
	listarPlanos,
	atualizarPlano,
	excluirPlano,
	type EntradaPlano,
	type PatchPlano,
	type PlanoDaLista
} from './crud';

export {
	criarEquipes,
	listarEquipes,
	buscarEquipe,
	atualizarEquipe,
	excluirEquipe,
	renumerarEquipes,
	nomePadraoEquipe,
	janelaDaEquipe,
	briefingDaEquipe,
	type PatchEquipe
} from './equipes';

export {
	adicionarMembro,
	removerMembro,
	definirChefe,
	limparChefe,
	listarMembrosDoPlano,
	agruparPorEquipe,
	ressincronizarSnapshots,
	type MembroDoPlano,
	type ResultadoAlocacao
} from './membros';

export {
	buscarCustoParametrosVigente,
	buscarCustoParametros,
	listarCustoParametros,
	criarCustoParametros,
	valoresDe,
	type EntradaCustoParametros
} from './custo-parametros';
