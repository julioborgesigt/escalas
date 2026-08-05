/**
 * A revogação de assinaturas atinge a seccional CERTA — FLW-GISE-011.
 *
 * `revogarAssinaturasSeccional` recebia um parâmetro `seccionalId` e o usava
 * como `unidades.id`. As sete chamadas passavam o id da linha
 * `gise_seccionais` — a participação da seccional NAQUELA escala. Dois
 * inteiros, o mesmo nome, espaços de id que se sobrepõem.
 *
 * O efeito não era um erro: era um SILÊNCIO. Os passos que dependem do
 * parâmetro (relatórios assinados, presenças dos membros) não achavam nada, ou
 * achavam a seccional errada quando algum `unidades.id` coincidia com o id da
 * participação. Os passos que NÃO dependem dele — apagar o documento
 * consolidado e devolver a escala a `em_preenchimento` — sempre rodaram. Como
 * é justamente esse o efeito que aparece na tela, o bug atravessou toda a
 * auditoria de fluxos sem ser notado: mudava-se a composição, a escala voltava
 * para preenchimento, e o relatório de extra continuava assinado com o conteúdo
 * antigo.
 *
 * Os dois primeiros casos abaixo passam com o código anterior. O terceiro e o
 * quarto são os que não passam — e o quarto é o pior dos dois: revogar a
 * seccional de outra pessoa.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { revogarAssinaturasSeccional } from '../seccionais';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

const GISE = 92001;
/** ids das UNIDADES seccionais. */
const UNID_A = 92101;
const UNID_B = 92102;
/** ids das PARTICIPAÇÕES (`gise_seccionais`), escolhidos para colidir com A/B. */
const PART_A = 92102;
const PART_B = 92101;

const assinaturas = () =>
	sqlite
		.prepare('SELECT seccional_id FROM gise_assinaturas_relatorios ORDER BY seccional_id')
		.all() as { seccional_id: number }[];
const presencas = () =>
	sqlite.prepare('SELECT policial_id FROM gise_presencas ORDER BY policial_id').all() as {
		policial_id: number;
	}[];
const documentos = () =>
	(
		sqlite.prepare(`SELECT COUNT(*) AS n FROM gise_documentos WHERE gise_id = ${GISE}`).get() as {
			n: number;
		}
	).n;

/**
 * Duas seccionais na mesma GISE, cada uma com relatório assinado e um policial
 * com presença registrada.
 *
 * Os ids de participação são trocados de propósito (PART_A = UNID_B): é a
 * colisão que transforma o bug de "não revoga" em "revoga a errada", e ela
 * acontece sozinha em produção, porque as duas tabelas têm autoincrement
 * próprio sobre a mesma faixa de números.
 */
function semear() {
	sqlite.exec(`
		INSERT INTO unidades (id, nome, tipo) VALUES
			(${UNID_A}, 'SECCIONAL A', 'seccional'),
			(${UNID_B}, 'SECCIONAL B', 'seccional');

		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha) VALUES
			(92201, 'M92201', 'Policial A', 'OIP', 'SECCIONAL A', 'h'),
			(92202, 'M92202', 'Policial B', 'OIP', 'SECCIONAL B', 'h');

		INSERT INTO gise_escalas (id, data_inicio, status)
		VALUES (${GISE}, '2026-08-10', 'em_andamento');

		INSERT INTO gise_seccionais (id, gise_id, seccional_id, status) VALUES
			(${PART_A}, ${GISE}, ${UNID_A}, 'preenchida'),
			(${PART_B}, ${GISE}, ${UNID_B}, 'preenchida');

		INSERT INTO gise_equipes (id, gise_seccional_id, tipo) VALUES
			(92301, ${PART_A}, 'operacional'),
			(92302, ${PART_B}, 'operacional');

		INSERT INTO gise_membros (equipe_id, policial_id) VALUES
			(92301, 92201),
			(92302, 92202);

		INSERT INTO gise_presencas (gise_id, policial_id, entrada_timestamp) VALUES
			(${GISE}, 92201, '2026-08-10 08:00:00'),
			(${GISE}, 92202, '2026-08-10 08:00:00');

		INSERT INTO gise_assinaturas_relatorios
			(gise_id, seccional_id, tipo, tipo_assinatura, assinante_nome, verification_hash, r2_key)
		VALUES
			(${GISE}, ${UNID_A}, 'extraordinario', 'simples', 'Supervisor A', 'hA', 'kA'),
			(${GISE}, ${UNID_B}, 'extraordinario', 'simples', 'Supervisor B', 'hB', 'kB');

		INSERT INTO gise_documentos (gise_id, r2_key, verificacao_hash)
		VALUES (${GISE}, 'gise/${GISE}.pdf', 'hash-doc');
	`);
}

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	semear();
});

describe('o que sempre funcionou — e por isso escondia o resto', () => {
	it('o documento consolidado da escala cai', async () => {
		await revogarAssinaturasSeccional(db, GISE, PART_A);
		expect(documentos()).toBe(0);
	});

	it('a escala volta para preenchimento', async () => {
		await revogarAssinaturasSeccional(db, GISE, PART_A);
		const gise = sqlite.prepare(`SELECT status FROM gise_escalas WHERE id = ${GISE}`).get() as {
			status: string;
		};
		expect(gise.status).toBe('em_preenchimento');
	});
});

describe('o que não funcionava', () => {
	it('o relatório assinado DA seccional alterada é revogado', async () => {
		await revogarAssinaturasSeccional(db, GISE, PART_A);
		expect(
			assinaturas().map((a) => a.seccional_id),
			'sobra só a seccional B, que ninguém mexeu'
		).toEqual([UNID_B]);
	});

	it('as presenças dos membros DELA são revogadas', async () => {
		await revogarAssinaturasSeccional(db, GISE, PART_A);
		expect(presencas().map((p) => p.policial_id)).toEqual([92202]);
	});

	it('a seccional de outra participação não é tocada', async () => {
		// Com o parâmetro tratado como `unidades.id`, `PART_A` (= 92102 = UNID_B)
		// apagava a assinatura da seccional B enquanto a A, alterada, seguia
		// assinada — o oposto exato do que a função existe para fazer.
		await revogarAssinaturasSeccional(db, GISE, PART_A);
		const restantes = assinaturas().map((a) => a.seccional_id);
		expect(restantes, 'B não podia ter caído').toContain(UNID_B);
		expect(restantes, 'A tinha de ter caído').not.toContain(UNID_A);
	});

	it('participação inexistente não revoga assinatura de ninguém', async () => {
		await revogarAssinaturasSeccional(db, GISE, 99999);
		expect(assinaturas()).toHaveLength(2);
		expect(presencas()).toHaveLength(2);
	});

	it('participação de OUTRA GISE não revoga nada desta', async () => {
		sqlite.exec(`
			INSERT INTO gise_escalas (id, data_inicio, status)
			VALUES (92002, '2026-08-20', 'em_andamento');
			INSERT INTO gise_seccionais (id, gise_id, seccional_id, status)
			VALUES (92999, 92002, ${UNID_A}, 'preenchida');
		`);
		await revogarAssinaturasSeccional(db, GISE, 92999);
		expect(assinaturas(), 'a seccional A desta GISE não é a daquela').toHaveLength(2);
	});
});
