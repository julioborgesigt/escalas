/**
 * Validação de CPF pelos dígitos verificadores — puro, compartilhado por
 * servidor E cliente (sem `$lib/server`, sem banco, sem estado).
 *
 * Existe porque o CPF entra no sistema por dois caminhos e, até aqui, nenhum
 * conferia mais do que a FORMA: `policialSchema` aceita `111.111.111-11` por
 * casar a regex. No cadastro de servidores isso é dado da planilha; no módulo
 * de diárias é pior — o beneficiário de outro departamento não está em
 * `policiais`, o CPF é digitado à mão uma única vez e vai direto para o
 * Requerimento assinado, sem matrícula para cruzar nem índice cego para bater.
 *
 * A normalização é a de `formato.ts` (`limparCPF`), e não uma cópia local:
 * `crypto/cpf-cripto.ts` tem a sua própria porque precisa ser importável por
 * scripts fora do app — esta não precisa, então reusa.
 *
 * Como no resto de `utils/`, entrada inválida devolve valor neutro (`false`),
 * sem lançar.
 */
import { limparCPF } from './formato';

/**
 * Dígito verificador do CPF (módulo 11). `pesoInicial` é 10 para o primeiro
 * dígito (sobre os 9 primeiros) e 11 para o segundo (sobre os 10 primeiros).
 * Resto 10 vira 0 — é a regra da Receita, não arredondamento.
 */
function digitoVerificador(digitos: number[], pesoInicial: number): number {
	let soma = 0;
	for (let i = 0; i < digitos.length; i++) soma += digitos[i] * (pesoInicial - i);
	const resto = (soma * 10) % 11;
	return resto === 10 ? 0 : resto;
}

/**
 * `true` se `v` é um CPF válido: 11 dígitos (com ou sem máscara), não é uma
 * sequência de um só dígito repetido (`000…`, `111…`, … `999…` — todas passam
 * no cálculo e por isso são recusadas à parte) e os dois dígitos verificadores
 * conferem.
 */
export function cpfValido(v: string | null | undefined): boolean {
	const limpo = limparCPF(v ?? '');
	if (limpo.length !== 11) return false;
	if (/^(\d)\1{10}$/.test(limpo)) return false;

	const digitos = limpo.split('').map(Number);
	const d1 = digitoVerificador(digitos.slice(0, 9), 10);
	if (d1 !== digitos[9]) return false;
	const d2 = digitoVerificador(digitos.slice(0, 10), 11);
	return d2 === digitos[10];
}
