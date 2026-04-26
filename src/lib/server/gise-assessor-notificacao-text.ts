/**
 * Texto plano (WhatsApp / copiar-colar) para aviso ao assessor quando uma seccional envia a GISE.
 */

export type GiseSecLinha = { nome: string; status: string };

export function seccionalJaEnviou(status: string): boolean {
	return status === 'preenchida' || status === 'preenchida_retificada';
}

export function rotuloStatusSeccional(status: string): string {
	switch (status) {
		case 'preenchida':
			return 'enviada';
		case 'preenchida_retificada':
			return 'enviada (após retificação)';
		case 'retificada':
			return 'pendente de reenvio (retificada)';
		case 'pendente':
		default:
			return 'pendente';
	}
}

export function montarTextoNotificacaoAssessorGise(opts: {
	dataInicioIso: string;
	giseId: number;
	nomeSeccionalQueAcabouDeEnviar: string;
	seccionais: GiseSecLinha[];
}): string {
	const { dataInicioIso, giseId, nomeSeccionalQueAcabouDeEnviar, seccionais } = opts;
	const dataFmt = new Date(dataInicioIso + 'T12:00:00').toLocaleDateString('pt-BR', {
		day: '2-digit',
		month: 'long',
		year: 'numeric'
	});

	const enviadas = seccionais.filter((s) => seccionalJaEnviou(s.status));
	const pendentes = seccionais.filter((s) => !seccionalJaEnviou(s.status));

	const linhasEnviadas =
		enviadas.length === 0
			? '(nenhuma ainda)'
			: enviadas.map((s) => `• ${s.nome} (${rotuloStatusSeccional(s.status)})`).join('\n');

	const linhasPendentes =
		pendentes.length === 0
			? '(nenhuma — todas enviaram)'
			: pendentes.map((s) => `• ${s.nome} (${rotuloStatusSeccional(s.status)})`).join('\n');

	return [
		`📋 GISE — atualização de preenchimento`,
		``,
		`Data da escala: ${dataFmt}`,
		`ID GISE: ${giseId}`,
		``,
		`✅ Acabou de enviar: ${nomeSeccionalQueAcabouDeEnviar}`,
		``,
		`✅ Seccionais que já enviaram (${enviadas.length}/${seccionais.length}):`,
		linhasEnviadas,
		``,
		`⏳ Ainda pendentes (${pendentes.length}/${seccionais.length}):`,
		linhasPendentes,
		``,
		`---`,
		`(Texto gerado pelo sistema — pode copiar e colar no WhatsApp)`
	].join('\n');
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export function montarHtmlEmailNotificacaoAssessorGise(textoPlano: string): string {
	const esc = escapeHtml(textoPlano);
	return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:system-ui,Segoe UI,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 12px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
        <tr>
          <td style="background:#0f766e;padding:18px 22px;border-radius:12px 12px 0 0;">
            <p style="margin:0;color:#ecfeff;font-size:16px;font-weight:700;">GISE — Seccionais</p>
            <p style="margin:6px 0 0;color:#99f6e4;font-size:12px;">Polícia Civil do Ceará</p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 22px 24px;">
            <p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.5;">
              Uma seccional acabou de finalizar o envio da escala. Abaixo está o resumo para copiar no grupo (WhatsApp).
            </p>
            <pre style="margin:0;padding:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word;color:#0f172a;">${esc}</pre>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
