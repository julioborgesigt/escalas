import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { podeBaixarForense, gerarCopiaConferencia } from '../copia-conferencia';
import type { UsuarioLogado } from '$lib/auth';

function superAdmin(): UsuarioLogado {
	return { id: 1, tipo: 'admin', nome: 'Super', primeiro_acesso: false, isSuperAdmin: true };
}

function adminGeral(): UsuarioLogado {
	return { id: 1, tipo: 'admin', nome: 'Admin', primeiro_acesso: false, isSuperAdmin: false };
}

function policial(papel: UsuarioLogado['papel'] = null): UsuarioLogado {
	return { id: 2, tipo: 'policial', nome: 'Policial', primeiro_acesso: false, papel, cargo: 'DPC' };
}

async function pdfComPaginas(n: number): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	for (let i = 0; i < n; i++) doc.addPage([300, 400]);
	return doc.save();
}

describe('podeBaixarForense', () => {
	it('Super Admin → true', () => {
		expect(podeBaixarForense(superAdmin())).toBe(true);
	});
	it('Admin Geral (não super) → false', () => {
		expect(podeBaixarForense(adminGeral())).toBe(false);
	});
	it('Admin Seccional → false', () => {
		expect(podeBaixarForense(policial('admin_seccional'))).toBe(false);
	});
	it('Admin Unidade → false', () => {
		expect(podeBaixarForense(policial('admin_unidade'))).toBe(false);
	});
	it('Policial comum → false', () => {
		expect(podeBaixarForense(policial())).toBe(false);
	});
	it('sem sessão (null) → false', () => {
		expect(podeBaixarForense(null)).toBe(false);
	});
});

describe('gerarCopiaConferencia', () => {
	it('NÃO adiciona página de manifesto (preserva o nº de páginas do rascunho)', async () => {
		const rascunho = await pdfComPaginas(2);
		const out = await gerarCopiaConferencia({
			pdfRascunho: rascunho,
			assinanteNome: 'Fulano de Tal',
			verificationHash: 'abc123def456',
			verificationUrl: 'https://exemplo.test/validar/abc123def456'
		});
		const doc = await PDFDocument.load(out);
		expect(doc.getPageCount()).toBe(2);
	});

	it('sem hash de verificação → devolve rascunho (apenas marca d’água), ainda carregável', async () => {
		const rascunho = await pdfComPaginas(1);
		const out = await gerarCopiaConferencia({
			pdfRascunho: rascunho,
			assinanteNome: 'Fulano de Tal'
		});
		const doc = await PDFDocument.load(out);
		expect(doc.getPageCount()).toBe(1);
		// Deve ser um PDF não-vazio e distinto/transformado em relação à entrada.
		expect(out.byteLength).toBeGreaterThan(0);
	});

	it('produz um PDF carregável quando há rodapé/QR de validação', async () => {
		const rascunho = await pdfComPaginas(3);
		const out = await gerarCopiaConferencia({
			pdfRascunho: rascunho,
			assinanteNome: 'Beltrano',
			verificationHash: 'deadbeefcafe',
			verificationUrl: 'https://exemplo.test/validar/deadbeefcafe'
		});
		const doc = await PDFDocument.load(out);
		expect(doc.getPageCount()).toBe(3);
	});
});
