/**
 * Os valores de hora extra e diária — leitura e gravação de `custo_parametros`.
 *
 * **A tabela é append-only e não existe função de UPDATE aqui.** Isso não é
 * esquecimento: cada gravação do Super Admin cria uma VERSÃO, e o plano guarda
 * em `custo_parametro_id` qual delas aplicou. Sobrescrever uma linha mudaria os
 * totais de todo plano que a referencia — inclusive os já impressos e assinados
 * pelo Diretor. Dois PDFs com o mesmo número e valores diferentes é exatamente
 * o que a versão existe para impedir.
 *
 * A "vigente" é a linha de maior (`vigente_desde`, `id`). O `id` desempata duas
 * gravações no mesmo dia, que é o caso de uma correção logo após um erro de
 * digitação — sem ele, qual das duas vale dependeria da ordem que o SQLite
 * resolvesse devolver.
 *
 * Todos os valores são INTEIROS EM CENTAVOS. Nenhuma função deste módulo aceita
 * ou devolve `real`.
 */
import { desc, eq } from 'drizzle-orm';
import { custoParametros } from '../../server/schema';
import type { CustoParametros } from '../../server/schema';
import type { Database } from '../core';
import type { ValoresCusto } from '../../planos/custo';

/** Os dez valores que o Super Admin edita, em centavos. */
export interface EntradaCustoParametros extends ValoresCusto {
	/** `YYYY-MM-DD` a partir de quando estes valores passam a valer. */
	vigente_desde: string;
	criado_por_id?: number | null;
	criado_por_nome?: string;
}

/**
 * A versão VIGENTE, ou `null` quando o Super Admin ainda não gravou nenhuma.
 *
 * `null` é um estado real do sistema recém-instalado, e quem chama precisa
 * tratá-lo: um plano criado sem valores não tem como calcular custo, e a tela
 * de criação avisa em vez de gravar zeros que pareceriam valores de verdade.
 */
export async function buscarCustoParametrosVigente(db: Database): Promise<CustoParametros | null> {
	const row = await db
		.select()
		.from(custoParametros)
		.orderBy(desc(custoParametros.vigente_desde), desc(custoParametros.id))
		.limit(1)
		.get();
	return row ?? null;
}

/** Uma versão específica pelo id — é por aqui que o PDF recupera os valores que aplicou. */
export async function buscarCustoParametros(
	db: Database,
	id: number
): Promise<CustoParametros | null> {
	const row = await db.select().from(custoParametros).where(eq(custoParametros.id, id)).get();
	return row ?? null;
}

/**
 * O histórico completo, da versão mais recente para a mais antiga.
 *
 * A tela de `/config-custos` mostra isto para o operador conseguir responder
 * "por que aquele plano de março soma diferente?" sem abrir o banco.
 */
export async function listarCustoParametros(db: Database): Promise<CustoParametros[]> {
	return db
		.select()
		.from(custoParametros)
		.orderBy(desc(custoParametros.vigente_desde), desc(custoParametros.id))
		.all();
}

/**
 * Grava uma VERSÃO NOVA e devolve o id.
 *
 * Sempre INSERT, nunca UPDATE — ver o cabeçalho do módulo. Não há como "editar
 * a versão vigente" por design; corrigir um valor digitado errado é gravar
 * outra versão, e as duas ficam no histórico.
 */
export async function criarCustoParametros(
	db: Database,
	dados: EntradaCustoParametros
): Promise<number> {
	const [row] = await db
		.insert(custoParametros)
		.values({
			oip_cd_normal: dados.oip_cd_normal,
			oip_ab_normal: dados.oip_ab_normal,
			dpc_12_normal: dados.dpc_12_normal,
			dpc_3e_normal: dados.dpc_3e_normal,
			oip_cd_plus: dados.oip_cd_plus,
			oip_ab_plus: dados.oip_ab_plus,
			dpc_12_plus: dados.dpc_12_plus,
			dpc_3e_plus: dados.dpc_3e_plus,
			diaria_estadual: dados.diaria_estadual,
			diaria_interestadual: dados.diaria_interestadual,
			vigente_desde: dados.vigente_desde,
			criado_por_id: dados.criado_por_id ?? null,
			criado_por_nome: dados.criado_por_nome ?? ''
		})
		.returning({ id: custoParametros.id });
	return row.id;
}

/**
 * Extrai só os dez valores de uma linha — o recorte que `custoDoPlano` consome.
 *
 * Existe para o cálculo não receber `id`, `vigente_desde` e `criado_por_*`, que
 * não são dinheiro e não têm o que fazer lá dentro.
 */
export function valoresDe(p: CustoParametros): ValoresCusto {
	return {
		oip_cd_normal: p.oip_cd_normal,
		oip_ab_normal: p.oip_ab_normal,
		dpc_12_normal: p.dpc_12_normal,
		dpc_3e_normal: p.dpc_3e_normal,
		oip_cd_plus: p.oip_cd_plus,
		oip_ab_plus: p.oip_ab_plus,
		dpc_12_plus: p.dpc_12_plus,
		dpc_3e_plus: p.dpc_3e_plus,
		diaria_estadual: p.diaria_estadual,
		diaria_interestadual: p.diaria_interestadual
	};
}

/**
 * O acréscimo de 30% que define a hora "plus", como FRAÇÃO SUGERIDA.
 *
 * A tela usa isto para pré-preencher os quatro campos `_plus` a partir dos
 * `_normal`. Não é aplicado no cálculo: lá o valor lido é o que está gravado na
 * versão, justamente para um reajuste futuro na alíquota não reescrever
 * documento já emitido.
 */
export function sugerirPlus(normal: number): number {
	return Math.round(normal * 1.3);
}
