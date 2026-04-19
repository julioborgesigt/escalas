import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import {
	getDB,
	salvarAssinaturaRelatorioGise,
	buscarGiseDetalhado,
	buscarPresencasGise,
	buscarGiseEscala,
	verificarTodosRelatoriosExtraAssinados,
	atualizarGiseEscala,
	buscarExigirCodigoEmailAssinatura
} from '$lib/db';
import { verificarDesafio2FA } from '$lib/auth';
import { getNowBR } from '$lib/utils';
import { logger } from '$lib/server/logger';
import { gerarRelatorioExtraordinarioPdf, toGisePdfData } from '$lib/export';
import { adicionarRodapeSimples, adicionarPaginaAuditoria } from '$lib/server/pdf-signing';
import { getR2 } from '$lib/server/platform';
import { giseSignatureSchema } from '$lib/schemas';

export const POST = async ({
	locals,
	params,
	request,
	platform,
	getClientAddress,
	url
}: RequestEvent) => {
	const u = locals.usuario;
	if (!u || (u.tipo !== 'policial' && u.tipo !== 'admin')) {
		return json(
			{ error: 'Somente policiais supervisores ou administradores podem assinar' },
			{ status: 403 }
		);
	}

	const { id, seccionalId } = params;
	const body = await request.json().catch(() => ({}));
	const parsed = giseSignatureSchema.safeParse(body);

	if (!parsed.success) {
		return json({ error: parsed.error.issues[0].message }, { status: 400 });
	}

	const {
		rubrica,
		type,
		hash: inputHash,
		signerName,
		signerCpf,
		latitude,
		longitude,
		selfieBase64,
		codigoValidação,
		desafioId
	} = parsed.data;

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	// Geração de hash segura e amigável (8 caracteres hex + UUID parcial para integridade)
	const hash = inputHash || crypto.randomUUID().slice(0, 8).toUpperCase() + '-' + crypto.randomUUID().slice(0, 8).toUpperCase();

	const db = getDB(platform);

	try {
		const giseIdNum = parseInt(id!);
		const secIdNum = parseInt(seccionalId!);

		const gise = await buscarGiseDetalhado(db, giseIdNum);
		if (!gise) return json({ error: 'Escala não encontrada' }, { status: 404 });

		const exigirCodigoEmail = await buscarExigirCodigoEmailAssinatura(db);
		if (exigirCodigoEmail && type !== 'serpro') {
			if (
				!codigoValidação ||
				typeof codigoValidação !== 'string' ||
				!desafioId ||
				typeof desafioId !== 'string'
			) {
				return json(
					{ error: 'Código de verificação por e-mail é obrigatório para assinaturas em tela.' },
					{ status: 400 }
				);
			}
			const result2FA = await verificarDesafio2FA(db, desafioId, codigoValidação);
			if (result2FA === 'expirado')
				return json({ error: 'O código de verificação expirou.' }, { status: 400 });
			if (result2FA === 'esgotado')
				return json({ error: 'Muitas tentativas. Solicite um novo código.' }, { status: 400 });
			if (!result2FA) return json({ error: 'Código de verificação inválido.' }, { status: 400 });
			if (result2FA.usuarioId !== u.id)
				return json({ error: 'Código não pertence ao usuário logado.' }, { status: 403 });
		}

		const presencas = await buscarPresencasGise(db, giseIdNum);

		const mockSignature = {
			assinante_nome: signerName || u.nome,
			verification_hash: hash,
			rubrica: rubrica || ''
		};

		const result = await gerarRelatorioExtraordinarioPdf(
			toGisePdfData(gise),
			presencas,
			secIdNum,
			url.origin,
			mockSignature
		);
		let finalPdf = result.pdf;
		const qrUrl = `${url.origin}/validar/${hash}`;

		finalPdf = await adicionarRodapeSimples(finalPdf, mockSignature.assinante_nome, {
			verificationHash: hash,
			verificationUrl: qrUrl
		});

		// Calcular Hash do original (Integridade)
		const originalHashBuffer = await crypto.subtle.digest('SHA-256', finalPdf.slice());
		const documentHash = Array.from(new Uint8Array(originalHashBuffer))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');

		// Adicionar folha de auditoria (Manifesto) profissional
		finalPdf = await adicionarPaginaAuditoria(finalPdf, {
			signerName: signerName || u.nome,
			signerCpf: signerCpf || u.cpf || undefined,
			signingTime: getNowBR(),
			verificationHash: hash,
			verificationUrl: qrUrl,
			ip,
			userAgent: ua,
			latitude: latitude || undefined,
			longitude: longitude || undefined,
			selfieBase64: selfieBase64 || undefined,
			rubricBase64: rubrica || undefined,
			documentHash,
			token: crypto.randomUUID(),
			documentName: `Relatório Extraordinário - GISE ${id}`,
			signatureLevel: 'avancada'
		});

		const hashBuffer = await crypto.subtle.digest('SHA-256', finalPdf.slice());
		const arquivo_hash = Array.from(new Uint8Array(hashBuffer))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');

		const p = platform as Record<string, unknown> | undefined;
		const r2 = getR2(p);
		const [yyyy, mm, dd] = gise.data_inicio.split('-');
		const mesAno = `${yyyy}-${mm}`;
		const folder = `gise/${mesAno}/${dd}/${id}/relatorios_extra`;
		const prefixBase = `${folder}/gise_rel_${id}_sec_${seccionalId}_${hash}`;

		let selfieKey: string | undefined = undefined;

		if (r2) {
			const r2Promises: Promise<any>[] = [
				r2.put(`${prefixBase}_assinada.pdf`, finalPdf, { contentType: 'application/pdf' })
			];

			if (selfieBase64) {
				const regex = /^data:image\/(jpeg|png|jpg);base64,/;
				const matches = selfieBase64.match(regex);
				if (matches) {
					const ext = matches[1] === 'png' ? 'png' : 'jpg';
					const dataBase64 = selfieBase64.replace(regex, '');
					const bytes = Buffer.from(dataBase64, 'base64');
					selfieKey = `${prefixBase}_selfie.${ext}`;
					r2Promises.push(
						r2.put(selfieKey, bytes, { httpMetadata: { contentType: `image/${ext}` } })
					);
				}
			}

			await Promise.all(r2Promises);
		}

		await salvarAssinaturaRelatorioGise(db, {
			gise_id: giseIdNum,
			seccional_id: secIdNum,
			tipo: 'extraordinario',
			assinante_id: u.tipo === 'policial' ? u.id : null,
			assinante_nome: signerName || u.nome,
			assinante_cpf: signerCpf || u.cpf || null,
			tipo_assinatura: (type as 'simples' | 'webpki' | 'serpro' | undefined) ?? 'simples',
			rubrica: rubrica || '',
			verification_hash: hash,
			ip_address: ip,
			user_agent: ua,
			latitude: latitude ?? undefined,
			longitude: longitude ?? undefined,
			selfie_key: selfieKey,
			r2_key: `${prefixBase}_assinada.pdf`,
			arquivo_hash: arquivo_hash
		});

		// Transição automática: se todos os relatórios de extra foram assinados → pronta_para_finalizar
		const giseAtual = await buscarGiseEscala(db, giseIdNum);
		if (giseAtual && giseAtual.status === 'aguardando_assinatura_relat') {
			const todosAssinados = await verificarTodosRelatoriosExtraAssinados(db, giseIdNum);
			if (todosAssinados) {
				await atualizarGiseEscala(db, giseIdNum, { status: 'pronta_para_finalizar' });
			}
		}

		return json({ success: true });
	} catch (e) {
		logger.error('[gise/relatorios/assinar] Falha ao salvar assinatura', {
			gise_id: id,
			seccional_id: seccionalId,
			error: e instanceof Error ? e.message : String(e),
			stack: e instanceof Error ? e.stack : undefined
		});
		return json(
			{
				error: 'Falha técnica ao gravar a assinatura no banco de dados.'
			},
			{ status: 500 }
		);
	}
};
