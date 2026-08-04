# Plano operacional — auditoria de fluxos e integridade de dados

**Data-base:** 02/ago/2026  
**Status:** proposto — não iniciado  
**Objetivo:** comprovar que as regras de negócio são aplicadas de forma
consistente entre interface, ações SvelteKit, APIs, banco de dados, documentos
e integrações; identificar estados impossíveis, transições indevidas,
autorizações divergentes, perda de dados e trilhas de auditoria incompletas.

> Esta auditoria começa por evidência. Nomes como “finalizada”, “assinada”,
> “ativa” ou “administrador” não são especificação suficiente: a regra válida é
> a que se confirma simultaneamente em servidor, banco, chamadores e testes.

---

## 1. Resultado esperado

Ao concluir:

1. Todo fluxo crítico terá um mapa de estados, transições, responsáveis e
   efeitos persistentes.
2. Toda ação sensível terá uma matriz papel × ação × recurso × rota.
3. Todo invariante relevante terá localização de enforcement, teste ou achado
   explícito.
4. Atualizações otimistas, invalidações e ações concorrentes terão sua
   consistência avaliada.
5. Documentos, assinaturas, R2, auditoria e retenção terão ciclo de vida
   verificável ponta a ponta.
6. Achados estarão classificados P0–P3, com evidência, responsável e teste de
   regressão definido.

Não é objetivo redesenhar a UI, reformatar código ou refatorar por estilo.
Qualquer mudança será consequência de um achado confirmado.

---

## 2. Escopo

### 2.1 Fluxos obrigatórios

| ID     | Fluxo                                                                       | Risco principal                                  |
| ------ | --------------------------------------------------------------------------- | ------------------------------------------------ |
| FLX-01 | autenticação, sessão, 2FA, certificado, troca/redefinição de senha          | acesso indevido ou sessão inválida               |
| FLX-02 | criação, edição, finalização, exclusão e assinatura de escala               | estado ilegal, documento inválido                |
| FLX-03 | solicitação, preparação, assinatura e finalização de documento              | assinatura fora de ordem ou perda de evidência   |
| FLX-04 | GISE: criação, equipes, seccionais, presença, relatórios e fechamento       | status divergente e dados incompletos            |
| FLX-05 | cadastro, lotação, papéis administrativos e desativação de policial/unidade | RBAC e referência quebrada                       |
| FLX-06 | exportação, validação pública, download e recebimento de documento          | vazamento, autorização ou artefato inconsistente |
| FLX-07 | webhooks e sincronizações externas                                          | replay, parcialidade e origem não confiável      |
| FLX-08 | auditoria, LGPD, retenção e R2                                              | evidência ausente, retenção incorreta ou órfão   |

### 2.2 Código prioritário

O auditor deve localizar os chamadores e testes reais, começando por:

- `src/routes/escalas/**`, `src/lib/db/escalas.ts` e
  `src/lib/server/escalas/**`;
- `src/routes/gise/**`, `src/lib/db/gise/**` e
  `src/lib/server/gise/**`;
- `src/lib/server/assinatura/**`, `src/lib/server/export/**` e rotas
  `src/routes/api/**`;
- `src/lib/auth.ts`, `src/lib/server/auth/**`, `src/hooks.server.ts` e
  rotas de login/senha;
- `src/lib/server/schema.ts`, `src/lib/db/audit.ts`,
  `src/lib/server/r2-cleanup.ts` e `src/lib/db/lgpd-retencao.ts`;
- `src/routes/api/webhook/**`, integrações SERPRO e sincronizações;
- `src/lib/server/policial-permissao.ts` e quaisquer helpers de permissão
  descobertos durante a leitura.

O limiar de tamanho não se aplica. Endpoint, helper ou migration pequena que
controle autorização, estado ou apagamento é parte do escopo.

### 2.3 Fora do escopo inicial

- aparência, tipografia e componentes, salvo quando uma condição visual
  permitir uma transição de negócio indevida;
- auditoria criptográfica completa de bibliotecas externas;
- mudança de política jurídica sem validação do responsável legal;
- performance sem relação direta com falha de consistência.

Esses casos devem ser registrados e encaminhados para a auditoria apropriada,
não ignorados.

---

## 3. Evidência exigida

Nenhum achado pode se basear em uma única leitura. Para cada afirmação sobre
um fluxo, coletar ao menos:

1. código servidor que autoriza e persiste a operação;
2. schema/consulta que representa o estado;
3. chamador de UI, API ou integração;
4. teste existente ou cenário de reprodução;
5. evento de auditoria, documento ou efeito externo, quando houver.

Quando as fontes divergirem, a divergência é o achado. Não escolher a
interpretação “mais provável” sem evidência.

### Fontes documentais

Consultar antes de propor mudança:

- `README.md`, `DEPLOY.md`, `TESTING.md` e `.env.example`;
- `CLAUDE.md`, sobretudo regras de erros API, testes e artefatos jurídicos;
- `docs/HISTORICO.md` e os relatórios arquivados relevantes;
- documentação oficial de Svelte/SvelteKit para mudanças na camada de rota;
- documentação oficial do protocolo/serviço quando a regra vier de
  assinatura, certificado, TSA, OCSP ou Cloudflare.

---

## 4. Método de auditoria por fluxo

### 4.1 Mapear estados antes de avaliar transições

Para cada fluxo, preencher um mapa com estados observados, sem inventar uma
máquina de estados a partir dos rótulos de UI.

```md
## FLX-<NN> — nome do fluxo

### Estados persistidos observados

| Estado/campo | Onde é gravado | Onde é lido  | Significado comprovado |
| ------------ | -------------- | ------------ | ---------------------- |
| ...          | schema/query   | rota/serviço | evidência              |

### Transições

| De  | Evento/ação | Quem pode | Pré-condições | Efeitos            | Para | Teste |
| --- | ----------- | --------- | ------------- | ------------------ | ---- | ----- |
| ... | ...         | ...       | ...           | DB/audit/R2/e-mail | ...  | ...   |

### Estados e transições proibidos

| Regra | Onde deve bloquear | Evidência atual | Cobertura    |
| ----- | ------------------ | --------------- | ------------ |
| ...   | API/ação/DB        | ...             | teste/manual |
```

Um estado é considerado protegido apenas quando o bloqueio está no servidor ou
no banco. Esconder botão na interface não é autorização.

### 4.2 Matriz de permissão

Criar uma matriz única por recurso. Papéis devem ser os valores efetivos do
sistema, e não nomes usados informalmente em comentários.

```md
## RBAC-<recurso>

| Papel efetivo | Ação   | Recurso/escopo            | Rota/ação/API | Gate servidor | Gate UI        | Resultado esperado |
| ------------- | ------ | ------------------------- | ------------- | ------------- | -------------- | ------------------ |
| ...           | editar | escala da própria unidade | ...           | helper/regra  | flag da página | permitido/negado   |
```

Para cada linha negativa, conferir que:

- a UI não revela ação indevidamente;
- a ação SvelteKit e a API rejeitam a chamada direta;
- o erro usa o helper de `$lib/server/api` e o `ErrorCode` adequado;
- a tentativa é auditada quando a política exigir.

### 4.3 Invariantes de dados

Registrar uma regra como invariante quando sua violação produz documento
inválido, permissão sem escopo, referência órfã, duplicidade ou dado
juridicamente enganoso.

```md
## INV-<NNN>

**Regra:** ...
**Entidades/campos:** ...
**Como pode ser violada:** UI | API direta | concorrência | webhook | migração
**Proteção atual:** schema | constraint | transação | validação | nenhuma
**Teste existente:** ...
**Ação:** corrigir | aceitar com prazo | investigar
```

Perguntas obrigatórias:

- uma escala assinada pode ser editada, removida, reenviada ou exportada com
  conteúdo diferente do assinado?
- os períodos e membros de escala podem sobrepor ou ficar inconsistentes?
- presença, relatório e assinatura GISE podem chegar a combinações de status
  impossíveis?
- papel administrativo sempre tem escopo de unidade/seccional válido?
- exclusão/desativação preserva ou protege referências históricas?
- auditoria é escrita na mesma operação que muda a entidade?
- documento no banco, objeto R2 e referência de validação pública podem
  divergir?

### 4.4 Concorrência e atualização otimista

Para operações que carregam dados, alteram localmente e depois invalidam:

1. identificar a versão/estado lido;
2. simular duas abas ou duas requisições com o mesmo estado inicial;
3. verificar se a segunda operação é rejeitada, idempotente ou causa perda de
   atualização;
4. confirmar rollback da UI em `failure`, `error`, rede interrompida e
   navegação;
5. verificar se `invalidate`/`invalidateAll` restaura o estado autoritativo.

Casos prioritários: editar/remover membro de escala, finalizar/reabrir,
solicitar/assinar documento, presença GISE, status de seccional e papéis
administrativos.

### 4.5 Efeitos externos e evidência

Para cada fluxo com e-mail, PDF, R2, TSA, OCSP, webhook ou SERPRO:

- definir o efeito que pode falhar antes, durante ou depois da persistência;
- identificar chave de idempotência, correlação ou defesa contra replay;
- confirmar estratégia de compensação, limpeza ou reprocessamento;
- verificar que logs/auditoria preservam o contexto necessário sem vazar
  segredo ou PII;
- conferir que uma falha externa retorna `ErrorCode.UPSTREAM` ou categoria
  adequada, sem mascarar sucesso parcial.

---

## 5. Lotes de execução

| Lote | Foco                            | Saídas mínimas                                             | Risco |
| ---- | ------------------------------- | ---------------------------------------------------------- | ----- |
| F0   | baseline e inventário           | mapa de arquivos, convenções, comandos e lacunas de testes | P1    |
| F1   | autenticação e sessão           | FLX-01 + matriz de RBAC transversal                        | P0    |
| F2   | escala e permissões             | FLX-02 + invariantes de escala                             | P0    |
| F3   | assinatura e documentos         | FLX-03 e FLX-06 + ciclo PDF/R2                             | P0    |
| F4   | GISE                            | FLX-04 + status, presença e relatórios                     | P0/P1 |
| F5   | cadastros e escopos             | FLX-05 + referências e desativação                         | P1    |
| F6   | webhooks e integrações          | FLX-07 + idempotência e falhas parciais                    | P0/P1 |
| F7   | auditoria, LGPD e retenção      | FLX-08 + trilha e descarte                                 | P0/P1 |
| F8   | concorrência e testes negativos | cenários multiaba/API direta por fluxo                     | P0/P1 |
| F9   | consolidação                    | registro final, regressão e aceitação de dívida            | P0–P3 |

F1–F4 devem preceder refactors abrangentes. F5–F7 podem rodar em paralelo se
não editarem os mesmos módulos. F8 só começa depois de haver mapas de estado
para os fluxos testados.

---

## 6. Testes e controles de regressão

### 6.1 Testes necessários por achado

| Tipo de falha        | Teste mínimo                                             |
| -------------------- | -------------------------------------------------------- |
| transição proibida   | teste de ação/API que tenta a transição diretamente      |
| permissão divergente | teste permitido e teste negado para cada papel relevante |
| invariante de banco  | unitário/integrado contra a query ou constraint          |
| concorrência         | duas operações com estado inicial idêntico               |
| atualização otimista | falha de rede/servidor e confirmação de rollback         |
| webhook              | assinatura/origem, replay, payload inválido e repetição  |
| R2/e-mail/documento  | falha externa, limpeza/compensação e auditoria           |
| PDF/e-mail           | golden antes e depois de mudança intencional             |

Todo `*.test.ts` novo deve estar em `__tests__/` ao lado do código testado.
E2E pertence a `e2e/`. Não criar fixture que dependa de PII real.

### 6.2 Comandos de verificação

O revisor registra apenas comandos que executou e seu resultado:

```bash
npm run lint:ci
npm run check
npm run test
npm run test:e2e
npm run docs:inventario
npm run knip
```

Para PDF e e-mail, seguir o procedimento de golden existente. Não usar
`UPDATE_PDF_GOLDENS=1` ou `UPDATE_EMAIL_GOLDENS=1` para mascarar uma regressão.

---

## 7. Classificação e registro de achados

### Severidade

- **P0:** autorização indevida, quebra de assinatura/documento, exposição de
  PII, corrupção/perda de dados ou trilha de auditoria materialmente falsa.
- **P1:** regra de negócio ou estado inconsistente que produz resultado errado,
  mas tem recuperação conhecida.
- **P2:** fragilidade de manutenção, duplicação de regra ou cobertura
  insuficiente sem falha comprovada.
- **P3:** documentação, nomenclatura ou observabilidade que não altera o
  comportamento atual.

### Formato obrigatório

```md
## FLW-<DOMINIO>-<NNN> — resumo objetivo

**Severidade:** P0 | P1 | P2 | P3
**Fluxo:** FLX-<NN>
**Estado:** aberto | confirmado | corrigido | aceito | bloqueado
**Arquivos/evidências:** caminho:linha, teste, log ou reprodução

### Regra esperada

...

### Comportamento observado

...

### Impacto

...

### Correção proposta

...

### Teste de regressão

...

### Decisão

Responsável, data, PR/commit ou justificativa de aceitação.
```

“Não achei problema” também deve ser registrado para cada fluxo, com arquivos
lidos, testes executados e limites da verificação.

---

## Resultado parcial — F7: auditoria, LGPD e R2

**Método:** leitura cruzada de mutações, `audit_log`, limpeza de retenção e R2;
testes focados existentes passaram (25/25). Os cenários de falha abaixo não
possuem cobertura que comprove o comportamento esperado.

### FLW-AUDIT-001 — eventos forenses podem desaparecer após a mutação

**Severidade:** P0  
**Fluxo:** FLX-08  
**Estado:** confirmado

`auditar()` declara que nunca lança e captura toda falha de persistência
(`src/lib/db/audit.ts:16,591-683`). Uma mutação crítica pode ocorrer antes da
tentativa de append — por exemplo, a finalização GISE persiste o status em
`src/routes/api/gise/[id]/finalizar/+server.ts:41` e só então chama
`auditar()` em `:47-61`. Se o insert falhar definitivamente, a resposta ainda
é sucesso e só existe um log de aplicação.

Isso contradiz o uso da cadeia como trilha forense material: a sequência
sobrevivente pode estar íntegra sem conter o evento que explica a mudança.

**Correção proposta:** para eventos críticos, adotar uma das políticas
explicitamente: (a) transação que persiste mutação e evento juntos, ou (b)
outbox durável com estado pendente, alerta e reprocessamento auditável. Não
alterar `auditar()` globalmente para lançar sem classificar quais operações
podem legitimamente priorizar disponibilidade.

**Teste de regressão:** simular falha do insert de auditoria ao finalizar uma
GISE e exigir rollback ou registro pendente recuperável; testar concorrência
do encadeamento.

### FLW-LGPD-002 — resposta integral de e-mail expõe destinatários nos logs

**Severidade:** P0  
**Fluxo:** FLX-08  
**Estado:** confirmado

O cliente Cloudflare registra a resposta completa de sucesso em
`src/lib/server/email.ts:138-143`; o tipo inclui `result.delivered: string[]`.
Em falha, também registra e inclui na exceção o corpo integral da resposta
(`:126-135`). O logger serializa campos em logs externos.

Endereços de e-mail e, dependendo do provedor, outros detalhes da entrega
podem ser persistidos em Cloudflare Logs fora do propósito operacional mínimo.

**Correção proposta:** permitir apenas campos de observabilidade aprovados
(status, classe de erro, request/correlation id) e mascarar destinatário,
conteúdo e anexo. Revisar também a mensagem da exceção para que ela não
reintroduza o corpo remoto em outro logger.

**Teste de regressão:** respostas de sucesso e erro simuladas não podem
produzir log ou erro contendo e-mail, conteúdo ou anexo.

### FLW-GISE-003 — mutações relevantes de GISE não geram evento de auditoria

**Severidade:** P1  
**Fluxo:** FLX-04 / FLX-08  
**Estado:** confirmado

As actions de membros, equipes, unidades e seccionais modificam a composição
da escala e podem revogar documentos/assinaturas, mas não chamam
`auditar()`/`registrarAuditComContexto`:

- `src/routes/gise/[id]/_actions/actions-membros.ts:71-80,131-137`;
- `src/routes/gise/[id]/_actions/actions-equipe.ts:48-56,126-139,167-171`;
- `src/routes/gise/[id]/_actions/actions-unidade.ts:66,91,119-129`;
- `src/routes/gise/[id]/_actions/actions-seccional.ts:57-72,97-113,171-181`.

O histórico não permite atribuir ao ator alterações que afetam presença,
escopo e validade documental.

**Correção proposta:** centralizar as mutações em serviço auditado ou tornar
o append parte obrigatória de cada action, com ator, alvo, estado antes/depois
e informação sobre revogação.

**Teste de regressão:** chamada direta de cada action bem-sucedida deve
produzir exatamente um evento com ator e alvo; falhas/negações não podem
simular sucesso.

### FLW-R2-004 — exclusão R2 confirma tentativa, não remoção

**Severidade:** P1  
**Fluxo:** FLX-06 / FLX-08  
**Estado:** confirmado

`deletarChavesR2()` usa `Promise.allSettled`, registra a rejeição e retorna a
quantidade de chaves tentadas, não removidas
(`src/lib/server/r2-cleanup.ts:20-22,49-68`). Chamadores podem em seguida
remover a referência D1; uma falha deixa PDF, cópia de conferência ou selfie
biométrica sem referência recuperável.

O comportamento best-effort é deliberado para não bloquear a fonte de verdade
de `/validar`, mas não oferece pendência, retry nem evidência de limpeza
incompleta — inadequado para dados pessoais.

**Correção proposta:** persistir pendências de remoção antes da exclusão
lógica, reprocessá-las até sucesso e auditar tentativas/falhas. A política
deve definir quando uma falha de R2 bloqueia uma transição e quando permanece
como pendência operacional.

**Teste de regressão:** falha parcial de R2 mantém uma pendência identificável
e reprocessável; a limpeza bem-sucedida a encerra.

### FLW-AUDIT-005 — retenção remove prefixo sem âncora verificável

**Severidade:** P1  
**Fluxo:** FLX-08  
**Estado:** confirmado

A retenção exclui diretamente entradas antigas de `audit_log`
(`src/lib/db/lgpd-retencao.ts:156-157`). A verificação de cadeia aceita a
primeira linha sobrevivente como `GENESIS` **ou** “corte de retenção” sem
validar sua origem (`src/lib/db/audit.ts:980-1000`).

Com isso, uma remoção de prefixo fora da política de retenção é
indistinguível de uma limpeza autorizada se o restante da cadeia permanecer
íntegro. A página de integridade pode retornar `ok: true`.

**Correção proposta:** criar checkpoint de retenção imutável/ancorado, com
intervalo removido, política aplicada, hash anterior e evento correspondente.
O verificador só deve aceitar um novo início de cadeia quando houver esse
checkpoint válido.

**Teste de regressão:** remover prefixo sem checkpoint precisa falhar; remoção
com checkpoint válido deve continuar verificável.

---

## Resultado parcial — F0: baseline e inventário

O inventário confirmou os oito fluxos planejados e localizou rotas, schema,
DB, serviços e testes adjacentes. A cobertura é mais forte em criptografia,
PDF e permissões isoladas do que em handlers SvelteKit/API, cenários negativos
e concorrência.

**Baseline executado em 02/ago:**

- `npm run lint:ci`: verde;
- `npm run docs:inventario`: 311 arquivos ≥40 linhas; 76 sem cabeçalho, 1
  arquivo opaco e 1 export sem JSDoc;
- `npm run test` antes da correção: 673/680 testes verdes; os 7 testes de
  golden PDF falharam por hash divergente. Não houve regravação de golden.

### Investigação concluída — goldens de PDF

Os sete PDFs não têm regressão de layout nem não-determinismo. Cada gerador
produz o mesmo hash em duas execuções; a divergência vinha exclusivamente do
fuso horário do processo:

- a máquina local estava em `America/Sao_Paulo` (UTC−03), enquanto o CI usa
  Node 22 em Linux/UTC;
- o harness congela `Date` em `2026-07-01T12:00:00.000Z`, mas o jsPDF inclui
  `/CreationDate` com o offset local no PDF; `normalizarPdf()` só removia o
  identificador aleatório `/ID`;
- em Node 22.23.2 com `TZ=UTC`, os sete hashes versionados passam sem alterar
  fixtures. O mesmo teste falha em `America/Sao_Paulo`, inclusive usando
  Node 22, o que também descarta versão do Node como causa;
- o código dos geradores não mudou desde a última atualização dos goldens
  (`13c238b2`); as mudanças posteriores apenas moveram arquivos.

**Correção aplicada em 02/ago:** o harness agora fixa `process.env.TZ = 'UTC'`
antes de criar os PDFs e restaura o fuso anterior ao encerrar a suíte. O mesmo
golden é verificável no Windows e no CI sem excluir `/CreationDate` do hash e
sem regravar um documento juridicamente relevante. Após a correção,
`npm run test` passou com 680/680 testes.

**Lacunas de cobertura a tratar em F8:**

- handlers de login por certificado, troca/redefinição de senha, alternância de
  acesso/módulo e cache/rate-limit de sessão;
- transições negativas de escala, exclusão de escala assinada e ações em massa;
- ordem solicitar → preparar → finalizar, idempotência e replay de assinatura;
- actions GISE, presença fora de horário/duplicada, reabertura e sync da Base
  Equipe;
- CRUD policial/unidade, upload em massa, papéis administrativos e
  desativação;
- exportação DOCX/XLSX/audit PDF, downloads e recebidos;
- webhook de retenção, replay em todos os endpoints e falha parcial de lote;
- cobertura de escrita de auditoria por ação crítica.

## Resultado parcial — F4: GISE

### FLW-GISE-004 — policial comum pode alterar seccional por POST direto

**Severidade:** P0  
**Fluxo:** FLX-04  
**Estado:** corrigido

As actions de finalizar seccional e de incluir/remover membros só restringem o
usuário quando ele _já é_ `admin_seccional`
(`src/routes/gise/[id]/_actions/actions-seccional.ts:124-143` e
`actions-membros.ts:36-82,86-139`). Para um policial autenticado comum, esse
predicado é falso e não há uma negação posterior. As actions aceitam POST
direto, independentemente da visibilidade do controle na UI.

**Correção proposta:** exigir explicitamente Admin Geral ou Admin Seccional
com `papel_unidade_id` igual à seccional do recurso, em cada action mutável.

**Teste de regressão:** POST direto como policial comum, admin de outra
seccional e admin de unidade fora do escopo deve retornar 403 e não alterar
nenhuma linha.

> **CORRIGIDO (04/ago/2026)** — a regra virou UMA função,
> `podePreencherSeccional` em `gise/[id]/_actions/shared.ts`: Admin Geral em
> qualquer seccional, admin de seccional só na sua. As QUATRO actions
> (`adicionarMembro`, `removerMembro`, `finalizarSeccional`,
> `salvarHorariosSec`) passaram a chamá-la.
>
> Eram quatro cópias da mesma META-regra, e nenhuma errada sozinha — o erro
> estava no que faltava nas quatro. Comentar cada uma não teria ajudado: quem
> escreve a quinta não lê as outras quatro. Extraída, não há como escrever só
> a metade.
>
> Confirmado por execução, não por leitura. Com a meia-regra restaurada,
> `e2e/autorizacao-negativa.spec.ts` reporta `success` — literal — para
> `adicionarMembro`, `removerMembro` e `salvarHorariosSec` chamadas por um
> policial de OUTRA unidade, sem papel algum, numa GISE com que não tem
> relação. Com a correção, os três dão 403.
>
> Duas correções de ORDEM saíram junto, achadas pelo mesmo spec:
> `removerMembro` conferia o estado da escala ("fechada para edição", 400)
> antes da permissão, e as duas rotas de finalizar assinatura da GISE
> consumiam a intenção antes dela. Gate de estado que dispara primeiro esconde
> a ausência do gate de permissão — foi exatamente assim que a primeira versão
> do spec passou com o servidor furado.

### FLW-GISE-005 — finalização aceita estado anterior aos relatórios exigidos

**Severidade:** P0  
**Fluxo:** FLX-04  
**Estado:** confirmado

Os dois caminhos de finalização aceitam `em_andamento`, além de
`pronta_para_finalizar`
(`src/routes/gise/[id]/_actions/actions-escala.ts:310-334` e
`src/routes/api/gise/[id]/finalizar/+server.ts:31-44`). A própria progressão
de status só alcança `pronta_para_finalizar` após o documento principal e os
relatórios extraordinários exigidos.

Uma GISE pode, portanto, ser finalizada sem o conjunto documental que o fluxo
descreve como pré-condição.

**Correção proposta:** aceitar exclusivamente `pronta_para_finalizar`, salvo
se existir política formal que defina um fluxo alternativo completo.

**Teste de regressão:** action e API devem recusar `em_andamento` sem alterar
status, caches, documentos ou Base_Equipe.

### FLW-GISE-006 — alteração de vagas contorna a reabertura formal

**Severidade:** P0  
**Fluxo:** FLX-04 / FLX-06 / FLX-08  
**Estado:** confirmado

`salvarSlotsEquipe` altera a equipe antes de verificar o status e não bloqueia
GISE finalizada (`actions-equipe.ts:33-58`). Para estados que saíram da fase
de edição, ela remove `giseDocumentos` e devolve a escala a
`em_preenchimento`, sem limpeza R2 nem auditoria. Isso contorna o endpoint de
reabertura, que contém regras adicionais.

**Correção proposta:** bloquear qualquer mutação estrutural quando finalizada;
exigir reabertura auditada, com a política de R2 de FLW-R2-004, antes de
qualquer alteração.

**Teste de regressão:** POST direto contra GISE finalizada deve preservar
vagas, status, documento, R2 e trilha de auditoria.

### FLW-GISE-007 — IDs filhos não são sempre vinculados à GISE da rota

**Severidade:** P1  
**Fluxo:** FLX-04  
**Estado:** confirmado

Actions de equipe/unidade recebem `equipeId` ou `linkId`, mas atualizam ou
excluem o filho antes de provar, por JOIN, que ele pertence à seccional e GISE
de `params.id` (`actions-equipe.ts:33-58,62-97,145-173` e
`actions-unidade.ts:95-129`). A invalidação documental pode usar a GISE A
enquanto a mutação atingiu uma entidade da GISE B.

**Correção proposta:** resolver o filho por JOIN
equipe → seccional → GISE com `gise_id = params.id` e repetir essa condição no
`UPDATE`/`DELETE`.

**Teste de regressão:** IDs da GISE B enviados para rota da GISE A retornam
404 e não alteram registro, status ou documento de nenhuma das duas.

### FLW-GISE-008 — presença qualificada pode emitir termo de saída sem entrada

**Severidade:** P1  
**Fluxo:** FLX-04 / FLX-03  
**Estado:** confirmado

O finalizador de assinatura qualificada de presença revalida a participação,
mas não a presença/hora. No fluxo de saída, o update de presença não cria
linha e seu resultado é ignorado; o endpoint ainda grava termo e auditoria de
sucesso (`src/routes/api/gise/[id]/presenca/finalizar-assinatura/+server.ts:63-68,100-158`
e `src/lib/db/gise/presencas.ts:55-83`).

**Correção proposta:** revalidar status e janela de horário no finalizador;
para saída, exigir entrada existente e verificar linhas afetadas. Criar
unicidade por `(gise_id, policial_id, tipo)` para termos de presença.

**Teste de regressão:** saída qualificada sem entrada não cria presença, termo
nem evento de sucesso.

### FLW-GISE-009 — vagas e exclusividade de membro não são atômicas

**Severidade:** P1  
**Fluxo:** FLX-04  
**Estado:** confirmado

Vaga livre, duplicidade na GISE e conflito de horário são consultados antes do
insert de membro (`actions-membros.ts:62-71`); não há transação, versão ou
constraint que una a decisão à gravação. Duas requisições podem observar a
mesma vaga e inserir o mesmo policial em equipes diferentes.

**Correção proposta:** transação ou update condicional de capacidade, junto de
modelo que imponha exclusividade por GISE.

**Teste de regressão:** duas chamadas paralelas devem aceitar apenas uma e
preservar a capacidade/associação única.

### FLW-GISE-010 — política de “uma GISE não finalizada” não é protegida

**Severidade:** P1  
**Fluxo:** FLX-04  
**Estado:** aceito

O código procura uma GISE ativa, mas criação paralela não é serializada e o
schema não impõe unicidade para status ativo
(`src/lib/db/gise/escalas-crud.ts:10-17,59-65,109-127`,
`src/routes/gise/+page.server.ts:181-218` e `schema.ts:281-327`). Quando há
mais de uma, a busca seleciona a mais recente e oculta as demais.

**Correção proposta:** definir se a regra é uma única GISE ativa ou múltiplas
GISEs; implementar constraint/serialização coerente com a política.

**Teste de regressão:** criação concorrente e criação de várias datas devem
seguir explicitamente a política escolhida.

FLW-GISE-003 já registra a ausência de auditoria nas mesmas form actions.

**Mapa de estado observado:** `em_definicao_supervisor` →
`em_preenchimento` → `aguardando_assinatura` → `em_andamento` →
`aguardando_relatorios` → `aguardando_assinatura_relat` →
`pronta_para_finalizar` → `finalizada`; reabertura retorna estados posteriores
para `em_preenchimento`. A finalização indevida de `em_andamento` é
FLW-GISE-005.

## Resultado parcial — F6: webhooks e integrações

> **ACEITO** — A regra não existe: uma GISE é de um DIA e o formulário cria uma por data selecionada. A constraint proposta quebraria a criação em lote. Removida a `buscarGiseAtiva`, que escolhia a mais recente e escondia as demais — e cujo resultado a página nem lia.

### FLW-WEBHOOK-001 — reset operacional não é atômico

**Severidade:** P0  
**Fluxo:** FLX-07  
**Estado:** confirmado

O reset apaga tabelas em chamadas sequenciais
(`src/routes/api/webhook/reset-policiais/+server.ts:161-183`). Uma falha
intermediária deixa dados já removidos, e o evento de auditoria só é tentado
depois de todas as deleções (`:185-204`).

**Correção proposta:** executar as deleções em operação atômica apropriada
(`batch`/transação suportada pelo binding), registrar tentativa, sucesso e
falha de forma durável.

**Teste de regressão:** simular erro no meio da limpeza e provar que nenhuma
tabela mudou e que a tentativa foi registrada.

### FLW-WEBHOOK-002 — sincronização parcial é reportada como sucesso

**Severidade:** P1  
**Fluxo:** FLX-07  
**Estado:** confirmado

`sync-policiais` pula silenciosamente linhas sem matrícula/nome
(`sync-policiais/+server.ts:93-99`); `sync-unidades` também descarta itens
não classificáveis e sempre responde `success: true`
(`sync-unidades/+server.ts:245-261`). O Apps Script não trata o campo
`errors` retornado, apenas `error`/`details`.

**Correção proposta:** tornar cada descarte um erro identificado, retornar
contrato de falha único e fazer o remetente exibir/registrar a falha.

**Teste de regressão:** payload com linha incompleta precisa falhar no
endpoint e sinalizar erro ao remetente.

### FLW-WEBHOOK-003 — envio Base_Equipe não tem entrega recuperável

**Severidade:** P1  
**Fluxo:** FLX-04 / FLX-07  
**Estado:** confirmado

A GISE é finalizada antes de agendar o envio externo. Em falha, o job só
registra logs, sem pendência, correlação, tentativa persistida ou auditoria
durável (`src/lib/server/gise/base-equipe-sync.ts:206-254`). No destino, o
Apps Script apaga linhas antes de inserir sem versão, nonce, staging ou
rollback.

**Correção proposta:** outbox persistente com estado, chave de idempotência,
retries e auditoria; no destino, versão monotônica e staging antes da troca.

**Teste de regressão:** timeout após aplicação, falha durante escrita,
repetição e payload antigo devem ser recuperáveis e não produzir planilha
parcial.

### FLW-WEBHOOK-004 — defesa contra replay ainda depende de flag opcional

**Severidade:** P2  
**Fluxo:** FLX-07  
**Estado:** confirmado

O remetente já envia timestamp e nonce, mas a ausência desses headers só é
rejeitada quando `WEBHOOK_REPLAY_ENFORCE` está ligado
(`src/lib/server/auth/webhook-auth.ts:196-210`). A configuração padrão o
mantém opcional.

**Correção proposta:** exigir a flag em produção e expor sua ausência em
health/deploy; remover o modo legado depois de período de migração explícito.

**Teste de regressão:** Bearer válido sem timestamp/nonce em produção retorna 401.

## Resultado parcial — F1: autenticação e sessão

### FLW-AUTH-001 — cache aceita sessão revogada durante a janela de TTL

**Severidade:** P0  
`src/lib/server/auth/session-cache.ts:10-17,38-47` documenta que token
revogado ou usuário desativado pode continuar válido por até 60 segundos,
inclusive em outro colo do Cache API. Isso afeta reset de senha, desativação e
remoção de Admin Geral.

**Ação/teste:** desabilitar cache em produção ou adicionar versão de revogação
consultada antes do cache; cachear, revogar e exigir rejeição na requisição
seguinte para reset, desativação e revogação de papel.

### FLW-AUTH-002 — reset de Admin Geral vinculado altera a credencial errada

**Severidade:** P0  
O login de Admin Geral vinculado valida `policiais.senha`, mas o reset grava o
placeholder em `administradores.senha`
(`src/lib/server/auth/auth-flow.ts:566-585`,
`src/lib/db/admin-vinculado.ts:7-34` e
`src/routes/redefinir-senha/+page.server.ts:148-167`).

**Ação/teste:** resolver o policial vinculado, atualizar a credencial efetiva
e revogar sessões das identidades admin/policial na mesma unidade de trabalho.
Após reset, senha antiga deve falhar nos dois modos e cookies anteriores devem
ser inválidos.

### FLW-AUTH-003 — Admin Geral vinculado contorna primeiro acesso

**Severidade:** P1  
O policial novo nasce com `primeiro_acesso=1`, mas a conta administrativa
vinculada nasce com `0`; a sessão admin atravessa o hook sem exigir troca de
senha/e-mail pessoal (`src/lib/db/policiais.ts:260-280`,
`src/lib/db/admin-vinculado.ts:25-34`, `src/hooks.server.ts:247-257`).

**Ação/teste:** derivar o flag do policial vinculado ou mantê-lo sincronizado
atomicamente. Login por certificado como admin recém-criado deve redirecionar
qualquer rota administrativa para `/alterar-senha`.

### FLW-AUTH-004 — segredos de uso único podem ser consumidos duas vezes

**Severidade:** P1  
**Estado:** corrigido  
OTP, desafio de certificado e token de reset são lidos antes de serem marcados
como usados, sem update condicional atômico
(`src/lib/auth.ts:541-545,574-607`,
`src/routes/redefinir-senha/+page.server.ts:87-132` e
`api/auth/certificado/verificar/+server.ts:73-92,230-237`).

**Ação/teste:** consumir com `UPDATE ... WHERE usado = 0 AND expires_at >
now`, verificando exatamente uma linha alterada. Duas confirmações paralelas
do mesmo segredo devem ter um único sucesso.

> **CORRIGIDO** — Os três segredos de uso único passaram a ser consumidos por `UPDATE ... WHERE usado = 0 RETURNING` (`consumirTokenRedefinicao`, `consumirDesafio2FA`), e o contador de tentativas virou incremento no SQL. Ver §14 do relatório de comentários/duplicação.

Os testes focados de autenticação passaram (60); hooks, tokens hasheados, 2FA,
certificado e gates Admin/Super Admin possuem garantias existentes, mas não
cobrem os cenários acima.

## Resultado parcial — F2: escalas

### FLW-ESC-001 — usuário da própria lotação pode mutar e assinar por rota direta

**Severidade:** P0  
**Estado:** aberto  
As actions de escala só exigem mesma lotação
(`src/routes/escalas/[id]/+page.server.ts:81-101`), e
`verificarPermissaoEscala` permite a mesma lotação para leitura/assinatura
(`src/lib/server/escalas/permissao.ts:17-32`). Isso é mais permissivo que a
UI de assinatura administrativa.

**Ação/teste:** separar guards de leitura, edição, assinatura e revogação no
servidor. OIP sem papel na própria lotação deve receber 403 para mutar,
assinar, finalizar e revogar.

> **ABERTO — pende decisão do operador.** Verificado em 04/ago/2026: o
> preâmbulo `carregarEscalaComPermissao` exige apenas Admin Geral OU mesma
> lotação, sem checar papel. A UI já exige papel — `podeEditar` no
> `+page.svelte` faz `podeEditarEscala && (podeOIPSolicitar || papel admin
DPC)` —, mas manda a flag LARGA (`podeEditarEscala`) para seis dos sete
> componentes de edição. Alinhar o servidor à regra estrita tira de policiais
> sem papel a capacidade de montar a escala da própria unidade; é decisão de
> produto, não de código, e por isso não foi feita junto com ESC-002/003.

### FLW-ESC-002 — membro de outra escala pode ser editado ou removido por ID

**Severidade:** P0  
**Estado:** corrigido  
Actions de editar/remover e edição agrupada usam o ID de
`escala_policiais` sem sempre combiná-lo com a escala da URL
(`src/routes/escalas/[id]/+page.server.ts:529-560,574-584,709-724`).

**Ação/teste:** toda leitura, update e delete deve incluir
`escala_policiais.escala_id = escalaId`. Item da escala B enviado para a rota
da escala A deve retornar 404/403 e permanecer intacto.

> **CORRIGIDO** — Toda consulta a `escala_policiais` nas actions passa a combinar `id` com `escala_id`, e item de outra escala responde 404. Regressão em `e2e/escala-imutabilidade.spec.ts` (4 casos, incluindo o de sanidade que prova que a própria escala continua editável).

### FLW-ESC-003 — documento assinado/finalizado não é imutável no servidor

**Severidade:** P0  
**Estado:** corrigido  
Os controles são ocultados na UI, mas actions de composição e exclusão não
verificam documento assinado ou `finalizada_em`
(`src/routes/escalas/[id]/+page.server.ts:200-766,998-1038` e
`src/routes/escalas/+page.server.ts:421-424`).

**Ação/teste:** centralizar guard de estado; só revogação/reabertura explícita
e auditada pode liberar mutação/exclusão. Após assinatura, cada action
material deve retornar 409 e preservar PDF, hash e membros.

> **CORRIGIDO** — Guard de estado centralizado no preâmbulo `carregarEscalaComPermissao`, com a operação (`'conteudo'` | `'ciclo'`) como parâmetro obrigatório. Escala assinada ou finalizada recusa as dez actions de conteúdo com 409; revogar a assinatura ou reabrir o FDS destrava, e o spec cobre a volta.

### FLW-DOC-001 — PDF preparado não está vinculado ao alvo, ator ou uso único

**Severidade:** P0  
**Estado:** corrigido  
Preparações de escala, GISE, relatório e presença devolvem PDF/hash ao cliente
sem intenção persistida. Os finalizadores aceitam `preparedPdf` e hash enviados
pelo cliente e persistem no recurso da URL. Na escala, isso ocorre em
`api/escalas/[id]/preparar-assinatura/+server.ts:64-65,177-186` e
`finalizar-assinatura/+server.ts:39-50,93-110`; há o mesmo padrão nos
finalizadores GISE.

**Ação/teste:** criar intenção opaca, expirada, de uso único e consumida
atomicamente, vinculando hash do PDF, recurso, ator, seccional/tipo, versão e
estado esperado. Preparar A e finalizar B, ou reutilizar a mesma intenção,
deve falhar sem D1/R2/auditoria alterados.

> **CORRIGIDO** — `assinatura_intencoes` (migração `0040`) +
> `lib/server/assinatura/intencao.ts`. O `preparar` grava a intenção e devolve
> um token opaco (o banco guarda só o `sha256:`); o `finalizar` a consome com
> `UPDATE ... WHERE usado = 0 AND expires_at > agora RETURNING` e confere
> recurso, escopo, ator e o SHA-256 do `preparedPdf` recebido. Vale para os
> QUATRO pares (escala, GISE, presença e relatório por seccional).
>
> De quebra, o `verificacao_hash` deixou de vir do cliente: era ele que
> escolhia a chave no R2 e o código público do `/validar`.
>
> Cobertura: 15 casos de unidade em `intencao.test.ts` e 3 em
> `assinatura-qualificada-a3.spec.ts` — estes com assinatura VÁLIDA e CPF
> correto, que é o que a verificação criptográfica não distingue sozinha.
> "Preparar em uma escala e finalizar em outra" e "a mesma preparação duas
> vezes" reprovam o código anterior.

### FLW-ESC-005 — datas, duplicidade e capacidade não têm proteção autoritativa

**Severidade:** P1  
Datas livres do cliente e checagens pré-insert não são protegidas por
constraint/transação (`src/routes/escalas/[id]/+page.server.ts:207-310,535-544`
e `src/lib/server/schema.ts:114-138`).

**Ação/teste:** validar intervalo no servidor, impor unicidade/check
apropriado e usar transação. Cobrir data fora do período, colisão na edição e
duas requisições concorrentes.

### FLW-ESC-006 — FDS pode ficar finalizada/enviada quando o e-mail falha

**Severidade:** P1  
`finalizada_em` é gravado antes do envio; a falha é capturada, mas a resposta e
auditoria seguem como finalização/envio
(`src/routes/escalas/[id]/+page.server.ts:876-922`).

**Ação/teste:** representar entrega pendente/falha e usar job idempotente;
auditar resultado real. Timeout do provedor deve deixar estado recuperável,
não “enviado”.

### FLW-ESC-007 — ações materiais de escala não produzem trilha forense

**Severidade:** P1  
Inserções, edições, remoções, reenvio e reabertura não registram o catálogo de
eventos disponível (`src/routes/escalas/[id]/+page.server.ts:240-250,582-584,724-764,947-1006`
e `src/lib/db/audit.ts:147-155`).

**Ação/teste:** append transacional/por outbox com ator, escala, itens e
antes/depois; cada action material bem-sucedida deve criar uma entrada.

## Resultado parcial — F3: assinatura, exportação e validação

### FLW-ACL-002 — download por hash não reaplica autorização do recurso

**Severidade:** P0  
A rota requer uma sessão, mas depois resolve o hash sem chamar os gates de
escala/GISE/seccional (`src/routes/api/validar/[hash]/download/+server.ts:60-179,240-351`).
Usuário autenticado fora do escopo pode receber cópia de conferência de outra
unidade.

**Ação/teste:** reaplicar autorização conforme o documento resolvido, ou
remover o download por hash para não privilegiados. Sessão de outra lotação
deve receber 403 sem bytes de PDF; participante autorizado deve continuar
recebendo a cópia permitida.

### FLW-R2-003 — assinatura GISE pode persistir sem blob R2

**Severidade:** P1  
Finalizadores de GISE, relatório e presença tratam R2 como opcional e podem
persistir documento/hash mesmo sem blob
(`api/gise/[id]/finalizar-assinatura/+server.ts:84-113` e finalizadores
equivalentes de relatório/presença).

**Ação/teste:** falhar antes de assinar sem R2; depois de `put`, usar estado
pendente/outbox e compensar blob se D1/auditoria falhar. Testar R2 ausente,
`put` falho e falha posterior de D1.

### FLW-DOC-003 — revogação/reassinatura GISE deixa artefatos antigos

**Severidade:** P1  
Caminhos alternativos removem apenas D1, e upserts de documento/assinatura
não garantem remoção dos PDFs, conferências e selfies anteriores
(`actions-equipe.ts:53-56,135-139`, `actions-seccional.ts:97-113`,
`actions-escala.ts:264-272,392-396`,
`src/lib/db/gise/documentos.ts:78-86` e `gise/assinaturas.ts:149-161`).

**Ação/teste:** centralizar revogação/reassinatura com limpeza R2 prévia,
preservação de chaves novas e auditoria. Hash antigo não deve resolver após
alterar, reabrir ou reassinar.

### FLW-TEST-005 — contratos de segurança de assinatura não têm teste de rota

**Severidade:** P2  
Goldens cobrem geradores, e E2E cobrem happy paths/anônimo, mas não troca de
alvo preparar/finalizar, escopo no hash-download, R2 falho ou limpeza de
reassinatura.

**Ação/teste:** adicionar suites negativas de handlers e teste estrutural do
PDF pós-manifesto/assinatura.

Garantias confirmadas: escalas regulares exigem R2 para finalizar; downloads
diretos aplicam gates; blob forense usa `private, no-store`; página pública
mascara PII; e a assinatura valida certificado contra a sessão.

## Resultado parcial — F5: cadastros e RBAC

### FLW-RBAC-001 — desativação não revoga Admin Geral e 2FA pendente

**Severidade:** P0  
Desativar policial apenas grava `ativo: 0`; sessão admin é validada contra
`administradores` sem conferir o policial vinculado, e 2FA pode criar nova
sessão sem revalidação (`src/routes/policiais/[id]/+page.server.ts:575`,
`src/lib/auth.ts:323-329` e `api/auth/verificar-2fa/+server.ts:111-129`).

**Ação/teste:** revogar vínculo, sessões e desafios em unidade atômica; validar
`policiais.ativo = 1` em sessão admin e confirmação 2FA. Cobrir sessão
existente e 2FA pendente após desativação.

### FLW-POLICIAL-002 — exclusão física apaga histórico e pode deixar R2 órfão

**Severidade:** P0  
A action executa `excluirPolicial` sem análise de impacto
(`src/routes/policiais/+page.server.ts:268-271`), e o DB executa DELETE físico
(`src/lib/db/policiais.ts:431-439`). Cascades removem escala, GISE, presença,
respostas e histórico, enquanto documentos R2 podem perder referência.

**Ação/teste:** recusar exclusão enquanto houver dependência ou adotar somente
desativação; aplicar `RESTRICT` a vínculos históricos indispensáveis. Testar
policial com escala, GISE, presença e histórico.

### FLW-RBAC-003 — escopo de papel não é validado nem usado consistentemente

**Severidade:** P1  
`papel_unidade_id` é exigido, mas não possui FK/validação de tipo e
`admin_unidade` recebe escopo da lotação atual, ignorando o ID persistido
(`src/lib/db/policiais.ts:455-476`,
`src/lib/server/policial-permissao.ts:38-40` e
`src/routes/policiais/[id]/+page.server.ts:325-340`).

**Ação/teste:** validar existência/tipo da unidade e usar o ID no helper, ou
revogar/requerer reassinatura ao transferir lotação. Cobrir ID inexistente,
tipo incompatível e transferência posterior.

### FLW-UNIDADE-004 — renomeação concorrente quebra lotação denormalizada

**Severidade:** P1  
`atualizarUnidade` lê, atualiza e propaga o nome em comandos separados sem
transação/versão (`src/lib/db/unidades.ts:80-110`).

**Ação/teste:** atualização condicional e transação para unidade, cascatas e
auditoria; duas renomeações do mesmo estado inicial devem produzir conflito,
não lotações órfãs.

### FLW-RBAC-005 — mudança, histórico e auditoria podem divergir

**Severidade:** P1  
Movimentação, desvinculação e papel persistem cadastro, histórico e auditoria
em etapas independentes (`src/routes/policiais/[id]/+page.server.ts:339-377,459-488,575-606`).

**Ação/teste:** transacionar registros ou usar outbox; compensar upload R2 se
persistência falhar. Injetar falha em histórico/auditoria.

### FLW-TEST-006 — cadastros e RBAC não têm cobertura negativa de actions

**Severidade:** P2  
Testes atuais cobrem helpers/predicates, não ações de salvar papel,
desvincular, definir ativo, excluir ou concorrência de renomeação.

**Ação/teste:** criar testes diretos permitidos/negados por papel e escopo
para todos os achados P0/P1.

## Resultado parcial — F8: matriz de regressão

**Convenção:** testes de handler/action ficam em `__tests__/` junto à rota ou
serviço; fluxos que precisam de D1, sessão, CSRF e HTTP real ficam em `e2e/`.
Todas as fixtures devem ser sintéticas. Testes de reset, concorrência,
`audit_log`, cache de sessão e GISE ativa usam banco exclusivo e não podem
rodar em paralelo com suites que compartilham esses recursos.

### P0 — suites obrigatórias antes de corrigir

| Achados          | Local sugerido                                                                                  | Cenário e asserção mínima                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| FLW-AUDIT-001    | `routes/api/gise/[id]/finalizar/__tests__/finalizar-audit.test.ts`                              | falha de auditoria e duas finalizações concorrentes: rollback total **ou** pendência durável, sem perda na cadeia |
| FLW-LGPD-002     | `lib/server/__tests__/email-logging.test.ts`                                                    | resposta de e-mail com destinatário/corpo: logger e erro não podem conter PII/conteúdo                            |
| FLW-GISE-004     | ✅ `e2e/autorizacao-negativa.spec.ts`                                                           | POST direto por policial comum/admin fora do escopo: 403 e nenhum estado/documento/audit alterado                 |
| FLW-GISE-005     | `e2e/gise-finalizacao-negativa.spec.ts`                                                         | finalizar `em_andamento` por action e API: 409 e status/documento/integração intactos                             |
| FLW-GISE-006     | `e2e/gise-reabertura-guard.spec.ts`                                                             | alterar vagas em GISE finalizada: 409, slots/hash/R2/auditoria preservados                                        |
| FLW-WEBHOOK-001  | `routes/api/webhook/reset-policiais/__tests__/atomicidade.test.ts`                              | falha na segunda deleção: nenhuma tabela alterada e tentativa registrada                                          |
| FLW-AUTH-001     | `server/auth/__tests__/session-cache.test.ts` + `e2e/sessao-revogacao.spec.ts`                  | aquecer cache e revogar/resetar/desativar: próximo request retorna 401                                            |
| FLW-AUTH-002     | `e2e/reset-admin-vinculado.spec.ts`                                                             | reset de admin vinculado: senha antiga falha nos dois modos, nova funciona e ambos cookies são revogados          |
| FLW-ESC-001      | `e2e/escalas-acoes-autorizacao.spec.ts`                                                         | OIP sem papel na mesma lotação chama mutar/assinar/finalizar/revogar: 403 em todas                                |
| FLW-ESC-002      | `e2e/escalas-ids-cruzados.spec.ts`                                                              | item de escala B enviado à rota A: 404/403 e A/B intactas                                                         |
| FLW-ESC-003      | `e2e/escalas-imutabilidade.spec.ts`                                                             | cada action material/exclusão em escala assinada: 409, PDF/hash/membros preservados                               |
| FLW-DOC-001      | ✅ `lib/server/assinatura/__tests__/intencao.test.ts` + `e2e/assinatura-qualificada-a3.spec.ts` | preparar A/finalizar B; ator/tipo divergentes e reutilização: falha sem D1/R2/audit alterados                     |
| FLW-ACL-002      | `e2e/validar-download-autorizacao.spec.ts`                                                      | usuário autenticado de outra lotação baixa por hash: 403 sem bytes; autorizado recebe somente cópia permitida     |
| FLW-RBAC-001     | `e2e/policial-desativacao-sessoes.spec.ts`                                                      | desativar policial-admin com sessão e 2FA pendente: ambos os caminhos retornam 401                                |
| FLW-POLICIAL-002 | `e2e/policiais-exclusao-historico.spec.ts`                                                      | excluir policial com grafo histórico: operação recusada e referências/R2 continuam recuperáveis                   |

### P1 — agrupamentos de teste

| Grupo                      | Achados                                                   | Testes necessários                                                                                                                                                        |
| -------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auditoria, LGPD e R2       | FLW-GISE-003, FLW-R2-004, FLW-AUDIT-005, FLW-DOC-003      | evento único por mutação; falha parcial de delete cria pendência recuperável; corte de cadeia sem checkpoint falha; hash/artefato antigo deixa de resolver após revogação |
| Estado e concorrência GISE | FLW-GISE-007…010                                          | IDs cruzados retornam 404; saída sem entrada não cria termo; duas requisições disputando vaga têm um vencedor; criação concorrente obedece política formal de GISE ativa  |
| Sincronizações             | FLW-WEBHOOK-002…004                                       | lote incompleto tem contrato de falha; outbox da Base_Equipe suporta timeout após aplicação/retry/payload antigo; webhook sem timestamp/nonce em produção retorna 401     |
| Tokens e primeiro acesso   | FLW-AUTH-003…004                                          | admin novo é redirecionado para troca de senha; duas confirmações de OTP/CMS/reset têm um sucesso e um rejeitado                                                          |
| Escalas e entrega          | FLW-ESC-005…007                                           | data fora do período/colisão/concorrência não persiste; e-mail FDS falho fica pendente; cada mutação material registra um evento                                          |
| Documento e storage        | FLW-R2-003, FLW-TEST-005                                  | R2 ausente, `put` falho e D1 posterior falho não deixam documento sem blob nem objeto sem destino; handlers recebem testes negativos                                      |
| Cadastro/RBAC              | FLW-RBAC-003, FLW-UNIDADE-004, FLW-RBAC-005, FLW-TEST-006 | unidade inválida/incompatível e transferência pós-papel; duas renomeações conflitam; falhas de histórico/auditoria não deixam estado parcial                              |

### Isolamento e ordem de execução

1. **Identidade:** AUTH-001…004 e RBAC-001 compartilham polícia/admin,
   sessões, desafios e cache; executar serialmente e limpar tokens/cache.
2. **Escalas:** ESC-001…003, ESC-005…007 e DOC-001 compartilham documento;
   o teste concorrente de ESC-005 exige banco isolado.
3. **GISE:** autorização, status e auditoria podem compartilhar fixture
   serial; vagas, presença e criação concorrente usam banco exclusivo.
4. **Documento/R2/auditoria:** DOC-001, R2-003/004, DOC-003 e AUDIT-001/005
   compartilham contrato de bucket/outbox; concorrência da cadeia fica isolada.
5. **Integrações:** reset sempre em base exclusiva; Base_Equipe usa servidor
   HTTP em memória, nunca planilha institucional real.

Nenhum teste da matriz pode ser considerado verde se apenas valida a UI. Cada
um deve chamar action/API direta e confirmar o estado persistente, artefato
R2 e evento de auditoria aplicáveis.

## Resultado parcial — F9: consolidação e decisão

### Resumo do ciclo estático

| Severidade | Quantidade | Decisão necessária                                                |
| ---------- | ---------- | ----------------------------------------------------------------- |
| P0         | 15         | triagem e plano de contenção antes de liberar fluxos relacionados |
| P1         | 19         | correção priorizada por domínio, acompanhada da matriz F8         |
| P2         | 3          | planejar junto das correções do domínio correspondente            |

O número resume achados confirmados neste documento, não vulnerabilidades
independentes: alguns compartilham a mesma causa arquitetural, como
autorização insuficiente, mutação sem transação/outbox ou documento sem
vínculo de intenção.

### Ondas de correção recomendadas

1. **Conter acesso e mutação indevidos:** FLW-GISE-004…006,
   FLW-ESC-001…003, FLW-ESC-002, FLW-ACL-002, FLW-RBAC-001 e
   FLW-POLICIAL-002. Antes de qualquer refactor, adicionar os testes negativos
   P0 da matriz F8 e garantir que ações diretas não escapam dos gates.
2. **Restabelecer integridade documental:** FLW-DOC-001, FLW-R2-003,
   FLW-DOC-003, FLW-R2-004 e FLW-AUDIT-001. Definir os contratos de intenção,
   outbox, limpeza e auditoria antes de alterar assinaturas ou R2.
3. **Corrigir credenciais e operações destrutivas:** FLW-AUTH-001…004,
   FLW-WEBHOOK-001 e FLW-LGPD-002. Segredos, cache, reset e logs precisam de
   testes de regressão isolados.
4. **Normalizar concorrência e regras de ciclo:** demais FLW-GISE,
   FLW-ESC-005…007, FLW-WEBHOOK-002…004 e FLW-RBAC-003…005.
5. **Fechar cobertura e dívida aceita:** executar F8, registrar evidência de
   cada teste e aceitar formalmente apenas itens que tenham risco, dono e
   prazo definidos.

### Controle estrutural — varredura de autorização (04/ago/2026)

Antes de atacar a onda 1 achado a achado, o inventário completo das operações
materiais foi levantado e virou guard de CI (`npm run guard:autorizacao`,
`scripts/guard-autorizacao.mjs`).

| operações materiais              | 114 |
| -------------------------------- | --- |
| recusam por permissão (403)      | 94  |
| dispensadas com motivo declarado | 20  |
| **sem decisão e sem motivo**     | 0   |

As 20 dispensas são pré-autenticação (10 — login, primeiro acesso, redefinição
por token), autosserviço sobre a própria conta (5), webhook autenticado por
segredo compartilhado (4) e um endpoint aposentado que responde 410.

**O que isso fecha e o que NÃO fecha.** Fecha a pergunta "existe operação
material sem gate?" — não existe. Não fecha "o gate está certo": FLW-ESC-001,
GISE-004…006, ACL-002 e RBAC-001 são gates que decidem a coisa ERRADA, e nível
2 não distingue isso. É por essa razão que a matriz F8 continua sendo o gate de
liberação, e não este guard.

Duas escolhas do guard merecem registro, porque a alternativa óbvia é pior:

- **Olha o resultado (403 × 401), não o nome do helper.** A autorização é
  decidida de treze formas — `requireAdmin`, `verificarPermissaoEscala`,
  `resolverParticipacaoGisePolicial`, comparação de lotação escrita à mão, além
  de preâmbulos locais a um arquivo só (`autorizarAcao`,
  `carregarEscalaComPermissao`). Uma lista de nomes nunca estaria completa, e
  deixaria passar justamente o handler novo com resolvedor novo.
- **Não foi criado um `autorizar()` único.** A regra difere por domínio de
  verdade; unificar produziria um switch maior e menos legível que os
  resolvedores atuais — o corolário de CLAUDE.md → "Duplicação: extrair antes de
  comentar". O que foi unificado é o VOCABULÁRIO da recusa, não a decisão.

O guard reprova também quando o parser lê menos handlers do que o arquivo
declara. Sem isso ele daria verde sobre rota que não enxerga, e silêncio
pareceria aprovação.

### Controle executável — cobertura negativa (04/ago/2026)

O guard LÊ o código. Duas perguntas ficam fora do alcance dele, e as duas
importam: **a decisão acontece antes do trabalho?** e **o gate olha o RECURSO
ou só o usuário?** As duas exigem requisição, e são as de
`e2e/autorizacao-negativa.spec.ts`, que varre `src/routes/**` em tempo de teste
— rota nova entra sozinha, sem alguém lembrar de acrescentá-la — e exerce as
113 operações materiais em dois cenários: anônimo, e policial de outra unidade
contra recurso REAL da unidade A.

Achou FLW-GISE-004 no primeiro tiro. Ver o registro do achado.

Três armadilhas que este spec custou a acertar, e valem para o próximo:

1. **Alvo protegido por outro motivo não testa este.** A primeira versão
   apontava para `escalaA`, que tem documento assinado: as actions paravam no
   409 de imutabilidade, e o spec passava com a checagem de lotação REMOVIDA do
   servidor. Trocado por `escalaAssinavel`, que está editável.
2. **Recusa por corpo inválido não prova permissão.** Onze operações validavam
   o `FormData`/Zod antes de autorizar e respondiam 400 ao corpo vazio.
   Aceitar 400 como "recusou" mascarava o buraco do GISE-004. Hoje só 401, 403
   e 404 contam; as que precisavam têm corpo mínimo declarado no spec.
3. **Form action não usa o status HTTP.** Com `x-sveltekit-action`, o
   `ActionResult` viaja em JSON sob HTTP 200 — inclusive o da action que
   EXECUTOU. Um spec que lesse `res.status()` passaria em todas as 70.

### Limites desta auditoria

- A análise foi predominantemente estática; não substitui teste contra R2,
  Cloudflare e SERPRO reais.
- Nenhuma correção de produção ou fixture de teste foi criada neste ciclo.
- A divergência dos goldens PDF por fuso foi resolvida no harness; nenhum PDF
  ou golden versionado foi alterado.
- P0/P1 ainda não são “resolvidos” por estarem documentados. A resolução exige
  implementação, os testes F8 verdes e atualização da documentação viva.

## 8. Critérios de aceite

O plano pode ser encerrado somente quando:

- [ ] todos os oito fluxos obrigatórios têm mapa de estados e transições;
- [ ] ações críticas possuem matriz de permissão com testes negativos;
- [ ] invariantes P0/P1 têm proteção servidor/banco e teste de regressão;
- [ ] fluxos com efeitos externos têm comportamento de falha e reexecução
      documentado;
- [ ] documentos assinados foram verificados contra os goldens ao serem tocados;
- [ ] cada atualização otimista crítica foi testada em falha e concorrência;
- [ ] achados abertos possuem dono, severidade e decisão explícita;
- [ ] documentação viva mudou junto de qualquer regra de negócio alterada;
- [ ] lint, check e testes aplicáveis foram executados e registrados.

---

## 9. Registro de execução

| Lote | Responsável        | Estado                  | Início      | Fim         | Achados/PRs                                                           |
| ---- | ------------------ | ----------------------- | ----------- | ----------- | --------------------------------------------------------------------- |
| F0   | coordenação        | concluído               | 02/ago/2026 | 02/ago/2026 | inventário FLX-01…08; TZ UTC fixado no harness, 680/680 testes verdes |
| F1   | auditoria paralela | concluído               | 02/ago/2026 | 02/ago/2026 | FLW-AUTH-001…004                                                      |
| F2   | auditoria paralela | concluído               | 02/ago/2026 | 02/ago/2026 | FLW-ESC-001…007 e FLW-DOC-001                                         |
| F3   | auditoria paralela | concluído               | 02/ago/2026 | 02/ago/2026 | FLW-ACL-002, FLW-R2-003, FLW-DOC-003, FLW-TEST-005                    |
| F4   | auditoria paralela | concluído               | 02/ago/2026 | 02/ago/2026 | FLW-GISE-004…010; FLW-GISE-003 relacionado                            |
| F5   | auditoria paralela | concluído               | 02/ago/2026 | 02/ago/2026 | FLW-RBAC-001, FLW-POLICIAL-002… FLW-TEST-006                          |
| F6   | auditoria paralela | concluído               | 02/ago/2026 | 02/ago/2026 | FLW-WEBHOOK-001…004                                                   |
| F7   | auditoria paralela | concluído               | 02/ago/2026 | 02/ago/2026 | FLW-AUDIT-001, FLW-LGPD-002, FLW-GISE-003, FLW-R2-004, FLW-AUDIT-005  |
| F8   | auditoria paralela | concluído               | 02/ago/2026 | 02/ago/2026 | matriz P0/P1 de testes, concorrência e falha externa                  |
| F9   | coordenação        | concluído (diagnóstico) | 02/ago/2026 | 02/ago/2026 | 15 P0, 19 P1, 3 P2; remediação e F8 pendentes                         |

---

## 10. Prompt operacional para outro agente

```text
Execute o lote <F#> de
docs/auditorias/PLANO_AUDITORIA_FLUXOS_INTEGRIDADE_2026-08-02.md.

1. Marque o lote como “em revisão” no registro e declare os arquivos que irá
   inspecionar.
2. Não assuma nomes de estado ou papéis: construa o mapa somente com
   evidências de schema, servidor, chamador e teste.
3. Para cada divergência, registre um FLW com severidade, impacto, caminhos,
   reprodução e teste de regressão.
4. Teste chamadas diretas à ação/API, não apenas a visibilidade da interface.
5. Antes de qualquer refactor, preserve os testes e os goldens necessários.
6. Atualize o registro com comandos executados, resultado, bloqueios e
   achados confirmados. Não marque um fluxo como revisado sem declarar os
   limites da verificação.
```
