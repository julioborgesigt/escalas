/**
 * O que impede apagar o cadastro de um policial — FLW-POLICIAL-002.
 *
 * A regra decidida não é "nunca apagar": é **nunca apagar o que um documento
 * assinado referencia**. Os casos abaixo separam as duas metades disso, e a
 * segunda é a que se costuma esquecer:
 *
 *  - por AUTORIA — ele assinou (termo de presença, relatório de extra);
 *  - por MENÇÃO — o documento o LISTA (escala assinada, GISE assinada).
 *
 * Um PDF que lista alguém inexistente é tão inconsistente quanto um assinado
 * por alguém inexistente. Um teste só da autoria deixaria passar exatamente o
 * caso mais comum: o policial escalado que nunca assinou nada.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from './sqlite-migrado';
import { vinculosAssinadosDoPolicial, motivoParaNaoExcluir } from '../policial-exclusao';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

const POL = 90101;
const ESCALA = 90101;
const GISE = 90101;
const SEC = 90101;
const EQ = 90101;

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO unidades (id, nome, tipo) VALUES (${POL}, 'DELEGACIA EXCL', 'delegacia');
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha, ativo)
		VALUES (${POL}, 'M90101', 'Fulano', 'DPC', 'DELEGACIA EXCL', 'h', 1);
		INSERT INTO escalas (id, titulo, cidade, tipo, lotacao, data_inicio, data_fim)
		VALUES (${ESCALA}, 'Escala', 'Fortaleza', 'plantao', 'DELEGACIA EXCL', '2026-01-01', '2026-01-31');
		INSERT INTO gise_escalas (id, data_inicio, status, hora_entrada, hora_saida)
		VALUES (${GISE}, '2026-02-01', 'em_andamento', '08:00', '16:00');
		INSERT INTO gise_seccionais (id, gise_id, seccional_id, status)
		VALUES (${SEC}, ${GISE}, ${POL}, 'preenchida');
		INSERT INTO gise_equipes (id, gise_seccional_id, tipo, slots_dpc, slots_oip)
		VALUES (${EQ}, ${SEC}, 'operacional', 1, 1);
	`);
});

const vinculos = () => vinculosAssinadosDoPolicial(db, POL);

describe('cadastro sem documento nenhum', () => {
	it('não tem impedimento — o erro de digitação continua podendo sumir', async () => {
		const v = await vinculos();
		expect(v).toEqual({
			termosPresenca: 0,
			relatoriosAssinados: 0,
			escalasAssinadas: 0,
			gisesAssinadas: 0
		});
		expect(motivoParaNaoExcluir(v)).toBeNull();
	});

	it('estar escalado numa escala NÃO assinada também não impede', async () => {
		// A linha divide por documento, não por participação: escala em montagem
		// pode perder um participante sem consequência documental.
		sqlite.exec(
			`INSERT INTO escala_policiais (escala_id, policial_id, data_plantao, horario, equipe)
			 VALUES (${ESCALA}, ${POL}, '2026-01-05', '08:00 às 20:00', '1')`
		);
		expect(motivoParaNaoExcluir(await vinculos())).toBeNull();
	});
});

describe('por AUTORIA — ele assinou', () => {
	it('termo de presença dele impede', async () => {
		sqlite.exec(
			`INSERT INTO gise_presenca_termos (gise_id, policial_id, tipo, assinante_nome, verification_hash, arquivo_hash)
			 VALUES (${GISE}, ${POL}, 'entrada', 'Fulano', 'H1', 'hash')`
		);
		const v = await vinculos();
		expect(v.termosPresenca).toBe(1);
		expect(motivoParaNaoExcluir(v)).toMatch(/termo\(s\) de presença/);
	});

	it('relatório de extra assinado por ele impede', async () => {
		sqlite.exec(
			`INSERT INTO gise_assinaturas_relatorios (gise_id, seccional_id, tipo, assinante_id, assinante_nome, tipo_assinatura, arquivo_hash, verification_hash)
			 VALUES (${GISE}, ${POL}, 'extraordinario', ${POL}, 'Fulano', 'simples', 'hash', 'H2')`
		);
		const v = await vinculos();
		expect(v.relatoriosAssinados).toBe(1);
		expect(motivoParaNaoExcluir(v)).toMatch(/relatório/);
	});
});

describe('por MENÇÃO — o documento o lista', () => {
	it('escala ASSINADA em que ele está escalado impede', async () => {
		// O caso mais comum, e o que um teste só de autoria deixaria passar: o
		// policial nunca assinou nada, mas o PDF assinado da escala traz o nome
		// dele na composição.
		sqlite.exec(`
			INSERT INTO escala_policiais (escala_id, policial_id, data_plantao, horario, equipe)
			VALUES (${ESCALA}, ${POL}, '2026-01-05', '08:00 às 20:00', '1');
			INSERT INTO escala_documentos (escala_id, r2_key, assinante_nome, arquivo_hash)
			VALUES (${ESCALA}, 'esc.pdf', 'Outro Policial', 'hash');
		`);
		const v = await vinculos();
		expect(v.escalasAssinadas).toBe(1);
		expect(motivoParaNaoExcluir(v)).toMatch(/escala\(s\) assinada\(s\)/);
	});

	it('GISE ASSINADA de que ele é membro impede', async () => {
		sqlite.exec(`
			INSERT INTO gise_membros (equipe_id, policial_id) VALUES (${EQ}, ${POL});
			INSERT INTO gise_documentos (gise_id, r2_key, assinante_nome, assinante_cpf, verificacao_hash)
			VALUES (${GISE}, 'gise.pdf', 'Supervisor', 'x', 'H3');
		`);
		const v = await vinculos();
		expect(v.gisesAssinadas).toBe(1);
		expect(motivoParaNaoExcluir(v)).toMatch(/GISE\(s\) assinada\(s\)/);
	});

	it('ser membro de GISE SEM documento não impede', async () => {
		sqlite.exec(`INSERT INTO gise_membros (equipe_id, policial_id) VALUES (${EQ}, ${POL})`);
		expect(motivoParaNaoExcluir(await vinculos())).toBeNull();
	});
});

describe('a mensagem', () => {
	it('nomeia TODOS os vínculos, não só o primeiro', async () => {
		// Quem lê precisa decidir entre apagar e desativar. "Não pode" sem dizer o
		// que está preservando não é informação suficiente para essa escolha.
		const msg = motivoParaNaoExcluir({
			termosPresenca: 2,
			relatoriosAssinados: 1,
			escalasAssinadas: 3,
			gisesAssinadas: 0
		});
		expect(msg).toContain('2 termo(s) de presença');
		expect(msg).toContain('1 relatório(s) de extra assinado(s)');
		expect(msg).toContain('3 escala(s) assinada(s)');
		expect(msg).not.toContain('GISE(s)');
		expect(msg, 'a saída existe e precisa estar na mensagem').toMatch(/desvinculação/i);
	});
});
