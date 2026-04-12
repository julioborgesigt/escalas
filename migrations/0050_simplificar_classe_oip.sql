-- Converte classes de OIP do formato 'X - Y' para apenas 'X' (A, B, C ou D)
-- Ex: 'D - I' -> 'D', 'C - III' -> 'C', 'B - VII' -> 'B', 'A - IV' -> 'A'
UPDATE policiais
SET classe = SUBSTR(classe, 1, 1)
WHERE cargo = 'OIP'
  AND classe LIKE '_ - %';
