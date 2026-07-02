# Testes Manuais — ESCALAS

Roteiro de regressão manual dos fluxos de negócio. Use antes de releases importantes, em complemento aos testes automatizados (`npm run test` e `npx playwright test`).

> **Fluxo Token A3 (presença GISE no desktop):** roteiro dedicado em [`docs/QA_ASSINATURA_A3_DESKTOP.md`](docs/QA_ASSINATURA_A3_DESKTOP.md) — exige Assinador SERPRO + token físico e não roda em CI.

## 1. Autenticação e Sessão

### 1.1 Login com 2FA (Fluxo Principal)
- [ ] Acessar `/login` sem estar autenticado
- [ ] Submeter matrícula + senha corretos → receber e-mail com código 2FA
- [ ] Inserir código 2FA correto → redirecionar conforme papel do usuário
  - Admin → `/painel`
  - Supervisor GISE → `/gise`
  - Membro GISE → `/res-gise`
  - Policial sem papel especial → `/`

### 1.2 Validações de Login
- [ ] Senha incorreta → mensagem de erro (sem revelar se matrícula existe)
- [ ] 5 tentativas falhas seguidas → bloqueio por 15 minutos (rate limiting)
- [ ] Código 2FA expirado → mensagem informando expiração
- [ ] Código 2FA incorreto múltiplas vezes → comportamento esperado

### 1.3 Primeiro Acesso
- [ ] Login com credencial temporária → redirecionar para `/alterar-senha`
- [ ] Tentar acessar outra página sem alterar senha → redirecionado de volta
- [ ] Alterar senha com sucesso → liberar acesso ao sistema

### 1.4 Logout
- [ ] Clicar em logout → sessão encerrada, cookie removido
- [ ] Tentar acessar página protegida após logout → redirecionar para `/login`
- [ ] Sessão expirada (após 12h) → redirecionar para `/login` ao tentar qualquer ação

---

## 2. Troca de Senha (`/alterar-senha`)

- [ ] Acessar com usuário autenticado
- [ ] Informar senha atual incorreta → erro de validação
- [ ] Informar nova senha igual à atual → erro ou aviso
- [ ] Alterar senha com sucesso → confirmação e redirecionamento
- [ ] Nova senha muito curta/fraca → validação de política de senha (se existir)

---

## 3. Gestão de Escalas (`/escalas`)

### 3.1 Listagem
- [ ] Visualizar lista de escalas com paginação
- [ ] Filtrar por lotação
- [ ] Filtrar por mês/ano
- [ ] Filtrar por tipo (plantão / expediente / FDS)
- [ ] Busca por texto
- [ ] Limpar filtros → lista completa restaurada
- [ ] Filtros persistem ao navegar entre páginas (localStorage)
- [ ] Admin sem escalas → estado vazio com mensagem

### 3.2 Criar Escala (`/escalas/nova`)
- [ ] Formulário com campos obrigatórios em branco → erros de validação
- [ ] Criar escala com dados válidos (título, cidade, lotação, datas, horário, tipo)
- [ ] Data de fim anterior à data de início → erro de validação
- [ ] Escala criada → aparece na listagem

### 3.3 Editar Escala (`/escalas/[id]`)
- [ ] Carregar página com dados corretos da escala
- [ ] Editar campos e salvar → dados atualizados
- [ ] Editar campos com dados inválidos → erro de validação
- [ ] Adicionar policial à escala (data de plantão, horário, equipe)
- [ ] Remover policial da escala → policial removido
- [ ] Adicionar policial inexistente ou inativo → erro

### 3.4 Deletar Escala
- [ ] Solicitar exclusão → confirmação solicitada
- [ ] Confirmar exclusão → escala removida da listagem
- [ ] Cancelar exclusão → nada alterado

### 3.5 Marcar Visto
- [ ] Admin marca escala como "vista" → status atualizado

---

## 4. Gestão GISE (`/gise`)

### 4.1 Listagem GISE
- [ ] Admin vê todas as GISE
- [ ] Supervisor vê apenas sua GISE
- [ ] Membro vê GISE atribuída
- [ ] GISE com diferentes status exibidas corretamente

### 4.2 Criar GISE
- [ ] Criar GISE com data de início, hora entrada/saída e supervisor
- [ ] Datas inválidas → validação
- [ ] GISE criada → aparece com status `em_definicao_supervisor`

### 4.3 Clonar GISE
- [ ] Clonar estrutura de GISE anterior → nova GISE com mesma estrutura de seccionais/equipes

### 4.4 Gerenciar Seccional (`/gise/[id]`)
- [ ] Adicionar seccional à GISE
- [ ] Atualizar dados da seccional (horário, unidade operacional)
- [ ] Deletar seccional → removida da GISE
- [ ] Adicionar seccional duplicada → erro

### 4.5 Gerenciar Equipes
- [ ] Criar equipe operacional com slots DPC/OIP
- [ ] Criar equipe SEINT
- [ ] Atualizar slots de equipe
- [ ] Deletar equipe → removida

### 4.6 Gerenciar Membros
- [ ] Adicionar policial ativo à equipe
- [ ] Remover policial da equipe
- [ ] Adicionar policial além do limite de slots → erro ou aviso
- [ ] Adicionar policial inativo → erro

### 4.7 Fluxo de Status GISE

Verificar cada transição de status:

| De | Para | Ação |
|----|------|------|
| `em_definicao_supervisor` | `em_preenchimento` | Supervisor define estrutura |
| `em_preenchimento` | `aguardando_assinatura` | Seccional preenchida |
| `aguardando_assinatura` | `em_andamento` | Após assinatura |
| `em_andamento` | `aguardando_relatorios` | Operação encerrada |
| `aguardando_relatorios` | `aguardando_assinatura_relat` | Relatórios submetidos |
| `aguardando_assinatura_relat` | `pronta_para_finalizar` | Relatórios assinados |
| `pronta_para_finalizar` | `finalizada` | Finalização |

- [ ] Verificar cada transição acima
- [ ] Reabrir GISE finalizada → status volta ao estado anterior
- [ ] Tentar forçar transição de status inválida → erro

### 4.8 Finalizar GISE
- [ ] Finalizar GISE no status correto → status `finalizada`
- [ ] Tentar finalizar GISE em status incorreto → erro

---

## 5. Assinatura Digital — Escalas

### 5.1 Assinatura Simples (Nome/CPF) — descontinuada, restrita a fluxos FDS legados
- [ ] Preparar assinatura → PDF gerado com sucesso
- [ ] Assinar com nome e CPF → documento assinado
- [ ] Hash de verificação gerado após assinatura
- [ ] Download do PDF assinado disponível

### 5.2 Assinatura WebPKI (Certificado ICP-Brasil)
- [ ] Selecionar método WebPKI
- [ ] Extensão WebPKI detectada no navegador
- [ ] Listar certificados disponíveis
- [ ] Assinar com certificado válido → finalizar com sucesso
- [ ] Tentar sem extensão instalada → mensagem de erro adequada
- [ ] Certificado expirado → mensagem de erro

### 5.3 Assinatura SERPRO
- [ ] Selecionar método SERPRO
- [ ] Aplicação desktop SERPRO conectada via WebSocket
- [ ] Assinar com sucesso → finalizar com sucesso
- [ ] SERPRO não conectado → mensagem de erro

### 5.4 Código de Assinatura por E-mail
- [ ] Solicitar código de assinatura por e-mail
- [ ] Inserir código correto → autorização concedida
- [ ] Código incorreto → erro de validação
- [ ] Código expirado → erro com instrução para solicitar novo

### 5.5 Re-assinatura
- [ ] Tentar assinar escala já assinada → erro informando documento já assinado

---

## 6. Assinatura Digital — GISE

### 6.1 Assinatura da GISE Principal
- [ ] Preparar assinatura da GISE → PDF gerado
- [ ] Assinar simples com nome/CPF/rubrica
- [ ] Assinar com WebPKI ou SERPRO
- [ ] Selfie capturada durante assinatura (se configurado)
- [ ] GPS coletado durante assinatura (se configurado)
- [ ] Hash de verificação gerado após assinatura

### 6.2 Presença (Check-in / Check-out)
- [ ] Policial registra entrada com rubrica e selfie
- [ ] Policial registra saída com rubrica e selfie
- [ ] Timestamps de entrada e saída salvos corretamente

### 6.3 Formulários de Produtividade
- [ ] Policial preenche formulário de respostas
- [ ] Salvar respostas → persistido no banco
- [ ] Atualizar respostas já salvas → substituído corretamente

### 6.4 Assinatura de Relatórios Seccional
- [ ] Preparar relatório seccional
- [ ] Assinar relatório tipo `extraordinario`
- [ ] Assinar relatório tipo `produtividade`
- [ ] Finalizar assinatura do relatório

---

## 7. Validação Pública de Documentos (`/validar/[hash]`)

- [ ] Acessar URL pública com hash válido → exibir informações do documento
- [ ] Hash inválido ou inexistente → página de erro adequada
- [ ] Download do documento validado → PDF baixado corretamente
- [ ] Verificar integridade: hash do arquivo bate com o registrado no banco
- [ ] Exibir dados do assinante (nome, CPF parcial, data/hora, IP, coordenadas)

---

## 8. Gestão de Policiais (`/policiais`)

### 8.1 Listagem
- [ ] Filtrar por lotação, cargo, seccional
- [ ] Busca por nome ou matrícula
- [ ] Paginação funcional

### 8.2 Criar Policial
- [ ] Criar com todos os campos obrigatórios preenchidos
- [ ] Matrícula duplicada → erro de unicidade
- [ ] CPF em formato inválido → validação (se houver)
- [ ] Atribuir papel (admin_seccional, admin_unidade) + unidade → persistido

### 8.3 Editar Policial (`/policiais/[id]`)
- [ ] Editar dados básicos (nome, telefone, cargo, lotação)
- [ ] Alterar papel → permissões atualizadas
- [ ] Desativar policial → flag `ativo = false`
- [ ] Policial desativado não aparece em seleções de equipe/escala

### 8.4 Upload em Lote (`/policiais/upload`)
- [ ] Upload de CSV válido → policiais criados em lote
- [ ] CSV com linhas inválidas → relatório de erros por linha
- [ ] CSV vazio → mensagem de erro

---

## 9. Gestão de Unidades (`/unidades`)

- [ ] Criar unidade do tipo `seccional` (sem seccional_id)
- [ ] Criar unidade do tipo `delegacia` com seccional vinculada
- [ ] Criar delegacia sem seccional → erro de validação
- [ ] Nome duplicado → erro de unicidade
- [ ] Editar unidade (nome, cidade, flags de plantão/expediente/FDS)
- [ ] Deletar unidade sem dependências → removida com sucesso
- [ ] Tentar deletar unidade com policiais ou escalas vinculados → erro ou aviso

---

## 10. Painel Administrativo (`/painel`)

### 10.1 Controle de Acesso
- [ ] Acesso negado para não-admin → redirecionamento
- [ ] Admin acessa painel completo sem erro

### 10.2 Relatório de Compliance
- [ ] Filtrar por mês/ano
- [ ] Unidades com escala assinada → indicador correto
- [ ] Unidades com escala não assinada → indicador correto
- [ ] Unidades sem escala → indicador correto
- [ ] Endpoint `/api/admin/compliance` retorna dados no formato esperado

### 10.3 Auditoria
- [ ] Ver log de auditoria das ações do sistema
- [ ] Filtrar por usuário, ação ou entidade
- [ ] Endpoint `/api/admin/audit` retorna dados no formato esperado

---

## 11. Produtividade (`/produtividade`)

- [ ] Carregar dados de produtividade das GISE finalizadas
- [ ] Gráficos renderizados corretamente
- [ ] Filtrar por período/seccional
- [ ] Dados vazios → estado vazio com mensagem

---

## 12. Configurações de Assinatura (`/conf-ass`)

> Acesso exclusivo do **Super Admin**. As flags são cacheadas no edge por até 5 min — a alteração deve refletir no fluxo de assinatura em ≤ 5 min.

- [ ] Visualizar configuração atual das flags de assinatura
- [ ] Ligar/desligar `exigir_foto_assinatura` → refletido na próxima assinatura
- [ ] Ligar/desligar `exigir_gps_assinatura` → refletido na próxima assinatura
- [ ] Ligar/desligar `restringir_smartphone` → em desktop, fluxo A3 oferecido
- [ ] Tentar desligar `exigir_codigo_email_assinatura` → **bloqueado** (2FA por e-mail é requisito legal mínimo; o PUT rejeita `exigirCodigoEmail=false`)

---

## 13. Resultados GISE (`/res-gise`)

- [ ] Membro GISE acessa seus resultados e formulários
- [ ] Formulários de produtividade preenchidos exibidos corretamente
- [ ] Sem GISE atribuída → estado vazio com mensagem

---

## 14. Documentos Recebidos (`/recebidos`)

- [ ] Listar documentos recebidos pelo usuário logado
- [ ] Sem documentos → estado vazio com mensagem

---

## 15. Controle de Acesso (RBAC)

| Papel | Deve acessar | Não deve acessar |
|-------|-------------|-----------------|
| Super Admin | Tudo (inclusive gestão de policiais/unidades, `/conf-ass`, promoção de admins e PDF forense íntegro) | — |
| Admin Geral | Operação global (escalas, GISE, LGPD, `/painel`) | Gestão de policiais/unidades, `/conf-ass`, promoção de admins |
| Admin Seccional | Escalas/policiais da seccional | `/painel` |
| Admin Unidade | Escalas/policiais da unidade | `/painel`, dados de outras unidades |
| Supervisor GISE | `/gise/[id]` da sua GISE | Outras GISE |
| Membro GISE | `/res-gise` | `/gise/[id]` (visão admin) |
| Policial sem papel | Suas escalas | Qualquer gestão |

> A matriz completa de capacidades está em [`DEPLOY.md`](DEPLOY.md#papéis-e-privilégios-de-administrador).

- [ ] Testar cada papel tentando acessar rota não autorizada → redirecionamento ou erro 403

---

## 16. Segurança

- [ ] Submeter formulário sem token CSRF → request bloqueada
- [ ] Injeção de caracteres especiais em campos de busca → sem efeito (ORM parameterizado)
- [ ] Usar cookie de sessão de outro usuário → acesso negado
- [ ] Acessar PDF alheio via hash adivinhado → acesso negado (hash não-sequencial)
- [ ] Verificar headers de segurança: `X-Frame-Options`, `X-Content-Type-Options`, `CSP`

---

## 17. Health Check

- [ ] `GET /api/health` → retorna 200 com status OK
- [ ] Conectividade com banco de dados refletida no health check
