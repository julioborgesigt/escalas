import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
	getDB,
	buscarExigirFotoAssinatura,
	buscarExigirGpsAssinatura,
	buscarRestringirSmartphone
} from '$lib/db';
import {
	REQUISITOS_SEMPRE_ATIVOS,
	REQUISITOS_OBRIGATORIOS_AVANCADA,
	REFORCOS_OPCIONAIS,
	classificarNivelAssinaturaTela,
	baseLegalDoNivel
} from '$lib/server/signature-level';

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (!locals.usuario?.isSuperAdmin) throw redirect(302, '/');

	const db = getDB(platform);

	// 2FA por e-mail é forçado para `true` no servidor (vide cfg-ass-cache.ts);
	// não lemos mais essa flag do D1 nem do cookie. As outras 3 vêm do D1.
	const [exigirFoto, exigirGps, restringirSmartphone] = await Promise.all([
		buscarExigirFotoAssinatura(db),
		buscarExigirGpsAssinatura(db),
		buscarRestringirSmartphone(db)
	]);

	const exigirCodigoEmail = true; // bloqueado por requisito legal

	const nivelEfetivo = classificarNivelAssinaturaTela({
		exigirFotoAssinatura: exigirFoto,
		exigirGpsAssinatura: exigirGps,
		exigirCodigoEmailAssinatura: exigirCodigoEmail,
		restringirSmartphone
	});

	return {
		exigirFoto,
		exigirGps,
		exigirCodigoEmail,
		restringirSmartphone,
		// Metadados para a UI educar o admin sobre quais requisitos são
		// fixos vs configuráveis, e qual o nível efetivo das assinaturas.
		nivelEfetivo,
		baseLegalAtual: baseLegalDoNivel(nivelEfetivo),
		requisitosSempreAtivos: REQUISITOS_SEMPRE_ATIVOS.map((r) => ({ ...r })),
		requisitosObrigatorios: REQUISITOS_OBRIGATORIOS_AVANCADA.map((r) => ({ ...r })),
		reforcosOpcionais: REFORCOS_OPCIONAIS.map((r) => ({ ...r }))
	};
};
