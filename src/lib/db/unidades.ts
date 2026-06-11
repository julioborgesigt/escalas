import { eq, asc } from 'drizzle-orm';
import { unidades, policiais, escalas } from '../server/schema';
import type * as schema from '../server/schema';
import type { Database } from './core';

export async function listarUnidades(db: Database): Promise<schema.Unidade[]> {
	return db.select().from(unidades).orderBy(asc(unidades.nome));
}

export async function criarUnidade(
	db: Database,
	data: {
		nome: string;
		tipo: 'departamento' | 'sub_departamento' | 'seccional' | 'delegacia';
		seccional_id: number | null;
		tem_plantao: boolean;
		tem_expediente: boolean;
		tem_fds: boolean;
		cidade: string;
	}
) {
	return db.insert(unidades).values({
		nome: data.nome.trim(),
		tipo: data.tipo,
		tem_plantao: data.tem_plantao,
		tem_expediente: data.tem_expediente,
		tem_fds: data.tem_fds,
		cidade: data.cidade || '',
		seccional_id: data.seccional_id ?? null
	});
}

export async function atualizarUnidade(
	db: Database,
	id: number,
	data: {
		nome: string;
		tipo: 'departamento' | 'sub_departamento' | 'seccional' | 'delegacia';
		seccional_id: number | null;
		tem_plantao: boolean;
		tem_expediente: boolean;
		tem_fds: boolean;
		cidade: string;
	}
): Promise<{ nomeAntigo: string }> {
	const unidade = await db
		.select({ nome: unidades.nome })
		.from(unidades)
		.where(eq(unidades.id, id))
		.get();
	if (!unidade) throw new Error('Unidade não encontrada');
	const nomeAntigo = unidade.nome;
	const nomeTrimmed = data.nome.trim();

	await db
		.update(unidades)
		.set({
			nome: nomeTrimmed,
			tipo: data.tipo,
			seccional_id: data.seccional_id,
			tem_plantao: data.tem_plantao,
			tem_expediente: data.tem_expediente,
			tem_fds: data.tem_fds,
			cidade: data.cidade || ''
		})
		.where(eq(unidades.id, id));

	// Cascata: atualizar lotação em policiais e escalas se o nome mudou
	if (nomeTrimmed !== nomeAntigo) {
		await db
			.update(policiais)
			.set({ lotacao: nomeTrimmed })
			.where(eq(policiais.lotacao, nomeAntigo));
		await db.update(escalas).set({ lotacao: nomeTrimmed }).where(eq(escalas.lotacao, nomeAntigo));
	}

	return { nomeAntigo };
}

export async function excluirUnidade(db: Database, id: number) {
	return db.delete(unidades).where(eq(unidades.id, id));
}

export async function upsertUnidade(
	db: Database,
	data: {
		nome: string;
		tipo: 'departamento' | 'sub_departamento' | 'seccional' | 'delegacia';
		seccional_id: number | null;
		cidade: string;
	}
) {
	return db
		.insert(unidades)
		.values({
			nome: data.nome.trim(),
			tipo: data.tipo,
			seccional_id: data.seccional_id,
			cidade: data.cidade || '',
			tem_plantao: true,
			tem_expediente: true,
			tem_fds: true
		})
		.onConflictDoUpdate({
			target: unidades.nome,
			set: {
				tipo: data.tipo,
				seccional_id: data.seccional_id,
				cidade: data.cidade || ''
			}
		});
}

export async function buscarUnidadePorNome(db: Database, nome: string) {
	if (!nome) return null;
	const trimmedNome = nome.trim();
	return db.select().from(unidades).where(eq(unidades.nome, trimmedNome)).get();
}

export async function buscarSeccionaisUnidades(db: Database) {
	return db
		.select()
		.from(unidades)
		.where(eq(unidades.tipo, 'seccional'))
		.orderBy(asc(unidades.nome))
		.all();
}
