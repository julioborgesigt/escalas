import { describe, it, expect } from 'vitest';
import {
	cifrarCPF,
	decifrarCPF,
	indiceCPF,
	prepararCpfParaDB,
	decifrarCpfDoDB
} from '../cpf-cripto';

const ENC = 'a'.repeat(64); // 32 bytes em hex
const IDX = 'b'.repeat(64);
const CPF = '123.456.789-09';
const CPF_NORM = '12345678909';

describe('cpf-cripto', () => {
	it('cifra e decifra (round-trip), normalizando o CPF', async () => {
		const enc = await cifrarCPF(CPF, ENC);
		expect(enc.startsWith('enc:v1:')).toBe(true);
		expect(enc).not.toContain(CPF_NORM);
		expect(await decifrarCPF(enc, ENC)).toBe(CPF_NORM);
	});

	it('gera ciphertext diferente a cada chamada (IV aleatório)', async () => {
		const a = await cifrarCPF(CPF_NORM, ENC);
		const b = await cifrarCPF(CPF_NORM, ENC);
		expect(a).not.toBe(b);
		expect(await decifrarCPF(a, ENC)).toBe(await decifrarCPF(b, ENC));
	});

	it('decifrar é tolerante: valor sem prefixo volta como está', async () => {
		expect(await decifrarCPF(CPF_NORM, ENC)).toBe(CPF_NORM);
		expect(await decifrarCPF('', ENC)).toBe('');
	});

	it('índice é determinístico e some com a normalização', async () => {
		const i1 = await indiceCPF(CPF, IDX);
		const i2 = await indiceCPF(CPF_NORM, IDX);
		expect(i1).toBe(i2);
		expect(i1).toMatch(/^[0-9a-f]{64}$/);
	});

	it('índice muda com a chave', async () => {
		expect(await indiceCPF(CPF_NORM, IDX)).not.toBe(await indiceCPF(CPF_NORM, ENC));
	});

	it('prepararCpfParaDB cifra + indexa quando há chaves', async () => {
		const env = { CPF_ENCRYPTION_KEY: ENC, CPF_INDEX_KEY: IDX };
		const { cpf, cpf_index } = await prepararCpfParaDB(CPF, env);
		expect(cpf?.startsWith('enc:v1:')).toBe(true);
		expect(cpf_index).toBe(await indiceCPF(CPF_NORM, IDX));
		expect(await decifrarCpfDoDB(cpf, env)).toBe(CPF_NORM);
	});

	it('prepararCpfParaDB fail-open: sem chaves grava texto e índice null', async () => {
		const { cpf, cpf_index } = await prepararCpfParaDB(CPF, {});
		expect(cpf).toBe(CPF_NORM);
		expect(cpf_index).toBeNull();
	});

	it('prepararCpfParaDB com CPF vazio devolve nulls', async () => {
		const { cpf, cpf_index } = await prepararCpfParaDB('', {
			CPF_ENCRYPTION_KEY: ENC,
			CPF_INDEX_KEY: IDX
		});
		expect(cpf).toBeNull();
		expect(cpf_index).toBeNull();
	});

	it('decifrarCpfDoDB sem chave devolve o valor como está', async () => {
		expect(await decifrarCpfDoDB('enc:v1:xxxx', {})).toBe('enc:v1:xxxx');
	});

	it('rejeita chave com tamanho inválido', async () => {
		await expect(cifrarCPF(CPF_NORM, 'abc')).rejects.toThrow(/32 bytes/);
	});
});
