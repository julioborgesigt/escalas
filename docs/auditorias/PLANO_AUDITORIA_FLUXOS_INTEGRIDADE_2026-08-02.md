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
**Estado:** corrigido

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

> **CORRIGIDO (04/ago/2026) — política decidida pelo operador: registrar
> pendência durável e seguir.** A mutação do usuário NÃO é desfeita por falha de
> trilha; o que deixou de acontecer é o evento sumir.
>
> `auditar()` continua sem lançar. O append encadeado saiu para `anexar`, que
> lança, e os dois chamadores tratam a MESMA falha de formas diferentes: o fluxo
> normal engole e grava em `audit_pendencias`; `reprocessarPendenciasAudit` — no
> cron diário de retenção — sabe se deu certo e escolhe entre apagar a pendência
> e incrementar `tentativas`.
>
> A tabela de pendência é deliberadamente BURRA: sem `seq`, sem hash encadeado,
> sem índice único, payload num TEXT. É o que lhe dá chance de gravar quando o
> append encadeado não conseguiu — a maioria das falhas é específica da cadeia
> (corrida de `seq`, chave de hash, coluna recusando valor). Com o D1 inteiro
> fora, os dois caminhos falham e resta o log: é um limite honesto, e está
> escrito no código.
>
> `pendenciasRestantes` sai na resposta do cron e no log. É o número que diz se
> a trilha está íntegra — crescendo entre execuções, há evento que a cadeia
> recusa de forma permanente, e o `tentativas` de cada linha separa isso da
> corrida que some na primeira retentativa.
>
> Cobertura: 8 casos contra SQLite real, 3 dos quais reprovam a versão anterior.

### FLW-LGPD-002 — resposta integral de e-mail expõe destinatários nos logs

**Severidade:** P0  
**Fluxo:** FLX-08  
**Estado:** corrigido

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

> **CORRIGIDO (04/ago/2026).** Dois pontos no sucesso e na falha, e um terceiro
> que o achado não menciona:
>
> - o log de sucesso registrava a resposta inteira, e `result.delivered` é a
>   lista de DESTINATÁRIOS. Passou a registrar `success` e a CONTAGEM;
> - o corpo de erro do provedor ecoa a requisição. Ia cru para o log e para a
>   mensagem do `Error`, que sobe até `enviarERegistrar` e é registrada lá —
>   **desfazendo por dentro a máscara que aquele wrapper já aplicava no
>   destinatário**. Cobertura no ponto de log não é cobertura do caminho;
> - o provedor de FALLBACK (Resend) tinha o mesmo `errorText` cru. Corrigir só o
>   Cloudflare deixaria o vazamento inteiro de pé exatamente em quem assume
>   quando o primeiro falha. Os dois passaram a usar `corpoDeErroSeguro`.
>
> `redigirEmails` (em `$lib/utils/pii`) substitui endereços dentro de texto
> livre pela máscara já usada na exibição. O motivo do erro continua legível:
> some o "para quem", não o "o quê".
>
> Cobertura: 8 casos sobre a redação e 3 sobre o CONTRATO em
> `server/__tests__/email-logging.test.ts` — estes varrem tudo que foi logado
> procurando o endereço em claro, e os três reprovam o código anterior. O caso
> dos dois provedores falhando existe porque a primeira versão dele passava com
> o código furado: falhando só o Cloudflare, o `Error` que chega ao chamador vem
> do Resend.

### FLW-GISE-003 — mutações relevantes de GISE não geram evento de auditoria

**Severidade:** P1  
**Fluxo:** FLX-04 / FLX-08  
**Estado:** corrigido

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

> **CORRIGIDO (05/ago/2026).** As treze actions passaram a fechar em
> `concluirMudancaGise` (`_actions/desfecho.ts`), que é o par do preâmbulo de
> `shared.ts`: um arquivo para o que roda ANTES de mutar, outro para o que roda
> DEPOIS. Doze ações novas no `CATALOGO_ACOES`, nomeadas por entidade e verbo
> (`gise_membro_removido`, `gise_equipe_alterada`, …), porque é assim que o
> operador procura — "quem tirou gente da escala".
>
> O achado pede "informação sobre revogação" no evento, e é daí que vem o
> formato: `invalidar*` APLICA a invalidação e devolve o que derrubou;
> `concluirMudancaGise` EXIGE esse valor. Registro e revogação saem da mesma
> chamada, então o evento não tem como afirmar uma revogação que não houve nem
> omitir a que houve. A severidade também é derivada ali: mudança que derrubou
> documento ou assinatura entra como `aviso`, o resto como `info`.
>
> Cobertura em dois níveis, e a divisão é deliberada:
> `__tests__/desfecho.test.ts` (7 casos, banco real) prova que o registro está
> CERTO; `__tests__/actions-auditadas.test.ts` (28 casos) lê os quatro arquivos
> e prova que ele EXISTE nas treze. O segundo é o que impede a volta do achado,
> porque o achado nunca foi uma action instrumentada errado — eram treze sem
> instrumentação nenhuma, e testar as treze uma a uma reproduziria a duplicação
> que abriu o buraco. Verificado por mutação: apagar a chamada de uma action
> reprova.
>
> **Achado novo, aberto como FLW-GISE-011**, encontrado ao escrever o teste do
> desfecho: `revogarAssinaturasSeccional` recebia o id errado nas sete chamadas
> e não revogava nada. Ver a seção própria.

### FLW-R2-004 — exclusão R2 confirma tentativa, não remoção

**Severidade:** P1  
**Fluxo:** FLX-06 / FLX-08  
**Estado:** corrigido

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

> **CORRIGIDO (05/ago/2026).** O best-effort continua — a linha no D1 é a fonte
> da verdade de `/validar` e não pode ficar refém do storage. O que mudou foi o
> PREÇO. `deletarChavesR2` devolvia quantas chaves foram TENTADAS e tratava a
> rejeição como `logger.warn`; o chamador então apagava a linha que guardava o
> `r2_key`, e depois disso o objeto existe no bucket sem nada no sistema saber
> que ele existe. Não é lixo neutro: é PDF com manifesto forense (CPF, IP, GPS)
> e selfie biométrica (LGPD art. 11), retidos sem base e sem responsável.
>
> **A política é a mesma já decidida para a trilha (FLW-AUDIT-001): pendência
> durável e segue.** A chave que resistiu vai para `r2_pendencias` ANTES de a
> linha sumir — é o ponto, depois seria tarde —, e `reprocessarPendenciasR2`
> tenta de novo no mesmo cron de retenção. O retorno passou a distinguir
> `removidas` de `pendentes`, porque "tentadas" não responde a pergunta que se
> faz a uma limpeza. A chave que sai do bucket é retirada da fila, para uma
> falha transitória não virar pendência eterna.
>
> A resposta do cron e a da exclusão de GISE passaram a expor os restantes: é o
> número que diz se o bucket está limpo, e crescendo entre execuções há objeto
> que o R2 não deixa apagar.
>
> Cobertura: 8 casos novos em `src/lib/server/__tests__/r2-cleanup.test.ts`, com
> banco real. Três mutações verificadas — voltar ao log silencioso, voltar a
> contar as tentadas, e não esquecer a pendência resolvida.

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
**Estado:** corrigido

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

> **ABERTO — pende decisão do operador.** Verificado em 04/ago/2026: a
> capacidade está EM USO e é oferecida pela tela. `podeFinalizar` em
> `gise/[id]/+page.svelte:441` habilita o botão para o Admin Geral tanto em
> `pronta_para_finalizar` quanto em `em_andamento`, e o modal de confirmação
> não menciona relatório nenhum. Recusar `em_andamento` no servidor tira do
> Admin Geral a finalização de uma GISE que nunca vai completar o conjunto
> documental — é a "política formal" que a própria correção proposta
> condiciona, e é decisão de produto, não de código.
>
> A favor de ser bug, não escape hatch: a mensagem de erro da API descreve a
> regra ESTRITA ("precisa estar com todos os relatórios de extra assinados")
> e mesmo assim aceita `em_andamento` — a condição contradiz o texto que a
> acompanha.
>
> Se a resposta for "sim, existe o caminho forçado", o mínimo é torná-lo
> visível: o modal precisa dizer o que está sendo pulado, e a auditoria
> distinguir finalização normal de antecipada. Hoje `status_anterior` vai nos
> metadados, mas a operação parece idêntica às demais.

> **CORRIGIDO (05/ago/2026) — decisão do operador: manter a saída, tornando-a
> explícita.** A finalização antecipada existe por um motivo real (GISE cujos
> relatórios nunca chegam) e continua existindo. O defeito não era ela existir:
> era ser SILENCIOSA.
>
> `modoDeFinalizacao` (`$lib/gise/finalizacao.ts`) classifica em normal,
> antecipada ou bloqueado. As DUAS rotas de finalização e o modal usam a mesma
> função — módulo puro e client-safe de propósito, porque quem decide e quem
> avisa precisam da mesma resposta.
>
> O modal passou a enumerar o que fica para trás; a trilha registra `modo:
'antecipada'` com severidade `aviso` e diz, no texto, o que foi pulado. E a
> action de finalização, que não auditava NADA — a rota de API equivalente
> auditava —, passou a auditar.
>
> Status desconhecido entra como bloqueado, não como antecipado: um estado novo
> na escada não pode abrir a finalização por omissão.
>
> Cobertura: 10 casos em `gise/__tests__/finalizacao.test.ts`; reprova a versão
> que não distinguia.

### FLW-GISE-006 — alteração de vagas contorna a reabertura formal

**Severidade:** P0  
**Fluxo:** FLX-04 / FLX-06 / FLX-08  
**Estado:** corrigido

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

> **CORRIGIDO (04/ago/2026).** Três defeitos, e o arquivo continha a versão
> certa de todos eles trinta linhas abaixo: `salvarHorariosEquipe` carrega a
> GISE, recusa `finalizada` e só então muta. `salvarSlotsEquipe` era a única
> das quatro actions de equipe sem essa recusa — e mutava ANTES de olhar o
> status, então numa escala finalizada a alteração já tinha acontecido quando
> alguém fosse decidir se podia. Em seguida apagava `gise_documentos` e
> devolvia a escala a `em_preenchimento`, contornando a reabertura auditada.
>
> O terceiro defeito não está no enunciado do achado: `atualizarGiseEquipe` e
> `excluirGiseEquipe` filtram só por `equipes.id`. Um `equipeId` de OUTRA GISE
> no corpo do formulário era aceito, e a mutação caía na equipe alheia
> enquanto a invalidação de documento caía na GISE da URL — duas escalas
> erradas de uma vez. É FLW-GISE-007 nestas quatro actions.
>
> Os três viraram um preâmbulo único em `_actions/shared.ts`
> (`carregarGiseEditavel`, `carregarEquipeDaGise`, `carregarSeccionalDaGise`),
> que as quatro actions passaram a usar. Escrito à mão, faltava numa das
> quatro; extraído, não há como esquecer.
>
> **Fica em aberto** a limpeza do R2: descartar o documento continua deixando
> o PDF órfão no bucket. É o escopo de FLW-R2-004, e há
> `limparR2DaGise`/`coletarChavesR2DaGise` prontos para isso — mas a política
> de quando apagar bytes de documento assinado é decisão daquele achado, não
> deste.

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

> **PARCIAL (04/ago/2026).** As quatro actions de EQUIPE passaram a amarrar o
> id filho à GISE da URL (`carregarEquipeDaGise`/`carregarSeccionalDaGise` em
> `_actions/shared.ts`), fechado junto com FLW-GISE-006 e coberto por
> `e2e/gise-imutabilidade.spec.ts`. Os demais ids filhos — presença,
> relatório, resposta de formulário — continuam abertos.
>
> **`actions-unidade.ts` fechado (05/ago/2026)**, junto com a instrumentação de
> FLW-GISE-003. As três actions passaram a usar o mesmo preâmbulo, e o `linkId`
> de `removerUnidade` — o outro caminho citado no enunciado — agora é resolvido
> com `gise_seccional_id = secId` no `WHERE`, devolvendo 404 quando o slot é de
> outra seccional. Duas coisas apareceram no caminho e não estavam no achado:
> nenhuma das três olhava o STATUS (dava para trocar a unidade de uma escala
> `finalizada`, que é FLW-GISE-006 neste arquivo), e `selecionarUnidade` não
> invalidava nada — a unidade sai impressa no relatório de extra, e trocá-la
> depois da assinatura deixava o PDF descrevendo outra unidade. Restam presença,
> relatório e resposta de formulário.

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

### FLW-GISE-011 — a revogação de assinaturas atingia a seccional errada

**Severidade:** P0  
**Fluxo:** FLX-04 / FLX-06  
**Estado:** corrigido  
**Origem:** não estava no plano; apareceu ao escrever o teste de FLW-GISE-003.

`revogarAssinaturasSeccional(db, giseId, seccionalId)` usava o terceiro
parâmetro como `unidades.id` — é o que `gise_assinaturas_relatorios.seccional_id`
referencia, e é por ele que `buscarGiseSeccionalMembros` filtra. As **sete**
chamadas passavam o id da linha `gise_seccionais`: a participação daquela
seccional NAQUELA escala. Dois inteiros, o mesmo nome, dois autoincrements
sobre a mesma faixa de números.

Consequência: mudou-se a composição de uma seccional depois de assinada, e

- o **relatório de extra continuou assinado** com o conteúdo antigo;
- as **presenças** dos membros dela continuaram registradas;
- se algum `unidades.id` coincidisse com o id da participação — o que acontece
  sozinho, pelos dois autoincrements —, caíam as assinaturas de **outra**
  seccional, que ninguém tinha alterado.

**Por que atravessou a auditoria inteira sem ser visto:** os passos 4 e 5 da
função não usam o parâmetro. Apagar o documento consolidado e devolver a escala
a `em_preenchimento` sempre funcionaram — e é esse o efeito que aparece na tela.
A tela dizia "a escala voltou para preenchimento", que é exatamente o que se
espera ver, enquanto o relatório assinado seguia intacto no banco.

**Correção:** a função passou a receber o id da PARTICIPAÇÃO — que é o que todas
as chamadas naturalmente têm — e resolve a unidade por dentro, com
`gise_id` no `WHERE`. Não há mais como um chamador escolher o inteiro errado.

**Regressão:** `src/lib/db/gise/__tests__/revogacao-seccional.test.ts`, 7 casos.
Os dois primeiros são os que SEMPRE passaram (documento e status) e estão lá
nomeados como a camuflagem que foram; sob mutação para o código anterior eles
seguem verdes e os três seguintes reprovam — inclusive o que prova a revogação
da seccional alheia.

## Resultado parcial — F6: webhooks e integrações

> **ACEITO** — A regra não existe: uma GISE é de um DIA e o formulário cria uma por data selecionada. A constraint proposta quebraria a criação em lote. Removida a `buscarGiseAtiva`, que escolhia a mais recente e escondia as demais — e cujo resultado a página nem lia.

### FLW-WEBHOOK-001 — reset operacional não é atômico

**Severidade:** P0  
**Fluxo:** FLX-07  
**Estado:** corrigido

O reset apaga tabelas em chamadas sequenciais
(`src/routes/api/webhook/reset-policiais/+server.ts:161-183`). Uma falha
intermediária deixa dados já removidos, e o evento de auditoria só é tentado
depois de todas as deleções (`:185-204`).

**Correção proposta:** executar as deleções em operação atômica apropriada
(`batch`/transação suportada pelo binding), registrar tentativa, sucesso e
falha de forma durável.

**Teste de regressão:** simular erro no meio da limpeza e provar que nenhuma
tabela mudou e que a tentativa foi registrada.

> **CORRIGIDO (04/ago/2026).** As catorze deleções viraram UM `db.batch`, que no
> D1 é uma transação. Falha na oitava deixava sete tabelas vazias e sete cheias
> — um estado que nenhuma tela do sistema sabe representar, num banco que acabou
> de perder metade do cadastro.
>
> A TENTATIVA passou a ser auditada ANTES de apagar qualquer coisa, e a falha
> depois. Antes, a auditoria só era tentada depois das catorze deleções
> passarem: a falha no meio não deixava registro nenhum de que alguém tinha
> mandado apagar. A trilha não pode depender do sucesso da operação que ela
> existe para documentar.
>
> Precisou de uma correção no harness de teste: o `batch` do
> `sqlite-migrado.ts` não existia, e sem ele um teste de atomicidade mediria uma
> sequência disfarçada de transação — passaria com o código NÃO atômico. Agora
> roda dentro de `BEGIN`/`COMMIT`/`ROLLBACK` reais, e é isso que faz o caso
> "falha no meio não apaga nada" ter valor.
>
> Cobertura: 3 casos em `db/__tests__/reset-atomicidade.test.ts`; o central
> reprova o harness sem transação.

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
**Estado:** corrigido  
`src/lib/server/auth/session-cache.ts:10-17,38-47` documenta que token
revogado ou usuário desativado pode continuar válido por até 60 segundos,
inclusive em outro colo do Cache API. Isso afeta reset de senha, desativação e
remoção de Admin Geral.

**Ação/teste:** desabilitar cache em produção ou adicionar versão de revogação
consultada antes do cache; cachear, revogar e exigir rejeição na requisição
seguinte para reset, desativação e revogação de papel.

> **CORRIGIDO (04/ago/2026) — garantia estreitada, não removida.** O cache
> continua existindo e continua tendo janela: o Cache API é por colo, e nenhuma
> invalidação local alcança outro data center. O que mudou é que a janela deixou
> de valer para quem MUTA. `ttlCacheSessaoParaMetodo` devolve 0 em
> `POST`/`PUT`/`PATCH`/`DELETE`, então toda operação material revalida no D1.
>
> Leitura pode estar até um TTL atrasada; ação, não. Revalidar custa um batch, e
> quem está mutando já paga vários — o ganho do cache estava no caminho de
> leitura, que é onde está o volume. `SESSION_CACHE_TTL_SECONDS=0` continua
> desligando tudo, para quem quiser revogação imediata também na leitura.
>
> Cobertura: `server/auth/__tests__/session-cache.test.ts` (13 casos, 5 reprovam
> a versão anterior). **Não** há teste de ponta a ponta, e isso é decisão
> registrada: o Cache API não funciona no preview local, então o spec que
> escrevi passava com a regra ligada E desligada. Teste que não distingue os
> dois casos é pior que teste nenhum, porque parece cobertura.

### FLW-AUTH-002 — reset de Admin Geral vinculado altera a credencial errada

**Severidade:** P0  
**Estado:** corrigido  
O login de Admin Geral vinculado valida `policiais.senha`, mas o reset grava o
placeholder em `administradores.senha`
(`src/lib/server/auth/auth-flow.ts:566-585`,
`src/lib/db/admin-vinculado.ts:7-34` e
`src/routes/redefinir-senha/+page.server.ts:148-167`).

**Ação/teste:** resolver o policial vinculado, atualizar a credencial efetiva
e revogar sessões das identidades admin/policial na mesma unidade de trabalho.
Após reset, senha antiga deve falhar nos dois modos e cookies anteriores devem
ser inválidos.

> **CORRIGIDO (04/ago/2026).** Não era só falha de segurança: era um reset de
> senha que **não funcionava**. O login do Admin Geral vinculado autentica
> contra `policiais.senha`; `redefinir-senha` gravava em
> `administradores.senha`, que é um placeholder aleatório que ninguém lê. A
> senha nova não passava a valer e a ANTIGA continuava valendo — no fluxo que
> existe justamente para tirar de circulação uma senha comprometida.
>
> A regra "onde mora a credencial" já estava escrita, certa e comentada, em
> `alterar-senha` e em `email-pessoal-guard`. Não protegeu o `redefinir-senha`,
> que nasceu sem ela: comentário protege quem lê AQUELE arquivo. Virou
> `server/auth/credencial.ts` — `resolverCredencial` diz onde gravar,
> `revogarSessoesDaCredencial` derruba as DUAS identidades. As três cópias
> passaram a chamá-la.
>
> A revogação em par também é correção: uma senha destrava dois cookies, e
> `alterar-senha` apagava só os do modo atual. O cookie do outro modo sobrevivia
> à rotação que existia para matá-lo.
>
> Cobertura: 14 casos de unidade em `credencial.test.ts` e o caso ponta a ponta
> em `e2e/revogacao-credencial.spec.ts`, que reprova o código anterior.

### FLW-AUTH-003 — Admin Geral vinculado contorna primeiro acesso

**Severidade:** P1  
**Estado:** corrigido  
O policial novo nasce com `primeiro_acesso=1`, mas a conta administrativa
vinculada nasce com `0`; a sessão admin atravessa o hook sem exigir troca de
senha/e-mail pessoal (`src/lib/db/policiais.ts:260-280`,
`src/lib/db/admin-vinculado.ts:25-34`, `src/hooks.server.ts:247-257`).

**Ação/teste:** derivar o flag do policial vinculado ou mantê-lo sincronizado
atomicamente. Login por certificado como admin recém-criado deve redirecionar
qualquer rota administrativa para `/alterar-senha`.

> **CORRIGIDO** — Derivado, não sincronizado: sincronizar dois campos deixa a
> janela em que eles discordam, e é justamente essa janela que o achado
> descreve. `queryAdminDaSessao` passou a trazer `policiais.primeiro_acesso` no
> mesmo `leftJoin` que já buscava `policiais.ativo`, e `adminDaSessao` devolve
> o valor do POLICIAL para conta vinculada — a linha `administradores` de um
> vinculado é feita de placeholders (senha aleatória, `primeiro_acesso = 0`
> gravado por `vincularAdminGeral`), e placeholder não decide autorização.
>
> O achado escapava porque o LOGIN lia o valor certo (via `credPol`, em
> `auth-flow`) e só a SESSÃO carregava o zero. Quem entra é mandado para
> `/alterar-senha`; quem já está dentro navega. E é a sessão que o
> `hooks.server.ts` consulta a cada request — um teste de login não pegaria.
>
> Cobertura: `src/lib/__tests__/admin-vinculado-sessao.test.ts` (7 casos,
> cobrindo também FLW-RBAC-001, que é o mesmo esquecimento no campo `ativo`).
> Cada um dos dois campos foi reprovado por mutação, separadamente.
>
> **Achado de tabela:** o teste falhava COM a correção aplicada, e a causa era o
> harness. `node:sqlite` devolve linha como objeto chaveado por nome de coluna,
> e o join seleciona `primeiro_acesso` das DUAS tabelas: as chaves colapsavam e
> `Object.values` entregava 10 colunas para um `SELECT` de 11, deslocando o
> mapeamento do drizzle. Terceiro defeito do harness nesta auditoria (depois do
> `get` que devolvia `[]` e do `batch` que não era transação), e os três têm a
> mesma forma: o harness erra em silêncio e a investigação vai parar no código
> de produção, que está certo. Corrigido com `setReturnArrays`, que remove a
> etapa chaveada por nome; os três agora têm regressão em
> `src/lib/db/__tests__/harness-fidelidade.test.ts`, cada um reprovado por
> mutação.

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
**Estado:** corrigido  
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

> **CORRIGIDO (05/ago/2026) — decisão do operador: exigir papel.**
> `podeMexerNaEscala` (`lib/server/escalas/permissao.ts`): Admin Geral em
> qualquer escala, ou policial COM papel administrativo na sua lotação.
>
> A regra não é nova. A tela já a calculava — `podeEditarEscala &&
(podeOIPSolicitar || papel administrativo com cargo DPC)` — e a usava em UM
> dos sete pontos de edição; os outros seis recebiam a flag larga. Expandindo os
> dois ramos, o conjunto é exatamente `isAnyAdmin`. O que faltava não era a
> regra: era ela ser a MESMA nos sete lugares e no servidor.
>
> Por isso agora é calculada no servidor e desce pronta para a tela, em vez de
> recalculada lá. Não há segunda versão para divergir.
>
> Cobertura: `e2e/escala-papel.spec.ts`. O spec de autorização negativa não
> cobria isto — lá o ator é de OUTRA unidade, e a recusa vem do gate de lotação,
> que sempre existiu. Aqui a lotação CONFERE. O segundo caso verifica que o
> admin de unidade continua editando: sem ele, "recusa todo mundo" passaria.
> Reprova o código anterior.

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
**Estado:** corrigido  
Inserções, edições, remoções, reenvio e reabertura não registram o catálogo de
eventos disponível (`src/routes/escalas/[id]/+page.server.ts:240-250,582-584,724-764,947-1006`
e `src/lib/db/audit.ts:147-155`).

**Ação/teste:** append transacional/por outbox com ator, escala, itens e
antes/depois; cada action material bem-sucedida deve criar uma entrada.

> **CORRIGIDO (05/ago/2026).** Doze das catorze actions não deixavam rastro
> nenhum. Todas passaram a fechar em `registrarMudancaEscala`
> (`_actions/desfecho.ts`), par do preâmbulo `carregarEscalaComPermissao` que já
> vivia no `+page.server.ts` — mesma divisão adotada na GISE: um lado para o que
> roda antes de mutar, outro para o que roda depois.
>
> O campo `itens` é OBRIGATÓRIO no contrato, e é a parte do achado que mais
> importa: a mesma action serve para uma linha e para trinta —
> `removerSelecionados` esvazia meio mês com um clique —, e "removeu policial da
> escala" sem o número não distingue a correção de um horário do desmonte do
> plantão inteiro. As actions em lote leem o alvo ANTES do `DELETE`, pelo mesmo
> motivo: depois não há de onde tirar quem saiu.
>
> Duas ações novas no catálogo. A escala de FDS não é assinada — o marco é a
> ENTREGA por e-mail —, então `reenviar_escala_fds` e `reabrir_escala_fds` são,
> nesse fluxo, o que revogar e reabrir são no fluxo assinado. Reabrir é
> `critico`: desfaz um documento que já circulou na caixa de entrada de alguém e
> que vai divergir da escala a partir da próxima edição.
>
> **Não é append transacional nem outbox**, e é decisão registrada: `auditar()`
> já resolve a falha de trilha por PENDÊNCIA DURÁVEL (FLW-AUDIT-001) — a mutação
> vale, o evento espera, o cron reinsere. Envolver as catorze actions numa
> transação com o append daria a mesma garantia a um custo muito maior, e
> quebraria a política já decidida pelo operador de que falha de trilha não
> derruba a operação.
>
> `finalizar` e `gerarProximoMes` continuam auditando por conta própria e estão
> DECLARADAS como exceção no guard: a primeira carrega o resultado do envio de
> e-mail, a segunda tem como entidade a escala NOVA, não a da URL. Nenhuma cabe
> no contrato de `registrarMudancaEscala`, que fixa `entidade_id` na escala da
> rota — declarar é o que separa "audita de outro jeito" de "não audita".
>
> Cobertura: `_actions/__tests__/desfecho.test.ts` (8, banco real) para o
> conteúdo do evento; `_actions/__tests__/actions-auditadas.test.ts` (30) lê o
> `+page.server.ts` e prova que as catorze registram. Verificados por mutação:
> apagar a chamada de uma action, remover `itens` do evento e voltar uma action
> a desestruturar em vez de receber o `event` reprovam, cada um no seu caso.

## Resultado parcial — F3: assinatura, exportação e validação

### FLW-ACL-002 — download por hash não reaplica autorização do recurso

**Severidade:** P2 (era P0 — reclassificado)  
**Estado:** aceito com reclassificação  
A rota requer uma sessão, mas depois resolve o hash sem chamar os gates de
escala/GISE/seccional (`src/routes/api/validar/[hash]/download/+server.ts:60-179,240-351`).
Usuário autenticado fora do escopo pode receber cópia de conferência de outra
unidade.

**Ação/teste:** reaplicar autorização conforme o documento resolvido, ou
remover o download por hash para não privilegiados. Sessão de outra lotação
deve receber 403 sem bytes de PDF; participante autorizado deve continuar
recebendo a cópia permitida.

> **RECLASSIFICADO PARA P2 (05/ago/2026), com o enunciado corrigido.** O achado
> diz que "usuário autenticado fora do escopo pode receber cópia de conferência
> de outra unidade". Verificado em `api/validar/[hash]/download/+server.ts:112`,
> o que o código faz é outra coisa:
>
> - o **blob forense** — manifesto com CPF, IP, GPS e selfie — passa por
>   `podeBaixarForense`, que é `isSuperAdmin === true`. **Está protegido**, e é
>   ele que carrega o dado sensível;
> - a **cópia de conferência** — sem manifesto — vai para qualquer sessão
>   autenticada que apresente o hash.
>
> E o hash é o código de validação IMPRESSO no próprio documento, com
> rate-limit por IP na rota. Quem tem o código já tem o documento. O problema de
> escopo é real — a rota não reaplica o gate do recurso —, mas a exposição não é
> a de um P0: exige possuir o identificador do documento e não alcança o
> forense.
>
> Fica no lote do módulo de validação, junto com os demais achados de `/validar`.
> Registrado aqui porque a diferença entre o enunciado e o código é a própria
> razão de o plano de auditoria não ser executado sem conferência.

### FLW-R2-003 — assinatura GISE pode persistir sem blob R2

**Severidade:** P1  
**Estado:** corrigido  
Finalizadores de GISE, relatório e presença tratam R2 como opcional e podem
persistir documento/hash mesmo sem blob
(`api/gise/[id]/finalizar-assinatura/+server.ts:84-113` e finalizadores
equivalentes de relatório/presença).

**Ação/teste:** falhar antes de assinar sem R2; depois de `put`, usar estado
pendente/outbox e compensar blob se D1/auditoria falhar. Testar R2 ausente,
`put` falho e falha posterior de D1.

> **CORRIGIDO (05/ago/2026).** Os seis finalizadores escreviam
> `if (r2) await r2.put(...)` e gravavam a linha em seguida, com ou sem bucket.
> Sem R2, o certificado era consumido, o hash de verificação era emitido e
> IMPRESSO no documento, e `/validar` passava a resolver esse hash para um
> arquivo que não existe — do lado de quem confere, indistinguível de um
> documento adulterado.
>
> A regra passou a ser a inversa, em `assinatura/blob-assinado.ts`: **sem onde
> guardar, não assina.** A assimetria é a razão — recusar antes é reversível (a
> pessoa tenta de novo em dez minutos); assinar e não guardar não é. O guard
> (`bucketParaAssinatura`) roda ANTES de consumir o token de intenção, para a
> recusa não custar o ato; devolve 503 + `upstream`, que o front trata como
> "tente de novo", e a mensagem afirma explicitamente que a assinatura NÃO foi
> realizada.
>
> `guardarPdfAssinado` fecha a segunda ponta: com o binding presente, o `put`
> ainda pode falhar (rede, quota), e a exceção subia para o catch genérico do
> endpoint — que em alguns caminhos já tinha gravado a linha. Agora vira recusa.
> `compensarBlobAssinado` cobre a terceira: falhando o D1 depois do `put`, o
> blob órfão é removido, e o que resistir cai na pendência durável de
> FLW-R2-004.
>
> Os dois finalizadores de escala mensal já usavam `getR2` (que lança), e por
> isso não tinham o furo; ficam como estão.
>
> Cobertura: `assinatura/__tests__/blob-assinado.test.ts`, 7 casos — os três
> cenários pedidos pelo achado (R2 ausente, `put` falho, falha posterior de D1).
> Duas mutações verificadas.

### FLW-DOC-003 — revogação/reassinatura GISE deixa artefatos antigos

**Severidade:** P1  
**Estado:** corrigido  
Caminhos alternativos removem apenas D1, e upserts de documento/assinatura
não garantem remoção dos PDFs, conferências e selfies anteriores
(`actions-equipe.ts:53-56,135-139`, `actions-seccional.ts:97-113`,
`actions-escala.ts:264-272,392-396`,
`src/lib/db/gise/documentos.ts:78-86` e `gise/assinaturas.ts:149-161`).

**Ação/teste:** centralizar revogação/reassinatura com limpeza R2 prévia,
preservação de chaves novas e auditoria. Hash antigo não deve resolver após
alterar, reabrir ou reassinar.

> **CORRIGIDO (05/ago/2026).** Os endpoints de reabrir/revogar já chamavam
> `limparR2DaGise`; o buraco estava nos caminhos por FORM ACTION, que apagavam
> `gise_documentos` (e, via `revogarAssinaturasSeccional`, relatórios e
> presenças) sem tocar no bucket.
>
> A limpeza entrou no DESFECHO, que é por onde as treze actions passam desde
> FLW-GISE-003 — `invalidarDocumentoDaEscala` e `invalidarAssinaturasDaSeccional`
> agora recebem o bucket e apagam os bytes ANTES das linhas. A ordem é o ponto:
> é a linha que diz quais objetos existem.
>
> Duas coletas novas em `r2-cleanup.ts`, e são deliberadamente ESTREITAS:
> `coletarChavesR2DoDocumentoGise` (só o consolidado) e
> `coletarChavesR2DaRevogacaoSeccional` (consolidado + relatórios da seccional +
> selfies de presença dos seus membros). Usar `coletarChavesR2DaGise`, que varre
> a GISE inteira, apagaria blobs de documentos que a invalidação NÃO derruba.
> A segunda espelha passo a passo o que `revogarAssinaturasSeccional` apaga, e
> recebe o id da PARTICIPAÇÃO pelo mesmo motivo que ela — ver FLW-GISE-011.
>
> Fechados também os dois caminhos fora do desfecho: `removerSeccional` (cujo
> `excluirGiseSeccional` leva equipes, membros e, em cascata, presenças e
> relatórios) e a edição de data/horário da escala.
>
> Isto encerra o "fica em aberto" registrado em FLW-GISE-006.
>
> Cobertura: 3 casos em `gise/[id]/_actions/__tests__/desfecho.test.ts`,
> incluindo a selfie de presença e a cópia de conferência (prefixo PLANO, que
> escapa da varredura por prefixo). Mutação verificada: removida a limpeza,
> dois casos reprovam.

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
**Estado:** corrigido  
Desativar policial apenas grava `ativo: 0`; sessão admin é validada contra
`administradores` sem conferir o policial vinculado, e 2FA pode criar nova
sessão sem revalidação (`src/routes/policiais/[id]/+page.server.ts:575`,
`src/lib/auth.ts:323-329` e `api/auth/verificar-2fa/+server.ts:111-129`).

**Ação/teste:** revogar vínculo, sessões e desafios em unidade atômica; validar
`policiais.ativo = 1` em sessão admin e confirmação 2FA. Cobrir sessão
existente e 2FA pendente após desativação.

> **CORRIGIDO (04/ago/2026).** Três buracos, o mesmo enunciado:
>
> 1. `validarSessao` e `validarSessaoComAceite` liam a linha `administradores`
>    sem olhar o vínculo — desativar o policial fechava o modo usuário e deixava
>    de pé o modo administrador, que é o mais poderoso dos dois. O ramo de
>    policial sempre exigiu `ativo = 1`; faltava no de admin. Resolvido por
>    `queryAdminDaSessao` + `adminDaSessao`, um `leftJoin` na mesma query (a
>    versão em batch não podia pagar round-trip a mais).
> 2. `verificar-2fa` emitia sessão sem repetir a checagem — um 2FA pendente
>    virava sessão de administrador depois da desativação. Passou a usar
>    `buscarAdminAtivo`, a mesma regra.
> 3. A desativação não derrubava sessão nenhuma: só impedia o próximo login, e
>    a sessão aberta seguia por até 8h. `registrarDesvinculacao` agora chama
>    `revogarSessoesDaCredencial`.
>
> Cobertura: dois casos em `e2e/revogacao-credencial.spec.ts` — um para a
> validação da sessão, outro para a action —, ambos reprovando o código
> anterior.

### FLW-POLICIAL-002 — exclusão física apaga histórico e pode deixar R2 órfão

**Severidade:** P0  
**Estado:** corrigido  
A action executa `excluirPolicial` sem análise de impacto
(`src/routes/policiais/+page.server.ts:268-271`), e o DB executa DELETE físico
(`src/lib/db/policiais.ts:431-439`). Cascades removem escala, GISE, presença,
respostas e histórico, enquanto documentos R2 podem perder referência.

**Ação/teste:** recusar exclusão enquanto houver dependência ou adotar somente
desativação; aplicar `RESTRICT` a vínculos históricos indispensáveis. Testar
policial com escala, GISE, presença e histórico.

> **CORRIGIDO (05/ago/2026) — decisão do operador: recusar quando há documento
> assinado; desativar em vez de apagar.** A regra não é "nunca apagar": é nunca
> apagar o que um documento assinado referencia. Cadastro digitado errado
> continua podendo sumir.
>
> `impedimentoParaExcluirPolicial` (`lib/db/policial-exclusao.ts`) responde por
> quatro caminhos, em duas naturezas: por AUTORIA (termo de presença dele,
> relatório de extra que ele assinou) e por MENÇÃO (escala assinada em que está
> escalado, GISE assinada de que é membro). As duas contam — um PDF que LISTA
> alguém inexistente é tão inconsistente quanto um assinado por alguém
> inexistente, e a menção é o caso mais comum: o policial escalado que nunca
> assinou nada.
>
> A mensagem nomeia os vínculos e aponta a desvinculação. Quem lê precisa
> escolher entre apagar e desativar, e "não pode" sem dizer o que está
> preservando não sustenta essa escolha.
>
> Cobertura: 8 casos contra SQLite real; os de MENÇÃO reprovam uma versão que
> só olhasse autoria.
>
> **Fica em aberto** a limpeza de R2 na exclusão permitida (cadastro sem
> documento pode ter anexo de histórico). É escopo de FLW-R2-004.

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
**Estado:** corrigido  
Movimentação, desvinculação e papel persistem cadastro, histórico e auditoria
em etapas independentes (`src/routes/policiais/[id]/+page.server.ts:339-377,459-488,575-606`).

**Ação/teste:** transacionar registros ou usar outbox; compensar upload R2 se
persistência falhar. Injetar falha em histórico/auditoria.

> **CORRIGIDO (05/ago/2026).** Cadastro e linha do tempo passaram a entrar
> juntos, por `atualizarPolicialComHistorico` — um `db.batch`, que no D1 é
> transação. Vale para as quatro actions que mudam cadastro: `salvar`,
> `salvarPapel`, `registrarMovimentacao` e `registrarDesvinculacao`.
>
> O que a janela deixava não é abstrato: lotação trocada sem a portaria na linha
> do tempo, papel administrativo concedido sem registro de quem concedeu, e —
> o pior — cadastro INATIVADO sem data, sem NUP e sem responsável, uma baixa
> funcional sem ato que a fundamente. Ninguém percebia porque cada tela lê uma
> das metades.
>
> Para compor o `UPDATE` num batch foi preciso separá-lo da cifragem do CPF, que
> é assíncrona: `camposDeAtualizacao` devolve o `SET` pronto e `atualizarPolicial`
> passou a ser a casca. `await atualizarPolicial(...)` não servia como
> ingrediente — o builder do drizzle é thenable, então o `await` o EXECUTA.
>
> **A AUDITORIA ficou de fora do batch, e é decisão registrada.** `auditar()`
> nunca lança e resolve a própria falha por pendência durável (FLW-AUDIT-001).
> Metê-la na transação trocaria uma garantia que já existe pela possibilidade de
> a mutação do usuário ser desfeita por causa da trilha — exatamente a política
> que o operador recusou ao decidir "pendência durável e segue".
>
> **Compensação de R2** (`abortarComLimpezaR2`): o PDF sobe ANTES da mutação de
> propósito — anexo inválido aborta com 400 sem ter mexido no cadastro —, e era
> isso que abria a outra ponta. Falhando a gravação, o objeto ficava no bucket
> sem nenhuma linha apontando para ele: invisível para a tela, invisível para o
> expurgo de retenção, e contando como dado pessoal armazenado sem base. As três
> ações com anexo agora apagam a chave e devolvem 500 — incluindo
> `registrarAfastamento`, que não muda cadastro e portanto não tinha o que
> transacionar, mas tem o mesmo anexo.
>
> Efeito colateral corrigido de quebra: em `registrarDesvinculacao` a revogação
> de sessões acontecia ANTES do histórico. Passou para depois da baixa
> persistida — revogar sessão de um cadastro que voltou a ser ativo é
> inofensivo; o contrário, não.
>
> Cobertura: `src/lib/db/__tests__/policial-mudanca-atomica.test.ts`, 6 casos —
> os três caminhos felizes e as três falhas, incluindo a falha no sentido
> inverso (o `UPDATE` é que morre, e o histórico não pode afirmar uma
> movimentação que não aconteceu). Verificado por mutação: com as duas escritas
> em sequência, dois casos reprovam.

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
| FLW-AUDIT-001    | ✅ `lib/db/__tests__/audit-pendencia.test.ts`                                                   | falha de auditoria e duas finalizações concorrentes: rollback total **ou** pendência durável, sem perda na cadeia |
| FLW-LGPD-002     | ✅ `lib/server/__tests__/email-logging.test.ts`                                                 | resposta de e-mail com destinatário/corpo: logger e erro não podem conter PII/conteúdo                            |
| FLW-GISE-004     | ✅ `e2e/autorizacao-negativa.spec.ts`                                                           | POST direto por policial comum/admin fora do escopo: 403 e nenhum estado/documento/audit alterado                 |
| FLW-GISE-005     | ✅ `lib/gise/__tests__/finalizacao.test.ts`                                                     | finalizar `em_andamento` por action e API: 409 e status/documento/integração intactos                             |
| FLW-GISE-006     | ✅ `e2e/gise-imutabilidade.spec.ts`                                                             | alterar vagas em GISE finalizada: 409, slots/hash/R2/auditoria preservados                                        |
| FLW-WEBHOOK-001  | ✅ `lib/db/__tests__/reset-atomicidade.test.ts`                                                 | falha na segunda deleção: nenhuma tabela alterada e tentativa registrada                                          |
| FLW-AUTH-001     | ✅ `server/auth/__tests__/session-cache.test.ts` (sem e2e — ver o achado)                       | aquecer cache e revogar/resetar/desativar: próximo request retorna 401                                            |
| FLW-AUTH-002     | ✅ `e2e/revogacao-credencial.spec.ts` + `auth/__tests__/credencial.test.ts`                     | reset de admin vinculado: senha antiga falha nos dois modos, nova funciona e ambos cookies são revogados          |
| FLW-ESC-001      | ✅ `e2e/escala-papel.spec.ts`                                                                   | OIP sem papel na mesma lotação chama mutar/assinar/finalizar/revogar: 403 em todas                                |
| FLW-ESC-002      | `e2e/escalas-ids-cruzados.spec.ts`                                                              | item de escala B enviado à rota A: 404/403 e A/B intactas                                                         |
| FLW-ESC-003      | `e2e/escalas-imutabilidade.spec.ts`                                                             | cada action material/exclusão em escala assinada: 409, PDF/hash/membros preservados                               |
| FLW-DOC-001      | ✅ `lib/server/assinatura/__tests__/intencao.test.ts` + `e2e/assinatura-qualificada-a3.spec.ts` | preparar A/finalizar B; ator/tipo divergentes e reutilização: falha sem D1/R2/audit alterados                     |
| FLW-ACL-002      | ⤵ reclassificado P2 — ver o achado                                                              | usuário autenticado de outra lotação baixa por hash: 403 sem bytes; autorizado recebe somente cópia permitida     |
| FLW-RBAC-001     | ✅ `e2e/revogacao-credencial.spec.ts`                                                           | desativar policial-admin com sessão e 2FA pendente: ambos os caminhos retornam 401                                |
| FLW-POLICIAL-002 | ✅ `lib/db/__tests__/policial-exclusao.test.ts`                                                 | excluir policial com grafo histórico: operação recusada e referências/R2 continuam recuperáveis                   |

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
