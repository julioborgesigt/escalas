import { and, eq, or, inArray, sql, type SQL } from 'drizzle-orm';
import type { Database } from '$lib/db';
import type { UsuarioLogado } from '$lib/auth';
import {
	escalas as escalasTable,
	escalaSolicitacoesAssinatura,
	escalaDocumentos
} from '$lib/server/schema';
import { lotacoesAdministradas } from '$lib/server/policial-permissao';

/**
 * Diz se o DPC admin tem alguma solicitação de assinatura de escala PENDENTE
 * dirigida a ele (mesmo recorte da listagem "escalas para assinar" de
 * `/escalas`): solicitações `unidade` no seu escopo administrativo ou
 * `respondencia` endereçadas a ele, em escala plantão/expediente ainda sem
 * documento assinado.
 *
 * Usado pelo layout para decidir o aviso "cadastre sua rubrica" — por isso é
 * um único `EXISTS` barato, executado apenas para DPC admin SEM rubrica.
 */
export async function temAssinaturaEscalaPendente(
	db: Database,
	u: UsuarioLogado
): Promise<boolean> {
	if (u.tipo !== 'policial' || u.cargo !== 'DPC') return false;
	if (u.papel !== 'admin_unidade' && u.papel !== 'admin_seccional') return false;

	let scopeCondition: SQL | undefined;
	if (u.papel === 'admin_unidade' && u.lotacao) {
		scopeCondition = or(
			and(eq(escalaSolicitacoesAssinatura.tipo, 'unidade'), eq(escalasTable.lotacao, u.lotacao)),
			and(
				eq(escalaSolicitacoesAssinatura.tipo, 'respondencia'),
				eq(escalaSolicitacoesAssinatura.destinatario_id, u.id)
			)
		);
	} else if (u.papel === 'admin_seccional') {
		const escopo = await lotacoesAdministradas(db, u);
		const lotacoes = escopo ? Array.from(escopo) : [];
		if (lotacoes.length === 0) return false;
		scopeCondition = or(
			and(
				eq(escalaSolicitacoesAssinatura.tipo, 'unidade'),
				inArray(escalasTable.lotacao, lotacoes)
			),
			and(
				eq(escalaSolicitacoesAssinatura.tipo, 'respondencia'),
				eq(escalaSolicitacoesAssinatura.destinatario_id, u.id)
			)
		);
	}
	if (!scopeCondition) return false;

	const subqDocs = db.select({ escala_id: escalaDocumentos.escala_id }).from(escalaDocumentos);
	const row = await db
		.select({ id: escalasTable.id })
		.from(escalasTable)
		.innerJoin(
			escalaSolicitacoesAssinatura,
			eq(escalaSolicitacoesAssinatura.escala_id, escalasTable.id)
		)
		.where(
			and(
				or(eq(escalasTable.tipo, 'plantao'), eq(escalasTable.tipo, 'expediente'))!,
				sql`${escalasTable.id} NOT IN (${subqDocs})` as SQL,
				scopeCondition
			)
		)
		.limit(1)
		.get();

	return !!row;
}
