-- Calendário de FERIADOS NACIONAIS, 2026–2030.
--
-- Gerado por `node scripts/gerar-feriados.mjs` — não edite à mão; o cabeçalho
-- do script explica o que entra, o que fica de fora e por quê. Em resumo: os
-- feriados por lei federal mais a Sexta-feira da Paixão; Carnaval e Corpus
-- Christi NÃO (ponto facultativo é declaração manual no pedido); feriado
-- estadual do Ceará fora por decisão de 10/09/2026.
--
-- Serve ao módulo de diárias: viagem em feriado conta como fim de semana no
-- Decreto nº 35.922/2024 e exige justificativa no pedido. O calendário SUGERE;
-- o solicitante confirma e o analista pode negar.
--
-- `uf` é '' quando nacional (mesma convenção de `unidades.sigla`: vazio é
-- "não tem"), o que deixa a chave primária composta funcionar — NULL não casa
-- consigo mesmo num UNIQUE. `abrangencia` é vocabulário aberto, sem CHECK.
CREATE TABLE IF NOT EXISTS `feriados` (
	`data` text NOT NULL,
	`abrangencia` text DEFAULT 'nacional' NOT NULL,
	`uf` text DEFAULT '' NOT NULL,
	`descricao` text NOT NULL,
	`fonte` text NOT NULL,
	PRIMARY KEY (`data`, `abrangencia`, `uf`)
);--> statement-breakpoint
-- 50 linhas: 9 datas fixas + Sexta-feira da Paixão, por ano.
INSERT OR IGNORE INTO `feriados` (`data`, `abrangencia`, `uf`, `descricao`, `fonte`) VALUES
	('2026-01-01', 'nacional', '', 'Confraternização Universal', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2026-04-03', 'nacional', '', 'Sexta-feira da Paixão', 'Lei nº 9.093/1995, art. 2º (feriado religioso); consta como feriado no calendário anual do Governo Federal e do Estado do Ceará'),
	('2026-04-21', 'nacional', '', 'Tiradentes', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2026-05-01', 'nacional', '', 'Dia Mundial do Trabalho', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2026-09-07', 'nacional', '', 'Independência do Brasil', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2026-10-12', 'nacional', '', 'Nossa Senhora Aparecida', 'Lei nº 6.802/1980'),
	('2026-11-02', 'nacional', '', 'Finados', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2026-11-15', 'nacional', '', 'Proclamação da República', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2026-11-20', 'nacional', '', 'Dia Nacional de Zumbi e da Consciência Negra', 'Lei nº 14.759/2023'),
	('2026-12-25', 'nacional', '', 'Natal', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2027-01-01', 'nacional', '', 'Confraternização Universal', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2027-03-26', 'nacional', '', 'Sexta-feira da Paixão', 'Lei nº 9.093/1995, art. 2º (feriado religioso); consta como feriado no calendário anual do Governo Federal e do Estado do Ceará'),
	('2027-04-21', 'nacional', '', 'Tiradentes', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2027-05-01', 'nacional', '', 'Dia Mundial do Trabalho', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2027-09-07', 'nacional', '', 'Independência do Brasil', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2027-10-12', 'nacional', '', 'Nossa Senhora Aparecida', 'Lei nº 6.802/1980'),
	('2027-11-02', 'nacional', '', 'Finados', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2027-11-15', 'nacional', '', 'Proclamação da República', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2027-11-20', 'nacional', '', 'Dia Nacional de Zumbi e da Consciência Negra', 'Lei nº 14.759/2023'),
	('2027-12-25', 'nacional', '', 'Natal', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2028-01-01', 'nacional', '', 'Confraternização Universal', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2028-04-14', 'nacional', '', 'Sexta-feira da Paixão', 'Lei nº 9.093/1995, art. 2º (feriado religioso); consta como feriado no calendário anual do Governo Federal e do Estado do Ceará'),
	('2028-04-21', 'nacional', '', 'Tiradentes', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2028-05-01', 'nacional', '', 'Dia Mundial do Trabalho', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2028-09-07', 'nacional', '', 'Independência do Brasil', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2028-10-12', 'nacional', '', 'Nossa Senhora Aparecida', 'Lei nº 6.802/1980'),
	('2028-11-02', 'nacional', '', 'Finados', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2028-11-15', 'nacional', '', 'Proclamação da República', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2028-11-20', 'nacional', '', 'Dia Nacional de Zumbi e da Consciência Negra', 'Lei nº 14.759/2023'),
	('2028-12-25', 'nacional', '', 'Natal', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2029-01-01', 'nacional', '', 'Confraternização Universal', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2029-03-30', 'nacional', '', 'Sexta-feira da Paixão', 'Lei nº 9.093/1995, art. 2º (feriado religioso); consta como feriado no calendário anual do Governo Federal e do Estado do Ceará'),
	('2029-04-21', 'nacional', '', 'Tiradentes', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2029-05-01', 'nacional', '', 'Dia Mundial do Trabalho', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2029-09-07', 'nacional', '', 'Independência do Brasil', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2029-10-12', 'nacional', '', 'Nossa Senhora Aparecida', 'Lei nº 6.802/1980'),
	('2029-11-02', 'nacional', '', 'Finados', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2029-11-15', 'nacional', '', 'Proclamação da República', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2029-11-20', 'nacional', '', 'Dia Nacional de Zumbi e da Consciência Negra', 'Lei nº 14.759/2023'),
	('2029-12-25', 'nacional', '', 'Natal', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2030-01-01', 'nacional', '', 'Confraternização Universal', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2030-04-19', 'nacional', '', 'Sexta-feira da Paixão', 'Lei nº 9.093/1995, art. 2º (feriado religioso); consta como feriado no calendário anual do Governo Federal e do Estado do Ceará'),
	('2030-04-21', 'nacional', '', 'Tiradentes', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2030-05-01', 'nacional', '', 'Dia Mundial do Trabalho', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2030-09-07', 'nacional', '', 'Independência do Brasil', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2030-10-12', 'nacional', '', 'Nossa Senhora Aparecida', 'Lei nº 6.802/1980'),
	('2030-11-02', 'nacional', '', 'Finados', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2030-11-15', 'nacional', '', 'Proclamação da República', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'),
	('2030-11-20', 'nacional', '', 'Dia Nacional de Zumbi e da Consciência Negra', 'Lei nº 14.759/2023'),
	('2030-12-25', 'nacional', '', 'Natal', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)');
