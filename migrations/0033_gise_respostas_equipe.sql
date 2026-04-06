-- Adicionar equipe_id em gise_respostas_formulario e ajustar restrições para uma resposta por equipe
ALTER TABLE gise_respostas_formulario ADD COLUMN equipe_id INTEGER REFERENCES gise_equipes(id) ON DELETE CASCADE;

-- Atualizar equipe_id nas respostas existentes (baseado na equipe do policial na época da escala)
UPDATE gise_respostas_formulario 
SET equipe_id = (
    SELECT m.equipe_id 
    FROM gise_membros m
    JOIN gise_equipes e ON m.equipe_id = e.id
    JOIN gise_seccionais s ON e.gise_seccional_id = s.id
    WHERE m.policial_id = gise_respostas_formulario.policial_id
      AND s.gise_id = gise_respostas_formulario.gise_id
    LIMIT 1
);

-- Nota: Como SQLite não suporta alterar restrições UNIQUE em tabelas existentes sem recriar, 
-- deixaremos o índice antigo mas usaremos a lógica de código para garantir 1 por equipe.
-- Em produção, uma nova migração com recriação de tabela seria o ideal, 
-- mas adicionar a coluna já resolve o problema de busca/filtragem.
