-- Vincula assinaturas de relatório extraordinário do quadro de supervisão GISE
-- à unidade real "Departamento de Polícia do Interior Sul" (tipo departamento),
-- em vez da unidade sintética legada "__GISE_SUPERVISAO_EXTRA__".

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
	)
	AND EXISTS (
		SELECT 1
		FROM unidades u3
		WHERE u3.nome = 'Departamento de Polícia do Interior Sul'
			AND u3.tipo = 'departamento'
	);
