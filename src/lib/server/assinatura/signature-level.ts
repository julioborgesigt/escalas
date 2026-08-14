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
		id: 'passkey',
		flag: 'exigirPasskeyAssinatura',
		descricao: 'Chave de assinatura no celular (passkey), liberada por biometria/PIN',
		valorProbatorio: 'alto',
		// É o único reforço que toca o inciso "b" do art. 4º II: a chave privada
		// nasce no enclave do aparelho, não é exportável e só opera após
		// verificação do titular. Mas as ressalvas são parte da nota, não
		// rodapé — sem atestação verificada, "autenticador de plataforma" é
		// declaração do cliente, e passkey sincronizada (o padrão em iOS e
		// Android) prova a CONTA do titular, não aquele aparelho.
		notas:
			'Controle exclusivo dos dados de criação (art. 4º II "b"). Sem atestação ' +
			'verificada não se afirma hardware; credencial sincronizada prova a conta ' +
			'do titular, não o aparelho. Hoje aplica-se SÓ à escala de serviço.'
	},
	{
		id: 'restricao_dispositivo',
		flag: 'restringirSmartphone',
		descricao: 'Bloqueia assinatura em desktop/laptop (apenas smartphone)',
		valorProbatorio: 'medio',
		// O valor deste reforço é INDIRETO e a nota precisa dizer isso: o
		// dispositivo não é dado de criação da assinatura (art. 4º II "b" —
		// aqui os dados de criação são login+senha+2FA), então a restrição não
		// eleva o nível. O que ela faz é elevar a QUALIDADE das outras duas
		// evidências (GPS de celular é GNSS, não geolocalização de IP; a câmera
		// está na mão de quem assina) e afastar o terminal compartilhado.
		notas:
			'Recusado no servidor pelo user-agent DECLARADO — indício, não prova, ' +
			'e não vincula o aparelho ao assinante. Reduz risco de assinatura em ' +
			'terminal compartilhado/destravado e torna GPS e foto confiáveis.'
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
	exigirPasskeyAssinatura: boolean;
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
