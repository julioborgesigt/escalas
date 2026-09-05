/**
 * O `scripts/hash-senha.mjs` produz um hash que o LOGIN aceita?
 *
 * O script vive fora de `src/` e reimplementa, por necessidade, os parâmetros
 * de `password-hash.ts` (iterações, tamanho de salt, formato). Nada além deste
 * teste liga as duas metades: um ajuste nos parâmetros de um lado passaria
 * despercebido, e o sintoma seria a conta de break-glass recusando a senha
 * correta — `verificarSenha` devolve `false`, não erro, então não haveria nem
 * mensagem para investigar.
 *
 * Por isso o teste EXECUTA o script de verdade, em vez de repetir a conta aqui:
 * repetir a conta testaria a cópia, não o arquivo que o operador roda.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { verificarSenha } from '../password-hash';

const SCRIPT = resolve(
	fileURLToPath(new URL('../../../../scripts/hash-senha.mjs', import.meta.url))
);
const SENHA = 'Senha#DeTeste-2026';

function rodarScript(senha: string): string {
	return execFileSync('node', [SCRIPT], {
		env: { ...process.env, HASH_PASSWORD: senha },
		encoding: 'utf8'
	}).trim();
}

describe('scripts/hash-senha.mjs', () => {
	it('emite o formato pbkdf2v2 com iterações, salt e hash', () => {
		expect(rodarScript(SENHA)).toMatch(/^pbkdf2v2:100000:[0-9a-f]{32}:[0-9a-f]{64}$/);
	});

	it('o hash gerado é aceito por verificarSenha (o que o login faz)', async () => {
		const hash = rodarScript(SENHA);
		await expect(verificarSenha(SENHA, hash)).resolves.toBe(true);
	});

	it('senha errada continua sendo recusada', async () => {
		const hash = rodarScript(SENHA);
		await expect(verificarSenha('outra-senha', hash)).resolves.toBe(false);
	});

	it('o hash NÃO depende do pepper — é o que mantém o break-glass vivo', async () => {
		const hash = rodarScript(SENHA);
		await expect(verificarSenha(SENHA, hash, 'pepper-qualquer')).resolves.toBe(true);
	});

	it('cada execução usa salt novo', () => {
		expect(rodarScript(SENHA)).not.toBe(rodarScript(SENHA));
	});

	it('sem HASH_PASSWORD, falha com instrução em vez de gerar hash de string vazia', () => {
		expect(() =>
			execFileSync('node', [SCRIPT], {
				env: { ...process.env, HASH_PASSWORD: '' },
				encoding: 'utf8',
				stdio: 'pipe'
			})
		).toThrow();
	});
});
