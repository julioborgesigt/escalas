/**
 * Evidência de presença: o que o servidor EXIGE quando a flag está ligada, e o
 * que ele aceita como declaração de que a captura não foi possível.
 *
 * Módulo client-safe, como `$lib/manifesto`: a tela decide o que pedir com a
 * MESMA regra que o servidor aplica para recusar. Sem isso, `exigirFoto` e
 * `exigirGps` viviam só no `SignaturePad` — a confirmação de presença
 * (`salvarEntrada`/`salvarSaida`) não passa por `validarEvidenciasAvancada` e
 * nunca as impôs. Um POST direto registrava presença sem foto e sem GPS
 * enquanto o painel do admin anunciava as duas como obrigatórias: a forma exata
 * da falha que `restringirSmartphone` tinha enquanto vivia só na tela.
 *
 * **Por que existe exceção declarada, e não apenas recusa.** A presença é o ato
 * de maior volume do sistema, tem JANELA DE HORÁRIO e é a base do pagamento da
 * diária. Recusar sem alternativa deixaria de fora quem tem o GPS negado pelo
 * aparelho — e a tela já permitia seguir nesse caso, então a recusa seca seria
 * uma regressão no campo. A saída é a que mantém o documento honesto: a
 * ausência é ACEITA, mas precisa vir DECLARADA com um motivo de lista fechada,
 * que entra na trilha de auditoria.
 *
 * O que isso compra, sendo preciso: não é impedir quem quer burlar — um cliente
 * adulterado sempre pode declarar "GPS negado", e nada client-side resiste a
 * isso (é a mesma fronteira de garantia que o liveness já declara em
 * `signature-service.ts`). O que muda é que a ausência deixa de ser INVISÍVEL:
 * antes o servidor gravava presença sem GPS sem registrar nada, e agora todo
 * ato sem evidência carrega o motivo na auditoria — o que torna o padrão
 * CONTÁVEL por quem lê o console (um servidor que declara "GPS negado" em todas
 * as presenças aparece).
 */

/**
 * Motivos aceitos para a ausência de uma evidência — lista FECHADA.
 *
 * Fechada de propósito: motivo em texto livre viraria campo de qualquer coisa,
 * não agregaria em relatório e ainda seria mais um texto de usuário entrando na
 * trilha. Estes três cobrem o que o navegador de fato reporta.
 */
export const MOTIVOS_SEM_EVIDENCIA = [
	/** O usuário (ou uma política do aparelho) negou a permissão. */
	'permissao_negada',
	/** O recurso não existe neste aparelho/navegador. */
	'indisponivel_no_aparelho',
	/** Existe e foi permitido, mas falhou: timeout de GPS, câmera ocupada. */
	'falha_tecnica'
] as const;

export type MotivoSemEvidencia = (typeof MOTIVOS_SEM_EVIDENCIA)[number];

/**
 * Converte um valor CRU (de `FormData`, portanto `string | null | File`) em
 * motivo válido, ou `null`.
 *
 * `null` para qualquer coisa fora da lista — inclusive uma string parecida. É o
 * que impede o campo de virar texto livre por um POST direto.
 */
export function lerMotivoSemEvidencia(valor: unknown): MotivoSemEvidencia | null {
	if (typeof valor !== 'string') return null;
	const v = valor.trim();
	return (MOTIVOS_SEM_EVIDENCIA as readonly string[]).includes(v)
		? (v as MotivoSemEvidencia)
		: null;
}

/** As duas flags que este gate consulta. */
export interface FlagsEvidenciaPresenca {
	exigirFotoAssinatura: boolean;
	exigirGpsAssinatura: boolean;
}

/** O que o cliente entregou, já normalizado pelo servidor. */
export interface EvidenciaPresenca {
	/** `true` quando a coordenada recebida é uma leitura PLAUSÍVEL (ver `coordenadaGeograficaValida`). */
	gpsValido: boolean;
	/** `true` quando a selfie foi aceita e gravada no R2. */
	temSelfie: boolean;
	motivoSemGps: MotivoSemEvidencia | null;
	motivoSemFoto: MotivoSemEvidencia | null;
}

/**
 * A recusa, ou `null` quando pode seguir.
 *
 * Recusa quando a flag está ligada, a evidência não veio E não há motivo
 * declarado. Evidência presente dispensa motivo; motivo declarado dispensa a
 * evidência (e fica na trilha).
 */
export function recusaPorEvidenciaDePresenca(
	flags: FlagsEvidenciaPresenca,
	ev: EvidenciaPresenca
): { error: string } | null {
	if (flags.exigirFotoAssinatura && !ev.temSelfie && !ev.motivoSemFoto) {
		return {
			error:
				'A foto é obrigatória para confirmar presença. ' +
				'Permita o acesso à câmera e tente novamente; se o aparelho não tiver câmera ' +
				'disponível, registre o motivo na tela para prosseguir.'
		};
	}
	if (flags.exigirGpsAssinatura && !ev.gpsValido && !ev.motivoSemGps) {
		return {
			error:
				'A localização é obrigatória para confirmar presença. ' +
				'Permita o acesso ao GPS e tente novamente; se o aparelho não conseguir obtê-la, ' +
				'registre o motivo na tela para prosseguir.'
		};
	}
	return null;
}

/**
 * O que a trilha de auditoria registra sobre a evidência deste ato.
 *
 * `temSelfie`/`temGps` já iam para lá; o que faltava era o MOTIVO quando não
 * foram capturadas — sem ele, "sem GPS" e "sem GPS porque o aparelho negou" são
 * a mesma linha, e nenhuma das duas explica nada a quem audita depois.
 */
export function metadadosDeEvidenciaPresenca(ev: EvidenciaPresenca): Record<string, unknown> {
	return {
		temSelfie: ev.temSelfie,
		temGps: ev.gpsValido,
		...(ev.motivoSemFoto ? { motivoSemFoto: ev.motivoSemFoto } : {}),
		...(ev.motivoSemGps ? { motivoSemGps: ev.motivoSemGps } : {})
	};
}
