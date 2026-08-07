/**
 * Máscaras de entrada e normalização de texto — puro, compartilhado por
 * servidor E cliente (sem import de `$lib/server`, sem acesso a banco, sem
 * estado).
 *
 * As máscaras (`formatarCPF`, `formatarNUP`) são aplicadas
 * A CADA TECLA, então precisam tratar a string parcialmente digitada — um
 * formatador que só aceitasse o valor completo faria o campo "pular" ao
 * terminar de digitar.
 *
 * Como no resto de `utils/`, **entrada inválida devolve valor neutro** (`''`,
 * a própria entrada), sem lançar: são funções chamadas em meio a markup, onde
 * uma exceção derrubaria a tela por causa de um campo vazio.
 */

/** Remove acentos e normaliza espaços. Útil para comparações case-insensitive. */
export function normalizarTexto(texto: string): string {
	if (!texto) return '';
	return texto
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.trim()
		.toLowerCase();
}

/**
 * Remove pontos e hifens da matrícula para padronização.
 * Ex: "301.095-1-1" -> "30109511"
 */
export function limparMatricula(matricula: string): string {
	if (!matricula) return '';
	return String(matricula).replace(/[.-]/g, '').trim();
}

/**
 * Gera um código aleatório para validação de documentos impressos. Ex: "ABCD-1234".
 *
 * Usa `crypto.getRandomValues` (CSPRNG) — `Math.random` é o PRNG xorshift128+
 * do V8, criptograficamente previsível: bastam 2 saídas para reconstruir o
 * estado interno e prever as próximas. Como o código é a única chave da rota
 * pública `/validar/[hash]` (sem autenticação), isso permitiria enumerar e
 * baixar todos os PDFs assinados.
 *
 * O byte é mapeado por `byte % 32` em vez de rejection sampling: como o
 * alfabeto tem exatamente 32 caracteres e 256 % 32 === 0, a distribuição é
 * uniforme sem viés.
 */
export function gerarCodigoValidacao(): string {
	const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Sem O, I, 1, 0 para evitar confusão
	const bytes = crypto.getRandomValues(new Uint8Array(8));
	const out = Array.from(bytes, (b) => chars[b % chars.length]).join('');
	return `${out.slice(0, 4)}-${out.slice(4, 8)}`;
}

/**
 * Normaliza um telefone para SÓ dígitos, no máximo 11 (DDD + 9). É o formato
 * PADRÃO dos campos de telefone do projeto: aplique na entrada (a cada tecla) e
 * ao comparar/gravar, para que uma diferença só de formatação (espaço, traço)
 * não conte como mudança.
 */
export function limparTelefone(v: string | null | undefined): string {
	return (v ?? '').replace(/\D/g, '').slice(0, 11);
}

/**
 * Formata um CPF no padrão 000.000.000-00.
 */
export function formatarCPF(v: string): string {
	if (!v) return '';
	v = v.replace(/\D/g, ''); // Remove tudo o que não é dígito
	if (v.length > 11) v = v.slice(0, 11);

	if (v.length > 9) {
		return v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
	} else if (v.length > 6) {
		return v.replace(/(\d{3})(\d{3})(\d{3})/, '$1.$2.$3');
	} else if (v.length > 3) {
		return v.replace(/(\d{3})(\d{3})/, '$1.$2');
	}
	return v;
}

/**
 * Remove pontos e hifens do CPF.
 */
export function limparCPF(v: string): string {
	if (!v) return '';
	return String(v).replace(/\D/g, '').trim();
}

/**
 * Aplica a máscara de NUP (Número Único de Protocolo): `00000.000000/0000-00`.
 * Vai preenchendo os separadores conforme o usuário digita (até 17 dígitos).
 */
export function formatarNUP(v: string): string {
	const d = v.replace(/\D/g, '').slice(0, 17);
	let out = d.slice(0, 5);
	if (d.length > 5) out += '.' + d.slice(5, 11);
	if (d.length > 11) out += '/' + d.slice(11, 15);
	if (d.length > 15) out += '-' + d.slice(15, 17);
	return out;
}
