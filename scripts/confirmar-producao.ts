/**
 * A confirmação que os scripts destrutivos exigem antes de tocar o banco.
 *
 * Existe porque a trava já existia e estava DESLIGADA DE FÁBRICA. Os dois
 * scripts que apagam credencial (`clear-passwords-non-admins`,
 * `set-default-password-all-users`) sempre checaram `--yes`, mas o
 * `package.json` embutia `--yes` na linha do `npm run` — então a pergunta que a
 * trava faz nunca chegava a ser feita. Trava que o atalho oficial contorna não
 * é trava; é comentário.
 *
 * O que torna isso perigoso não é o efeito de cada script isoladamente, e sim a
 * distância entre os dois alvos:
 *
 *     npm run users:clear-passwords-non-admins        ← banco LOCAL
 *     npm run users:clear-passwords-non-admins:prod   ← PRODUÇÃO
 *
 * Os nomes são idênticos até o sufixo. No autocomplete do terminal a diferença
 * entre zerar o seu banco de teste e zerar a senha de todo policial em serviço
 * é um Tab — e o efeito (`senha=''`, `primeiro_acesso=1` para todos) não tem
 * desfazer: como o `UPDATE` sobrescreve `updated_at` na mesma tacada, nem se
 * consegue depois distinguir quem já estava assim de quem o comando atingiu.
 *
 * Daí as duas exigências, deliberadamente diferentes entre si:
 *
 *   - `--yes` continua sendo a confirmação de INTENÇÃO, e agora precisa ser
 *     digitada (`npm run ... -- --yes`), porque é isso que a torna um ato;
 *   - contra PRODUÇÃO, além dela, a env `CONFIRMO_PRODUCAO` precisa conter o
 *     NOME DO BANCO. Nomear o alvo é o ponto: `--yes` vira memória muscular
 *     depois da terceira vez, digitar `escalas-db` não vira.
 */

/** O banco que os scripts destrutivos operam — o mesmo `DB_NAME` deles. */
export const DB_NAME = 'escalas-db';

/** Env que precisa conter `DB_NAME` para autorizar a execução remota. */
export const ENV_CONFIRMACAO = 'CONFIRMO_PRODUCAO';

export interface PedidoDeConfirmacao {
	/** `--remote` presente: o alvo é produção. */
	remoto: boolean;
	/** `--yes` presente. */
	confirmado: boolean;
	/** O que o script faz, em uma linha, na voz do estrago: "zerar a senha de TODOS os policiais". */
	efeito: string;
	/** O comando completo que o operador deveria ter digitado (sem segredo nenhum). */
	exemplo: string;
}

/**
 * Encerra o processo com código 1 quando a confirmação não veio.
 *
 * Não devolve nada: ou autoriza seguindo em frente, ou mata o processo. É
 * `void` de propósito — resultado que o chamador pudesse ignorar por engano
 * recriaria o buraco que esta função existe para fechar.
 */
export function exigirConfirmacao(p: PedidoDeConfirmacao): void {
	const alvo = p.remoto ? 'PRODUÇÃO (remoto)' : 'banco LOCAL';

	if (!p.confirmado) {
		console.error(`Confirmação obrigatória: este comando vai ${p.efeito} em ${alvo}.`);
		console.error('Acrescente --yes para executar.');
		console.error(`Exemplo: ${p.exemplo}`);
		process.exit(1);
	}

	if (!p.remoto) return;

	const informado = process.env[ENV_CONFIRMACAO]?.trim();
	if (informado !== DB_NAME) {
		console.error(`RECUSADO: este comando vai ${p.efeito} em PRODUÇÃO, e isso não tem desfazer.`);
		console.error(
			`Para autorizar, informe o nome do banco em ${ENV_CONFIRMACAO} — nomear o alvo é a confirmação.`
		);
		console.error(`Exemplo: ${p.exemplo}`);
		if (informado) {
			console.error(
				`(recebido: ${JSON.stringify(informado)}, esperado: ${JSON.stringify(DB_NAME)})`
			);
		}
		process.exit(1);
	}
}
