export interface UsuarioLogado {
	id: number;
	tipo: 'policial' | 'admin';
	nome: string;
	matricula?: string;
	lotacao?: string;
	primeiro_acesso: boolean;
}

export async function hashSenha(senha: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(senha);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function gerarToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function criarSessao(
	db: D1Database,
	tipo: 'policial' | 'admin',
	usuarioId: number
): Promise<string> {
	const token = gerarToken();
	const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
	await db.prepare(
		'INSERT INTO sessoes (token, tipo, usuario_id, expires_at) VALUES (?, ?, ?, ?)'
	).bind(token, tipo, usuarioId, expiresAt).run();
	return token;
}

export async function validarSessao(
	db: D1Database,
	token: string | undefined
): Promise<UsuarioLogado | null> {
	if (!token) return null;

	const sessao = await db.prepare(
		"SELECT * FROM sessoes WHERE token = ? AND expires_at > datetime('now')"
	).bind(token).first<{ tipo: string; usuario_id: number }>();

	if (!sessao) return null;

	if (sessao.tipo === 'admin') {
		const admin = await db.prepare(
			'SELECT * FROM administradores WHERE id = ?'
		).bind(sessao.usuario_id).first<{ id: number; nome: string; primeiro_acesso: number }>();
		if (!admin) return null;
		return {
			id: admin.id,
			tipo: 'admin',
			nome: admin.nome,
			primeiro_acesso: admin.primeiro_acesso === 1
		};
	}

	const policial = await db.prepare(
		'SELECT * FROM policiais WHERE id = ? AND ativo = 1'
	).bind(sessao.usuario_id).first<{
		id: number; nome: string; matricula: string; lotacao: string; primeiro_acesso: number;
	}>();
	if (!policial) return null;
	return {
		id: policial.id,
		tipo: 'policial',
		nome: policial.nome,
		matricula: policial.matricula,
		lotacao: policial.lotacao,
		primeiro_acesso: policial.primeiro_acesso === 1
	};
}

export async function excluirSessao(db: D1Database, token: string): Promise<void> {
	await db.prepare('DELETE FROM sessoes WHERE token = ?').bind(token).run();
}
