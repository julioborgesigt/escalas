import { fail } from '@sveltejs/kit';
import { getDB, listarUnidades } from '$lib/db';
import { policiais as policiaisTable } from '$lib/server/schema';
import * as XLSX from 'xlsx';
import { limparMatricula } from '$lib/utils';
import { gerarSenhaAleatoriaHash } from '$lib/auth';
import type { Actions } from './$types';

function normalizarTexto(texto: string): string {
	return texto
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.trim();
}

function encontrarUnidade(nomeNaPlanilha: string, unidades: { nome: string }[]): string {
	const normalizado = normalizarTexto(nomeNaPlanilha);
	const encontrada = unidades.find(u => normalizarTexto(u.nome) === normalizado);
	return encontrada ? encontrada.nome : '';
}

export const actions = {
	upload: async ({ request, platform, locals }) => {
		let db;
		try {
			db = getDB(platform);
		} catch {
			return fail(500, {
				error: 'Banco de dados não disponível. Verifique se o D1 está configurado.',
				errorType: 'database'
			});
		}

		const unidades = await listarUnidades(db);
		if (unidades.length === 0) {
			return fail(400, {
				error: 'Nenhuma unidade policial cadastrada. Cadastre pelo menos uma.',
				errorType: 'no_units'
			});
		}

		const formData = await request.formData();
		const file = formData.get('file') as File;

		if (!file || !file.name) {
			return fail(400, { error: 'Nenhum arquivo enviado.', errorType: 'validation' });
		}

		const fileName = file.name.toLowerCase();
		const validExtensions = ['.xlsx', '.xls', '.ods', '.csv'];
		const ext = fileName.substring(fileName.lastIndexOf('.'));
		if (!validExtensions.includes(ext)) {
			return fail(400, {
				error: `Formato de arquivo não suportado: "${ext}". Use ${validExtensions.join(', ')}.`,
				errorType: 'validation'
			});
		}

		const validMimeTypes = [
			'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'application/vnd.ms-excel',
			'application/vnd.oasis.opendocument.spreadsheet',
			'text/csv',
			'text/plain',
			'application/octet-stream'
		];
		if (file.type && !validMimeTypes.includes(file.type)) {
			return fail(400, {
				error: `Tipo de arquivo inválido: "${file.type}". Envie uma planilha válida.`,
				errorType: 'validation'
			});
		}

		const MAX_SIZE = 5 * 1024 * 1024;
		if (file.size > MAX_SIZE) {
			return fail(400, {
				error: 'Arquivo muito grande. O tamanho máximo permitido é 5 MB.',
				errorType: 'validation'
			});
		}

		let workbook;
		try {
			const buffer = await file.arrayBuffer();
			workbook = XLSX.read(buffer, { type: 'array' });
		} catch {
			return fail(400, {
				error: `Não foi possível ler o arquivo "${file.name}".`,
				errorType: 'parse'
			});
		}

		if (!workbook.SheetNames.length) {
			return fail(400, {
				error: 'O arquivo não contém nenhuma aba/planilha.',
				errorType: 'parse'
			});
		}

		const sheet = workbook.Sheets[workbook.SheetNames[0]];
		const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
			header: ['nome', 'matricula', 'cargo', 'telefone', 'lotacao']
		});

		if (rows.length <= 1) {
			return fail(400, {
				error: 'A planilha está vazia ou contém apenas o cabeçalho. Adicione dados a partir da linha 2.',
				errorType: 'validation'
			});
		}

		const dataRows = rows.slice(1);

		let imported = 0;
		let skipped = 0;
		const errors: { row: number; nome: string; message: string }[] = [];

		for (let i = 0; i < dataRows.length; i++) {
			const row = dataRows[i];
			const rowNum = i + 2; 
			const nome = row.nome ? String(row.nome).trim() : '';

			const missing: string[] = [];
			if (!row.nome) missing.push('Nome (coluna A)');
			if (!row.matricula) missing.push('Matrícula (coluna B)');
			if (!row.cargo) missing.push('Cargo (coluna C)');

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

			let lotacaoFinal = '';
			if (row.lotacao) {
				lotacaoFinal = encontrarUnidade(String(row.lotacao).trim(), unidades);
			}

			if (locals.usuario?.tipo === 'policial') {
				if (lotacaoFinal !== locals.usuario.lotacao) {
					errors.push({
						row: rowNum,
						nome,
						message: `Lotação "${row.lotacao}" diferente da sua. Você só pode importar policiais da sua lotação.`
					});
					continue;
				}
			}

			const matriculaLimpa = limparMatricula(String(row.matricula));

			try {
				const senhaHash = await gerarSenhaAleatoriaHash();
				const result = await db
					.insert(policiaisTable)
					.values({
						nome,
						matricula: matriculaLimpa,
						cargo: cargo as 'DPC' | 'OIP',
						telefone: row.telefone ? String(row.telefone).trim() : '',
						lotacao: lotacaoFinal,
						senha: senhaHash,
						primeiro_acesso: 1
					})
					.onConflictDoNothing()
					.returning({ id: policiaisTable.id });

				if (result.length === 0) {
					skipped++;
					errors.push({
						row: rowNum,
						nome,
						message: `Matrícula "${matriculaLimpa}" já cadastrada — registro ignorado.`
					});
				} else {
					imported++;
					if (row.lotacao && !lotacaoFinal) {
						errors.push({
							row: rowNum,
							nome,
							message: `Lotação "${row.lotacao}" não encontrada no sistema — importado sem lotação.`
						});
					}
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

		return { success: true, imported, skipped, errors, total: dataRows.length };
	}
} satisfies Actions;
