/**
 * Disponibilidade da assinatura avançada em tela quando a administração
 * exige a chave. Sem chave, o titular lê; o botão não é oferecido.
 *
 * Puro de propósito: o layout já resolveu `temChaveAssinatura` no servidor.
 * A UI só decide se mostra o controle. O recorte do identificador também
 * mora aqui para o manifesto e a tela confrontarem o MESMO texto.
 */

/**
 * `credentialId` é base64url de 16 a 90+ caracteres — inteiro no manifesto
 * ou na ficha, empurra o cartão. As pontas bastam para confrontar o PDF com
 * o cadastro. PDF e UI importam ESTA função: duas abreviações divergentes
 * fariam o confronto "não bater" sem o dado ter mudado.
 */
export function abreviarCredencial(id: string): string {
	return id.length <= 20 ? id : `${id.slice(0, 8)}...${id.slice(-8)}`;
}

/** A credencial deste PDF ainda está no cadastro, foi revogada, ou sumiu. */
export type SituacaoChaveCadastro = 'ativa' | 'revogada' | 'ausente';

/** Situação no cadastro — o recorte do PDF pode ser de uma chave já revogada. */
export function situacaoChaveNoCadastro(
	cadastro: { revogadaEm: string | null } | null
): SituacaoChaveCadastro {
	if (!cadastro) return 'ausente';
	return cadastro.revogadaEm ? 'revogada' : 'ativa';
}

export function avancadaEmTelaDisponivel(exigirPasskey: boolean, temChave: boolean): boolean {
	return !exigirPasskey || temChave;
}

/** Lê as flags que o `load` do layout já resolveu — evita repetir o Boolean. */
export function avancadaEmTelaDoLayout(data: {
	exigirPasskeyAssinatura?: boolean;
	temChaveAssinatura?: boolean;
}): boolean {
	return avancadaEmTelaDisponivel(
		Boolean(data.exigirPasskeyAssinatura),
		Boolean(data.temChaveAssinatura)
	);
}

/**
 * O cartão da chave aparece nesta tela?
 *
 * Só com `exigir_passkey_assinatura` LIGADA — e vale para as duas telas que
 * mostram o cartão: Meu Perfil (o titular) e a ficha do policial (Admin Geral).
 * Desligada, a chave não assina nada: o cartão do titular pedia cadastro para
 * um reforço que a corporação não usa, e o do administrador anunciava uma
 * credencial sem função.
 *
 * Uma função para as duas telas, e não a flag lida à mão em cada uma — é assim
 * que as cópias divergem, e aqui a divergência seria o administrador ver o que
 * o titular não vê.
 *
 * **A consequência é deliberada e precisa estar escrita:** desligada a
 * exigência, uma chave JÁ registrada some da tela levando junto o botão de
 * revogar, inclusive o do Admin Geral — que o DEPLOY descreve como o
 * procedimento de "perdi o celular". Enquanto a exigência está desligada não há
 * urgência nisso (nenhuma tela oferece caminho de assinatura por chave), e
 * religá-la traz cartão e botão de volta ANTES de qualquer assinatura ser
 * possível pela interface. Quem precisar revogar com a exigência desligada
 * liga a flag em `/conf-ass`, revoga, e desliga de novo.
 */
export function cartaoChaveVisivel(data: { exigirPasskeyAssinatura?: boolean }): boolean {
	return Boolean(data.exigirPasskeyAssinatura);
}

/**
 * Recado quando a avançada em tela não é oferecida. Celular: cadastrar.
 * Desktop: A3 permanece. Nunca afirma "dispositivo registrado".
 */
export function mensagemConviteChave(isMobile: boolean): string {
	if (isMobile) {
		return (
			'Cadastre a chave de assinatura no celular para assinar em tela. ' +
			'Cadastrar de novo substitui a chave anterior.'
		);
	}
	return 'A assinatura avançada em tela é no celular. Neste computador, use o Token A3.';
}

/**
 * Já há chave: sync da conta Apple/Google NÃO é cadastro novo. Cadastrar de
 * novo substitui — é só para troca ou perda de aparelho.
 *
 * Texto enxugado a pedido do produto (ago/2026): mantém só o essencial —
 * quando NÃO cadastrar de novo, quando cadastrar, e que documentos antigos
 * não são afetados. As substrings verificadas em `chave-assinatura.test.ts`
 * continuam presentes de propósito.
 */
export function mensagemJaTemChaveNoPerfil(): string {
	return (
		'Mesma conta Apple/Google neste celular? Então não cadastre de novo — assine normalmente. ' +
		'Só registre aqui se trocou de aparelho ou perdeu o anterior: a chave antiga deixa de ' +
		'valer, mas os documentos já assinados continuam válidos.'
	);
}

/** Passo dos dois códigos, depois da confirmação de que vai substituir. */
export function mensagemReposicaoDoisEmails(): string {
	return (
		'Registrar de novo substitui a chave atual. Confirme os códigos enviados aos dois e-mails. ' +
		'Um aviso chega no e-mail funcional quando a troca concluir.'
	);
}

/**
 * Cartão da ficha do policial, visão do Admin Geral. Cadastro é do titular;
 * daqui só se revoga. "Chave única" é o contrato: uma ativa por pessoa.
 */
export function mensagemChaveNoCartaoAdmin(): string {
	return (
		'Chave única, guardada no celular do servidor, liberada por biometria ou PIN a cada assinatura. ' +
		'O cadastro só pode ser feito pelo próprio servidor, em Meu Perfil. ' +
		'Aqui na função de administrador, só é possível revogar.'
	);
}

/**
 * Nota junto do provedor (AAGUID): o AAGUID é DECLARADO pelo autenticador na
 * cerimônia de cadastro, não verificado pelo servidor — mesma ressalva do
 * `attestation: 'none'` já documentada no resto do módulo `webauthn/`. Por
 * isso não entra no manifesto do PDF, só nas telas de perfil e da ficha do
 * policial. Curto de propósito: aparece como parêntese ao lado do nome do
 * provedor, não como frase separada.
 */
export function notaProvedorDeclarado(): string {
	return 'não verificado';
}

/**
 * Titular perguntando "em qual celular cadastrei?". Não gravamos modelo,
 * IMEI nem nome (`attestation: 'none'`). O vínculo (conta Apple/Google ×
 * só aquele aparelho) e o recorte são o que dá para mostrar.
 *
 * Enxugado a pedido do produto (ago/2026) — a UI move este texto para um
 * "Onde está minha chave?" recolhível, então a frase não precisa mais
 * reintroduzir o contexto ("a frase de vínculo acima"). As substrings que
 * `chave-assinatura.test.ts` verifica continuam presentes de propósito.
 */
export function mensagemOndeEstaAChave(): string {
	return (
		'O sistema não guarda o modelo do celular, só se a chave está numa conta Apple/Google ' +
		'ou só neste aparelho. Para localizar: iPhone → Ajustes → Senhas → Chaves-de-acesso; ' +
		'Android → Gerenciador de senhas do Google.'
	);
}
