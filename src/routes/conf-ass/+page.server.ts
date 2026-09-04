/**
 * Painel da política de assinatura — onde o Super Admin liga os reforços.
 *
 * A tela não é uma lista de interruptores independentes: ela classifica o NÍVEL
 * jurídico resultante (`classificarNivelAssinaturaTela`) e mostra a base legal
 * dele. É o que impede a leitura errada de que desligar um reforço só "deixa
 * mais fácil" — desligar certos itens muda a modalidade da assinatura, e com ela
 * o valor probatório do documento.
 *
 * Por isso os requisitos se dividem em três grupos em `signature-level.ts`:
 * os SEMPRE ativos (que a tela nem oferece), os obrigatórios da avançada
 * (Lei 14.063/2020 art. 4º II) e os reforços opcionais. Só o último grupo é
 * escolha do operador.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
	getDB,
	buscarExigirFotoAssinatura,
	buscarExigirGpsAssinatura,
	buscarRestringirSmartphone,
	buscarExigirPasskeyAssinatura
} from '$lib/db';
import {
	REQUISITOS_SEMPRE_ATIVOS,
	REQUISITOS_OBRIGATORIOS_AVANCADA,
	REFORCOS_OPCIONAIS,
	classificarNivelAssinaturaTela,
	baseLegalDoNivel
} from '$lib/server/assinatura/signature-level';

export const load: PageServerLoad = async ({ locals, platform, depends }) => {
	depends('app:assinatura-flags');

	if (!locals.usuario?.isSuperAdmin) redirect(302, '/');

	const db = getDB(platform);

	// 2FA por e-mail é forçado para `true` no servidor (vide cfg-ass-cache.ts);
	// não lemos mais essa flag do D1 nem do cookie. As outras 3 vêm do D1.
	const [exigirFoto, exigirGps, restringirSmartphone, exigirPasskey] = await Promise.all([
		buscarExigirFotoAssinatura(db),
		buscarExigirGpsAssinatura(db),
		buscarRestringirSmartphone(db),
		buscarExigirPasskeyAssinatura(db)
	]);

	const exigirCodigoEmail = true; // bloqueado por requisito legal

	const nivelEfetivo = classificarNivelAssinaturaTela({
		exigirFotoAssinatura: exigirFoto,
		exigirGpsAssinatura: exigirGps,
		exigirCodigoEmailAssinatura: exigirCodigoEmail,
		restringirSmartphone,
		exigirPasskeyAssinatura: exigirPasskey
	});

	return {
		exigirFoto,
		exigirGps,
		exigirCodigoEmail,
		restringirSmartphone,
		exigirPasskey,
		// Metadados para a UI educar o admin sobre quais requisitos são
		// fixos vs configuráveis, e qual o nível efetivo das assinaturas.
		nivelEfetivo,
		baseLegalAtual: baseLegalDoNivel(nivelEfetivo),
		requisitosSempreAtivos: REQUISITOS_SEMPRE_ATIVOS.map((r) => ({ ...r })),
		requisitosObrigatorios: REQUISITOS_OBRIGATORIOS_AVANCADA.map((r) => ({ ...r })),
		reforcosOpcionais: REFORCOS_OPCIONAIS.map((r) => ({ ...r }))
	};
};
