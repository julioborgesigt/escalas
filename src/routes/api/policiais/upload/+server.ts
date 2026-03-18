import { json } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import * as XLSX from 'xlsx';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform, request }) => {
	let db;
	try {
		db = getDB(platform);
	} catch {
		return json({
			error: 'Banco de dados não disponível. Verifique se o D1 está configurado corretamente nas bindings do Cloudflare Pages.',
			errorType: 'database'
		}, { status: 500 });
	}

	const formData = await request.formData();
	const file = formData.get('file') as File;

	if (!file) {
		return json({ error: 'Nenhum arquivo enviado.', errorType: 'validation' }, { status: 400 });
	}

	const fileName = file.name.toLowerCase();
	const validExtensions = ['.xlsx', '.xls', '.ods', '.csv'];
	const ext = fileName.substring(fileName.lastIndexOf('.'));
	if (!validExtensions.includes(ext)) {
		return json({
			error: `Formato de arquivo não suportado: "${ext}". Use ${validExtensions.join(', ')}.`,
			errorType: 'validation'
		}, { status: 400 });
	}

	let workbook;
	try {
		const buffer = await file.arrayBuffer();
		workbook = XLSX.read(buffer, { type: 'array' });
	} catch {
		return json({
			error: `Não foi possível ler o arquivo "${file.name}". Verifique se o arquivo não está corrompido e se é uma planilha válida.`,
			errorType: 'parse'
		}, { status: 400 });
	}

	if (!workbook.SheetNames.length) {
		return json({
			error: 'O arquivo não contém nenhuma aba/planilha.',
			errorType: 'parse'
		}, { status: 400 });
	}

	const sheet = workbook.Sheets[workbook.SheetNames[0]];
	const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
		header: ['nome', 'matricula', 'cargo', 'telefone', 'lotacao']
	});

	if (rows.length <= 1) {
		return json({
			error: 'A planilha está vazia ou contém apenas o cabeçalho. Adicione dados a partir da linha 2.',
			errorType: 'validation'
		}, { status: 400 });
	}

	// Skip header row
	const dataRows = rows.slice(1);

	let imported = 0;
	let skipped = 0;
	const errors: { row: number; nome: string; message: string }[] = [];

	for (let i = 0; i < dataRows.length; i++) {
		const row = dataRows[i];
		const rowNum = i + 2; // +2 because: index 0 = row 2 in spreadsheet (row 1 is header)
		const nome = row.nome ? String(row.nome).trim() : '';

		const missing: string[] = [];
		if (!row.nome) missing.push('Nome (coluna A)');
		if (!row.matricula) missing.push('Matrícula (coluna B)');
		if (!row.cargo) missing.push('Cargo (coluna C)');
		if (!row.lotacao) missing.push('Lotação (coluna E)');

		if (missing.length > 0) {
			errors.push({
				row: rowNum,
				nome: nome || '(vazio)',
				message: `Campos obrigatórios faltando: ${missing.join(', ')}`
			});
			continue;
		}

		const cargo = String(row.cargo).toUpperCase().trim();
		if (!['DPC', 'OIP'].includes(cargo)) {
			errors.push({
				row: rowNum,
				nome,
				message: `Cargo "${row.cargo}" inválido. Use "DPC" ou "OIP".`
			});
			continue;
		}

		try {
			const result = await db.prepare(
				'INSERT OR IGNORE INTO policiais (nome, matricula, cargo, telefone, lotacao) VALUES (?, ?, ?, ?, ?)'
			).bind(
				nome,
				String(row.matricula).trim(),
				cargo,
				row.telefone ? String(row.telefone).trim() : '',
				String(row.lotacao).trim()
			).run();

			if (result.meta?.changes === 0) {
				skipped++;
				errors.push({
					row: rowNum,
					nome,
					message: `Matrícula "${String(row.matricula).trim()}" já cadastrada — registro ignorado.`
				});
			} else {
				imported++;
			}
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : 'Erro desconhecido no banco de dados';
			errors.push({
				row: rowNum,
				nome,
				message: `Erro ao salvar: ${message}`
			});
		}
	}

	return json({ imported, skipped, errors, total: dataRows.length });
};
