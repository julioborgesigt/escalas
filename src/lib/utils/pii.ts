/**
 * Mascaramento de dado pessoal para EXIBIÇÃO — puro, compartilhado por servidor
 * E cliente (sem import de `$lib/server`, sem acesso a banco, sem estado).
 *
 * Usado nas telas públicas de validação e nas confirmações de envio: ali o
 * objetivo é permitir que o titular CONFIRA sem publicar o dado para quem não
 * é titular. Não é anonimização nem criptografia — para guardar o dado
 * cifrado, veja `$lib/crypto`.
 *
 * Como no resto de `utils/`, entrada vazia devolve `''` sem lançar.
 */

/**
 * Mascara o nome para exibição comercial (Ex: MARCOS S*** LIRA)
 */
export function mascararNome(nome: string | undefined): string {
	if (!nome) return '';
	const partes = nome.trim().split(/\s+/);
	if (partes.length === 1) return partes[0];
	const primeiro = partes[0];
	const ultimo = partes[partes.length - 1];

	// Se tiver 2 nomes: MARCOS LIRA -> MARCOS L***
	if (partes.length === 2) return `${primeiro} ${ultimo[0]}***`;

	// Se tiver 3+ nomes: MARCOS SANDRO LIRA -> MARCOS S*** LIRA
	return `${primeiro} ${partes[1][0]}*** ${ultimo}`;
}

/**
 * Mascara o CPF (Ex: ***.229.***-**)
 */
export function mascararCPF(cpf: string | undefined): string {
	if (!cpf) return '';
	const limpo = cpf.replace(/\D/g, '');
	if (limpo.length !== 11) return cpf;
	// Exibe apenas os dígitos centrais (4º, 5º e 6º)
	return `***.${limpo.slice(3, 6)}.***-**`;
}

/**
 * Mascara e-mail para confirmação de envio ("enviamos um código para
 * jo****a@***.com"): o titular reconhece o endereço, quem não é titular não o
 * descobre.
 *
 * Mostra até 2 caracteres iniciais e o último do local-part, preservando o
 * comprimento (é o que dá o "parece o meu" ao titular). Local-part de 1 ou 2
 * caracteres cai em casos especiais, onde não há o que mascarar sem apagar tudo.
 *
 * O DOMÍNIO é escondido de propósito, sobrando só o TLD: saber que a conta de
 * recuperação é do Gmail já é meio caminho para tentar tomá-la.
 */
export function mascararEmail(email: string): string {
	const at = email.indexOf('@');
	if (at <= 0) return email;
	const local = email.slice(0, at);
	const domain = email.slice(at + 1);
	let masked: string;
	if (local.length === 1) {
		masked = local;
	} else if (local.length === 2) {
		masked = local[0] + '*';
	} else {
		const showStart = Math.min(2, Math.floor(local.length / 2));
		masked =
			local.slice(0, showStart) +
			'*'.repeat(local.length - showStart - 1) +
			local[local.length - 1];
	}
	// Ocultar domínio para não revelar provedor (ex: gmail.com → ***.com)
	const dotIdx = domain.lastIndexOf('.');
	const maskedDomain = dotIdx > 0 ? '***' + domain.slice(dotIdx) : '***';
	return masked + '@' + maskedDomain;
}
