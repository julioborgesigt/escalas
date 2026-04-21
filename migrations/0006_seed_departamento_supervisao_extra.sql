-- Garante o departamento pai usado pelo relatório extraordinário do quadro de supervisão GISE.
-- Necessário para bases remotas que receberam a hierarquia nova no código, mas ainda não
-- sincronizaram a unidade raiz via webhook/sheet.

INSERT OR IGNORE INTO "unidades" (
	"nome",
	"tipo",
	"seccional_id",
	"cidade",
	"tem_plantao",
	"tem_expediente",
	"tem_fds"
)
VALUES (
	'Departamento de Polícia do Interior Sul',
	'departamento',
	NULL,
	'',
	1,
	1,
	1
);

-- Se ainda existirem assinaturas extraordinárias antigas apontando para a unidade sintética,
-- remapeia para o departamento pai recém-garantido.
UPDATE gise_assinaturas_relatorios
SET seccional_id = (
	SELECT u.id
	FROM unidades u
	WHERE u.nome = 'Departamento de Polícia do Interior Sul'
		AND u.tipo = 'departamento'
	LIMIT 1
)
WHERE tipo = 'extraordinario'
	AND seccional_id = (
		SELECT u2.id
		FROM unidades u2
		WHERE u2.nome = '__GISE_SUPERVISAO_EXTRA__'
		LIMIT 1
	);
