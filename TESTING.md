# Testes Manuais — ESCALAS

Roteiro de regressão manual dos fluxos de negócio. **Papel deste arquivo: exceção, não gate** — a regressão padrão é a suíte automatizada (`npm run test` + `npx playwright test`, ambas no CI). Use este roteiro para o que a automação não alcança (hardware físico, caixa de e-mail real, ACT ICP) e para QA exploratório antes de releases grandes. Casos já automatizados estão marcados com `[E2E: <spec>]` — não precisam de reexecução manual.

> **Fluxo Token A3 (presença GISE no desktop):** roteiro dedicado em [`docs/QA_ASSINATURA_A3_DESKTOP.md`](docs/QA_ASSINATURA_A3_DESKTOP.md) — o Assinador SERPRO + token físico seguem manuais, mas a cadeia criptográfica do fluxo A3 (preparar → CMS → finalizar → validar) roda em CI com CA de teste (`e2e/assinatura-qualificada-a3.spec.ts`).

## 1. Autenticação e Sessão

### 1.1 Login com 2FA (Fluxo Principal)

- [ ] Acessar `/login` sem estar autenticado
- [ ] Submeter matrícula + senha corretos → receber e-mail com código 2FA
- [ ] Inserir código 2FA correto → redirecionar para a tela de boas-vindas conforme papel `[E2E: boas-vindas-rbac.spec.ts — exceto Super Admin, que depende de SUPER_ADMIN_LOGIN]`
  - Super Admin → `/super-admin`
  - Admin Geral → `/escalas/bem-vindo` ou `/gise/bem-vindo` (conforme o módulo escolhido)
  - Admin Seccional / Unidade → `/escalas/bem-vindo`
  - Demais policiais → `/bem-vindo` (cards de atalho conforme papel/GISE)

### 1.2 Validações de Login

- [ ] Senha incorreta → mensagem de erro (sem revelar se matrícula existe)
- [ ] 5 tentativas falhas seguidas → bloqueio por 15 minutos (rate limiting)
- [ ] Código 2FA expirado → mensagem informando expiração
- [ ] Código 2FA incorreto múltiplas vezes → comportamento esperado

### 1.3 Primeiro Acesso

- [ ] Login com credencial temporária → redirecionar para `/alterar-senha`
- [ ] Tentar acessar outra página sem alterar senha → redirecionado de volta
- [ ] Alterar senha com sucesso → liberar acesso ao sistema

### 1.4 Login por certificado A3 (desktop, Assinador SERPRO)

- [ ] Aba **Policial** → "Entrar com Certificado Digital" → assinar o desafio no token → sessão operacional criada (sem senha e sem 2FA)
- [ ] Aba **Administrador** → mesmo botão com módulo escolhido → sessão de admin criada se o policial do certificado tiver conta admin vinculada; redireciona para a boas-vindas do módulo
- [ ] Certificado de policial SEM vínculo admin na aba Administrador → 403 com mensagem clara
- [ ] Certificado revogado (OCSP) → login recusado

### 1.5 Logout

- [ ] Clicar em logout → sessão encerrada, cookie removido
- [ ] Tentar acessar página protegida após logout → redirecionar para `/login`
- [ ] Sessão expirada (após 8h) → redirecionar para `/login` ao tentar qualquer ação

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

### 3.2 Criar Escala (modal "Nova Escala" em `/escalas`)

> `[E2E: escala-crud.spec.ts]` cobre a criação pela action (`?/criar`): admin de unidade cria e a escala aparece na listagem; policial sem papel → 403; duplicata de tipo/lotação/período → 409. Manual: o modal em si (etapas de tipo→data) e o redirect para `/escalas/[id]`.

- [ ] Card "Nova Escala" (home) e botão da listagem abrem o modal
- [ ] Escolher tipo (plantão mensal / expediente mensal / FDS) → etapa de data correspondente
- [ ] Mês/FDS que já possui escala para a lotação → aviso/bloqueio de duplicata
- [ ] Criar escala com dados válidos → redireciona para `/escalas/[id]` (edição)
- [ ] Cancelar/fechar o modal → volta ao estado anterior sem criar
- [ ] Escala criada → aparece na listagem
- [ ] (servidor) Policial sem papel de administração → 403 ao criar via POST direto (`/escalas?/criar`)

### 3.3 Editar Escala (`/escalas/[id]`)

> `[E2E: escala-crud.spec.ts]` cobre o `?/adicionar` servidor: admin adiciona e o servidor aparece na lista devolvida; mesmo servidor/data de novo → 409 (choque global); policial de outra lotação → 403. Manual: edição inline de campos, remoção e os fluxos por tipo (plantão/FDS) na tela.

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
- [ ] (servidor) Policial sem papel de administração → 403 ao excluir via POST direto (`/escalas?/excluir`) `[E2E: escala-crud.spec.ts]`
- [ ] Excluir escala assinada (por qualquer caminho: /escalas, /recebidos, /painel) → documento, cópia de conferência e selfie removidos do R2 junto _(revogação e re-assinatura: `[E2E: escala-revogacao.spec.ts]`; limpeza R2 no unitário `r2-cleanup.test.ts`)_

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

| De                            | Para                          | Ação                        |
| ----------------------------- | ----------------------------- | --------------------------- |
| `em_definicao_supervisor`     | `em_preenchimento`            | Supervisor define estrutura |
| `em_preenchimento`            | `aguardando_assinatura`       | Seccional preenchida        |
| `aguardando_assinatura`       | `em_andamento`                | Após assinatura             |
| `em_andamento`                | `aguardando_relatorios`       | Operação encerrada          |
| `aguardando_relatorios`       | `aguardando_assinatura_relat` | Relatórios submetidos       |
| `aguardando_assinatura_relat` | `pronta_para_finalizar`       | Relatórios assinados        |
| `pronta_para_finalizar`       | `finalizada`                  | Finalização                 |

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

> `[E2E: assinatura-qualificada-a3.spec.ts]` cobre a cadeia criptográfica do fluxo qualificado (preparar → CMS → finalizar → download → `/validar`, com negativos de CA desconhecida, CPF divergente e digest adulterado) usando CA de teste. O que segue manual em 5.2/5.3 é a integração com o assinador real (WebPKI/SERPRO, PIN, token físico, certificado expirado de verdade).

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

### 5.5 Re-assinatura e revogação

> `[E2E: escala-revogacao.spec.ts]` cobre o ciclo qualificado (CA de teste): assinar → documento baixável e `/validar` encontra → revogar (DELETE) → documento some do banco e do `/validar` → reassinar (hash novo). Também a re-assinatura sem revogar (overwrite): o hash antigo deixa de resolver (achado R2-4). Guarda: policial de outra lotação não revoga → 403. A limpeza dos objetos R2 em si (quais apagar) é coberta no unitário `r2-cleanup.test.ts`.

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

> `[E2E: presenca-gise.spec.ts]` cobre entrada/saída em tela com rubrica + 2FA + GPS (2FA obrigatório — a flag é semeada como em produção), o comprovante sob demanda dos dois sentidos, o **vínculo na escrita** (não-participante com 2FA válido → 403, não grava) e as guardas do comprovante (anônimo 401, não-participante 403, tipo inválido 400, sem presença 404). Manual: selfie/câmera real (liveness é client-side) e o fluxo por Token A3 (janela de horário + hardware — QA A3).

- [ ] Policial registra entrada com rubrica e selfie
- [ ] Policial registra saída com rubrica e selfie
- [ ] Timestamps de entrada e saída salvos corretamente
- [ ] No desktop (com restrição de smartphone), a tela de confirmação mostra APENAS o botão "Confirmar … com Certificado Digital" (sem quadro de rubrica/gerenciar); sem rubrica cadastrada, mostra o aviso com botão de cadastro
- [ ] Após confirmar (tela OU Token A3), o botão **"Comprovante"** aparece ao lado do aviso de Entrada/Saída Confirmada e baixa o PDF
  - Presença por Token A3 → serve o termo qualificado (ICP-Brasil) guardado no R2
  - Presença em tela → gera o comprovante **avançado** sob demanda (rubrica + evidências), SEM menção a ICP-Brasil no rodapé

### 6.2.1 Aviso "Cadastre sua rubrica" (pós-login)

- [ ] Policial SEM rubrica vinculado a GISE ativa (membro/supervisor/supervisão) vê o aviso ao logar
- [ ] DPC admin SEM rubrica com solicitação de assinatura pendente vê o aviso ao logar
- [ ] "Deixar para depois" fecha e não reaparece na mesma sessão do navegador; reaparece no próximo login
- [ ] "Cadastrar rubrica" abre o modal de cadastro; após salvar, o aviso não volta
- [ ] Policial sem pendência de assinatura NÃO vê o aviso

### 6.3 Formulários de Produtividade

- [ ] Policial preenche formulário de respostas
- [ ] Salvar respostas → persistido no banco
- [ ] Atualizar respostas já salvas → substituído corretamente

### 6.4 Assinatura de Relatórios Seccional

> `[E2E: relatorio-extra-gise.spec.ts]` cobre a assinatura **qualificada** do relatório extraordinário pelo supervisor via CA de teste (preparar → CMS → finalizar → documento persistido → `/validar`) e as guardas: não-supervisor → 403, seccional inválida → 400, saída incompleta → 400, CPF do token ≠ supervisor → 400.
> `[E2E: relatorio-extra-avancado.spec.ts]` cobre a assinatura **avançada em tela** (endpoint `assinar`): supervisor com rubrica + 2FA + selfie/GPS → 200; não-supervisor → 403; saída incompleta → 400; sem 2FA → 400.
> A montagem do manifesto (todas as rubricas de presença + supervisor, FOTO condicional) é coberta no unitário `manifesto-signers.test.ts`. Manual: o Assinador SERPRO real, a selfie/câmera de verdade e a assinatura do relatório de `produtividade`.

- [ ] Preparar relatório seccional
- [ ] Assinar relatório tipo `extraordinario`
- [ ] Assinar relatório tipo `produtividade`
- [ ] Finalizar assinatura do relatório
- [ ] Manifesto do relatório de extra contém TODAS as assinaturas de presença **tanto** quando o supervisor assina por Token A3 **quanto** pelo celular/tela; campo "FOTO DO ATO" só aparece quando há selfie
- [ ] Botões de download "C/ manifesto" só aparecem para quem pode baixá-lo (admin, ou DPC assinante do documento); demais perfis veem apenas "S/ manifesto"

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

### 8.5 Meu Perfil (`/perfil`) e Solicitações (`/solicitacoes`)

- [ ] Policial acessa "Meu perfil": identificação somente leitura (nome, matrícula, cargo, e-mails)
- [ ] Cadastrar/atualizar/excluir rubrica pelo perfil
- [ ] Alterar telefone/classe/regime/lotação → botão só habilita com mudança real → cria solicitação PENDENTE (cadastro NÃO muda ainda)
- [ ] Nova solicitação do mesmo campo substitui a pendente anterior
- [ ] Admin Geral vê a pendência em "Solicitações" com dados do servidor e de/para
- [ ] Aprovar (✓) → valor aplicado no cadastro imediatamente; Rejeitar (✗) → cadastro intacto; ambos auditados
- [ ] Policial vê o status (Pendente/Aprovada/Rejeitada) no histórico do perfil
- [ ] Valores inválidos (classe de outro cargo, lotação inexistente, telefone malformado) → erro de validação

### 8.6 E-mail pessoal pelo perfil (cadastro/troca)

- [ ] Sem e-mail pessoal: "Cadastrar" abre o modal SEM campo de senha; código chega no novo endereço; confirmar persiste verificado
- [ ] Com e-mail pessoal: "Alterar" exige a senha de acesso; senha errada → "Senha incorreta."; sem senha o envio fica bloqueado
- [ ] Código correto → e-mail trocado, selo "Verificado" e **aviso de segurança no e-mail funcional**
- [ ] Código errado/expirado → erro; reenvio disponível após o timer
- [ ] Troca também registrada na auditoria (detalhe indica TROCA + aviso)

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

### 10.4 Logs técnicos (`/auditoria/logs`)

> Acesso exclusivo do **Super Admin** (mesma política de `/auditoria`). Grava apenas `warn`/`error` do servidor; a persistência acontece após a resposta (waitUntil), então o registro pode levar alguns segundos para aparecer.

- [ ] Botão "Logs técnicos" no cabeçalho de `/auditoria` abre a página
- [ ] Provocar um aviso (ex.: chamar um webhook com token errado) → registro aparece com nível "Aviso", rota e Request ID
- [ ] Filtrar por nível, busca livre e período
- [ ] Filtrar por Request ID (usar o link no detalhe de um evento da auditoria) → mostra os logs daquela request
- [ ] Expandir um registro → contexto JSON formatado
- [ ] Usuário não Super Admin acessando `/auditoria/logs` → redirecionado

---

## 11. Produtividade (`/produtividade`)

- [ ] Carregar dados de produtividade das GISE finalizadas
- [ ] Gráficos renderizados corretamente
- [ ] Filtrar por período/seccional
- [ ] Dados vazios → estado vazio com mensagem
- [ ] Com mais de 200 respostas acumuladas → stats/rankings/gráficos contam o conjunto completo (o load pagina internamente em lotes de 500)

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

> `[E2E: boas-vindas-rbac.spec.ts]` cobre: policial comum barrado em `/painel` e `/auditoria`; Admin Geral com `/painel` liberado e consoles de auditoria vetados (Super Admin only, inclusive na API `/api/admin/audit`); anônimo → `/login`. `[E2E: escalas-cross-lotacao.spec.ts]` cobre o isolamento entre lotações. Manual: perfis que dependem de env (Super Admin) e a varredura exploratória completa da tabela.

| Papel              | Deve acessar                                                                                         | Não deve acessar                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Super Admin        | Tudo (inclusive gestão de policiais/unidades, `/conf-ass`, promoção de admins e PDF forense íntegro) | —                                                             |
| Admin Geral        | Operação global (escalas, GISE, LGPD, `/painel`)                                                     | Gestão de policiais/unidades, `/conf-ass`, promoção de admins |
| Admin Seccional    | Escalas/policiais da seccional                                                                       | `/painel`                                                     |
| Admin Unidade      | Escalas/policiais da unidade                                                                         | `/painel`, dados de outras unidades                           |
| Supervisor GISE    | `/gise/[id]` da sua GISE                                                                             | Outras GISE                                                   |
| Membro GISE        | `/res-gise`                                                                                          | `/gise/[id]` (visão admin)                                    |
| Policial sem papel | Suas escalas                                                                                         | Qualquer gestão                                               |

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

---

## 18. Webhooks de Sincronização (operador / Apps Script)

> `[E2E: webhook-sync.spec.ts]` cobre o contrato ponta a ponta contra o D1: `sync-policiais` cria e atualiza (upsert) a partir do payload do Apps Script, cargo inválido conta como falha sem derrubar o lote, `sync-unidades` cria a seccional; **M-4** — um SYNC_TOKEN válido tentando `papel: seccional` NÃO promove (fica `null`); **reset destrutivo** fail-closed (SYNC válido mas sem a 2ª credencial → 401, nada apagado); auth negativa (sem/errado bearer → 401). A lógica de auth (Bearer/HMAC/replay) tem cobertura unitária em `webhook-auth.test.ts`.

- [ ] (manual) Rodar o menu "🚀 Sincronização D1" da planilha real → policiais/unidades refletidos no sistema
- [ ] (manual) Reset destrutivo com as 3 credenciais corretas em ambiente de teste → tabelas operacionais zeradas com snapshot no log
