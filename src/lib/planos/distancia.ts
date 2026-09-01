/**
 * Quantos quilômetros a equipe percorre — o número que decide a rubrica.
 *
 * ## O trajeto passa pelo BRIEFING
 *
 * A equipe sai de Jucás, se apresenta em Iguatu e cumpre mandados em Acopiara:
 * o deslocamento é `origem → briefing → destino`, não a reta entre as pontas. É
 * a decisão da corporação, e a diferença não é decorativa — um briefing fora do
 * caminho pode somar dezenas de quilômetros e cruzar o limite dos 100 km que
 * separa hora extra de diária (ver `custeio.ts`).
 *
 * ## Sem briefing resolvido, mede-se o direto — e a tela DIZ isso
 *
 * O local de briefing é um prédio ("Sede da 4ª Seccional do Interior Sul") e em
 * que cidade ele fica é dado que alguém precisa informar. Enquanto não estiver,
 * o trajeto sai medido de ponta a ponta: `via: 'direto'` existe para a tela
 * poder avisar que a parada não entrou na conta, em vez de exibir um número
 * menor sem explicação.
 *
 * ## Regra pura, e por isso aqui
 *
 * Recebe a matriz pronta e códigos IBGE; não conhece banco. É o que permite ao
 * card recalcular enquanto o admin troca os seletores, sem ida ao servidor — e
 * ao servidor recalcular o mesmo na gravação, para decidir se o valor recebido
 * é o medido ou uma correção à mão.
 */

/** Os três pontos do trajeto, por código IBGE. `null` = não resolvido. */
export type CidadesDoTrajeto = {
	origem: string | null;
	briefing: string | null;
	destino: string | null;
};

/** O que a medição devolve. */
export type TrajetoMedido = {
	km: number;
	/** `'briefing'` conta a parada; `'direto'` mede as pontas — ver o cabeçalho. */
	via: 'briefing' | 'direto';
};

/**
 * A chave do par na matriz: menor código primeiro.
 *
 * A tabela guarda uma linha por par NÃO ordenado, então ida e volta precisam
 * cair na mesma entrada — sem isto, metade das consultas não acharia nada.
 */
export function chaveDoPar(a: string, b: string): string {
	return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/**
 * Distância entre dois municípios, ou `null` quando o par não está na matriz.
 *
 * Mesma cidade é ZERO, e não ausência: a matriz não guarda o par consigo mesmo
 * (seriam mais 184 linhas dizendo `0`), mas equipe que sai e chega na mesma
 * cidade percorreu zero quilômetros — o que é uma medida, não uma falta dela.
 */
function distanciaEntre(a: string, b: string, matriz: ReadonlyMap<string, number>): number | null {
	if (a === b) return 0;
	return matriz.get(chaveDoPar(a, b)) ?? null;
}

/**
 * O trajeto da equipe em quilômetros, ou `null` quando não dá para medir.
 *
 * `null` quando origem ou destino não têm município resolvido — aí o campo
 * continua manual, como era antes desta tabela existir. Devolver zero seria
 * pior: zero é uma medida, e faria a tela sugerir hora extra como se a
 * distância tivesse sido conferida.
 */
export function distanciaDoTrajeto(
	cidades: CidadesDoTrajeto,
	matriz: ReadonlyMap<string, number>
): TrajetoMedido | null {
	const { origem, briefing, destino } = cidades;
	if (!origem || !destino) return null;

	const direto = distanciaEntre(origem, destino, matriz);

	if (briefing) {
		const ida = distanciaEntre(origem, briefing, matriz);
		const volta = distanciaEntre(briefing, destino, matriz);
		if (ida !== null && volta !== null) return { km: ida + volta, via: 'briefing' };
		// Uma das pernas faltou na matriz (município fora do Ceará, por exemplo).
		// Cai no direto em vez de devolver nada: um número medido de ponta a ponta,
		// declarado como tal, serve mais do que um campo vazio.
	}

	return direto === null ? null : { km: direto, via: 'direto' };
}
