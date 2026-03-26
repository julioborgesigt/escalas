/**
 * Remove pontos e hifens da matrícula para padronização.
 * Ex: "301.095-1-1" -> "30109511"
 */
export function limparMatricula(matricula: string): string {
	if (!matricula) return '';
	return String(matricula).replace(/[.-]/g, '').trim();
}

/**
 * Gera um código aleatório para validação de documentos impressos.
 * Ex: "ABCD-1234"
 */
export function gerarCodigoValidacao(): string {
	const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Sem O, I, 1, 0 para evitar confusão
	const gen = (n: number) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
	return `${gen(4)}-${gen(4)}`;
}
export function formatarTelefone(v: string): string {
	if (!v) return '';
	v = v.replace(/\D/g, ''); // Remove tudo o que não é dígito

	if (v.length > 11) v = v.slice(0, 11);

	if (v.length > 10) {
		// (88) 9.8888-8888
		return v.replace(/(\d{2})(\d{1})(\d{4})(\d{4})/, '($1) $2.$3-$4');
	} else if (v.length > 6) {
		// (88) 98888-8888 ou (88) 8888-8888
		// Se o terceiro dígito for 9, tratamos como celular para o formato (88) 9.8888-...
		if (v.length > 2 && v[2] === '9') {
			return v.replace(/(\d{2})(\d{1})(\d{4})(\d{0,4})/, '($1) $2.$3-$4');
		}
		return v.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
	} else if (v.length > 2) {
		if (v.length > 2 && v[2] === '9') {
			return v.replace(/(\d{2})(\d{1})(\d{0,4})/, '($1) $2.$3');
		}
		return v.replace(/(\d{2})(\d{0,5})/, '($1) $2');
	} else if (v.length > 0) {
		return v.replace(/(\d{0,2})/, '($1');
	}
	return v;
}

