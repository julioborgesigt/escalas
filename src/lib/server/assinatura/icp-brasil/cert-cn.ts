/**
 * Lookup de certificado ICP pelo CN do subject.
 *
 * O mesmo `issuer.getField('CN')` + `find` no trust store estava copiado em
 * `pdf-verification`, `cades-finalizer` e `cert-login`. Qualquer correção de
 * encoding do DN tinha de ser feita três vezes — e a terceira ficava para trás.
 */
import type forge from 'node-forge';
import type { TrustStore } from './trust-store';

/**
 * CN do subject ou do issuer. String vazia quando o campo não existe — o
 * node-forge devolve `null` nesse caso, e os call sites já tratavam assim.
 */
export function cnDoCertificado(
	cert: forge.pki.Certificate,
	lado: 'subject' | 'issuer' = 'subject'
): string {
	return (cert[lado].getField('CN')?.value as string) || '';
}

/**
 * Primeiro certificado da lista cujo CN do subject coincide. `undefined` se
 * ninguém bater — inclusive quando `cn` é vazio e nenhum subject está vazio.
 */
export function encontrarCertPorCN(
	certs: readonly forge.pki.Certificate[],
	cn: string
): forge.pki.Certificate | undefined {
	return certs.find((c) => cnDoCertificado(c) === cn);
}

/**
 * Issuer do certificado no trust store (intermediários + raízes), pelo CN.
 * É o que OCSP e DSS precisam antes de consultar o responder.
 */
export function encontrarIssuerNoTrustStore(
	certificado: forge.pki.Certificate,
	ts: Pick<TrustStore, 'intermediates' | 'roots'>
): forge.pki.Certificate | undefined {
	return encontrarCertPorCN(
		[...ts.intermediates, ...ts.roots],
		cnDoCertificado(certificado, 'issuer')
	);
}
