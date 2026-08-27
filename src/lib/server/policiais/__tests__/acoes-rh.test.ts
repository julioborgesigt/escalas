/**
 * O executor único dos três atos de RH — a peça que garante que "aprovar um
 * pedido de movimentação" e "movimentar direto" produzam o MESMO resultado.
 *
 * Enquanto o efeito morava dentro das form actions da ficha, o caminho da
 * aprovação teria de reescrevê-lo. Estes testes são sobre isso: o que cada tipo
 * muda no cadastro (e o que NÃO muda), e o que a linha do tempo passa a
 * registrar — para os dois caminhos ao mesmo tempo, porque só existe um.
 *
 * Banco de verdade: a propriedade sob teste é o par cadastro + histórico, que um
 * fake do drizzle não observa.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { executarAcaoRH, type AcaoRH } from '../acoes-rh';

const POL = 96001;
/** Na aprovação, o ator é quem PEDIU — quem apurou o fato e anexou a portaria. */
const SOLICITANTE = { id: 96002, nome: 'Admin da Unidade' };

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

const cadastro = () =>
	sqlite.prepare(`SELECT lotacao, ativo FROM policiais WHERE id = ${POL}`).get() as {
		lotacao: string;
		ativo: number;
	};

const eventos = () =>
	sqlite
		.prepare(
			`SELECT tipo, unidade_origem, unidade_destino, subtipo, data_inicio, data_fim,
			        nup, documento_r2_key, registrado_por_id, registrado_por_nome
			 FROM policial_historico WHERE policial_id = ${POL} ORDER BY id`
		)
		.all() as Array<Record<string, unknown>>;

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha, ativo)
		VALUES (${POL}, 'M96001', 'Servidor Alvo', 'OIP', 'DEL A', 'h', 1);
	`);
});

describe('executarAcaoRH', () => {
	it('movimentação troca a lotação e grava a portaria na linha do tempo', async () => {
		const acao: AcaoRH = {
			tipo: 'movimentacao',
			unidade_origem: 'DEL A',
			unidade_destino: 'DEL B',
			data_evento: '2026-09-01',
			nup: '00000.000123/2026-01',
			documento_r2_key: 'policial-historico/96001/portaria.pdf',
			documento_nome: 'portaria.pdf'
		};

		await executarAcaoRH(db, POL, acao, SOLICITANTE);

		expect(cadastro().lotacao).toBe('DEL B');
		const [ev] = eventos();
		expect(ev.tipo).toBe('movimentacao');
		expect(ev.unidade_origem).toBe('DEL A');
		expect(ev.unidade_destino).toBe('DEL B');
		expect(ev.nup).toBe('00000.000123/2026-01');
		expect(ev.documento_r2_key).toBe('policial-historico/96001/portaria.pdf');
	});

	/**
	 * Afastado continua ativo e escalável: quem responde "está fora hoje?" é
	 * `afastamentoVigente`, lendo a linha do tempo — não uma coluna do cadastro.
	 */
	it('afastamento NÃO altera o cadastro, só registra', async () => {
		await executarAcaoRH(
			db,
			POL,
			{
				tipo: 'afastamento',
				subtipo: 'ferias',
				data_inicio: '2026-09-01',
				data_fim: '2026-09-30',
				qtd_dias: 30
			},
			SOLICITANTE
		);

		expect(cadastro()).toEqual({ lotacao: 'DEL A', ativo: 1 });
		const [ev] = eventos();
		expect(ev.tipo).toBe('afastamento');
		expect(ev.subtipo).toBe('ferias');
		expect(ev.data_inicio).toBe('2026-09-01');
		expect(ev.data_fim).toBe('2026-09-30');
	});

	it('desvinculação inativa o cadastro, sem apagar a pessoa', async () => {
		await executarAcaoRH(
			db,
			POL,
			{
				tipo: 'desvinculacao',
				descricao: 'Aposentadoria',
				unidade_origem: 'DEL A',
				unidade_destino: 'Aposentadoria',
				data_evento: '2026-09-15'
			},
			SOLICITANTE
		);

		const linha = cadastro();
		expect(linha.ativo).toBe(0);
		// A lotação permanece: o histórico de escalas continua apontando para ela.
		expect(linha.lotacao).toBe('DEL A');
		expect(eventos()[0].tipo).toBe('desvinculacao');
	});

	/**
	 * O ator vai para `registrado_por_*`. Na aprovação de um pedido é o
	 * SOLICITANTE, não o Admin Geral que aprovou: foi ele quem levantou o fato, e
	 * a autorização fica na trilha de auditoria. Trocar os dois faria a ficha
	 * atribuir ao aprovador um ato que ele não levantou.
	 */
	it('credita a linha do tempo a quem a função recebe como ator', async () => {
		await executarAcaoRH(
			db,
			POL,
			{ tipo: 'movimentacao', unidade_origem: 'DEL A', unidade_destino: 'DEL B' },
			SOLICITANTE
		);

		const [ev] = eventos();
		expect(ev.registrado_por_id).toBe(SOLICITANTE.id);
		expect(ev.registrado_por_nome).toBe('Admin da Unidade');
	});
});
