import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, salvarConfiguracao } from '$lib/db';
import { assinaturaConfigSchema } from '$lib/schemas';
import { invalidarFlagsAssinatura, lerFlagsAssinatura } from '$lib/server/cfg-ass-cache';
import { requireSuperAdmin, badRequest, validateBody } from '$lib/server/api';
import { REQUISITOS_OBRIGATORIOS_AVANCADA } from '$lib/server/signature-level';

export const GET: RequestHandler = async ({ platform }) => {
	const flags = await lerFlagsAssinatura(platform);
	return json({
		exigirFoto: flags.exigirFotoAssinatura,
		exigirGps: flags.exigirGpsAssinatura,
		exigirCodigoEmail: flags.exigirCodigoEmailAssinatura,
		restringirSmartphone: flags.restringirSmartphone,
		// Metadados para a UI: requisitos legais que NÃO podem ser desligados.
		bloqueados: REQUISITOS_OBRIGATORIOS_AVANCADA.map((r) => ({
			flag: r.flag,
			motivo: r.baseLegal
		}))
	});
};

export const PUT: RequestHandler = async ({ platform, request, locals }) => {
	const u = requireSuperAdmin(locals);
	if (u instanceof Response) return u;

	const v = await validateBody(request, assinaturaConfigSchema);
	if (!v.ok) return v.response;

	const db = getDB(platform);
	const data = v.data;
	const saves: Promise<void>[] = [];

	if (data.exigirFoto !== undefined) {
		saves.push(salvarConfiguracao(db, 'exigir_foto_assinatura', data.exigirFoto ? '1' : '0'));
	}
	if (data.exigirGps !== undefined) {
		saves.push(salvarConfiguracao(db, 'exigir_gps_assinatura', data.exigirGps ? '1' : '0'));
	}
	// 2FA por e-mail é REQUISITO MÍNIMO da assinatura avançada
	// (Lei 14.063/2020 art. 4º II "b" — controle exclusivo). Não pode ser
	// desligado pela UI: tentativa de gravar `false` é rejeitada com 400.
	// Permitir ligar (idempotente) — útil em fluxo de instalação inicial.
	if (data.exigirCodigoEmail !== undefined) {
		if (data.exigirCodigoEmail === false) {
			return badRequest(
				'O 2FA por e-mail é requisito legal mínimo para assinatura AVANÇADA ' +
					'(Lei 14.063/2020 art. 4º II "b") e não pode ser desativado. ' +
					'Sem ele, as assinaturas em tela seriam classificadas como SIMPLES (art. 4º I), ' +
					'exigindo aceite expresso da contraparte para serem oponíveis (art. 5º I).'
			);
		}
		saves.push(salvarConfiguracao(db, 'exigir_codigo_email_assinatura', '1'));
	}
	if (data.restringirSmartphone !== undefined) {
		saves.push(
			salvarConfiguracao(db, 'restringir_smartphone', data.restringirSmartphone ? '1' : '0')
		);
	}

	if (saves.length === 0) return badRequest('Nenhum campo válido para salvar');

	await Promise.all(saves);

	// Invalida o cache edge server-side para que toda assinatura subsequente
	// leia os novos valores do D1 (não mais do cliente).
	await invalidarFlagsAssinatura();

	return json({ ok: true });
};
