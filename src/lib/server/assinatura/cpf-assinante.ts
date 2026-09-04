/**
 * Quem vê PII FORENSE, e o CPF do assinante já recortado por essa regra.
 *
 * O manifesto do PDF assinado carrega CPF, IP, GPS e selfie de quem assinou.
 * A regra de quem alcança esse conjunto é UMA — Super Admin — e vivia colada ao
 * download (`copia-conferencia.ts`), que é código pesado (pdf-lib). Um `load` de
 * página que quisesse aplicar a MESMA regra pagaria o bundle inteiro do
 * assinador para consultar um booleano, e foi por isso que dois deles não a
 * aplicaram: `gise/[id]` e `escalas/[id]` decifravam `assinante_cpf` e
 * devolviam o CPF COMPLETO ao cliente, enquanto
 * `/api/gise/[id]/documento-assinado/info` — mesmo campo, mesma tabela, mesmo
 * público — mascarava para todo mundo que não é Super Admin (A2/LGPD).
 *
 * Não era buraco explorável: o CPF não é renderizado em tela nenhuma. Era pior
 * de achar por isso — o dado descia no payload de hidratação da página, legível
 * em "view-source", para o supervisor (policial comum) e para o admin de
 * seccional, sem nunca aparecer na interface que justificasse tê-lo enviado.
 *
 * Daí `cpfAssinanteParaExibir` DECIFRAR e MASCARAR na mesma chamada: quem
 * precisa do CPF para exibir não consegue mais obter a versão crua por
 * distração, porque o helper conveniente já é o recortado. Chamar
 * `decifrarCpfDoDB` direto continua possível — e é o que os geradores de PDF
 * fazem, legitimamente, porque o manifesto É o artefato forense.
 */
import type { UsuarioLogado } from '$lib/auth';
import { decifrarCpfDoDB, type CpfCriptoEnv } from '$lib/crypto/cpf-cripto';
import { mascararCPF } from '$lib/utils/pii';

/**
 * Quem pode ver PII forense em claro: SOMENTE Super Admin — mais restrito que o
 * `podeBaixarComManifesto` dos endpoints autenticados de download.
 *
 * Mora aqui, e não no módulo de download, para que um `load` de página possa
 * consultá-la sem arrastar o bundle do assinador. `copia-conferencia.ts`
 * reexporta o nome para os call sites que já o importavam de lá.
 */
export function podeBaixarForense(u: UsuarioLogado | null | undefined): boolean {
	return u?.isSuperAdmin === true;
}

/**
 * CPF do assinante pronto para sair do servidor: decifrado do repouso e
 * mascarado para quem não é Super Admin.
 *
 * Use em TODO caminho que serializa `assinante_cpf` para o cliente — `load` de
 * página ou resposta JSON. Devolve `''` quando não há CPF gravado (é o que
 * `decifrarCpfDoDB` e `mascararCPF` já fazem com valor vazio).
 */
export async function cpfAssinanteParaExibir(
	armazenado: string | null | undefined,
	env: CpfCriptoEnv | undefined,
	u: UsuarioLogado | null | undefined
): Promise<string> {
	const cpf = await decifrarCpfDoDB(armazenado, env);
	return podeBaixarForense(u) ? cpf : mascararCPF(cpf);
}
