import { json } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import * as XLSX from 'xlsx';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform, request }) => {
	const db = getDB(platform);
	const formData = await request.formData();
	const file = formData.get('file') as File;

	if (!file) {
		return json({ error: 'Nenhum arquivo enviado' }, { status: 400 });
	}

	const buffer = await file.arrayBuffer();
	const workbook = XLSX.read(buffer, { type: 'array' });
	const sheet = workbook.Sheets[workbook.SheetNames[0]];
	const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { header: ['nome', 'matricula', 'cargo', 'telefone', 'lotacao'] });

	// Skip header row
	const dataRows = rows.slice(1);

	let imported = 0;
	let errors: string[] = [];

	for (const row of dataRows) {
		if (!row.nome || !row.matricula || !row.cargo || !row.lotacao) {
			errors.push(`Linha com dados incompletos: ${row.nome || 'sem nome'}`);
			continue;
		}

		const cargo = row.cargo.toUpperCase().trim();
		if (!['DPC', 'OIP'].includes(cargo)) {
			errors.push(`Cargo inválido para ${row.nome}: ${row.cargo}`);
			continue;
		}

		try {
			await db.prepare(
				'INSERT OR IGNORE INTO policiais (nome, matricula, cargo, telefone, lotacao) VALUES (?, ?, ?, ?, ?)'
			).bind(
				row.nome.trim(),
				String(row.matricula).trim(),
				cargo,
				row.telefone ? String(row.telefone).trim() : '',
				row.lotacao.trim()
			).run();
			imported++;
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : 'Erro desconhecido';
			errors.push(`Erro ao importar ${row.nome}: ${message}`);
		}
	}

	return json({ imported, errors, total: dataRows.length });
};
