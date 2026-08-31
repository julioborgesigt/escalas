# Plano — módulo Plano Operacional (operação com deslocamento) e parâmetros de custo

**Data:** 30/ago/2026
**Status:** nada no código — plano aprovado, implementação não iniciada.
**Não é:** confirmação de presença, relatório extraordinário, nem assinatura
digital do plano. Esses três ficam **fora deste ciclo**, por decisão explícita.

> **Registro do que foi PLANEJADO, não do que está no código.** O módulo foi
> implementado e o modelo evoluiu depois: o signatário virou campo do plano (não
> há mais padrão global em `/config-custos`), e o `local_briefing_padrao` desta
> Fase 0 **não existe mais** — briefing e destino são listas por plano
> (`plano_opcoes`), com uma opção padrão arbitrada por índice único parcial. A
> descrição vigente está no [`README.md`](../README.md) §8; este documento fica
> como o registro da decisão original.

---

## 1. Contexto

O sistema só conhece **escala extra**: serviço sem deslocamento fora da
circunscrição, saindo de ponto de origem fixo, pago sempre em hora extra. O
custo nunca precisou ser calculado, então não existe no código — nenhuma tabela,
nenhuma tela, nenhum valor de hora ou diária.

Falta cobrir a **operação especial**: uma ou mais equipes se deslocam para
cumprir mandados de prisão / busca e apreensão domiciliar demandados por uma
delegacia ou seccional. Ela muda duas coisas de uma vez:

1. **o pagamento deixa de ser único.** Pode ser hora extra, diária ou nada,
   conforme o dia e o horário — entre 08:00 e 18:00 em dia útil não há custo;
   fora disso é hora extra; em fim de semana ou feriado é hora extra em qualquer
   horário, acrescida de 30% (a **hora extra plus**, que também cobre
   00:00–05:59 em dia útil);
2. **os parâmetros passam a ser por equipe.** Viatura, cidade de destino, local
   de briefing, horário próprio (há equipe que desloca antes) e a quantidade de
   horas ou de diárias de cada uma.

O entregável é o **plano operacional em PDF**, nos moldes do modelo fornecido
(`Plano — 4ª Seccional do Interior Sul`): corpo com oito seções numeradas,
Anexo I com as equipes e seus custos, Anexo II com o consolidado financeiro.
Tudo preenchido pelo Administrador Geral (GISE).

O módulo nasce **isolado** — tabelas, camada de dados, rotas e PDF próprios —
para que mexer nele não alcance a escala extra que já roda em produção. O que se
reaproveita é padrão e utilitário, não estrutura compartilhada.

---

## 2. Decisões que orientam o resto do documento

| Decisão                                                                                                   | Porquê                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tabelas e rotas próprias (`planos_operacionais`, `/gise/planos`), **não** uma flag em `operacoes`          | `operacoes` é o CATÁLOGO de operações (GISE, CRAJUBAR) do qual as escalas GISE pendem (`gise_escalas.operacao_id`). Um plano operacional não é catálogo: é evento único com equipes próprias. Discriminar por coluna faria toda consulta de `/gise/operacoes` e `/gise` passar a filtrar — o acoplamento a evitar |
| Dinheiro em **centavos** (`integer`)                                                                      | Nunca float para moeda. Meia diária vira `diarias_meias` (1–30, inteiro), não `2.5`                                                                                                                                                                                                                               |
| Tabela de valores **versionada** (append-only); o plano guarda a versão que usou                          | Reemitir em junho o PDF de um plano de março tem de devolver os mesmos números depois de um reajuste                                                                                                                                                                                                              |
| `cargo` + `classe` do policial **congelados na linha do membro**                                          | São a base de cálculo do custo. Nome, matrícula, lotação e telefone continuam vindo vivos do cadastro, porque são identificação/contato — não mudam o valor pago                                                                                                                                                  |
| Classe vazia **não vira R$ 0 em silêncio**                                                                | `policiais.classe` é `text NOT NULL DEFAULT ''`. Sem faixa resolvida, a linha sai como pendência na tela e o PDF não é liberado                                                                                                                                                                                   |
| Quantidade de horas/diárias **digitada, com sugestão calculada**                                           | A classificação 08–18h / fim de semana / feriado sugere; o Admin Geral confirma ou sobrescreve — a equipe que desloca antes é o caso normal, não a exceção                                                                                                                                                        |
| **CPF não vai ao PDF**                                                                                    | Minimização LGPD: o modelo não o traz e o documento circula. Fica no banco. A Classe entra porque é ela que justifica o valor/hora da linha                                                                                                                                                                       |
| Assinatura do PDF é do **Diretor Titular do DPI SUL**; o coordenador fica no item 8                       | É o que o modelo faz. Nome e cargo do Diretor são configuráveis e ficam congelados no plano                                                                                                                                                                                                                        |

---

## 3. Fase 0 — Modelo de dados

`migrations/0068_plano_operacional.sql` (uma migração, quatro tabelas) +
declaração em `src/lib/server/schema.ts`, no estilo comentado de
`migrations/0051_operacao_config.sql`.

### `custo_parametros` — os valores, versionados

**Append-only: nunca `UPDATE`.** Dez valores em centavos —
`oip_cd_normal`, `oip_ab_normal`, `dpc_12_normal`, `dpc_3e_normal`, os quatro
`_plus` correspondentes, `diaria_estadual`, `diaria_interestadual` — mais
`vigente_desde`, `criado_por_id`, `criado_por_nome`, `created_at`. Vigente = a
linha de maior (`vigente_desde`, `id`).

Os quatro `_plus` são **colunas próprias, não derivadas**: a tela pré-preenche
com `normal × 1,3` e o Super Admin pode ajustar, mas o valor que o plano usou
fica gravado. Derivar no momento da leitura faria um reajuste na alíquota mudar
retroativamente um documento já entregue.

### `planos_operacionais` — os parâmetros gerais

`numero` + `ano` (`UNIQUE (ano, numero)`, sequencial automático), `nome`,
`finalidade`, `nup` (opcional), `data_inicio`/`hora_inicio`/`data_fim`/`hora_fim`,
`feriado`, `acoes` (as linhas do item 2b do PDF), `coordenador_id` →
`policiais`, `demandante_unidade_id` → `unidades` (`onDelete: restrict`, como
`gise_seccionais`), `departamento` (default `'DPI SUL'`),
`local_briefing_padrao`, `oip_por_equipe_padrao`, `diretor_nome` +
`diretor_cargo`, `custo_parametro_id` → `custo_parametros`, `status`
(`rascunho` | `concluido`), `created_at`/`updated_at`.

> `data_fim`/`hora_fim` não estavam na lista de parâmetros pedida, mas a sugestão
> automática de horas precisa de uma janela para classificar. Entram como
> previsão de término, editável. Nulos, a sugestão não é oferecida e a
> quantidade é só digitada.

### `plano_equipes`

`plano_id` (cascade), `ordem`, `nome` (nasce `Equipe 01`…), `tipo`
(`operacional` | `seint`), `viatura_modelo`, `viatura_placa`,
`data_inicio`/`hora_inicio`/`hora_fim` (**NULL = herda do plano**),
`cidade_destino`, `local_briefing` (NULL = herda o padrão), `tipo_custo`
(`sem_custo` | `hora_extra` | `diaria`), `horas_normais`, `horas_plus`,
`diaria_tipo` (`estadual` | `interestadual`), `diarias_meias`.

NULL e zero são respostas diferentes, pela mesma razão registrada em
`operacoes`: herdar o padrão não é o mesmo que escolher o valor vazio.

### `plano_equipe_membros`

`equipe_id` (cascade), `plano_id` (denormalizado, mesma razão de
`gise_membros.gise_id`: o SQLite não indexa através de join), `policial_id`,
`cargo_snapshot`, `classe_snapshot`, `chefe`. Dois índices únicos:
`(plano_id, policial_id)` — um servidor por plano — e
`(equipe_id) WHERE chefe = 1` — um chefe por equipe.

O chefe é **flag na linha do membro**, e não `chefe_policial_id` na equipe,
justamente para não sobrar ponteiro pendurado quando o membro sai: o `CASCADE`
resolve sozinho o que um ponteiro exigiria lembrar de limpar.

---

## 4. Fase 1 — Regras puras (`src/lib/planos/`)

Tudo aqui é `.ts` puro com `__tests__/` ao lado. É o que a regra "se uma regra
precisa de teste, ela sai do `.svelte`" exige, e é onde mora o risco real desta
entrega.

- **`faixa-custo.ts`** — `faixaDoPolicial(cargo, classe)` → `'dpc_12'` |
  `'dpc_3e'` | `'oip_ab'` | `'oip_cd'` | `null`. O domínio das classes já existe
  em `classesDoCargo()` (`src/lib/cadastro-campos.ts`): DPC = `1ª 2ª 3ª ESPECIAL`,
  OIP = `A B C D`. `null` para classe em branco ou fora do domínio — e quem
  chama trata como pendência, **nunca como zero**.
- **`horas-extras.ts`** — `classificarJanela({ inicio, fim, feriado })` →
  `{ normais, plus, semCusto }`, percorrendo a janela hora a hora. Fim de semana
  ou feriado: tudo `plus`. Dia útil: 00:00–05:59 `plus`, 06:00–07:59 normal,
  08:00–17:59 sem custo, 18:00–23:59 normal.

  **Armadilha que o `CLAUDE.md` cataloga três vezes** (`hoje()` com
  `toISOString()`, o laço "dias do intervalo", `toISO` com duas convenções de
  mês): montar as datas a partir das partes da string, ou pelo truque de
  meio-dia já usado em `diaSemana` (`new Date(iso + 'T12:00:00')`). Nunca
  `toISOString()`, que joga o dia para UTC e classifica sábado como sexta.

- **`custo.ts`** — `custoDaEquipe(equipe, membros, parametros)` e
  `custoDoPlano(...)`, devolvendo subtotal por equipe, consolidado por categoria
  (DPC/OIP × DRO/diária, que é o que o Anexo II imprime), total geral e a lista
  de membros sem faixa resolvida. Diária:
  `Math.round(diarias_meias * valor / 2)`, com a regra de arredondamento no
  JSDoc.
- **`rotulos.ts`** — os rótulos que o PDF e a tela compartilham, numa fonte só:
  `DRO (H. Extra)`, `Diária estadual`, `Diária interestadual`, `Sem custo`, e
  `resumoHoras(6, 5, 1)` → `6h (5N/1A)` (formato do modelo: N = normal,
  A = acrescida). Duas cópias divergiriam na primeira correção feita numa delas.
- **`diarias.ts`** — validação de 1 a 30 meias-diárias (0,5 a 15) e a formatação
  `"2,5 diárias"`.

---

## 5. Fase 2 — Camada de dados (`src/lib/db/planos/`)

`crud.ts` (planos + numeração), `equipes.ts`, `membros.ts`,
`custo-parametros.ts`, `index.ts` — espelhando a fachada de
`src/lib/db/operacoes/index.ts`, reexportada por `src/lib/db.ts`.

Arquivo novo em `src/lib/db/` é verificado por `npm run docs:guard`: **cabeçalho
no topo e JSDoc em todo export**.

Regras que moram aqui, não nas rotas:

- **numeração do plano** — `SELECT MAX+1` dentro do próprio `INSERT`, com o
  `UNIQUE (ano, numero)` como tranca real da corrida. Mesma lição de
  `uq_escalas_mensal`: consulta prévia não fecha corrida, e sem o índice a
  violação chega à action como 500 com SQL cru em vez de 409;
- **`criarPlanoComEquipes`** — cria plano e as N equipes (`Equipe 01`…, mais a
  SEINT quando pedida) numa chamada só;
- **`adicionarMembro`** grava `cargo_snapshot`/`classe_snapshot` lidos do
  cadastro no INSERT e deriva `plano_id` da própria equipe;
- **`definirChefe`** limpa o chefe anterior da equipe no mesmo passo.

---

## 6. Fase 3 — Autorização (`src/lib/server/planos/permissao.ts`)

Um único **portão**: `carregarPlanoParaEdicao(db, id, usuario)` → o plano ou a
recusa. Toda action e todo `+server.ts` do módulo entra por ele.

É a lição da tabela de duplicação do `CLAUDE.md`: o portão de assinatura GISE
rodava copiado em cinco rotas e duas delas divergiam, em eixos diferentes. Com
**um** ponto de entrada, a pergunta "todas concordam?" não chega a existir.

Nesta entrega: **Admin Geral** (`isAdminGeral`) escreve e lê os planos; **Super
Admin** (`isSuperAdmin`) edita os valores em `/config-custos`. Nenhuma operação
material do módulo é pública — nada a declarar em
`scripts/guard-autorizacao.mjs`.

---

## 7. Fase 4 — Telas

### `/config-custos` (nova, Super Admin)

`isSuperAdmin` no `load` **e** na action, espelhando
`src/routes/config-geral/+page.server.ts`. Os dez valores em campos de moeda,
com os quatro `plus` pré-preenchidos em `normal × 1,3` e editáveis, mais os dois
campos do bloco de assinatura (`diretor_nome`, `diretor_cargo`, gravados em
`configuracoes`). Salvar **insere uma versão nova** de `custo_parametros` e
audita (`auditar` + `contextoDeEvento`). A tela mostra a versão vigente e o
histórico, para o operador saber qual valor um plano antigo usou. Trava
`max-w-3xl`, como `config-geral`.

### `/gise/operacoes` — a bifurcação

O botão "Nova operação" passa a abrir um `ModalShell` com a escolha:

- **Operação** → abre o painel deslizante atual (`abrir('nova')`), sem nenhuma
  mudança de comportamento;
- **Plano operacional** → navega para `/gise/planos/novo`.

### `/gise/planos` e `/gise/planos/novo`

A lista (número/ano, nome, data, demandante, status, total) e a criação. A
criação é **rota própria, não modal** — README §10, "formulário longo vira
rota" —, com o mesmo calendário de marcação de feriado de `ModalCriarGise.svelte`,
extraído para `$lib/components/CalendarioDia.svelte` (seleção de UM dia). Se a
extração pedir props demais, a decisão de duplicar fica registrada no arquivo,
como o corolário do `CLAUDE.md` autoriza. Coordenador e demandante usam
`SearchableSelect` sobre `/api/policiais/search` e `/api/unidades/search`.

### `/gise/planos/[id]` — o editor

Cabeçalho editável (todos os parâmetros gerais), um card por equipe (viatura,
horário confirmado, cidade destino, briefing herdado ou próprio, tipo de custo e
quantidade — com o botão "sugerir" chamando `classificarJanela`) e, dentro dele,
os membros. Adicionar **por nome ou matrícula** já é o comportamento de
`/api/policiais/search` (o `q` casa os dois). Um painel consolidado mostra o
Anexo II antes de gerar o PDF, com aviso destacado para membro sem classe
cadastrada.

Actions divididas por assunto em `_actions/` (`actions-plano.ts`,
`actions-equipe.ts`, `actions-membros.ts`), como `src/routes/gise/[id]/_actions/`.

---

## 8. Fase 5 — O PDF

`src/lib/server/export/pdf-plano-operacional.ts` — **moldura própria**, pelo
mesmo critério que separou `pdf-relatorio-extra.ts` de `pdf.ts`: nenhum bloco
deste documento é usado por escala nenhuma. Exportado por
`src/lib/server/export/index.ts`.

Cabeçalho: a estrutura institucional **já em uso** (`CORPORACAO` /
`DELEGACIA_GERAL` / `DEPARTAMENTO` de `$lib/institucional` +
`embutirLogosNoTopo`), e não a do modelo — decisão do solicitante.

### Página 1 — corpo

`PLANO OPERACIONAL NNN/AAAA` · nome da operação em caixa alta ·
`Dia 29/09/2026 (Terça-feira)`, seguido das oito seções:

1. **FINALIDADE** — o texto do plano (padrão editável);
2. **CALENDÁRIO** — *a) Cronograma operacional:* DATA / HORÁRIO /
   `LOCAL DE APRESENTAÇÃO: Conforme anexo I.` · *b) Ações a serem realizadas:*
   a lista de `acoes` (padrão: Cumprimento de Mandados; Lavratura de APF; TCO e
   Inquéritos; Outros atos de Polícia Judiciária);
3. **REFERÊNCIAS** · 4. **PARTICIPANTES** (Conforme anexo I) · 5. **EXECUÇÃO** ·
   6. **EFETIVO EMPREGADO** (Conforme Anexo I) · 7. **CUSTOS OPERACIONAIS**
   (Conforme Anexo II);
8. **COORDENADOR** — `NOME, DPC, Mat. NNNNNNNN - <lotação>`.

Fecho `Fortaleza, 30 de agosto de 2026.` (`formatarDataExtenso`) e o bloco de
assinatura do **Diretor Titular do DPI SUL** (`diretor_nome`/`diretor_cargo`,
congelados no plano). O rodapé institucional das três páginas (endereço e
e-mail do DPI SUL) entra como constantes novas em `$lib/institucional`, nunca
literal no gerador — é exatamente a divergência que aquele arquivo existe para
impedir.

### Página 2 — `ANEXO I - DETALHAMENTO DE EQUIPES E CUSTOS`

Um bloco por equipe com
`Destino: <cidade> | VTR: <modelo/placa> | Apresentação: HH:MM | Briefing: <local>`,
e uma linha por membro no formato do modelo, acrescida da Classe:

```
FRANCISCO ALEX FELINTO DE LUCENA                     6h (5N/1A)
OIP C | Mat: 30010124 | 4ª Seccional do Interior Sul | Tel: 85 99268-1684
DRO (H. Extra)                                        R$ 163,80
```

com o chefe marcado e `Total: R$ …` por equipe.

### Página 3 — `ANEXO II - CONSOLIDADO FINANCEIRO`

Dois blocos e um total geral:

1. `DIÁRIA DE REFORÇO OPERACIONAL (HORAS EXTRAS)` — colunas CATEGORIA /
   QUANTIDADE / CUSTO TOTAL, linhas `Delegados (DPC)`, `Agentes (OIP)`, `TOTAL`
   (exatamente o modelo);
2. `DIÁRIAS` — mesma forma, separando estadual e interestadual;
3. `TOTAL GERAL`, somando os dois, e a nota `* Valores estimados.`

Uma linha de procedência fecha o anexo: a versão de valores aplicada
(`custo_parametros.id` + `vigente_desde`). É o que torna auditável um PDF
reemitido depois de um reajuste.

### Download

`/api/planos/[id]/download` (GET), passando pelo portão da Fase 3 e registrando
`registrarAuditComContexto` **antes de qualquer byte sair** — a regra de
`src/routes/api/gise/[id]/download/+server.ts`, porque exportar é acesso a dado
pessoal. Se algum membro estiver sem classe, o endpoint recusa com
`conflict(...)` nomeando quem falta, em vez de emitir um documento com R$ 0
silencioso. No cliente, `apiFetchResponse` + `baixarBlob` /
`nomeArquivoContentDisposition` de `$lib/utils/download`; nunca âncora montada
à mão.

**Golden**: entrada nova em
`src/lib/server/export/__tests__/fixtures/pdf-goldens.json`, gravada com
`UPDATE_PDF_GOLDENS=1` **uma vez**, depois de conferir o PDF gerado contra o
modelo.

### Dois utilitários que faltam e entram junto

- `diaSemanaExtenso(iso)` em `$lib/utils/datas` — hoje só existe
  `DIAS_SEMANA_CURTO` (`Ter`), e o modelo pede `Terça-feira`;
- `formatarBRL(centavos)` — moeda formatada a partir do inteiro, sem passar por
  float.

> **Nota, não bloqueio.** O texto padrão da finalidade contém "Departamento de
> Polícia Judiciária do Interior Sul", e o cabeçalho de
> `src/lib/institucional.ts` registra que esse órgão **não existe** no
> organograma — o nome correto é "Departamento de Polícia do Interior Sul —
> DPI SUL". Como é campo editável e foi ditado assim, entra literal como padrão,
> mas vale conferir antes do primeiro plano emitido.

---

## 9. Fase 6 — Navegação, guards e documentação

- **Menu**: destino novo entra em `src/routes/_components/menu-visibilidade.ts`
  **e** em `bem-vindo-cards.ts` — `__tests__/bem-vindo-cards.test.ts` reprova
  destino de menu sem quadro correspondente;
- `npm run guard:autorizacao` — toda action nova recusa alguém (Fase 3);
- `npm run guard:duplicacao` — o portão único da Fase 3 e o `rotulos.ts` da
  Fase 1 são o que evita a reprovação. **Não regravar a baseline para passar**;
- `npm run docs:guard` — cabeçalho + JSDoc nos arquivos de `src/lib/db/planos/`;
- **documentos vivos, no mesmo PR**: README §7 (estrutura de pastas) e §8
  (módulos) ganham o módulo; `TESTING.md` ganha o roteiro manual. Sem variável
  de ambiente nova.

---

## 10. Verificação

### Testes automatizados (o gate)

```bash
npm run test          # unitários — inclui os novos __tests__ de src/lib/planos/
npm run check         # type-check
npm run lint:strict
npm run format:check
npm run guard:autorizacao && npm run guard:duplicacao && npm run docs:guard
npm run test:e2e      # Playwright
```

Casos que os unitários precisam cobrir, porque são onde isto quebra em silêncio:
janela atravessando a meia-noite; sábado/domingo classificados por data **local**
(não UTC); feriado em dia útil; janela inteiramente dentro de 08:00–18:00 (custo
zero legítimo, distinto de classe faltando); membro com `classe = ''`; diária de
0,5 e de 15; arredondamento da meia diária; `resumoHoras` no formato
`6h (5N/1A)`.

### E2E (`e2e/`, Playwright)

Super Admin grava valores em `/config-custos` → Admin Geral entra em
`/gise/operacoes`, escolhe "Plano operacional", preenche os parâmetros, monta
duas equipes com membros e chefe, define custos diferentes em cada uma e baixa o
PDF (verificando `Content-Type` e `Content-Disposition`).

### No app de verdade (`npm run dev`)

1. `/config-custos` só abre para Super Admin — Admin Geral cai em `/`;
2. `/gise/operacoes` → "Nova operação" oferece as duas opções, e a opção
   *Operação* continua abrindo o painel de hoje sem mudança nenhuma;
3. plano criado em dia útil às 14:00 sugere custo zero; movido para sábado,
   sugere hora extra plus nas mesmas horas;
4. o PDF sai com as três páginas na ordem do modelo, e o TOTAL GERAL do Anexo II
   confere com o painel de custos da tela **e** com a soma dos totais do Anexo I;
5. reajustar os valores em `/config-custos` **não** muda o PDF do plano já
   criado — é a prova de que a versão ficou congelada.
