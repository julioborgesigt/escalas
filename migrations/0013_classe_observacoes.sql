-- Adiciona campo classe aos policiais (classe de carreira: Especial, A I, B II, C III, etc.)
ALTER TABLE policiais ADD COLUMN classe TEXT NOT NULL DEFAULT '';
-- Adiciona campo observacoes por policial em cada escala (férias, licenças, etc.)
ALTER TABLE escala_policiais ADD COLUMN observacoes TEXT NOT NULL DEFAULT '';
