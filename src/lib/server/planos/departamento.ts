/**
 * O departamento que o plano operacional representa, resolvido do banco — a
 * sigla que vai no cabeçalho e no item 5, e os cargos que o signatário pode
 * ter.
 *
 * Até set/2026 isso eram literais em `$lib/planos/padroes` ("DPI SUL" e três
 * cargos). Passou a vir de `unidades` porque o departamento é dado, não
 * constante (plano do módulo de diárias, decisão 17): é o que deixa o mesmo
 * código emitir documento em nome de outro departamento sem edição.
 *
 * Um lugar só, consumido pela criação (`novo`) e pelo editor (`[id]`) — as duas
 * rotas e as suas actions precisam da MESMA lista, senão o `<select>` de uma
 * aceita o que a régua da outra recusa.
 */
import { buscarDepartamentoPadrao, type Departamento } from '$lib/db';
import type { Database } from '$lib/db';
import { cargosSignatario } from '$lib/planos/padroes';

export type DepartamentoDoPlano = {
	departamento: Departamento | null;
	/** Forma curta para o cabeçalho e o item 5; vazia se não há departamento. */
	sigla: string;
	/** Os cargos aceitos para o signatário, com o órgão por extenso. */
	cargos: readonly string[];
};

/** Resolve o departamento ativo e deriva sigla e cargos. */
export async function departamentoDoPlano(db: Database): Promise<DepartamentoDoPlano> {
	const departamento = await buscarDepartamentoPadrao(db);
	return {
		departamento,
		sigla: departamento?.sigla ?? '',
		cargos: cargosSignatario(departamento?.nome ?? '')
	};
}
