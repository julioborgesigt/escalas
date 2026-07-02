> 📌 **Registro histórico (mai/2026).** Os achados abaixo refletem o estado do sistema na data da auditoria. A maior parte foi remediada nas semanas seguintes (plano em [`LGPD_REMEDIATION_PLAN.md`](LGPD_REMEDIATION_PLAN.md)); a auditoria geral de [28/jun/2026](AUDITORIA_GERAL_2026-06-28.md) reavaliou a dimensão LGPD como "excepcional" (CPF cifrado, IPs anonimizados, retenção automatizada). Não use este documento como estado atual.

# Relatório de Auditoria de Conformidade LGPD

## Sistema de Gestão de Escalas — Polícia Civil do Estado do Ceará (PCCE)

**Data:** 15 de maio de 2026  
**Stack:** SvelteKit 2 + TypeScript + Cloudflare D1/R2/Pages  
**Base legal analisada:** Lei 13.709/2018 (LGPD), Lei 14.063/2020, Decreto 10.748/2021  
**Conformidade estimada atual:** ~45%

---

## Resumo Executivo

O sistema processa dados pessoais de aproximadamente 6.900 policiais civis, incluindo nome completo, CPF, email, telefone, geolocalização e dados biométricos (selfie/rubrica). A auditoria identificou **4 vulnerabilidades CRÍTICAS**, **11 de nível ALTO** e **7 de nível MÉDIO**.

Os pontos mais graves são: (1) dump.sql com dados reais de pessoas versionado no repositório; (2) CPF exposto publicamente via endpoint `/validar/[hash]`; (3) senha padrão hardcoded em script de produção; (4) ausência total de direitos dos titulares implementados.

O projeto demonstra boa intenção de conformidade — Termo de Uso sólido, consentimento implementado, auditoria funcional — mas a **implementação técnica está incompleta** nas dimensões mais críticas.

---

## Índice

1. [Mapa de Dados Pessoais](#1-mapa-de-dados-pessoais)
2. [Vulnerabilidades CRÍTICAS](#2-vulnerabilidades-críticas)
3. [Vulnerabilidades ALTAS](#3-vulnerabilidades-altas)
4. [Vulnerabilidades MÉDIAS](#4-vulnerabilidades-médias)
5. [Achados Positivos](#5-achados-positivos)
6. [Direitos dos Titulares — Status](#6-direitos-dos-titulares--status)
7. [Transferências e Integrações Externas](#7-transferências-e-integrações-externas)
8. [Matriz de Conformidade por Artigo LGPD](#8-matriz-de-conformidade-por-artigo-lgpd)
9. [Cronograma de Remediação](#9-cronograma-de-remediação)
10. [Checklist Executivo](#10-checklist-executivo)

---

## 1. Mapa de Dados Pessoais

### 1.1 Dados Coletados

| Dado                                      | Categoria LGPD                                      | Tabelas                                                                         | Criptografado?                                                        | Base Legal                                                                                                |
| ----------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Nome completo                             | Comum                                               | policiais, audit_log, escala_documentos, gise_documentos                        | Não                                                                   | Consentimento (art. 7º, V)                                                                                |
| CPF                                       | Comum (identificador único)                         | policiais, escala_documentos, gise_documentos, gise_assinaturas_relatorios      | **Não**                                                               | Consentimento (art. 7º, V)                                                                                |
| Matrícula funcional                       | Comum                                               | policiais                                                                       | Não                                                                   | Contrato/Obrigação legal                                                                                  |
| E-mail corporativo                        | Comum                                               | policiais, administradores, gise_escalas                                        | Não                                                                   | Consentimento                                                                                             |
| E-mail pessoal                            | Comum                                               | policiais, administradores                                                      | Não                                                                   | **Sem base legal documentada**                                                                            |
| Telefone                                  | Comum                                               | policiais                                                                       | Não                                                                   | **Sem base legal documentada**                                                                            |
| Cargo/Classe/Regime                       | Comum                                               | policiais                                                                       | Não                                                                   | Contrato/Obrigação legal                                                                                  |
| Lotação                                   | Comum                                               | policiais, escalas                                                              | Não                                                                   | Contrato                                                                                                  |
| Endereço IP                               | Dados de localização                                | login_attempts, escala_documentos, gise_presencas, aceites_termos               | **Não** (exceto audit_log)                                            | Implícito em auditoria                                                                                    |
| Geolocalização (lat/lng)                  | Dados de localização                                | escala_documentos, gise_documentos, gise_presencas, gise_assinaturas_relatorios | Não                                                                   | Consentimento explícito                                                                                   |
| Selfie / Rubrica                          | **Biométrico**                                      | R2 (Cloudflare) via chave                                                       | Não documentado                                                       | Consentimento explícito                                                                                   |
| Rubrica reutilizável (assinatura gráfica) | **Biométrico comportamental** (grafo de assinatura) | policiais (`rubrica`)                                                           | PNG transparente sem EXIF; em repouso no D1                           | **Consentimento específico (art. 8º)** — registrado em `rubrica_consentimento_em`; excluível pelo titular |
| Termo de presença qualificado (Token A3)  | Comum + localização                                 | gise_presenca_termos                                                            | CPF **cifrado**, IP **anonimizado**, GPS 2 casas (~1 km), UA resumido | Exercício regular de direito / obrigação legal (art. 7º) + assinatura qualificada ICP-Brasil              |
| User-Agent                                | Identificação de dispositivo                        | audit_log, aceites_termos, escala_documentos                                    | Não                                                                   | Implícito — sem finalidade declarada                                                                      |
| Data/hora de acesso                       | Comum                                               | Todas as tabelas de auditoria                                                   | Não                                                                   | Auditoria                                                                                                 |

### 1.2 Dados Sensíveis (Art. 5º, II)

Não foram identificados dados sensíveis em sentido estrito (saúde, religião, origem racial, etc.).

A **selfie** é dado biométrico, mas enquadrada na Lei 14.063/2020 como componente de autenticação avançada — base defensável. Recomenda-se documentação explícita no Termo.

A **rubrica reutilizável** (cadastro do policial para assinatura por Token A3 no desktop) é um grafo de assinatura — dado biométrico comportamental. Diferentemente da selfie/rubrica de ato, ela é **persistida e reutilizada**, o que constitui finalidade própria e exige **consentimento específico** (art. 8º), implementado com aceite destacado e **direito de exclusão** pelo titular (ver Adendo 2026-06-25).

### 1.3 Dados de Crianças e Adolescentes (Art. 14)

Não há campo `data_nascimento` nem validação de maioridade. Embora improvável na prática (cargo policial exige 18+), a ausência de controle e documentação é não-conformidade formal.

---

## 2. Vulnerabilidades CRÍTICAS

### C1 — dump.sql com dados reais de pessoas no repositório

**Arquivos:** `/home/user/escalas/dump.sql`  
**Artigos LGPD:** Art. 46 (segurança), Art. 48 (notificação de incidentes)

O arquivo `dump.sql` está presente no repositório e contém dados pessoais reais de policiais em texto plano:

```sql
INSERT INTO "policiais" VALUES(6837,'FRANCISCO DIEGO SARMENTO DA SILVA','30014405',...,'00646139339',...);
INSERT INTO "policiais" VALUES(6839,'VANIO DA SILVA FAÇANHA','30000811','(85) 989752742','73444502320',...);
```

Dados expostos: nome completo, CPF, telefone, email, matrícula, lotação de todos os policiais.

**Ação imediata:**

1. Adicionar ao `.gitignore`:
   ```
   dump.sql
   *.backup
   backup/
   ```
2. Remover o arquivo do histórico do Git:
   ```bash
   git filter-branch --tree-filter 'rm -f dump.sql' -- --all
   git push origin --force --all
   ```
3. Criar script de sanitização para uso em desenvolvimento:
   ```bash
   # scripts/sanitize-dump.sh
   sed -i "s/'[0-9]\{11\}'/'***.***.***-**'/g" dump.sql
   sed -i "s/'(85) [0-9 -]\{10,14\}'/'(XX) XXXXX-XXXX'/g" dump.sql
   ```

---

### C2 — CPF exposto publicamente em `/validar/[hash]`

**Arquivo:** `src/routes/validar/[hash]/+page.server.ts` (linhas 172–182)  
**Artigos LGPD:** Art. 9º (dados pessoais sensíveis/identificadores), Art. 32 (segurança)

O endpoint de validação pública de documentos retorna CPF completo, IP, user-agent e coordenadas geográficas precisas para qualquer pessoa que possua o hash (impresso no QR code do documento):

```typescript
return {
	encontrado: true,
	documento: {
		assinante_nome: documento.assinante_nome,
		assinante_cpf: documento.assinante_cpf, // ← CPF COMPLETO EXPOSTO
		ip_address: documento.ip_address, // ← IP EXPOSTO
		user_agent: documento.user_agent, // ← FINGERPRINT EXPOSTO
		latitude: documento.latitude, // ← LOCALIZAÇÃO PRECISA
		longitude: documento.longitude
	}
};
```

A combinação CPF + lat/lng + timestamp + user-agent permite reidentificação e rastreamento individual sem qualquer autenticação.

**Correção:**

```typescript
return {
	encontrado: true,
	documento: {
		assinante_nome: documento.assinante_nome,
		// Mascarar CPF: apenas 3 primeiros + 2 últimos dígitos
		assinante_cpf: documento.assinante_cpf
			? `${documento.assinante_cpf.slice(0, 3)}.***.***-${documento.assinante_cpf.slice(-2)}`
			: null,
		// Remover campos de rastreamento
		latitude: null,
		longitude: null,
		ip_address: null,
		user_agent: null,
		// Manter apenas metadados de certificado
		cert_issuer: documento.cert_issuer,
		cert_valido_ate: documento.cert_valido_ate,
		tipo_assinatura: documento.tipo_doc,
		created_at: documento.created_at
	}
};
```

---

### C3 — Senha padrão hardcoded em script de produção

**Arquivo:** `scripts/set-default-password-all-users.ts` (linha 14)  
**Artigos LGPD:** Art. 46 (medidas de segurança)

```typescript
const DEFAULT_PASSWORD = 'J1a2b3cd4j';
// ...
console.log(`Senha padrão aplicada: ${DEFAULT_PASSWORD}`); // ← Exposta em stdout/logs
```

A senha está em texto claro no código-fonte (versionada no Git), é impressa em stdout durante a execução (visível em logs de CI/CD) e é fraca (10 caracteres sem caracteres especiais).

**Ação imediata:**

1. Verificar se o script foi executado em produção recentemente
2. Rotacionar senhas de todos os usuários afetados
3. Corrigir o script:
   ```typescript
   // Gerar senha aleatória por execução, NÃO hardcoded
   import { gerarSenhaProvisoria } from '../src/lib/server/provisional-password';
   const senha = gerarSenhaProvisoria();
   // Nunca imprimir a senha em console — enviar por email seguro
   ```

---

### C4 — Credenciais de bootstrap contornam 2FA

**Arquivo:** `src/lib/server/auth-flow.ts` (linhas 167–212)  
**Artigos LGPD:** Art. 46 (medidas de segurança), OWASP A07:2021

As variáveis de ambiente `ADMIN_GERAL_LOGIN` e `ADMIN_GERAL_SENHA`, quando definidas, criam uma rota de login que pula completamente o segundo fator de autenticação:

```typescript
if (envLogin && envSenha && matricula === envLogin) {
	// AVISO: ignora 2FA
	const token = await criarSessao(db, 'admin', envAdmin.id);
	return { sucesso: true, token }; // ← sem desafio 2FA
}
```

Se essas credenciais estiverem ativas em produção e vazarem, o invasor acessa conta de admin sem qualquer proteção secundária.

**Ação imediata:**

1. **Remover** `ADMIN_GERAL_LOGIN` e `ADMIN_GERAL_SENHA` do ambiente de produção agora
2. Revisar logs de autenticação dos últimos 90 dias para logins via bootstrap
3. Se necessário manter o mecanismo, forçar 2FA mesmo para bootstrap

---

## 3. Vulnerabilidades ALTAS

### A1 — IP não anonimizado em 6 tabelas

**Arquivos:** `src/lib/db/audit.ts`, `src/lib/server/schema.ts`  
**Artigos LGPD:** Art. 6º (finalidade e necessidade), Art. 46

A função `anonimizarIp()` existe e está implementada corretamente em `audit.ts` (linha 122), mas é aplicada **apenas** na tabela `audit_log`. Em seis outras tabelas o IP completo é armazenado:

- `login_attempts` — IP completo
- `escala_documentos` — campo `ip_address`
- `gise_documentos` — campo `ip_address`
- `gise_presencas` — campo `ip_address`
- `gise_assinaturas_relatorios` — campo `ip_address`
- `aceites_termos` — campo `ip`

**Correção:** Exportar `anonimizarIp()` e aplicar em todos os pontos de inserção. Criar migração para sanitizar registros históricos:

```sql
-- migrations/0017_anonimizar_ips_historicos.sql
UPDATE login_attempts
  SET ip = SUBSTR(ip, 1, INSTR(ip, '.', INSTR(ip, '.') + 1) - 1) || '.0.0'
  WHERE ip IS NOT NULL AND ip NOT LIKE '%.0.0';

UPDATE escala_documentos
  SET ip_address = SUBSTR(ip_address, 1, INSTR(ip_address, '.', INSTR(ip_address, '.') + 1) - 1) || '.0.0'
  WHERE ip_address IS NOT NULL AND ip_address NOT LIKE '%.0.0';
-- Repetir para demais tabelas
```

---

### A2 — Ausência de política de retenção implementada

**Artigos LGPD:** Art. 16 (eliminação dos dados), Art. 5º, I (princípio da necessidade)

O Termo de Uso (seção 3.2) menciona retenção de 5 anos, mas nenhuma tabela possui limpeza automática. Os dados acumulam indefinidamente:

| Tabela                 | Dado sensível        | Retenção ideal                             |
| ---------------------- | -------------------- | ------------------------------------------ |
| `audit_log`            | nome, IP anonimizado | 2 anos                                     |
| `login_attempts`       | IP                   | 30–90 dias                                 |
| `dois_fatores_tokens`  | tokens expirados     | Limpeza imediata                           |
| `reset_senha_tokens`   | tokens usados        | 7 dias após uso                            |
| `escala_documentos`    | CPF, IP, lat/lng     | 5 anos (legal), CPF anonimizar após 2 anos |
| `policiais` (inativos) | todos os dados       | 5 anos após inatividade                    |

**Correção:** Criar tabela de política de retenção e job de limpeza noturno. Ver Recomendação 3 do Cronograma.

---

### A3 — Token de redefinição de senha exposto em URL

**Arquivo:** `src/routes/api/auth/confirmar-redefinicao/+server.ts` (linha 124)  
**Artigos LGPD:** Art. 46 (segurança), NIST SP 800-63B

```typescript
const token = await criarTokenRedefinicao(db, tipo, usuario.id);
const link = `${url.origin}/redefinir-senha?token=${token}`;
await enviarLinkRedefinicaoSenha(usuario.email, usuario.nome, link, platform);
```

Token sensível aparece em: URL (referer logs), histórico do browser, headers HTTP de email, logs de proxy/CDN.

**Correção:** Usar token opaco de referência (não o token real) na URL, validar via POST com CSRF:

```typescript
const resetId = gerarToken(); // Referência pública
await db.insert(resetRequests).values({ reset_id: resetId, usuario_id, expires_at });
const link = `${url.origin}/redefinir-senha?id=${resetId}`;
// O resetId sozinho não permite reset — requer POST com CSRF
```

---

### A4 — Senha provisória enviada em email

**Arquivo:** `src/routes/api/auth/primeiro-acesso/+server.ts` (linhas 65–71)  
**Artigos LGPD:** Art. 46 (segurança), OWASP

```typescript
const senhaProvisoria = gerarSenhaProvisoria();
await enviarSenhaProvisoria(policial.email, senhaProvisoria, policial.nome, platform);
```

Email não é canal seguro. A senha fica armazenada na caixa de entrada do usuário indefinidamente e pode ser interceptada em trânsito (SMTP sem TLS garantido).

**Correção:** Substituir senha provisória por link de configuração de senha (token de 1 uso, TTL 4 horas):

```typescript
const setupToken = gerarToken();
await db.insert(setupTokens).values({ token: setupToken, usuario_id: policial.id, expires_at });
const link = `${url.origin}/setup-senha?token=${setupToken}`;
await enviarLinkSetupSenha(policial.email, link, policial.nome, platform);
// O usuário CRIA sua senha — ela nunca trafega pelo email
```

---

### A5 — E-mail pessoal coletado sem finalidade documentada

**Arquivo:** `src/lib/server/schema.ts` (campo `email_pessoal`, `email_pessoal_verificado`)  
**Artigos LGPD:** Art. 6º (finalidade), Art. 7º (bases legais)

O campo `email_pessoal` existe na tabela `policiais` e no dump.sql confirma-se armazenamento de emails pessoais, porém não há uso claro no código nem base legal documentada para essa coleta.

**Ação:** Verificar se o campo é utilizado; se não for, removê-lo via migração. Se for necessário, documentar base legal explícita no Termo.

---

### A6 — Ausência de mecanismo de notificação de incidentes

**Artigos LGPD:** Art. 48 (comunicação de incidentes)

O art. 48 exige comunicação à ANPD e aos titulares em caso de incidente de segurança. O sistema não possui:

- Tabela/registro de incidentes
- Fluxo de notificação automática para titulares afetados
- Procedimento de comunicação à ANPD

**Ação:** Implementar tabela `brechas_dados` e endpoint de registro, com envio automático de email aos afetados.

---

### A7 — DPO identificado no Termo mas sem contato acessível

**Arquivo:** `src/lib/server/termo/termo-vigente.ts`  
**Artigos LGPD:** Art. 41 (encarregado de dados)

O Termo menciona "Encarregado de Dados (DPO) da PCCE" na seção 3.3, mas não fornece nome, email, telefone ou endereço para contato. Sem canais acessíveis, os titulares não conseguem exercer seus direitos do art. 18.

**Ação:** Adicionar ao Termo e criar página `/contato-dpo` com formulário e dados do encarregado.

---

### A8 — Webhooks sem assinatura HMAC do payload

**Arquivos:** `src/routes/api/webhook/sync-policiais/+server.ts`, `sync-unidades/+server.ts`  
**Artigos LGPD:** Art. 46 (integridade dos dados)

Os webhooks de sincronização usam apenas Bearer Token para autenticação, sem verificação de integridade do payload (HMAC-SHA256). Um payload interceptado e modificado pode injetar dados falsos de policiais.

**Correção:**

```typescript
const calculatedHmac = crypto.createHmac('sha256', SYNC_SECRET).update(rawBody).digest('hex');
if (!timingSafeEqual(Buffer.from(calculatedHmac), Buffer.from(hmacHeader))) {
	return json({ error: 'Assinatura inválida' }, { status: 401 });
}
```

---

### A9 — Gmail como operador de dados sem DPA

**Arquivo:** `src/lib/server/email.ts`  
**Artigos LGPD:** Art. 37 (contrato com operadores), Art. 33 (transferência internacional)

O sistema envia dados pessoais para `smtp.gmail.com:465` (Google LLC, EUA), incluindo: nome e email do policial, código 2FA, link com token de reset, documentos DOCX com dados de escalas.

O Google atua como **operador** desses dados sem Termo de Processamento de Dados (DPA) formalmente vinculado ao uso do sistema PCCE.

**Ação:**

1. Assinar o Google Workspace Data Processing Addendum (gratuito)
2. Avaliar alternativa: email institucional PCCE (servidor próprio) para eliminar transferência internacional
3. Para 2FA: migrar para TOTP (Google Authenticator/Authy) — elimina envio de código por email

---

### A10 — Sessões com duração de 12 horas sem re-autenticação

**Arquivo:** `src/lib/auth.ts` (linha 185)  
**Artigos LGPD:** Art. 46 (segurança)

```typescript
const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(); // 12 horas
```

NIST SP 800-63B recomenda 15–60 minutos para operações sensíveis. Uma sessão comprometida dá ao atacante 12 horas de acesso.

**Correção:** Reduzir TTL e implementar refresh token:

```typescript
const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hora
// Refresh token separado com TTL 24h em cookie HttpOnly
```

---

### A11 — Exportação de dados sem auditoria de acesso

**Arquivos:** `src/lib/server/export-pdf.ts`, `export-xlsx.ts`, `export-docx.ts`  
**Artigos LGPD:** Art. 32 (rastreabilidade)

Os exports de PDF/XLSX/DOCX contêm dados pessoais completos (nome, matrícula, telefone de todos os policiais) mas não registram em `audit_log` quem exportou, quando, e quantos registros.

**Correção:** Adicionar registro de auditoria em cada função de export:

```typescript
await registrarAuditComContexto(db, {
	usuario: locals.usuario,
	acao: 'exportar_dados',
	entidade: 'escala',
	entidade_id: escalaId,
	detalhes: `Export ${formato} — ${policiais.length} policiais`
});
```

---

## 4. Vulnerabilidades MÉDIAS

### M1 — Consentimento não granular (única flag para múltiplas finalidades)

**Arquivo:** `migrations/0013_termos_uso.sql` (campo `aceitou_lgpd`)  
**Artigos LGPD:** Art. 8º (consentimento específico e destacado)

Um único campo booleano `aceitou_lgpd` cobre: assinatura, auditoria por terceiros, coleta de localização e coleta de selfie. O consentimento deve ser específico por finalidade.

**Correção:** Separar em campos distintos e atualizar UI:

```sql
ALTER TABLE aceites_termos ADD COLUMN consentiu_assinatura INTEGER DEFAULT 0;
ALTER TABLE aceites_termos ADD COLUMN consentiu_auditoria INTEGER DEFAULT 0;
ALTER TABLE aceites_termos ADD COLUMN consentiu_localizacao INTEGER DEFAULT 0;
ALTER TABLE aceites_termos ADD COLUMN consentiu_biometria INTEGER DEFAULT 0;
```

---

### M2 — User-Agent completo armazenado (device fingerprinting)

**Artigos LGPD:** Art. 6º (necessidade), Art. 46

O User-Agent completo (ex: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36...`) permite fingerprinting de dispositivo. Combinado com IP e timestamp, é um rastreador individual.

**Correção:** Sumarizar antes de armazenar:

```typescript
function sumarizarUserAgent(ua: string): string {
	const match = ua.match(/(Chrome|Firefox|Safari|Edge)\/(\d+)/);
	return match ? `${match[1]}/${match[2]}` : 'Desconhecido';
}
```

---

### M3 — Tokens de 2FA armazenados em texto plano

**Arquivo:** `src/lib/server/schema.ts` (campo `codigo` em `dois_fatores_tokens`)  
**Artigos LGPD:** Art. 46 (segurança)

Códigos de 2FA armazenados sem hash. Se o banco for comprometido, todos os códigos ativos ficam expostos.

**Correção:** Armazenar apenas o hash:

```typescript
codigo: await bcrypt.hash(codigo, 10),
// Na verificação: await bcrypt.compare(codigoFornecido, desafio.codigo)
```

---

### M4 — Mascaramento de email insuficiente (revela domínio)

**Arquivo:** `src/lib/server/auth-flow.ts` (função `mascararEmail`, linhas 26–44)

A função mascara a parte local mas mantém o domínio completo:
`jo***@empresa.com.br` — combinado com nome do usuário, o email é trivialmente deduzível.

**Correção:** Retornar apenas confirmação genérica: `"Se este email estiver cadastrado, você receberá um código."` — sem revelar qualquer informação do endereço.

---

### M5 — Coordenadas geográficas de alta precisão em relatórios públicos

**Artigos LGPD:** Art. 6º (necessidade e proporcionalidade)

Coordenadas `lat/lng` com precisão de metros são armazenadas em `gise_presencas` e retornadas em alguns contextos. Para fins de auditoria de presença, a precisão de cidade/bairro seria suficiente.

**Ação:** Reduzir precisão ao inserir (manter apenas 2 casas decimais ≈ 1km de precisão) ou substituir por campo `municipio`.

---

### M6 — Falta de validação de maioridade

**Artigos LGPD:** Art. 14 (tratamento de dados de crianças)

Sem campo `data_nascimento` nem validação, o sistema pode cadastrar menores de 18 anos. Embora improvável, exige documentação explícita.

---

### M7 — Ausência de Relatório de Impacto (RIPD/DPIA)

**Artigos LGPD:** Art. 38 (relatório de impacto à proteção de dados)

Para tratamentos de alto risco (dados biométricos, geolocalização, dados de servidores públicos), a ANPD pode solicitar RIPD. Não há documentação de avaliação de riscos realizada.

---

## 5. Achados Positivos

O projeto demonstra maturidade técnica em várias áreas:

| Item                                            | Implementação                                                                       | Avaliação                                        |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------ |
| Hash de senhas                                  | PBKDF2 com 100.000 iterações + salt aleatório 16 bytes                              | Excelente                                        |
| Tokens criptográficos                           | `crypto.getRandomValues()` 256 bits                                                 | Correto                                          |
| Cookies de sessão                               | `httpOnly`, `sameSite=strict`, `secure`                                             | Correto                                          |
| CSRF                                            | Double-submit cookie + validação de header                                          | Implementado                                     |
| Headers HTTP                                    | CSP, HSTS com preload, X-Frame-Options: DENY                                        | Bom                                              |
| Comparações timing-safe                         | `timingSafeEqual()` em tokens e senhas                                              | Protege contra timing attacks                    |
| Rate limiting de login                          | 5 tentativas / 15 minutos por IP                                                    | Implementado                                     |
| Invalidação de sessões                          | `invalidarOutrasSessoes()` após troca de senha                                      | Seguro                                           |
| Migração de hash legado                         | SHA-256 legado migrado automaticamente para PBKDF2                                  | Correto                                          |
| Anonimização de IP em audit_log                 | Função `anonimizarIp()` implementada                                                | Correto (parcial)                                |
| Consentimento documentado                       | Tabela `aceites_termos` com hash do termo, timestamp, IP                            | Bem implementado                                 |
| Versionamento de Termo                          | Hash SHA-256 garante imutabilidade; novo aceite obrigatório em mudanças             | Correto                                          |
| Auditoria de ações                              | 45+ tipos de ação rastreados em `audit_log`                                         | Abrangente                                       |
| Anti-replay em webhook destrutivo               | Validação de data UTC + tokens duplos em `/reset-policiais`                         | Bem protegido                                    |
| Verificação OCSP/CAdES-LT                       | Snapshot de resposta OCSP para validação offline                                    | Conforme                                         |
| Trust Store ICP-Brasil                          | Certificados raiz/intermediários integrados                                         | Correto                                          |
| Rubrica reutilizável com consentimento granular | Aceite específico (art. 8º) + endpoint de exclusão `DELETE /api/perfil/rubrica`     | Modelo a replicar (contrasta com M1 e Art. 18)   |
| `gise_presenca_termos` por _privacy-by-design_  | CPF cifrado, IP anonimizado, GPS 2 casas (~1 km), UA resumido + bruto só p/ perícia | Aplica as recomendações de A1, M2 e M5 na origem |

---

## 6. Direitos dos Titulares — Status

| Direito                           | Artigo | Status     | Observação                                    |
| --------------------------------- | ------ | ---------- | --------------------------------------------- |
| Confirmação e acesso              | 18, I  | ❌ Ausente | Sem endpoint `/api/meus-dados`                |
| Retificação                       | 18, II | ⚠️ Parcial | Admin edita; titular não tem autoatendimento  |
| Anonimização/bloqueio             | 18, IV | ❌ Ausente | Apenas admin pode                             |
| Portabilidade                     | 18, V  | ❌ Ausente | Sem export JSON/CSV de dados próprios         |
| Eliminação                        | 18, VI | ❌ Ausente | Sem fluxo de solicitação pelo titular         |
| Revogação de consentimento        | 18, IX | ⚠️ Parcial | Revoga assinatura; não revoga coleta de dados |
| Revisão de decisões automatizadas | 20     | —          | Não identificada necessidade                  |
| Contato com DPO                   | 41     | ⚠️ Parcial | DPO mencionado sem contato público            |
| Notificação de incidentes         | 48     | ❌ Ausente | Sem mecanismo implementado                    |

**Implementações prioritárias:**

1. `GET /api/meus-dados` — retornar dados do titular autenticado
2. `POST /api/meus-dados/solicitar-exclusao` — fluxo de exclusão com aprovação
3. `GET /api/meus-dados/exportar` — portabilidade em JSON
4. Página `/contato-dpo` — formulário para exercer direitos

---

## 7. Transferências e Integrações Externas

| Serviço                       | Papel                  | Dados Compartilhados                            | DPA?               | Risco                                                      |
| ----------------------------- | ---------------------- | ----------------------------------------------- | ------------------ | ---------------------------------------------------------- |
| Google Gmail (smtp.gmail.com) | Operador               | Email, nome, código 2FA, DOCX de escalas        | ❌ Não             | ALTO — transferência internacional sem contrato            |
| Cloudflare D1 + R2            | Operador               | Todos os dados (banco + PDFs assinados)         | Verificar          | ALTO — conformidade LGPD precisa ser documentada           |
| SERPRO Desktop (local)        | N/A                    | Hash de PDF, retorna CMS com CPF do certificado | N/A                | MÉDIO — CPF extraído deve ser mascarado antes de persistir |
| OCSP Responders ICP-Brasil    | Operador técnico       | Hash do certificado (não dados pessoais)        | N/A                | BAIXO                                                      |
| Webhooks (origem externa)     | Operador (envia dados) | CPF, nome, email, telefone de policiais         | Verificar contrato | ALTO — sem validação HMAC de integridade                   |

**Ações requeridas:**

1. Assinar DPA com Google (Google Workspace Data Processing Addendum — gratuito)
2. Obter e documentar DPA com Cloudflare
3. Documentar o sistema externo que envia os webhooks e sua base legal

---

## 8. Matriz de Conformidade por Artigo LGPD

| Artigo                     | Requisito                           | Conformidade | Status                                                       |
| -------------------------- | ----------------------------------- | ------------ | ------------------------------------------------------------ |
| Art. 5º, I (transparência) | Finalidade explícita                | 60%          | Termo bom, mas finalidades implícitas não cobertas           |
| Art. 5º, I (necessidade)   | Coletar apenas o necessário         | 65%          | Telefone/email pessoal sem finalidade clara                  |
| Art. 6º (legalidade)       | Base legal para todo tratamento     | 55%          | Algumas coletas sem base documentada                         |
| Art. 7º, V (consentimento) | Consentimento específico e granular | 60%          | Aceite implementado, mas não granular                        |
| Art. 8º (transparência)    | Informar ao titular                 | 75%          | Termo claro, mas DPO sem contato                             |
| Art. 14 (crianças)         | Proteção de menores                 | 20%          | Sem validação ou documentação                                |
| Art. 16 (retenção)         | Prazo definido e cumprido           | 25%          | Documentado no Termo, não implementado                       |
| Art. 18 (direitos)         | Mecanismos de exercício de direitos | 20%          | Praticamente nenhum implementado                             |
| Art. 37 (operadores)       | Contratos com operadores            | 30%          | Google e Cloudflare sem DPA documentado                      |
| Art. 41 (DPO)              | Encarregado identificável           | 40%          | Mencionado sem contato acessível                             |
| Art. 46 (segurança)        | Medidas técnicas adequadas          | 45%          | Boas práticas, mas falhas críticas (CPF em texto, IPs, dump) |
| Art. 48 (incidentes)       | Notificação de vazamentos           | 0%           | Não implementado                                             |

**Conformidade global estimada: ~45%**

---

## 9. Cronograma de Remediação

### Sprint 1 — Emergencial (1–2 semanas)

| #   | Ação                                                                | Arquivo                                     | Impacto |
| --- | ------------------------------------------------------------------- | ------------------------------------------- | ------- |
| 1   | Remover dump.sql do repositório e histórico Git                     | `.gitignore` + `git filter-branch`          | CRÍTICO |
| 2   | Mascarar CPF em `/validar/[hash]`                                   | `src/routes/validar/[hash]/+page.server.ts` | CRÍTICO |
| 3   | Remover lat/lng, IP e user-agent de `/validar/[hash]`               | Mesmo arquivo                               | CRÍTICO |
| 4   | Remover `ADMIN_GERAL_LOGIN/SENHA` do ambiente de produção           | Variáveis de ambiente                       | CRÍTICO |
| 5   | Remover senha hardcoded do script, rotacionar senhas afetadas       | `scripts/set-default-password-all-users.ts` | CRÍTICO |
| 6   | Aplicar `anonimizarIp()` em todas as tabelas (+ migração histórica) | Schema + migrations                         | ALTO    |

### Sprint 2 — Curto prazo (2–4 semanas)

| #   | Ação                                                       | Impacto |
| --- | ---------------------------------------------------------- | ------- |
| 7   | Substituir senha provisória por link de setup              | ALTO    |
| 8   | Implementar limpeza automática de dados (retention policy) | ALTO    |
| 9   | Adicionar HMAC-SHA256 aos webhooks                         | ALTO    |
| 10  | Assinar DPA com Google e Cloudflare                        | ALTO    |
| 11  | Adicionar auditoria em exports PDF/XLSX/DOCX               | ALTO    |
| 12  | Corrigir token de reset (não expor na URL)                 | ALTO    |
| 13  | Sumarizar user-agent antes de armazenar                    | MÉDIO   |
| 14  | Hash de tokens 2FA antes de armazenar                      | MÉDIO   |

### Sprint 3 — Médio prazo (1–2 meses)

| #   | Ação                                                    | Impacto |
| --- | ------------------------------------------------------- | ------- |
| 15  | Implementar `GET /api/meus-dados` (acesso pelo titular) | ALTO    |
| 16  | Implementar solicitação de exclusão pelo titular        | ALTO    |
| 17  | Implementar portabilidade (`/api/meus-dados/exportar`)  | ALTO    |
| 18  | Criar página `/contato-dpo` com formulário              | ALTO    |
| 19  | Implementar notificação de incidentes (tabela + emails) | ALTO    |
| 20  | Separar consentimento por finalidade (granularidade)    | MÉDIO   |
| 21  | Reduzir TTL de sessão para 1 hora + refresh token       | MÉDIO   |
| 22  | Remover/documentar coleta de email pessoal e telefone   | MÉDIO   |

### Sprint 4 — Longo prazo (2–4 meses)

| #   | Ação                                                   | Impacto |
| --- | ------------------------------------------------------ | ------- |
| 23  | Criptografia de CPF em repouso (column encryption)     | ALTO    |
| 24  | Documentar e publicar RIPD/DPIA                        | MÉDIO   |
| 25  | Formalizar DPO com nome, contato e responsabilidades   | MÉDIO   |
| 26  | Treinamento da equipe em LGPD                          | MÉDIO   |
| 27  | Auditoria de penetração focada em LGPD após remediação | ALTO    |

---

## 10. Checklist Executivo

### Imediato (antes de qualquer acesso externo ao repositório)

- [ ] `dump.sql` removido do repositório e histórico Git limpo
- [ ] `.gitignore` atualizado para `*.sql`, `dump.sql`, `backup/`
- [ ] CPF mascarado em `/validar/[hash]`
- [ ] `ADMIN_GERAL_LOGIN/SENHA` removidos de produção
- [ ] Senha hardcoded removida do script

### Antes de ir para produção com novos usuários

- [ ] Todos os IPs anonimizados em todas as tabelas
- [ ] Token de reset não exposto em URL
- [ ] Senha provisória substituída por link de setup
- [ ] DPO identificado com contato no Termo
- [ ] Endpoint `GET /api/meus-dados` implementado
- [ ] Fluxo de solicitação de exclusão implementado

### Conformidade contínua

- [ ] DPA assinado com Google e Cloudflare
- [ ] HMAC nos webhooks implementado
- [ ] Política de retenção com limpeza automática ativa
- [ ] Auditoria de exports ativa
- [ ] RIPD documentado e aprovado pelo jurídico
- [ ] Revisão de conformidade trimestral agendada

---

## Adendo — 2026-06-25: Assinatura por Token A3 no desktop (rubrica reutilizável + termo de presença qualificado)

Este adendo documenta o tratamento introduzido pelo fluxo de **assinatura qualificada por Token A3 no computador** (desktop), em complemento — não substituição — à auditoria de 15/05/2026.

### A. Rubrica reutilizável (`policiais.rubrica`)

- **Finalidade:** elemento gráfico de assinatura reaproveitado nas assinaturas qualificadas do titular (carimbo visual no PDF), evitando redesenho a cada ato. É finalidade **distinta** da rubrica de um ato isolado.
- **Base legal:** **consentimento específico e destacado** (art. 7º, I + art. 8º). O aceite é exigido no cadastro (checkbox próprio com referência ao art. 18) e o momento é registrado em `rubrica_consentimento_em`. A atualização registra `rubrica_atualizada_em`.
- **Dados e minimização:** PNG transparente processado **no navegador** (re-render que descarta EXIF/GPS, recorte e remoção de fundo); o servidor valida formato/tamanho e persiste. Sem selfie/biometria facial associada a este cadastro.
- **Retenção:** atrelada ao **vínculo funcional** — enquanto o policial mantém cadastro ativo e não revoga o consentimento. Não há prazo fixo porque é um dado de conveniência sob controle do titular.
- **Direito de exclusão (art. 18, VI e IX):** `DELETE /api/perfil/rubrica` zera os três campos (`rubrica`, `rubrica_atualizada_em`, `rubrica_consentimento_em`) a pedido do titular, a qualquer momento, e gera evento de auditoria `rubrica_excluida`. A exclusão não afeta documentos já assinados (o grafo já incorporado a PDFs assinados é imutável por natureza da assinatura).

### B. Termo de Confirmação de Presença qualificado (`gise_presenca_termos`)

- **Finalidade:** comprovar entrada/saída no serviço por assinatura qualificada (CAdES-LT/PAdES, Token A3), com termo em PDF verificável em `/validar`.
- **Base legal:** exercício regular de direito em processo administrativo / cumprimento de obrigação (art. 7º, II e VI) + Lei 14.063/2020 e MP 2.200-2/2001 para a assinatura.
- **Privacy-by-design (proteções na origem):**
  - **CPF cifrado** em repouso (`cifrarCpfParaArmazenar`) — não em texto plano;
  - **IP anonimizado** (`anonimizarIp`) — endereça o achado A1 nesta tabela nova;
  - **Geolocalização reduzida** a 2 casas decimais (~1 km) — aplica a recomendação M5;
  - **User-Agent resumido** + bruto (`user_agent_raw`) preservado apenas para perícia forense — coerente com M2;
  - metadados de validação (cert_issuer/serial/validade, OCSP, carimbo de tempo) para reconferência offline.
- **Retenção:** vinculada ao documento funcional (relatórios da GISE) e ao prazo legal aplicável aos atos de serviço; o PDF assinado reside no R2 sob chave que oculta o `policial_id`.
- **Exposição pública:** a página `/validar/[hash]` é compartilhada e **já aplica a mitigação C2** — decifra e **mascara o CPF** (`123.***.***-99`), mascara o nome e **omite IP, user-agent e coordenadas** na resposta ao cliente. O termo de presença herda automaticamente essa proteção.

### C. Reflexo nos achados existentes

| Achado                             | Efeito deste tratamento                                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| M1 (consentimento não granular)    | A rubrica reutilizável adota **consentimento próprio e destacado** — modelo a estender às demais finalidades.                 |
| A1 (IP não anonimizado)            | A tabela nova `gise_presenca_termos` **já anonimiza** o IP na origem.                                                         |
| M2 (UA fingerprinting)             | UA armazenado **resumido**; o bruto fica isolado em campo dedicado para perícia.                                              |
| M5 (geo de alta precisão)          | Coordenadas gravadas com **2 casas decimais** (~1 km).                                                                        |
| Art. 18 (direitos do titular)      | Passo concreto: **exclusão autosserviço** da rubrica pelo titular (`DELETE /api/perfil/rubrica`).                             |
| C2 (`/validar` expunha CPF/IP/geo) | **Mitigado** no endpoint compartilhado (CPF mascarado, IP/UA/GPS omitidos); o termo de presença já é coberto automaticamente. |

---

## Referências Normativas

1. **Lei 13.709/2018 (LGPD)** — Lei Geral de Proteção de Dados Pessoais
2. **Lei 14.063/2020** — Assinaturas Eletrônicas em Interações com Entes Públicos
3. **Decreto 10.748/2021** — Regulamenta a Lei 14.063/2020
4. **MP 2.200-2/2001** — Infraestrutura de Chaves Públicas (ICP-Brasil)
5. **NIST SP 800-63B** — Digital Identity Guidelines
6. **NIST SP 800-122** — Guide to Protecting PII Confidentiality
7. **OWASP Top 10:2021** — A07: Identification and Authentication Failures
8. **ISO/IEC 27001** — Information Security Management Systems

---

_Relatório gerado em 15 de maio de 2026. Revisão recomendada após Sprint 2 (aproximadamente 30 dias)._
