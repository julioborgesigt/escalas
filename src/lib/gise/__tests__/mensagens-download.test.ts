import { describe, it, expect } from 'vitest';
import {
	dialogoDownloadAssinado,
	dialogoDownloadNaoAssinado,
	type DocumentoGise
} from '../mensagens-download';

const DOCS: DocumentoGise[] = ['escala', 'relatorioExtra'];

describe('dialogoDownloadAssinado', () => {
	it('sem manifesto: um botão só, e o texto NÃO promete a folha de auditoria', () => {
		for (const documento of DOCS) {
			const d = dialogoDownloadAssinado({
				documento,
				url: '/u',
				urlComManifesto: '/u&manifesto=true',
				podeManifesto: false
			});
			expect(d.secundaria, documento).toBeUndefined();
			expect(d.principal.url, documento).toBe('/u');
			// A regressão que a extração fecha: oferecer "Com manifesto" a quem o
			// servidor vai recusar, ou citá-lo no texto sem dar o botão.
			expect(d.linhas.join(' ').toLowerCase(), documento).not.toContain('manifesto');
		}
	});

	it('com manifesto: dois botões, e o secundário é a URL com o parâmetro', () => {
		for (const documento of DOCS) {
			const d = dialogoDownloadAssinado({
				documento,
				url: '/u',
				urlComManifesto: '/u&manifesto=true',
				podeManifesto: true
			});
			expect(d.principal, documento).toEqual({ label: 'Sem manifesto', url: '/u' });
			expect(d.secundaria, documento).toEqual({
				label: 'Com manifesto',
				url: '/u&manifesto=true'
			});
		}
	});

	it('os dois documentos concordam em gênero — escala é feminina, relatório é masculino', () => {
		const escala = dialogoDownloadAssinado({
			documento: 'escala',
			url: '/u',
			urlComManifesto: '/m',
			podeManifesto: true
		});
		const extra = dialogoDownloadAssinado({
			documento: 'relatorioExtra',
			url: '/u',
			urlComManifesto: '/m',
			podeManifesto: true
		});
		expect(escala.titulo).toContain('Assinada');
		expect(escala.linhas[0]).toContain('Esta escala já foi assinada');
		expect(extra.titulo).toContain('Assinado');
		expect(extra.linhas[0]).toContain('Este relatório de serviço extraordinário já foi assinado');
	});
});

describe('dialogoDownloadNaoAssinado', () => {
	it('avisa que sai via preliminar e nunca oferece manifesto', () => {
		for (const documento of DOCS) {
			const d = dialogoDownloadNaoAssinado({ documento, url: '/u' });
			expect(d.secundaria, documento).toBeUndefined();
			expect(d.principal, documento).toEqual({ label: 'Confirmar Download', url: '/u' });
			expect(d.linhas.join(' '), documento).toContain('via preliminar');
			expect(d.linhas.join(' ').toLowerCase(), documento).not.toContain('manifesto');
		}
	});

	it('só a escala nomeia o supervisor — o relatório de extra não tem um só assinante', () => {
		expect(dialogoDownloadNaoAssinado({ documento: 'escala', url: '/u' }).linhas[0]).toContain(
			'pelo supervisor'
		);
		expect(
			dialogoDownloadNaoAssinado({ documento: 'relatorioExtra', url: '/u' }).linhas[0]
		).not.toContain('supervisor');
	});
});
