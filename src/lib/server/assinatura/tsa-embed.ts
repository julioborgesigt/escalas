/**
 * Anexar um carimbo de tempo RFC 3161 a um PDF já assinado — o passo que
 * promove CAdES-BES a CAdES-T.
 *
 * Existe separado de `tsa.ts` (o cliente HTTP da TSA) porque este é o lado PDF
 * da história: pegar o CMS que está no `/Contents`, acrescentar o
 * `TimeStampToken` como UnsignedAttribute e regravar o placeholder.
 *
 * POR QUE É SEGURO fazer isso DEPOIS de assinar (verificado em PDF real de
 * e-CPF SERPRO):
 *   - O TST vive DENTRO do `/Contents`, no gap do `/ByteRange` — não altera
 *     nenhum byte assinado nem cria revisão incremental. Logo não dispara o
 *     "documento modificado" do Adobe, diferente do DSS.
 *   - `adicionarTimestampTokenAoCms` só ACRESCENTA unsignedAttrs; a assinatura
 *     RSA incide sobre os signedAttrs, que ficam intactos.
 *
 * BEST-EFFORT É A REGRA, e é o que esta função existe para não deixar divergir:
 * TSA fora do ar, rede caindo, placeholder cheio ou resposta malformada
 * mantêm a assinatura VÁLIDA e sem carimbo. Nada aqui pode lançar para o
 * chamador — um adorno temporal não derruba um ato de assinatura já
 * consumado. Os dois consumidores (assinatura qualificada em
 * `cades-finalizer` e selo institucional em `server-seal`) repetiam esse
 * contrato em cópias separadas, e bastava alguém "melhorar" o tratamento de
 * erro de um lado para as duas políticas divergirem em silêncio.
 *
 * Observação jurídica: DigiCert/FreeTSA NÃO são ACT credenciadas ICP-Brasil.
 * O que sai daqui é `'tsa_externa'` — atestação de tempo de terceiro
 * confiável, não carimbo qualificado. Ainda assim é muito superior ao relógio
 * do signatário. Quem exige ACT credenciada é `exigirTsa`, em `tsa.ts`.
 */
import forge from 'node-forge';
import { logger } from '../logger';
import { solicitarCarimboTempo } from './tsa';
import { adicionarTimestampTokenAoCms } from './cms-tst';
import { embedCmsBytesNoPlaceholder } from './pdf-signing-prepare';

export interface CarimboTempoAnexado {
	/** PDF com o TST embutido — ou o de entrada, inalterado, se não houve carimbo. */
	pdf: Uint8Array;
	/** CMS com o TST anexado — ou o de entrada, se não houve carimbo. */
	cmsDer: Uint8Array;
	/** `TimeStampToken` em base64, para gravar como metadado. Só quando aplicado. */
	tstTokenB64?: string;
	/** `true` só quando o carimbo foi obtido E embutido com sucesso. */
	aplicado: boolean;
}

/**
 * Pede um TST à TSA configurada e o embute no CMS do PDF.
 *
 * Sem `TSA_URL` configurada, devolve a entrada intacta com `aplicado: false` —
 * não é erro, é a instalação que optou por não carimbar.
 *
 * @param assinatura `signatureValue` do CMS (string binária do forge), que é o
 *   dado sobre o qual a TSA carimba o tempo.
 * @param contexto Prefixo do log, para distinguir os fluxos no Sentry
 *   (`'[CADES]'`, `'[selo]'`).
 */
export async function anexarCarimboTempo(
	pdf: Uint8Array,
	cmsDer: Uint8Array,
	assinatura: string,
	env: Record<string, string | undefined> | undefined,
	contexto: string
): Promise<CarimboTempoAnexado> {
	const semCarimbo: CarimboTempoAnexado = { pdf, cmsDer, aplicado: false };

	const url = env?.TSA_URL;
	if (!url) return semCarimbo;

	try {
		const tsa = await solicitarCarimboTempo(assinatura, {
			url,
			username: env?.TSA_USERNAME,
			password: env?.TSA_PASSWORD
		});
		if (!tsa.ok) {
			logger.warn(`${contexto} TSA falhou — assinatura mantida sem carimbo de tempo`, {
				url,
				error: tsa.error
			});
			return semCarimbo;
		}

		const novoCmsDer = adicionarTimestampTokenAoCms(cmsDer, tsa.tstAsn1);
		return {
			pdf: embedCmsBytesNoPlaceholder(pdf, novoCmsDer),
			cmsDer: novoCmsDer,
			tstTokenB64: tstEmBase64(tsa.tstAsn1),
			aplicado: true
		};
	} catch (e) {
		logger.warn(`${contexto} Erro ao anexar carimbo de tempo — assinatura mantida sem TST`, {
			error: e instanceof Error ? e.message : String(e)
		});
		return semCarimbo;
	}
}

/**
 * Serializa o TST para base64. Devolve `undefined` em vez de lançar: o token em
 * base64 é METADADO de auditoria, e perdê-lo não pode invalidar um carimbo que
 * já está embutido no PDF.
 */
export function tstEmBase64(tstAsn1: forge.asn1.Asn1): string | undefined {
	try {
		return forge.util.encode64(forge.asn1.toDer(tstAsn1).getBytes());
	} catch {
		return undefined;
	}
}
