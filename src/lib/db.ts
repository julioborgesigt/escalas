import type { Policial, Escala, EscalaPolicialComDados, Unidade } from './types';
import { limparMatricula } from './utils';

export function getDB(platform: App.Platform | undefined): D1Database {
	if (!platform?.env?.escalas_db) {
		throw new Error('Database not available. Make sure D1 is configured.');
	}
	return platform.env.escalas_db;
}

// ---- Policiais ----

export async function listarPoliciais(db: D1Database, lotacao?: string, semLotacao?: boolean): Promise<Policial[]> {
	let query = 'SELECT * FROM policiais WHERE ativo = 1';
	const params: string[] = [];
	if (semLotacao) {
		query += " AND (lotacao = '' OR lotacao IS NULL)";
	} else if (lotacao) {
		query += ' AND lotacao = ?';
		params.push(lotacao);
	}
	query += ' ORDER BY cargo, nome';
	const result = await db.prepare(query).bind(...params).all<Policial>();
	return result.results;
}

export async function buscarPolicial(db: D1Database, id: number): Promise<Policial | null> {
	return db.prepare('SELECT * FROM policiais WHERE id = ?').bind(id).first<Policial>();
}

export async function criarPolicial(db: D1Database, data: Omit<Policial, 'id' | 'ativo' | 'created_at' | 'updated_at'>): Promise<D1Result> {
	const matriculaLimpa = limparMatricula(data.matricula);
	return db.prepare(
		'INSERT INTO policiais (nome, matricula, cargo, telefone, lotacao) VALUES (?, ?, ?, ?, ?)'
	).bind(data.nome, matriculaLimpa, data.cargo, data.telefone, data.lotacao).run();
}

export async function atualizarPolicial(db: D1Database, id: number, data: Partial<Omit<Policial, 'id' | 'created_at' | 'updated_at'>>): Promise<D1Result> {
	const fields: string[] = [];
	const values: (string | number)[] = [];

	if (data.nome !== undefined) { fields.push('nome = ?'); values.push(data.nome); }
	if (data.matricula !== undefined) { fields.push('matricula = ?'); values.push(limparMatricula(data.matricula)); }
	if (data.cargo !== undefined) { fields.push('cargo = ?'); values.push(data.cargo); }
	if (data.telefone !== undefined) { fields.push('telefone = ?'); values.push(data.telefone); }
	if (data.lotacao !== undefined) { fields.push('lotacao = ?'); values.push(data.lotacao); }
	if (data.ativo !== undefined) { fields.push('ativo = ?'); values.push(data.ativo); }

	fields.push("updated_at = datetime('now')");
	values.push(id);

	return db.prepare(`UPDATE policiais SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
}

export async function excluirPolicial(db: D1Database, id: number): Promise<D1Result> {
	return db.prepare('DELETE FROM policiais WHERE id = ?').bind(id).run();
}

export async function listarLotacoes(db: D1Database): Promise<string[]> {
	const result = await db.prepare('SELECT nome FROM unidades ORDER BY nome').all<{ nome: string }>();
	return result.results.map(r => r.nome);
}

// ---- Unidades ----

export async function listarUnidades(db: D1Database): Promise<Unidade[]> {
	const result = await db.prepare('SELECT * FROM unidades ORDER BY nome').all<Unidade>();
	return result.results;
}

export async function criarUnidade(db: D1Database, nome: string): Promise<D1Result> {
	return db.prepare('INSERT INTO unidades (nome) VALUES (?)').bind(nome.trim()).run();
}

export async function atualizarUnidade(db: D1Database, id: number, novoNome: string): Promise<{ nomeAntigo: string }> {
	const unidade = await db.prepare('SELECT nome FROM unidades WHERE id = ?').bind(id).first<{ nome: string }>();
	if (!unidade) throw new Error('Unidade não encontrada');
	const nomeAntigo = unidade.nome;
	await db.prepare('UPDATE unidades SET nome = ? WHERE id = ?').bind(novoNome.trim(), id).run();
	// Cascata: atualizar lotação em policiais e escalas
	await db.prepare("UPDATE policiais SET lotacao = ? WHERE lotacao = ?").bind(novoNome.trim(), nomeAntigo).run();
	await db.prepare("UPDATE escalas SET lotacao = ? WHERE lotacao = ?").bind(novoNome.trim(), nomeAntigo).run();
	return { nomeAntigo };
}

export async function excluirUnidade(db: D1Database, id: number): Promise<D1Result> {
	return db.prepare('DELETE FROM unidades WHERE id = ?').bind(id).run();
}

// ---- Escalas ----

export async function listarEscalas(db: D1Database, lotacao?: string): Promise<Escala[]> {
	let query = 'SELECT * FROM escalas';
	const params: string[] = [];
	if (lotacao) {
		query += ' WHERE lotacao = ?';
		params.push(lotacao);
	}
	query += ' ORDER BY data_inicio DESC';
	const result = await db.prepare(query).bind(...params).all<Escala>();
	return result.results;
}

export async function buscarEscala(db: D1Database, id: number): Promise<Escala | null> {
	return db.prepare('SELECT * FROM escalas WHERE id = ?').bind(id).first<Escala>();
}

export async function criarEscala(db: D1Database, data: Omit<Escala, 'id' | 'created_at'>): Promise<D1Result> {
	return db.prepare(
		'INSERT INTO escalas (titulo, cidade, data_inicio, data_fim, horario, hora_entrada, hora_saida, lotacao) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
	).bind(data.titulo, data.cidade, data.data_inicio, data.data_fim, data.horario, data.hora_entrada, data.hora_saida, data.lotacao).run();
}

export async function excluirEscala(db: D1Database, id: number): Promise<D1Result> {
	return db.prepare('DELETE FROM escalas WHERE id = ?').bind(id).run();
}

// ---- Escala Policiais ----

export async function adicionarPolicialEscala(db: D1Database, escalaId: number, policialId: number, dataPlantao: string, dataSaida: string, horaEntrada: string, horaSaida: string): Promise<D1Result> {
	return db.prepare(
		'INSERT INTO escala_policiais (escala_id, policial_id, data_plantao, data_saida, hora_entrada, hora_saida) VALUES (?, ?, ?, ?, ?, ?)'
	).bind(escalaId, policialId, dataPlantao, dataSaida, horaEntrada, horaSaida).run();
}

export async function atualizarEscalaPolicial(db: D1Database, id: number, dataPlantao: string, dataSaida: string, horaEntrada: string, horaSaida: string): Promise<D1Result> {
	return db.prepare('UPDATE escala_policiais SET data_plantao = ?, data_saida = ?, hora_entrada = ?, hora_saida = ? WHERE id = ?').bind(dataPlantao, dataSaida, horaEntrada, horaSaida, id).run();
}

export async function removerPolicialEscala(db: D1Database, id: number): Promise<D1Result> {
	return db.prepare('DELETE FROM escala_policiais WHERE id = ?').bind(id).run();
}

export async function listarPoliciaisEscala(db: D1Database, escalaId: number): Promise<EscalaPolicialComDados[]> {
	const result = await db.prepare(`
		SELECT ep.*, p.nome, p.matricula, p.cargo, p.telefone, p.lotacao
		FROM escala_policiais ep
		JOIN policiais p ON ep.policial_id = p.id
		WHERE ep.escala_id = ?
		ORDER BY ep.data_plantao, p.cargo DESC, p.nome
	`).bind(escalaId).all<EscalaPolicialComDados>();
	return result.results;
}
