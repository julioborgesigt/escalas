/**
 * Geração de PDF da trilha de auditoria (server-side, jspdf + autotable —
 * mesmo stack do export-pdf.ts das escalas).
 *
 *  - `gerarAuditPdfTabela`: relatório tabular de N eventos (landscape).
 *  - `gerarAuditPdfEvento`: comprovante detalhado de UM evento (portrait),
 *    com todos os campos forenses (IP, rota, request_id, cadeia de hash, diff).
 *
 * O limite de quantos eventos entram no relatório é responsabilidade do
 * chamador (endpoint /auditoria/export), que aplica a janela temporal.
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { AuditLog } from './schema';
import { metaDaAcao } from '../db/audit';

interface JsPDFAuto extends jsPDF {
	lastAutoTable?: { finalY: number };
}

const CATEGORIA: Record<string, string> = {
	autenticacao: 'Autenticação',
	escala: 'Escala',
	gise: 'GISE',
	policial: 'Policial',
	unidade: 'Unidade',
	configuracao: 'Configuração',
	documento: 'Documento',
	lgpd: 'LGPD',
	sistema: 'Sistema'
};
const SEVERIDADE: Record<string, string> = { info: 'Info', aviso: 'Aviso', critico: 'Crítico' };
const RESULTADO: Record<string, string> = {
	sucesso: 'Sucesso',
	falha: 'Falha',
	negado: 'Negado'
};

/** UTC "YYYY-MM-DD HH:MM:SS" → "DD/MM/AAAA HH:MM:SS" (horário de Brasília). */
function fmt(s: string | null | undefined): string {
	if (!s) return '—';
	const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
	return Number.isNaN(d.getTime())
		? s
		: d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function rodapePaginas(doc: JsPDFAuto, geradoPor: string): void {
	const total = doc.getNumberOfPages();
	const w = doc.internal.pageSize.getWidth();
	const h = doc.internal.pageSize.getHeight();
	const carimbo = `Gerado por ${geradoPor} em ${fmt(new Date().toISOString())}`;
	for (let i = 1; i <= total; i++) {
		doc.setPage(i);
		doc.setFontSize(7);
		doc.setTextColor(120);
		doc.text(carimbo, 40, h - 18);
		doc.text(`Página ${i}/${total}`, w - 80, h - 18);
	}
	doc.setTextColor(0);
}

export interface AuditPdfTabelaOpts {
	geradoPor: string;
	de: string;
	ate: string;
	total: number;
	ancoraSeq?: number;
	ancoraHash?: string;
}

/** Relatório tabular dos eventos filtrados (paisagem A4). */
export function gerarAuditPdfTabela(logs: AuditLog[], opts: AuditPdfTabelaOpts): Uint8Array {
	const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' }) as JsPDFAuto;

	doc.setFontSize(15);
	doc.text('Trilha de Auditoria', 40, 42);
	doc.setFontSize(9);
	doc.setTextColor(90);
	doc.text(`Período: ${opts.de} a ${opts.ate}   ·   ${opts.total} evento(s) no relatório`, 40, 60);
	doc.setTextColor(0);

	autoTable(doc, {
		startY: 74,
		head: [['Data/hora', 'Sev.', 'Categoria', 'Ação', 'Ator', 'Alvo', 'Resultado', 'IP']],
		body: logs.map((l) => [
			fmt(l.created_at),
			SEVERIDADE[l.severidade ?? ''] ?? '—',
			CATEGORIA[l.categoria ?? ''] ?? l.categoria ?? '—',
			metaDaAcao(l.acao).label,
			`${l.usuario_nome || '—'}${l.actor_tipo ? ` (${l.actor_tipo})` : ''}`,
			l.alvo_nome ?? (l.alvo_id ? `#${l.alvo_id}` : '—'),
			RESULTADO[l.resultado ?? ''] ?? l.resultado ?? '—',
			l.ip ?? '—'
		]),
		styles: { fontSize: 7, cellPadding: 3, overflow: 'linebreak' },
		headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 7 },
		alternateRowStyles: { fillColor: [245, 247, 250] },
		columnStyles: { 0: { cellWidth: 95 }, 3: { cellWidth: 130 } }
	});

	if (opts.ancoraHash) {
		const y = (doc.lastAutoTable?.finalY ?? 80) + 18;
		doc.setFontSize(7);
		doc.setTextColor(90);
		doc.text(
			`Âncora de integridade (cabeça da cadeia): seq ${opts.ancoraSeq} · ${opts.ancoraHash}`,
			40,
			y
		);
		doc.setTextColor(0);
	}

	rodapePaginas(doc, opts.geradoPor);
	return new Uint8Array(doc.output('arraybuffer'));
}

function tentarJson(s: string | null): string | null {
	if (!s) return null;
	try {
		return JSON.stringify(JSON.parse(s), null, 2);
	} catch {
		return s;
	}
}

/** Comprovante detalhado de um único evento (retrato A4). */
export function gerarAuditPdfEvento(l: AuditLog, geradoPor: string): Uint8Array {
	const doc = new jsPDF({ unit: 'pt', format: 'a4' }) as JsPDFAuto;
	const meta = metaDaAcao(l.acao);

	doc.setFontSize(15);
	doc.text('Comprovante de Evento — Auditoria', 40, 46);
	doc.setFontSize(9);
	doc.setTextColor(90);
	doc.text(`Evento #${l.id}`, 40, 62);
	doc.setTextColor(0);

	const linhas: [string, string][] = [
		['Data/hora', fmt(l.created_at)],
		['Ação', `${meta.label}  (${l.acao})`],
		['Categoria', CATEGORIA[l.categoria ?? ''] ?? l.categoria ?? '—'],
		['Severidade', SEVERIDADE[l.severidade ?? ''] ?? '—'],
		['Resultado', RESULTADO[l.resultado ?? ''] ?? l.resultado ?? '—'],
		[
			'Ator',
			`${l.usuario_nome || '—'}${l.actor_tipo ? ` (${l.actor_tipo})` : ''}${l.usuario_id ? ` · #${l.usuario_id}` : ''}${l.usuario_papel ? ` · ${l.usuario_papel}` : ''}`
		],
		['Alvo', l.alvo_nome ?? (l.alvo_id ? `${l.alvo_tipo ?? ''} #${l.alvo_id}` : '—')],
		['Entidade', `${l.entidade}${l.entidade_id ? ` #${l.entidade_id}` : ''}`],
		['Detalhes', l.detalhes ?? '—'],
		['IP', l.ip ?? '—'],
		['User-Agent', l.user_agent ?? '—'],
		['Rota', `${l.metodo ?? ''} ${l.rota ?? '—'}`.trim()],
		['Request ID', l.request_id ?? '—'],
		['Sequência', l.seq != null ? String(l.seq) : '—'],
		['Hash anterior', l.hash_anterior ?? '—'],
		['Hash do registro', l.hash_registro ?? '—']
	];

	autoTable(doc, {
		startY: 76,
		body: linhas,
		styles: { fontSize: 9, cellPadding: 5, overflow: 'linebreak' },
		columnStyles: {
			0: { cellWidth: 120, fontStyle: 'bold', fillColor: [245, 247, 250] },
			1: { cellWidth: 'auto' }
		}
	});

	const metadados = tentarJson(l.metadados);
	const antes = tentarJson(l.dados_antes);
	const depois = tentarJson(l.dados_depois);

	let y = (doc.lastAutoTable?.finalY ?? 100) + 18;
	const bloco = (titulo: string, conteudo: string) => {
		doc.setFontSize(10);
		doc.text(titulo, 40, y);
		y += 6;
		autoTable(doc, {
			startY: y,
			body: [[conteudo]],
			styles: { fontSize: 8, cellPadding: 5, font: 'courier', overflow: 'linebreak' },
			theme: 'grid'
		});
		y = (doc.lastAutoTable?.finalY ?? y) + 16;
	};
	if (metadados) bloco('Metadados', metadados);
	if (antes) bloco('Estado anterior', antes);
	if (depois) bloco('Estado posterior', depois);

	rodapePaginas(doc, geradoPor);
	return new Uint8Array(doc.output('arraybuffer'));
}
