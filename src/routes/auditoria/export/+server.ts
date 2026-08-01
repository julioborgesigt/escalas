/**
 * GET /auditoria/export — exporta a trilha de auditoria. Restrito ao SUPER
 * ADMIN (`requireSuperAdmin`), não ao Admin Geral.
 *
 * Parâmetros:
 *   - format = csv | pdf          (default csv)
 *   - id = <n>                    exporta UM único evento (ignora a janela)
 *   - filtros + de/ate            mesmos do console
 *
 * Limite de janela (evita exportações gigantes):
 *   - CSV: no máximo 1 ano (366 dias)   · até 10.000 linhas
 *   - PDF: no máximo 1 mês  (31 dias)   · até 2.000 linhas
 * Sem `de`/`ate`, assume a janela máxima terminando hoje.
 */
import type { RequestHandler } from './$types';
import { getDB, listarAuditLog, buscarAuditLog, cabecaCadeiaAudit, metaDaAcao } from '$lib/db';
import type { AuditLog } from '$lib/server/schema';
import { gerarAuditPdfTabela, gerarAuditPdfEvento } from '$lib/server/export/audit-pdf';
import { requireSuperAdmin, contentDisposition, badRequest, notFound } from '$lib/server/api';

const MAX_DIAS_CSV = 366;
const MAX_DIAS_PDF = 31;
const MAX_LINHAS_CSV = 10_000;
const MAX_LINHAS_PDF = 2_000;

/** Célula CSV: neutraliza fórmulas (CSV injection) e escapa aspas. */
function csvCell(v: unknown): string {
	const s = v == null ? '' : String(v);
	const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
	return '"' + safe.replace(/"/g, '""') + '"';
}

const COLUNAS: [string, (l: AuditLog) => unknown][] = [
	['seq', (l) => l.seq],
	['data_hora_utc', (l) => l.created_at],
	['categoria', (l) => l.categoria],
	['severidade', (l) => l.severidade],
	['resultado', (l) => l.resultado],
	['acao', (l) => l.acao],
	['acao_label', (l) => metaDaAcao(l.acao).label],
	['ator_tipo', (l) => l.actor_tipo],
	['ator', (l) => l.usuario_nome],
	['ator_papel', (l) => l.usuario_papel],
	['entidade', (l) => l.entidade],
	['entidade_id', (l) => l.entidade_id],
	['alvo_tipo', (l) => l.alvo_tipo],
	['alvo_id', (l) => l.alvo_id],
	['alvo_nome', (l) => l.alvo_nome],
	['detalhes', (l) => l.detalhes],
	['ip_anonimizado', (l) => l.ip],
	['user_agent', (l) => l.user_agent],
	['request_id', (l) => l.request_id],
	['rota', (l) => l.rota],
	['metodo', (l) => l.metodo],
	['hash_registro', (l) => l.hash_registro]
];

function montarCsv(logs: AuditLog[]): string {
	const header = COLUNAS.map(([h]) => h).join(',');
	const linhas = logs.map((l) => COLUNAS.map(([, f]) => csvCell(f(l))).join(','));
	// BOM para o Excel reconhecer UTF-8; CRLF é o padrão de fim de linha em CSV.
	return '﻿' + [header, ...linhas].join('\r\n');
}

function diaStr(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

/** Resolve e valida a janela [de, ate]; aplica default e impõe o máximo. */
function resolverJanela(
	deRaw: string | null,
	ateRaw: string | null,
	maxDias: number
): { de: string; ate: string } | { erro: string } {
	const ate = ateRaw || diaStr(Date.now());
	const ateMs = Date.parse(`${ate}T00:00:00Z`);
	if (Number.isNaN(ateMs)) return { erro: 'Data "Até" inválida.' };
	const de = deRaw || diaStr(ateMs - maxDias * 86_400_000);
	const deMs = Date.parse(`${de}T00:00:00Z`);
	if (Number.isNaN(deMs)) return { erro: 'Data "De" inválida.' };
	const spanDias = (ateMs - deMs) / 86_400_000;
	if (spanDias < 0) return { erro: 'Intervalo inválido: "De" é posterior a "Até".' };
	if (spanDias > maxDias) {
		return {
			erro: `Período muito longo para exportação (máximo ${maxDias} dias). Refine "De" e "Até".`
		};
	}
	return { de, ate };
}

function respostaArquivo(corpo: Uint8Array | string, tipo: string, nome: string): Response {
	return new Response(corpo as unknown as BodyInit, {
		headers: {
			'Content-Type': tipo,
			'Content-Disposition': contentDisposition(nome),
			'Cache-Control': 'private, no-store'
		}
	});
}

export const GET: RequestHandler = async ({ locals, platform, url }) => {
	const u = requireSuperAdmin(locals);
	if (u instanceof Response) return u;

	const db = getDB(platform);
	const q = url.searchParams;
	const format = q.get('format') === 'pdf' ? 'pdf' : 'csv';
	const hoje = diaStr(Date.now());

	// --- Evento único (id) — ignora janela; sempre 1 linha ---
	const idRaw = q.get('id');
	if (idRaw) {
		const id = Number(idRaw);
		if (!Number.isInteger(id) || id <= 0) return badRequest('ID inválido');
		const evento = await buscarAuditLog(db, id);
		if (!evento) return notFound('Evento de auditoria');
		if (format === 'pdf') {
			const pdf = gerarAuditPdfEvento(evento, u.nome);
			return respostaArquivo(pdf, 'application/pdf', `auditoria-evento-${id}.pdf`);
		}
		return respostaArquivo(
			montarCsv([evento]),
			'text/csv; charset=utf-8',
			`auditoria-evento-${id}.csv`
		);
	}

	// --- Exportação em lote (com janela limitada) ---
	const janela = resolverJanela(
		q.get('de'),
		q.get('ate'),
		format === 'pdf' ? MAX_DIAS_PDF : MAX_DIAS_CSV
	);
	if ('erro' in janela) return badRequest(janela.erro);

	const { logs } = await listarAuditLog(db, {
		categoria: q.get('categoria') || undefined,
		acao: q.get('acao') || undefined,
		severidade: q.get('severidade') || undefined,
		resultado: q.get('resultado') || undefined,
		actor_tipo: q.get('actor_tipo') || undefined,
		busca: q.get('busca') || undefined,
		de: janela.de,
		ate: `${janela.ate} 23:59:59`,
		page: 1,
		limit: format === 'pdf' ? MAX_LINHAS_PDF : MAX_LINHAS_CSV
	});

	if (format === 'pdf') {
		const ancora = await cabecaCadeiaAudit(db);
		const pdf = gerarAuditPdfTabela(logs, {
			geradoPor: u.nome,
			de: janela.de,
			ate: janela.ate,
			total: logs.length,
			ancoraSeq: ancora?.seq,
			ancoraHash: ancora?.hash
		});
		return respostaArquivo(pdf, 'application/pdf', `auditoria-${hoje}.pdf`);
	}

	return respostaArquivo(montarCsv(logs), 'text/csv; charset=utf-8', `auditoria-${hoje}.csv`);
};
