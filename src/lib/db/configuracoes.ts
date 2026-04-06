import { eq, sql } from 'drizzle-orm';
import { configuracoes } from '../server/schema';
import type { Database } from './core';

export async function buscarConfiguracao(db: Database, chave: string): Promise<string | null> {
	const row = await db.select().from(configuracoes).where(eq(configuracoes.chave, chave)).get();
	return row?.valor ?? null;
}

export async function salvarConfiguracao(
	db: Database,
	chave: string,
	valor: string
): Promise<void> {
	await db
		.insert(configuracoes)
		.values({ chave, valor })
		.onConflictDoUpdate({
			target: configuracoes.chave,
			set: { valor, updated_at: sql`(datetime('now', '-3 hours'))` }
		});
}

/** Lê a flag booleana "exigir_foto_assinatura" (padrão: true). */
export async function buscarExigirFotoAssinatura(db: Database): Promise<boolean> {
	const val = await buscarConfiguracao(db, 'exigir_foto_assinatura');
	return val !== '0'; // qualquer coisa diferente de '0' = true
}

/** Lê a flag booleana "exigir_gps_assinatura" (padrão: true). */
export async function buscarExigirGpsAssinatura(db: Database): Promise<boolean> {
	const val = await buscarConfiguracao(db, 'exigir_gps_assinatura');
	return val !== '0';
}
