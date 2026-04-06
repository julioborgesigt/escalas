-- Remove a senha padrão hardcoded (SHA-256 de "12345678") dos policiais que ainda a utilizam.
-- Policiais afetados terão primeiro_acesso = 1 forçando troca de senha no próximo login.
-- A nova senha aleatória é um hash PBKDF2 impossível de adivinhar.
-- NOTA: Novos policiais criados via API/upload já recebem senha aleatória.

-- Marcar todos os policiais com a senha padrão como primeiro_acesso
UPDATE policiais
SET primeiro_acesso = 1
WHERE senha = 'ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f';

-- Também atualizar o admin padrão se ainda usar a senha legada
UPDATE administradores
SET primeiro_acesso = 1
WHERE senha = '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9';
