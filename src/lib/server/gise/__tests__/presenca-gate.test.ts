/**
 * Saída sem entrada não vira termo assinado — FLW-GISE-008.
 *
 * O finalizador de assinatura qualificada revalidava a participação e mais
 * nada. No fluxo de saída, o `UPDATE` de presença não cria linha: sem entrada
 * registrada ele não achava nada, o resultado era IGNORADO, e o endpoint seguia
 * gravando termo assinado e auditoria de sucesso. Um documento com valor
 * jurídico atestando um ato que não aconteceu.
 *
 * A janela de horário tinha o mesmo formato de furo, por outro caminho: existia
 * só no `preparar`, que é o passo barato. Quem guardasse um `preparedPdf` e
 * chamasse o finalizador depois passava por cima dela.
 *
 * Duas camadas, e o teste cobre as duas porque elas respondem a coisas
 * diferentes: o gate erra CEDO (antes de consumir o certificado), e o
 * `WHERE entrada_timestamp IS NOT NULL` decide de verdade — entre um e outro
 * cabe uma requisição.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { gateDePresenca, janelaDePresencaLiberada } from '../presenca-gate';
import { salvarEntradaGise, salvarSaidaGise } from '$lib/db/gise/presencas';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

const GISE = 98001;
const POL = 98101;

/** Calendário civil em Brasília — `toISOString().slice(0,10)` é UTC e, das 21h
 *  às 00h BRT, "hoje" já é amanhã (mesmo defeito documentado em `hojeLocalISO`). */
function diaBrasiliaISO(offsetDias = 0): string {
	const ms = Date.now() + offsetDias * 86_400_000;
	return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

/** Data no passado: a janela de qualquer horário já abriu. */
const ONTEM = () => diaBrasiliaISO(-1);
/** Data no futuro: nenhuma janela abriu. */
const AMANHA = () => diaBrasiliaISO(1);

const presenca = () =>
	sqlite
		.prepare(
			`SELECT entrada_timestamp AS entrada, saida_timestamp AS saida
			 FROM gise_presencas WHERE gise_id = ${GISE} AND policial_id = ${POL}`
		)
		.get() as { entrada: string | null; saida: string | null } | undefined;

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha)
		VALUES (${POL}, 'M98101', 'Escalado', 'OIP', 'DEL A', 'h');

		INSERT INTO gise_escalas (id, data_inicio, status)
		VALUES (${GISE}, '${ONTEM()}', 'em_andamento');
	`);
});

describe('janela de horário', () => {
	it('libera quando o horário previsto já passou', () => {
		const r = janelaDePresencaLiberada(
			{ dataInicio: ONTEM(), horarioPrevisto: { inicio: '08:00', fim: '18:00' } },
			'entrada'
		);
		expect(r.ok).toBe(true);
	});

	it('recusa com 409 antes do horário', async () => {
		const r = janelaDePresencaLiberada(
			{ dataInicio: AMANHA(), horarioPrevisto: { inicio: '08:00', fim: '18:00' } },
			'entrada'
		);
		expect(r.ok).toBe(false);
		if (r.ok) throw new Error('inalcançável');
		expect(r.resposta.status).toBe(409);
		expect((await r.resposta.json()).error).toContain('08:00');
	});

	it('a saída olha o horário de FIM, não o de início', async () => {
		// Entrada liberada e saída ainda não é o estado normal do meio do plantão.
		const dataInicio = diaBrasiliaISO();
		const entrada = janelaDePresencaLiberada(
			{ dataInicio, horarioPrevisto: { inicio: '00:01', fim: '23:59' } },
			'entrada'
		);
		const saida = janelaDePresencaLiberada(
			{ dataInicio, horarioPrevisto: { inicio: '00:01', fim: '23:59' } },
			'saida'
		);
		expect(entrada.ok).toBe(true);
		expect(saida.ok, 'às 23:59 a saída ainda não abriu').toBe(false);
	});

	it('sem horário previsto não há janela a impor', () => {
		expect(janelaDePresencaLiberada({}, 'saida').ok).toBe(true);
		expect(janelaDePresencaLiberada({ dataInicio: AMANHA() }, 'saida').ok).toBe(true);
	});
});

describe('gate: saída exige entrada', () => {
	const part = () => ({
		dataInicio: ONTEM(),
		horarioPrevisto: { inicio: '08:00', fim: '18:00' }
	});

	it('sem entrada, a saída é recusada com 409', async () => {
		const r = await gateDePresenca(db, part(), GISE, POL, 'saida');
		expect(r.ok).toBe(false);
		if (r.ok) throw new Error('inalcançável');
		expect(r.resposta.status).toBe(409);
		expect((await r.resposta.json()).error).toContain('ENTRADA');
	});

	it('com entrada registrada, a saída é liberada', async () => {
		await salvarEntradaGise(db, GISE, POL, 'rubrica');
		expect((await gateDePresenca(db, part(), GISE, POL, 'saida')).ok).toBe(true);
	});

	it('a ENTRADA nunca depende de entrada anterior', async () => {
		expect((await gateDePresenca(db, part(), GISE, POL, 'entrada')).ok).toBe(true);
	});

	it('segunda saída é recusada com 409 (SEC-33)', async () => {
		await salvarEntradaGise(db, GISE, POL, 'rubrica');
		await salvarSaidaGise(db, GISE, POL, 'rubrica-saida');
		const r = await gateDePresenca(db, part(), GISE, POL, 'saida');
		expect(r.ok).toBe(false);
		if (r.ok) throw new Error('inalcançável');
		expect(r.resposta.status).toBe(409);
	});

	it('entrada depois da saída é recusada com 409 (SEC-33)', async () => {
		await salvarEntradaGise(db, GISE, POL, 'rubrica');
		await salvarSaidaGise(db, GISE, POL, 'rubrica-saida');
		const r = await gateDePresenca(db, part(), GISE, POL, 'entrada');
		expect(r.ok).toBe(false);
		if (r.ok) throw new Error('inalcançável');
		expect(r.resposta.status).toBe(409);
		expect((await r.resposta.json()).error).toContain('saída');
	});
});

describe('a gravação é quem decide', () => {
	it('salvarSaidaGise sem entrada não registra nada e AVISA', async () => {
		// O ponto do achado: antes, o UPDATE não achava linha e o resultado era
		// descartado — o endpoint seguia como se tivesse dado certo.
		const r = await salvarSaidaGise(db, GISE, POL, 'rubrica');
		expect(r.registrada).toBe(false);
		expect(presenca(), 'nenhuma linha foi criada').toBeUndefined();
	});

	it('com entrada, a saída é gravada e confirmada', async () => {
		await salvarEntradaGise(db, GISE, POL, 'rubrica-entrada');
		const r = await salvarSaidaGise(db, GISE, POL, 'rubrica-saida');
		expect(r.registrada).toBe(true);
		expect(presenca()?.saida).not.toBeNull();
	});

	it('linha de presença SEM entrada_timestamp também é recusada', async () => {
		// Estado possível por caminhos antigos: existe a linha, falta o carimbo.
		// Filtrar só por (gise, policial) aceitaria — e é o que fazia.
		sqlite.exec(`INSERT INTO gise_presencas (gise_id, policial_id) VALUES (${GISE}, ${POL})`);
		const r = await salvarSaidaGise(db, GISE, POL, 'rubrica');
		expect(r.registrada).toBe(false);
		expect(presenca()?.saida).toBeNull();
	});

	it('segunda saída não sobrescreve o carimbo (SEC-33)', async () => {
		await salvarEntradaGise(db, GISE, POL, 'rubrica-entrada');
		const a = await salvarSaidaGise(db, GISE, POL, 'rubrica-saida-1');
		const saida1 = presenca()?.saida;
		const b = await salvarSaidaGise(db, GISE, POL, 'rubrica-saida-2');
		expect(a.registrada).toBe(true);
		expect(b.registrada).toBe(false);
		expect(presenca()?.saida).toBe(saida1);
	});

	it('entrada depois da saída não reabre o ato (SEC-33)', async () => {
		await salvarEntradaGise(db, GISE, POL, 'entrada-1');
		const entrada1 = presenca()?.entrada;
		await salvarSaidaGise(db, GISE, POL, 'saida-1');
		const r = await salvarEntradaGise(db, GISE, POL, 'entrada-2');
		expect(r.registrada).toBe(false);
		expect(presenca()?.entrada).toBe(entrada1);
	});
});
