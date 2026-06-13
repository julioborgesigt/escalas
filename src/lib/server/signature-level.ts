/**
 * Classificação dos níveis de assinatura eletrônica segundo a
 * **Lei 14.063/2020 art. 4º** e a **MP 2.200-2/2001 art. 10 §1º**.
 *
 * Esta é a fonte única de verdade para:
 *   - decidir se uma assinatura em tela é "SIMPLES" ou "AVANÇADA";
 *   - rotular o manifesto do PDF, a página /validar e o painel /conf-ass;
 *   - autorizar (ou bloquear) configurações que rebaixariam o nível.
 *
 * Importante: alterar a lógica deste módulo afeta toda a cadeia probatória
 * dos documentos assinados — qualquer mudança exige passar por revisão
 * jurídica e bump do CONTEUDO_HTML do termo de uso.
 */

// ---------------------------------------------------------------------------
// Definição legal
// ---------------------------------------------------------------------------

/**
 * Lei 14.063/2020, art. 4º:
 *
 *  I  — ASSINATURA ELETRÔNICA SIMPLES:
 *       "a que permite identificar o seu signatário e anexa ou associa
 *        dados a outros dados em formato eletrônico do signatário".
 *
 *  II — ASSINATURA ELETRÔNICA AVANÇADA:
 *       a que utiliza certificados não emitidos pela ICP-Brasil ou outro
 *       meio de comprovação da autoria e da integridade de documentos,
 *       desde que admitido pelas partes ou aceito pela pessoa a quem for
 *       oposto, com as seguintes características:
 *         a) associação ao signatário de maneira unívoca;
 *         b) utilização de dados para a criação de assinatura cujo
 *            signatário pode, com elevado nível de confiança, operar
 *            sob o seu controle exclusivo;
 *         c) relacionamento aos dados de tal modo que qualquer
 *            modificação posterior é detectável.
 *
 *  III — ASSINATURA ELETRÔNICA QUALIFICADA:
 *        a que utiliza certificado digital ICP-Brasil (MP 2.200-2/2001).
 */
type NivelAssinatura = 'simples' | 'avancada' | 'qualificada';

// ---------------------------------------------------------------------------
// Requisitos do sistema
// ---------------------------------------------------------------------------

/**
 * Requisitos sempre ativos no fluxo de assinatura em tela — não há toggle
 * no admin, são parte da implementação:
 *
 *   - **Hash SHA-256** do PDF original (atende art. 4º II "c");
 *   - **Sessão autenticada** com login+senha (atende art. 4º II "a" parcial);
 *   - **Registro de IP, User-Agent e timestamp** do servidor (auditoria).
 */
export const REQUISITOS_SEMPRE_ATIVOS = [
	{
		id: 'hash_sha256',
		descricao: 'Hash criptográfico SHA-256 do PDF original',
		baseLegal: 'Lei 14.063/2020 art. 4º II "c" (integridade detectável)'
	},
	{
		id: 'sessao_autenticada',
		descricao: 'Sessão autenticada (login + senha + RBAC)',
		baseLegal: 'Lei 14.063/2020 art. 4º II "a" (vínculo unívoco)'
	},
	{
		id: 'registro_auditoria',
		descricao: 'Registro de IP anonimizado, User-Agent e timestamp',
		baseLegal: 'LGPD art. 16 e Decreto 10.748/2021'
	}
] as const;

/**
 * Requisitos **configuráveis** que o sistema exige para classificar a
 * assinatura como AVANÇADA. Hoje só há um: 2FA por e-mail.
 *
 * O e-mail institucional/pessoal é o único canal lateral de posse exclusiva
 * disponível para todos os usuários (foto e GPS dependem de hardware do
 * dispositivo e não comprovam posse exclusiva). Sem 2FA, a assinatura em
 * tela cai para SIMPLES (Lei 14.063 art. 4º I).
 *
 * Por essa razão, a configuração `exigirCodigoEmailAssinatura` é
 * **sempre forçada para true** pelo endpoint PUT — o admin pode mexer em
 * foto/GPS/restrição-dispositivo, mas não pode desligar o 2FA.
 */
export const REQUISITOS_OBRIGATORIOS_AVANCADA = [
	{
		id: 'segundo_fator_email',
		flag: 'exigirCodigoEmailAssinatura',
		descricao: 'Confirmação por código numérico enviado ao e-mail cadastrado do signatário (2FA)',
		baseLegal: 'Lei 14.063/2020 art. 4º II "b" — controle exclusivo dos dados de criação'
	}
] as const;

/**
 * Reforços opcionais — aumentam o valor probatório em juízo (prova de
 * presença física, prova de localização, antifraude por dispositivo),
 * mas a ausência de qualquer um deles **não rebaixa** a classificação
 * legal de AVANÇADA para SIMPLES.
 */
export const REFORCOS_OPCIONAIS = [
	{
		id: 'selfie_liveness',
		flag: 'exigirFotoAssinatura',
		descricao: 'Selfie com detecção facial (prova de presença)',
		valorProbatorio: 'alto',
		notas: 'Detecta presença de rosto; não compara contra biometria cadastrada (1:1).'
	},
	{
		id: 'geolocalizacao',
		flag: 'exigirGpsAssinatura',
		descricao: 'Coordenadas GPS reduzidas a ~1 km (LGPD-friendly)',
		valorProbatorio: 'medio',
		notas: 'Coordenadas com 2 casas decimais; útil para correlacionar com escala de serviço.'
	},
	{
		id: 'restricao_dispositivo',
		flag: 'restringirSmartphone',
		descricao: 'Bloqueia assinatura em desktop/laptop (apenas smartphone)',
		valorProbatorio: 'medio',
		notas: 'Reduz risco de assinatura em terminal compartilhado/destravado por terceiro.'
	}
] as const;

// ---------------------------------------------------------------------------
// Classificação
// ---------------------------------------------------------------------------

interface FlagsParaClassificacao {
	exigirFotoAssinatura: boolean;
	exigirGpsAssinatura: boolean;
	exigirCodigoEmailAssinatura: boolean;
	restringirSmartphone: boolean;
}

/**
 * Decide o nível efetivo da assinatura em tela dado o estado das flags.
 *
 * Regra única: AVANÇADA se e somente se TODOS os requisitos da lista
 * `REQUISITOS_OBRIGATORIOS_AVANCADA` estiverem ativos.
 *
 * Aplica-se apenas a assinaturas SEM token ICP-Brasil — o fluxo
 * qualificado (Web PKI / SERPRO) é sempre `'qualificada'` e ignora estas
 * flags.
 */
export function classificarNivelAssinaturaTela(
	flags: FlagsParaClassificacao
): Extract<NivelAssinatura, 'simples' | 'avancada'> {
	const f = flags as unknown as Record<string, boolean>;
	const todosObrigatoriosAtivos = REQUISITOS_OBRIGATORIOS_AVANCADA.every((r) => f[r.flag] === true);
	return todosObrigatoriosAtivos ? 'avancada' : 'simples';
}

/**
 * Pontuação de reforços ativos (0 a `REFORCOS_OPCIONAIS.length`).
 * Usada na UI para exibir o "Nível de Proteção" como métrica complementar.
 */
export function contarReforcos(flags: FlagsParaClassificacao): number {
	const f = flags as unknown as Record<string, boolean>;
	return REFORCOS_OPCIONAIS.filter((r) => f[r.flag] === true).length;
}

/**
 * Devolve a base legal textual para uso em rótulos da UI e badges do PDF.
 */
export function baseLegalDoNivel(nivel: NivelAssinatura): string {
	switch (nivel) {
		case 'qualificada':
			return 'MP 2.200-2/2001 art. 10 §1º — ICP-Brasil';
		case 'avancada':
			return 'Lei 14.063/2020 art. 4º II e art. 5º II';
		case 'simples':
			return 'Lei 14.063/2020 art. 4º I e art. 5º I';
	}
}
