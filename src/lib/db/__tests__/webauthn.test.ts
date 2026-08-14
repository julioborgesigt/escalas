/**
 * Camada de dados da passkey, contra um SQLite REAL.
 *
 * Banco de verdade porque dois comportamentos aqui SÃO o SQL: o uso único do
 * desafio (`UPDATE ... WHERE usado = 0 ... RETURNING`) e o filtro por
 * `revogado_em IS NULL`, que é o que separa "credencial ativa" de "credencial
 * que já existiu".
 *
 * O invariante mais importante é o de **uma credencial ativa por pessoa**:
 * é ele que permite o `preparar` saber, antes da cerimônia, qual credencial vai
 * assinar — e portanto emitir o manifesto já completo, com a asserção cobrindo
 * um PDF que nomeia a chave que o assinou. Se duas ficarem ativas, o manifesto
 * passa a mentir ou a ficar vago, e nada no fluxo acusa.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from './sqlite-migrado';
import {
	buscarCredencialAtiva,
	buscarCredencialPorId,
	registrarCredencial,
	revogarCredenciaisAtivas,
	excluirCredenciaisDoDono,
	registrarUsoCredencial,
	criarDesafioWebauthn,
	consumirDesafioWebauthn,
	type DonoCredencial
} from '../webauthn';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

const POLICIAL: DonoCredencial = { tipo: 'policial', id: 42 };
const OUTRO: DonoCredencial = { tipo: 'policial', id: 99 };
/** Mesmo id, outro TIPO de conta — pessoas distintas no sistema. */
const ADMIN_42: DonoCredencial = { tipo: 'admin', id: 42 };

const SPKI = new Uint8Array([0x30, 0x59, 1, 2, 3, 4, 5, 6, 7, 8]);

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
});

function nova(
	credentialId: string,
	extras: Partial<Parameters<typeof registrarCredencial>[2]> = {}
) {
	return {
		credentialId,
		publicKeySpki: SPKI,
		contador: 0,
		aaguid: null,
		backupElegivel: true,
		backupAtivo: true,
		...extras
	};
}

describe('uma credencial ativa por pessoa', () => {
	it('registrar de novo revoga a anterior', async () => {
		await registrarCredencial(db, POLICIAL, nova('cred-1'));
		await registrarCredencial(db, POLICIAL, nova('cred-2'));

		const ativa = await buscarCredencialAtiva(db, POLICIAL);
		expect(ativa?.credentialId).toBe('cred-2');

		const anterior = await buscarCredencialPorId(db, 'cred-1');
		expect(anterior?.revogadaEm).not.toBeNull();
	});

	it('nunca há duas ativas, mesmo depois de vários registros', async () => {
		await registrarCredencial(db, POLICIAL, nova('a'));
		await registrarCredencial(db, POLICIAL, nova('b'));
		await registrarCredencial(db, POLICIAL, nova('c'));

		const ativas = sqlite
			.prepare(
				'SELECT count(*) AS n FROM credenciais_webauthn WHERE usuario_id = 42 AND revogado_em IS NULL'
			)
			.get() as { n: number };
		expect(ativas.n).toBe(1);
	});

	it('a credencial de uma pessoa não aparece para outra', async () => {
		await registrarCredencial(db, POLICIAL, nova('minha'));
		expect(await buscarCredencialAtiva(db, OUTRO)).toBeNull();
		// `policiais.id = 42` e `administradores.id = 42` são pessoas diferentes.
		expect(await buscarCredencialAtiva(db, ADMIN_42)).toBeNull();
	});
});

describe('revogação', () => {
	it('revogada some de buscarCredencialAtiva mas continua em buscarCredencialPorId', async () => {
		// A distinção não é detalhe: o `finalizar` usa a segunda para recusar com
		// "revogada, registre novamente" em vez de "não reconhecida".
		await registrarCredencial(db, POLICIAL, nova('cred'));
		await revogarCredenciaisAtivas(db, POLICIAL);

		expect(await buscarCredencialAtiva(db, POLICIAL)).toBeNull();
		const linha = await buscarCredencialPorId(db, 'cred');
		expect(linha).not.toBeNull();
		expect(linha?.revogadaEm).not.toBeNull();
		expect(linha?.dono).toEqual(POLICIAL);
	});

	it('é idempotente e devolve quantas revogou', async () => {
		await registrarCredencial(db, POLICIAL, nova('cred'));
		expect(await revogarCredenciaisAtivas(db, POLICIAL)).toBe(1);
		expect(await revogarCredenciaisAtivas(db, POLICIAL)).toBe(0);
	});

	it('excluir apaga de verdade — inclusive as já revogadas', async () => {
		// Só é chamado quando o titular sai do sistema SEM documento assinado.
		await registrarCredencial(db, POLICIAL, nova('velha'));
		await registrarCredencial(db, POLICIAL, nova('atual'));

		expect(await excluirCredenciaisDoDono(db, POLICIAL)).toBe(2);
		expect(await buscarCredencialPorId(db, 'velha')).toBeNull();
		expect(await buscarCredencialPorId(db, 'atual')).toBeNull();
	});
});

describe('contador e uso', () => {
	it('registra o contador da asserção e a data de uso', async () => {
		await registrarCredencial(db, POLICIAL, nova('cred'));
		const antes = await buscarCredencialAtiva(db, POLICIAL);
		expect(antes?.ultimoUso).toBeNull();

		await registrarUsoCredencial(db, antes!.id, 12);

		const depois = await buscarCredencialAtiva(db, POLICIAL);
		expect(depois?.contador).toBe(12);
		expect(depois?.ultimoUso).not.toBeNull();
	});

	it('preserva os flags de sincronização como vieram do aparelho', async () => {
		// São eles que decidem se o manifesto pode dizer "aparelho" ou tem de
		// dizer "conta do titular".
		await registrarCredencial(
			db,
			POLICIAL,
			nova('local', { backupElegivel: false, backupAtivo: false })
		);
		const c = await buscarCredencialAtiva(db, POLICIAL);
		expect(c?.backupElegivel).toBe(false);
		expect(c?.backupAtivo).toBe(false);
	});
});

describe('desafio de registro', () => {
	it('consome uma vez e devolve os bytes emitidos', async () => {
		const { desafioId, desafio } = await criarDesafioWebauthn(db, POLICIAL);
		const bytes = await consumirDesafioWebauthn(db, desafioId, POLICIAL);
		expect(bytes).not.toBeNull();
		expect(bytes).toHaveLength(32);

		// A segunda tentativa falha — é o `UPDATE ... WHERE usado = 0`.
		expect(await consumirDesafioWebauthn(db, desafioId, POLICIAL)).toBeNull();
		expect(desafio).toMatch(/^[A-Za-z0-9\-_]+$/);
	});

	it('desafio de OUTRA pessoa não serve, mesmo dentro da validade', async () => {
		const { desafioId } = await criarDesafioWebauthn(db, POLICIAL);
		expect(await consumirDesafioWebauthn(db, desafioId, OUTRO)).toBeNull();
	});

	it('expirado é recusado', async () => {
		const { desafioId } = await criarDesafioWebauthn(db, POLICIAL);
		sqlite
			.prepare('UPDATE webauthn_desafios SET expires_at = ?')
			.run(new Date(Date.now() - 60_000).toISOString());

		expect(await consumirDesafioWebauthn(db, desafioId, POLICIAL)).toBeNull();
	});

	it('id ausente é recusado sem lançar', async () => {
		expect(await consumirDesafioWebauthn(db, undefined, POLICIAL)).toBeNull();
		expect(await consumirDesafioWebauthn(db, 'nao-existe', POLICIAL)).toBeNull();
	});
});
