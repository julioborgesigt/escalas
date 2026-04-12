-- Converte policiais com regime 'ambos' para 'plantao'
UPDATE policiais SET regime = 'plantao' WHERE regime = 'ambos';
