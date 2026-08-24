/**
 * Identidade visual gravada no PDF preparado para assinatura.
 *
 * Nome e CPF saem da SESSÃO, nunca do body. O cliente até ago/2026 mandava
 * `signerName`/`signerCpf` e o servidor preferia esses campos quando
 * preenchidos — um signatário autorizado carimbava no documento a identidade
 * que escolhesse, e o CMS (quando havia certificado) atestava outra pessoa
 * (SEC-07). A rota avançada de presença já usava `u.nome`/`u.cpf`; as
 * qualificadas (Token A3) não.
 *
 * O schema continua aceitando os campos para não quebrar o cliente; o
 * servidor ignora.
 */

export function identidadeVisualAssinante(u: { nome: string; cpf?: string | null }): {
	signerName: string;
	signerCpf: string;
} {
	return { signerName: u.nome, signerCpf: u.cpf?.trim() || '' };
}
