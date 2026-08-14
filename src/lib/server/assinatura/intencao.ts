/**
 * A INTENÇÃO de assinatura: o que amarra um PDF preparado ao documento que ele
 * vai virar (FLW-DOC-001).
 *
 * O fluxo de assinatura com certificado é em dois tempos, porque a chave
 * privada está no token do policial e não no servidor:
 *
 *     preparar → (o dono da chave assina o digest) → finalizar
 *
 * Entre os dois tempos o PDF passa pelo CLIENTE. Até ago/2026 o finalizar
 * aceitava de volta qualquer `preparedPdf` e o gravava no recurso da URL, e a
 * verificação criptográfica não acusava nada: a assinatura ERA válida e o CPF
 * do certificado ERA o do usuário logado. Só o documento podia ser outro.
 *
 * Três coisas ficavam em aberto, e as três são fechadas aqui:
 *
 *   1. **Alvo.** Preparar na escala A e finalizar na B guardava o PDF de A como
 *      documento assinado de B. A intenção carrega `recurso` + `recurso_id`
 *      (+ `escopo_id` para o relatório por seccional) e o finalizar confere
 *      contra a URL.
 *   2. **Uso único.** A mesma preparação podia ser finalizada quantas vezes
 *      quisessem. O consumo é `UPDATE ... WHERE usado = 0 ... RETURNING`, o
 *      mesmo formato de `consumirDesafio2FA`: o SQLite serializa e exatamente
 *      um vencedor altera a linha.
 *   3. **Conteúdo.** O `preparedPdf` do finalizar é conferido contra o
 *      `documento_hash` que o servidor gravou. Assinar o digest de um PDF e
 *      enviar outro no corpo deixa de passar.
 *
 * De quebra, o `verificacao_hash` deixa de vir do cliente: era ele que
 * escolhia a chave no R2 e o código do `/validar` público.
 *
 * **Não substitui a permissão.** O finalizar continua chamando
 * `verificarPermissaoEscala`/`verificarPermissaoGise`: a intenção prova que
 * ESTE ator preparou ESTE documento para ESTE alvo, não que ele ainda pode
 * assiná-lo — permissão pode ter sido revogada no meio do caminho.
 */
import { and, eq, gt } from 'drizzle-orm';
import type { Database } from '$lib/db';
import { assinaturaIntencoes } from '../schema';
import { sha256Hex } from '$lib/crypto/digest';
import { gerarTokenOpaco } from '$lib/crypto/token';

/** Prefixo do token armazenado — o mesmo de `sessoes` e `reset_senha_tokens`. */
const PREFIXO_HASH = 'sha256:';

/**
 * 15 minutos. O tempo entre preparar e finalizar é o de digitar o PIN do token
 * A3 e o provider responder; janela maior só amplia o alcance de uma
 * preparação vazada, e o usuário sempre pode preparar de novo.
 */
const VALIDADE_MS = 15 * 60 * 1000;

type RecursoAssinavel = 'escala' | 'gise' | 'gise_presenca' | 'gise_relatorio';

/** Identifica o documento-alvo. `escopoId` só para o relatório por seccional. */
export interface AlvoAssinatura {
	recurso: RecursoAssinavel;
	recursoId: number;
	escopoId?: number | null;
}

/** Quem preparou. Vem de `locals.usuario`, nunca do corpo da requisição. */
export interface AtorAssinatura {
	id: number;
	tipo: 'policial' | 'admin';
}

async function hashDoToken(token: string): Promise<string> {
	return `${PREFIXO_HASH}${await sha256Hex(token)}`;
}

/**
 * Registra a intenção e devolve o token OPACO que vai ao cliente. Só este
 * valor permite finalizar, e ele existe em claro uma única vez — o banco
 * guarda o hash.
 *
 * @param pdfPreparado bytes do PDF que o `preparar` acabou de montar.
 * @param contexto estado que só o `preparar` conhece e que o `finalizar`
 * precisa gravar. Vai por aqui, e não pelo corpo do finalizar, por dois
 * motivos distintos: `selfieKey` é chave de bucket (deixá-la voltar do cliente
 * permitiria apontar o documento para a foto de outra pessoa — mesma classe do
 * FLW-DOC-001), e o GPS já está DESENHADO no PDF assinado, então recebê-lo de
 * novo deixaria banco e documento discordando sem nada acusar.
 */
export async function criarIntencaoAssinatura(
	db: Database,
	alvo: AlvoAssinatura,
	ator: AtorAssinatura,
	pdfPreparado: Uint8Array,
	verificacaoHash: string,
	contexto: ContextoPreparo = {}
): Promise<string> {
	const token = gerarTokenOpaco();
	await db.insert(assinaturaIntencoes).values({
		token: await hashDoToken(token),
		recurso: alvo.recurso,
		recurso_id: alvo.recursoId,
		escopo_id: alvo.escopoId ?? null,
		usuario_id: ator.id,
		usuario_tipo: ator.tipo,
		documento_hash: await sha256Hex(pdfPreparado),
		verificacao_hash: verificacaoHash,
		selfie_key: contexto.selfieKey ?? null,
		latitude: contexto.latitude ?? null,
		longitude: contexto.longitude ?? null,
		expires_at: new Date(Date.now() + VALIDADE_MS).toISOString()
	});
	return token;
}

type RecusaIntencao =
	| 'ausente' // o cliente não mandou o token
	| 'invalida' // não existe, já foi usada ou expirou
	| 'alvo-divergente' // preparada para outro recurso
	| 'ator-divergente' // preparada por outra pessoa
	| 'documento-divergente'; // o PDF do corpo não é o que foi preparado

/**
 * Estado que atravessa as duas fases pelo servidor. Ver `criarIntencaoAssinatura`
 * para o porquê de não trafegar pelo cliente.
 */
export interface ContextoPreparo {
	/** Objeto da selfie no R2, quando o `preparar` subiu uma. */
	selfieKey?: string | null;
	latitude?: number | null;
	longitude?: number | null;
}

export type ResultadoIntencao =
	| {
			ok: true;
			verificacaoHash: string;
			contexto: Required<ContextoPreparo>;
	  }
	| { ok: false; motivo: RecusaIntencao };

/**
 * CONSOME a intenção e confere que ela corresponde a este finalizar.
 *
 * A ordem importa: o `UPDATE` condicional vem PRIMEIRO, então uma tentativa
 * com token válido queima a intenção mesmo que o alvo não confira. É
 * deliberado — quem erra o alvo está fora do fluxo normal, e deixar a intenção
 * viva permitiria varrer recursos até achar um que aceite.
 *
 * Devolve o `verificacao_hash` do SERVIDOR, que é o que o chamador deve usar
 * para nomear o objeto no R2 e gravar o código público de validação.
 */
export async function consumirIntencaoAssinatura(
	db: Database,
	token: string | undefined | null,
	alvo: AlvoAssinatura,
	ator: AtorAssinatura,
	pdfPreparado: Uint8Array
): Promise<ResultadoIntencao> {
	if (!token) return { ok: false, motivo: 'ausente' };

	const linhas = await db
		.update(assinaturaIntencoes)
		.set({ usado: 1 })
		.where(
			and(
				eq(assinaturaIntencoes.token, await hashDoToken(token)),
				eq(assinaturaIntencoes.usado, 0),
				gt(assinaturaIntencoes.expires_at, new Date().toISOString())
			)
		)
		.returning({
			recurso: assinaturaIntencoes.recurso,
			recurso_id: assinaturaIntencoes.recurso_id,
			escopo_id: assinaturaIntencoes.escopo_id,
			usuario_id: assinaturaIntencoes.usuario_id,
			usuario_tipo: assinaturaIntencoes.usuario_tipo,
			documento_hash: assinaturaIntencoes.documento_hash,
			verificacao_hash: assinaturaIntencoes.verificacao_hash,
			selfie_key: assinaturaIntencoes.selfie_key,
			latitude: assinaturaIntencoes.latitude,
			longitude: assinaturaIntencoes.longitude
		});

	const intencao = linhas[0];
	if (!intencao) return { ok: false, motivo: 'invalida' };

	if (
		intencao.recurso !== alvo.recurso ||
		intencao.recurso_id !== alvo.recursoId ||
		(intencao.escopo_id ?? null) !== (alvo.escopoId ?? null)
	) {
		return { ok: false, motivo: 'alvo-divergente' };
	}

	if (intencao.usuario_id !== ator.id || intencao.usuario_tipo !== ator.tipo) {
		return { ok: false, motivo: 'ator-divergente' };
	}

	if (intencao.documento_hash !== (await sha256Hex(pdfPreparado))) {
		return { ok: false, motivo: 'documento-divergente' };
	}

	return {
		ok: true,
		verificacaoHash: intencao.verificacao_hash,
		contexto: {
			selfieKey: intencao.selfie_key ?? null,
			latitude: intencao.latitude ?? null,
			longitude: intencao.longitude ?? null
		}
	};
}

/**
 * Mensagem para o usuário. Todas as recusas dizem a mesma coisa de propósito:
 * distinguir "preparada para outro recurso" de "não existe" entregaria, a quem
 * está sondando, o mapa de quais alvos aceitam qual preparação.
 */
export function mensagemRecusaIntencao(): string {
	return 'Preparação de assinatura inválida ou expirada. Refaça a assinatura.';
}
