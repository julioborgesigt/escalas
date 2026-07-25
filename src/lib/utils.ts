/**
 * Formata uma data no formato "YYYY-MM-DD" para "DD/MM/YYYY".
 */
export function formatarData(dateStr: string): string {
	if (!dateStr) return '';
	const [year, month, day] = dateStr.split('-');
	return `${day}/${month}/${year}`;
}

/**
 * Retorna a data do dia seguinte no formato "YYYY-MM-DD".
 */
function proximoDia(dateStr: string): string {
	const d = new Date(dateStr + 'T00:00:00');
	d.setDate(d.getDate() + 1);
	return d.toISOString().split('T')[0];
}

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
 * Retorna a data de saída efetiva: se horaSaida ≤ horaEntrada, avança um dia.
 * Hora vazia conta como meia-noite ('00'); com ambas vazias, mantém a data.
 * Implementação ÚNICA — `$lib/rotacao` re-exporta daqui (achado D1 do antigo ARQUIVOS.md — ver docs/HISTORICO.md).
 */
export function calcularDataSaida(
	dataInicio: string,
	horaEntrada: string,
	horaSaida: string
): string {
	if (!horaEntrada && !horaSaida) return dataInicio;
	const he = parseInt(horaEntrada.split(':')[0] || '0', 10);
	const hs = parseInt(horaSaida.split(':')[0] || '0', 10);
	return hs <= he ? proximoDia(dataInicio) : dataInicio;
}

/**
 * Nomes dos meses em português, índice 0 = Janeiro (mesma base de
 * `Date.getMonth()`). Para mês 1-12 vindo do banco/URL, use `MESES_PT[mes - 1]`.
 *
 * Fonte única: a lista estava redeclarada em 13 arquivos (calendários, tabelas,
 * PDFs, painel de compliance) com nomes diferentes (MESES, MESES_PT, MESES_CAL).
 */
export const MESES_PT = [
	'Janeiro',
	'Fevereiro',
	'Março',
	'Abril',
	'Maio',
	'Junho',
	'Julho',
	'Agosto',
	'Setembro',
	'Outubro',
	'Novembro',
	'Dezembro'
] as const;

/**
 * Dias da semana abreviados, índice 0 = domingo (base de `Date.getDay()`).
 * Também estava redeclarado em 6 arquivos (calendários e formatadores).
 */
export const DIAS_SEMANA_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

/**
 * Opções de mês para `<select>`, na ordem 1-12, com uma entrada inicial "Todos"
 * (valor 0). `valorTexto` devolve os valores como string (formulários que
 * comparam com `string`).
 */
export function opcoesMeses(): Array<{ value: number; label: string }>;
export function opcoesMeses(valorTexto: true): Array<{ value: string; label: string }>;
export function opcoesMeses(valorTexto = false) {
	const todos = valorTexto ? { value: 'todos', label: 'Todos' } : { value: 0, label: 'Todos' };
	return [
		todos,
		...MESES_PT.map((label, i) => ({ value: valorTexto ? String(i + 1) : i + 1, label }))
	];
}

/**
 * Formata uma data por extenso. Ex: "01 de Janeiro de 2025".
 */
export function formatarDataExtenso(date: Date): string {
	const d = date.getDate();
	const m = MESES_PT[date.getMonth()];
	const a = date.getFullYear();
	return `${String(d).padStart(2, '0')} de ${m} de ${a}`;
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
 * Soma `dias` a uma data ISO `YYYY-MM-DD` e devolve o resultado no mesmo
 * formato. Aceita valores negativos. Retorna a entrada se ela for inválida.
 */
export function adicionarDias(iso: string, dias: number): string {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
	const d = new Date(iso + 'T00:00:00');
	d.setDate(d.getDate() + dias);
	return d.toISOString().slice(0, 10);
}

/**
 * Diferença INCLUSIVA em dias entre duas datas ISO (`fim` >= `inicio`):
 * "2026-01-01" a "2026-01-01" = 1 dia. Retorna 0 se as datas forem inválidas
 * ou se `fim` < `inicio`.
 */
export function diffDiasInclusivo(inicio: string, fim: string): number {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) return 0;
	const ms = new Date(fim + 'T00:00:00').getTime() - new Date(inicio + 'T00:00:00').getTime();
	if (ms < 0) return 0;
	return Math.round(ms / 86_400_000) + 1;
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
/**
 * Retorna a data/hora atual ajustada para o fuso de Brasília/Fortaleza (UTC-3).
 * Útil para ambientes como Cloudflare Workers que operam em UTC.
 */
export function getNowBR(): Date {
	return new Date(Date.now() - 3 * 3600 * 1000);
}

/**
 * Mascara o nome para exibição comercial (Ex: MARCOS S*** LIRA)
 */
export function mascararNome(nome: string | undefined): string {
	if (!nome) return '';
	const partes = nome.trim().split(/\s+/);
	if (partes.length === 1) return partes[0];
	const primeiro = partes[0];
	const ultimo = partes[partes.length - 1];

	// Se tiver 2 nomes: MARCOS LIRA -> MARCOS L***
	if (partes.length === 2) return `${primeiro} ${ultimo[0]}***`;

	// Se tiver 3+ nomes: MARCOS SANDRO LIRA -> MARCOS S*** LIRA
	return `${primeiro} ${partes[1][0]}*** ${ultimo}`;
}

/**
 * Mascara o CPF (Ex: ***.229.***-**)
 */
export function mascararCPF(cpf: string | undefined): string {
	if (!cpf) return '';
	const limpo = cpf.replace(/\D/g, '');
	if (limpo.length !== 11) return cpf;
	// Exibe apenas os dígitos centrais (4º, 5º e 6º)
	return `***.${limpo.slice(3, 6)}.***-**`;
}

export function mascararEmail(email: string): string {
	const at = email.indexOf('@');
	if (at <= 0) return email;
	const local = email.slice(0, at);
	const domain = email.slice(at + 1);
	let masked: string;
	if (local.length === 1) {
		masked = local;
	} else if (local.length === 2) {
		masked = local[0] + '*';
	} else {
		const showStart = Math.min(2, Math.floor(local.length / 2));
		masked =
			local.slice(0, showStart) +
			'*'.repeat(local.length - showStart - 1) +
			local[local.length - 1];
	}
	// Ocultar domínio para não revelar provedor (ex: gmail.com → ***.com)
	const dotIdx = domain.lastIndexOf('.');
	const maskedDomain = dotIdx > 0 ? '***' + domain.slice(dotIdx) : '***';
	return masked + '@' + maskedDomain;
}
