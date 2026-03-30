import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, salvarAssinaturaRelatorioGise } from '$lib/db';
import { isAdminGeral, isAdminSeccional } from '$lib/auth';

export const POST: RequestHandler = async ({ locals, params, request, platform, getClientAddress }: { locals: any, params: Record<string, string>, request: Request, platform?: any, getClientAddress: any }) => {
	const u = locals.usuario;
	if (!u || (u.tipo !== 'policial' && u.tipo !== 'admin')) {
		return json({ error: 'Somente policiais supervisores ou administradores podem assinar' }, { status: 403 });
	}

	const { id, seccionalId, dia } = params;
	const body = await request.json();
	const { rubrica, type, hash: inputHash, signerName, signerCpf, latitude, longitude } = body;
	
	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	// Gera um hash aleatório se não for fornecido (assinatura simples)
	const hash = inputHash || Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

	if (!['sabado', 'domingo'].includes(dia)) {
		return json({ error: 'Dia inválido' }, { status: 400 });
	}

	const db = getDB(platform);

	try {
		await salvarAssinaturaRelatorioGise(db, {
			gise_id: parseInt(id),
			seccional_id: parseInt(seccionalId),
			dia: dia as 'sabado' | 'domingo',
			tipo: 'extraordinario',
			assinante_id: u.tipo === 'policial' ? u.id : null,
			assinante_nome: signerName || u.nome,
			assinante_cpf: signerCpf || (u as any).cpf || null,
			tipo_assinatura: type || 'simples',
			rubrica: rubrica,
			verification_hash: hash,
			ip_address: ip,
			user_agent: ua,
			latitude,
			longitude
		});

		return json({ success: true });
	} catch (e: any) {
		console.error(`[GISE-SIGN] Falha ao salvar assinatura: GISE ${id}, Sec ${seccionalId}, Dia ${dia}. Erro:`, e);
		return json({ 
			error: 'Falha técnica ao gravar a assinatura no banco de dados.', 
			details: e.message,
			context: { giseId: id, seccionalId, dia, usuario: u.nome }
		}, { status: 500 });
	}
};
