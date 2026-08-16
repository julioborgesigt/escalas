/**
 * Mensagens e recusas da chave de assinatura — puro, sem banco.
 *
 * O cadastro no desktop e o 403 sem chave são a fronteira que a UI não pode
 * "consertar" sozinha: um POST direto tem de morrer com a mesma frase.
 */
import { describe, it, expect } from 'vitest';
import {
	recusarCadastroChavePorUA,
	mensagemSemChaveAssinatura,
	ERRO_CADASTRO_CHAVE_DESKTOP,
	ERRO_PASSKEY_UM_TIRO
} from '../chave-assinatura';
import {
	avancadaEmTelaDisponivel,
	avancadaEmTelaDoLayout,
	mensagemConviteChave,
	abreviarCredencial,
	situacaoChaveNoCadastro,
	mensagemJaTemChaveNoPerfil,
	mensagemReposicaoDoisEmails,
	mensagemOfertaChavePrimeiroAcesso,
	mensagemChaveNoCartaoAdmin,
	mensagemOndeEstaAChave
} from '$lib/chave-assinatura-ui';

const UA_DESKTOP =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const UA_CELULAR =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

describe('recusarCadastroChavePorUA', () => {
	it('recusa desktop sempre — não depende da política móvel da avançada', () => {
		expect(recusarCadastroChavePorUA(UA_DESKTOP)).toBe(true);
	});

	it('aceita celular', () => {
		expect(recusarCadastroChavePorUA(UA_CELULAR)).toBe(false);
	});
});

describe('mensagemSemChaveAssinatura', () => {
	it('no celular aponta para Meu Perfil', () => {
		expect(mensagemSemChaveAssinatura(UA_CELULAR)).toMatch(/Meu Perfil/);
		expect(mensagemSemChaveAssinatura(UA_CELULAR)).not.toMatch(/dispositivo registrado/i);
	});

	it('no desktop aponta o Token A3 e não afirma aparelho cadastrado', () => {
		expect(mensagemSemChaveAssinatura(UA_DESKTOP)).toMatch(/Token A3/);
		expect(mensagemSemChaveAssinatura(UA_DESKTOP)).not.toMatch(/dispositivo registrado/i);
	});
});

describe('constantes', () => {
	it('um-tiro e cadastro desktop têm frase estável', () => {
		expect(ERRO_PASSKEY_UM_TIRO).toMatch(/chave do seu celular/);
		expect(ERRO_CADASTRO_CHAVE_DESKTOP).toMatch(/celular/);
	});
});

describe('avancadaEmTelaDisponivel', () => {
	it('com a flag desligada, oferece mesmo sem chave', () => {
		expect(avancadaEmTelaDisponivel(false, false)).toBe(true);
	});

	it('com a flag ligada, só oferece quem tem chave', () => {
		expect(avancadaEmTelaDisponivel(true, false)).toBe(false);
		expect(avancadaEmTelaDisponivel(true, true)).toBe(true);
	});

	it('lê o layout sem afirmar aparelho cadastrado', () => {
		expect(
			avancadaEmTelaDoLayout({ exigirPasskeyAssinatura: true, temChaveAssinatura: false })
		).toBe(false);
		expect(mensagemConviteChave(true)).toMatch(/celular/);
		expect(mensagemConviteChave(false)).toMatch(/Token A3/);
		expect(mensagemConviteChave(true)).not.toMatch(/dispositivo registrado/i);
		expect(mensagemConviteChave(false)).not.toMatch(/dispositivo registrado/i);
	});
});

describe('abreviarCredencial', () => {
	it('deixa id curto intacto', () => {
		expect(abreviarCredencial('abc12xyz8901abcd')).toBe('abc12xyz8901abcd');
		expect(abreviarCredencial('a'.repeat(20))).toBe('a'.repeat(20));
	});

	it('recorte 8...8 no id longo — o mesmo texto do manifesto', () => {
		const id = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHw';
		expect(abreviarCredencial(id)).toBe('AQIDBAUG...obHB0eHw');
		expect(abreviarCredencial(id).length).toBe(19);
	});
});

describe('situacaoChaveNoCadastro', () => {
	it('distingue ativa, revogada e ausente', () => {
		expect(situacaoChaveNoCadastro(null)).toBe('ausente');
		expect(situacaoChaveNoCadastro({ revogadaEm: null })).toBe('ativa');
		expect(situacaoChaveNoCadastro({ revogadaEm: '2026-08-01T12:00:00.000Z' })).toBe('revogada');
	});
});

describe('copy da chave no perfil', () => {
	it('distingue sync de reposição e não afirma aparelho cadastrado', () => {
		const jaTem = mensagemJaTemChaveNoPerfil();
		expect(jaTem).toMatch(/Apple\/Google/);
		expect(jaTem).toMatch(/não cadastre de novo/);
		expect(jaTem).toMatch(/documentos já assinados continuam válidos/i);
		expect(jaTem).not.toMatch(/dispositivo registrado/i);

		expect(mensagemReposicaoDoisEmails()).toMatch(/dois e-mails/);
		expect(mensagemReposicaoDoisEmails()).toMatch(/e-mail funcional/);
		expect(mensagemOfertaChavePrimeiroAcesso()).toMatch(/e-mail funcional/);
		expect(mensagemOfertaChavePrimeiroAcesso()).not.toMatch(/dispositivo registrado/i);
	});

	it('cartão do Admin Geral: cadastro do titular, daqui só revoga', () => {
		const admin = mensagemChaveNoCartaoAdmin();
		expect(admin).toMatch(/Chave única/);
		expect(admin).toMatch(/próprio servidor/);
		expect(admin).toMatch(/Meu Perfil/);
		expect(admin).toMatch(/função de administrador/);
		expect(admin).toMatch(/revogar/);
		expect(admin).not.toMatch(/dispositivo registrado/i);
	});

	it('não promete modelo do celular — aponta vínculo e o gerenciador do SO', () => {
		const onde = mensagemOndeEstaAChave();
		expect(onde).toMatch(/não guarda o modelo/i);
		expect(onde).toMatch(/Apple\/Google/);
		expect(onde).toMatch(/Chaves-de-acesso/);
		expect(onde).toMatch(/Gerenciador de senhas do Google/);
		expect(onde).not.toMatch(/dispositivo registrado/i);
	});
});
