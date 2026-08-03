# Plano operacional — revisão de compreensão, comentários e duplicação

**Data-base:** 02/ago/2026  
**Status:** proposto — não iniciado  
**Dono da revisão:** a definir  
**Escopo mínimo obrigatório:** arquivos de código com mais de 200 linhas físicas  
**Objetivo:** fazer com que uma pessoa que nunca trabalhou no sistema consiga
entender a responsabilidade, os contratos e as decisões não óbvias do código
sem que os comentários se transformem em ruído ou em uma segunda
implementação, potencialmente desatualizada.

> Este é um plano de trabalho, não uma autorização para fazer mudanças
> mecânicas em massa. Cada comentário precisa ser comprovado pelo
> comportamento, pelos testes e pelos consumidores antes de ser alterado.

---

## 1. Resultado esperado

Ao encerrar a revisão:

1. **100% do escopo mínimo** terá uma ficha de revisão concluída.
2. Todo módulo importante terá um cabeçalho no topo quando o seu propósito,
   consumidores ou decisões não forem evidentes pelo nome e pela estrutura.
3. Todo export público com contrato não trivial terá documentação correta de
   entradas, retorno, efeitos, pré-condições, erros e invariantes relevantes.
4. Comentários incorretos, obsoletos ou redundantes estarão corrigidos,
   removidos ou substituídos por código mais claro.
5. Cópias de lógica serão tratadas como um achado: extraídas, mantidas
   separadas com justificativa explícita ou removidas se estiverem mortas.
6. Alterações de comportamento terão testes; alterações em artefatos jurídicos
   preservarão os goldens, exceto quando a mudança visual for deliberada e
   aprovada.
7. O registro final deixará rastreável o que foi revisado, quais achados foram
   resolvidos, quais foram aceitos como dívida e quem decidiu.

O objetivo não é maximizar a quantidade de comentários. Código simples deve
ser autoexplicativo; comentários existem para registrar **decisões e contratos
que não podem ser deduzidos com segurança apenas lendo a sintaxe**.

---

## 2. Escopo e inventário reproduzível

### 2.1 Escopo mínimo

A medição executada em 02/ago/2026 encontrou **131 arquivos** acima de 200
linhas físicas em `src/`, `e2e/` e `scripts/`, considerando extensões
`.ts`, `.svelte`, `.js`, `.mjs` e `.cjs`.

O número preliminar de 144, apresentado antes deste plano, não deve ser usado:
ele não foi reproduzido pela medição direta. O escopo oficial é sempre o
snapshot abaixo, executado no início de cada lote; arquivos podem cruzar o
limite durante a revisão.

```powershell
Get-ChildItem -Path src,e2e,scripts -Recurse -File `
  -Include *.ts,*.svelte,*.js,*.mjs,*.cjs |
  Where-Object { $_.FullName -notmatch '\\node_modules\\' } |
  ForEach-Object {
    $linhas = (Get-Content -LiteralPath $_.FullName | Measure-Object -Line).Lines
    if ($linhas -gt 200) {
      [PSCustomObject]@{
        Linhas = $linhas
        Arquivo = $_.FullName.Substring((Get-Location).Path.Length + 1).Replace('\','/')
      }
    }
  } |
  Sort-Object Arquivo |
  Format-Table -AutoSize
```

O agente que iniciar um lote deve copiar a saída para a seção “Registro de
execução” deste documento ou para a issue do lote. Isso torna a cobertura
auditável sem manter uma lista manual que envelhece.

### 2.2 Escopo complementar obrigatório

O limiar de tamanho é uma forma de priorização, não uma fronteira de risco.
Além dos 131 arquivos, incluir mesmo abaixo de 200 linhas:

- rotas de autenticação, sessão, CSRF, webhooks e redefinição de senha;
- rotas que servem ou autorizam download de documento assinado;
- helpers de autorização, datas, fuso horário, serialização e validação;
- código que gera, assina, valida ou armazena PDF, e-mail e termo;
- qualquer arquivo tocado por uma extração ou alteração de comentário;
- testes diretamente responsáveis por documentar os contratos revistos.

Não entram, salvo indício concreto de problema: dependências, arquivos
gerados, caches, mídia, builds e migrations SQL sem funções.

### 2.3 Baseline documental atual

Executado em 02/ago/2026:

```text
npm run docs:inventario

311 arquivos ≥ 40 linhas
76 sem cabeçalho de módulo
1 arquivo “opaco” pela heurística
1 export público sem JSDoc
```

O arquivo opaco identificado foi
`src/routes/escalas/[id]/_components/EscalaCabecalho.svelte`; o export sem
JSDoc está em `src/routes/res-gise/_components/useResGise.svelte.ts`.

`docs:inventario` é um instrumento de triagem. Ele não certifica que um
comentário está correto, não analisa todos os tipos de export e não substitui
leitura humana.

---

## 3. Princípios e padrão de qualidade

### 3.1 Ordem de prioridade documental

Aplicar nesta ordem, definida no `CLAUDE.md`:

1. **Cabeçalho de módulo** — no topo, antes dos imports; identifica o papel
   do arquivo, quem o consome e as decisões importantes.
2. **Contrato de export público** — JSDoc quando a assinatura não basta para
   comunicar comportamento, restrições e efeitos.
3. **Comentário de ponto opaco** — junto à decisão que exige contexto de
   negócio, segurança, biblioteca ou ordem de execução.

Não criar comentários como `/** Busca uma escala pelo id. */`. Se a função já
se chama `buscarEscalaPorId`, isso não ensina nada e cria uma superfície que
pode divergir do código.

### 3.2 O que um comentário deve explicar

É candidato a comentário o trecho que responde a pelo menos uma pergunta:

- **Por que** esta regra existe?
- **Quem** pode executar esta operação e qual é a definição exata daquele
  papel?
- **Qual ordem** é obrigatória e qual falha ocorre se ela for invertida?
- **Qual invariante** deve continuar verdadeiro entre chamadas?
- **Que limitação externa** (SvelteKit, Cloudflare, ICP-Brasil, biblioteca ou
  protocolo) motivou a solução?
- **Qual consequência jurídica, de segurança ou de integridade** impede uma
  simplificação aparentemente natural?

Afirmações de segurança, permissão, legislação ou protocolo exigem fonte
verificável no código, nos testes ou na documentação oficial. Não presumir que
um comentário antigo está certo por já existir.

### 3.3 O que deve ser resolvido no código, não no comentário

Preferir renomear, dividir ou extrair quando houver:

- função longa que reúne responsabilidades diferentes;
- parâmetros booleanos ou numéricos sem significado autoevidente;
- nomes que escondem unidade, fuso, estado ou efeito colateral;
- estrutura de controle que torna a regra ilegível;
- mesma lógica em dois ou mais lugares.

Uma extração não é automática: se o componente ou helper comum exigir uma
interface artificial e difícil de usar, manter as implementações separadas e
registrar a diferença de responsabilidade.

---

## 4. Método de revisão por arquivo

Cada arquivo recebe uma ficha completa. A ficha só pode ser marcada como
“revisada” depois que todos os itens aplicáveis forem avaliados.

### 4.1 Preparação

1. Ler o cabeçalho, imports, exports e consumidores principais.
2. Identificar o domínio: assinatura, exportação, autenticação, banco,
   escalas, GISE, API, UI ou infraestrutura.
3. Abrir os testes adjacentes em `__tests__/` e a rota/componente consumidor.
4. Para Svelte/SvelteKit, consultar a documentação oficial antes de propor
   mudança e validar componentes modificados com o autofixer do Svelte.
5. Verificar `README.md`, `DEPLOY.md`, `TESTING.md` e `CLAUDE.md` quando a
   regra afetar seu conteúdo.

### 4.2 Revisão de compreensão e comentários

Para cada módulo, export e função complexa:

1. Comparar comentário, implementação, chamadores e teste.
2. Marcar o comentário como **correto**, **incompleto**, **incorreto**,
   **obsoleto**, **redundante** ou **não aplicável**.
3. Para toda divergência, registrar literalmente:
   - o que o comentário afirma;
   - o que o código realmente faz;
   - a evidência consultada;
   - o risco de alguém seguir a explicação atual.
4. Analisar funções com pelo menos 25 linhas, alto número de ramos, acesso a
   dados, autorização, serialização, data/fuso ou efeitos externos mesmo que
   não sejam exportadas.
5. Identificar regras implícitas que um novo programador não conseguiria
   reconstruir com segurança.

### 4.3 Revisão de duplicação e coesão

Buscar duplicação em dois níveis:

1. **Estrutural:** blocos com forma quase idêntica, usando `fallow`.
2. **Semântica:** funções com nomes ou sintaxe diferentes, mas que definem a
   mesma regra ou convertem o mesmo dado.

Pontos de busca obrigatórios:

- autorização e papéis (Admin Geral, Super Admin, policial, GISE);
- datas locais, UTC, intervalos, calendários e rotação;
- erros de banco e conflitos de unicidade;
- parsing e validação de requests;
- fluxos preparar → assinar → finalizar;
- geração e download de documentos;
- modais, seleção, loading e ações repetidas de UI.

A configuração atual de `.fallowrc.json` não cobre todo `src/lib/server/`.
Para a revisão, executar uma análise isolada cuja entrada inclua todo
`src/**/*.{ts,svelte}`. Não alterar a configuração versionada apenas para
diagnóstico; registrar o comando/configuração temporária usada na ficha.
Reduzir `minOccurrences` de 3 para 2 somente como sinal de investigação, não
como prova de que duas ocorrências devem ser unificadas.

### 4.4 Classificação do achado

| Tipo | Definição | Exemplo de ação |
| --- | --- | --- |
| `DOC-CORRETO` | comentário confere e agrega contexto | manter |
| `DOC-INC` | comentário não basta para uso seguro | ampliar contrato/decisão |
| `DOC-ERR` | comentário contradiz o comportamento | corrigir com teste/evidência |
| `DOC-OBS` | contexto deixou de ser verdadeiro | atualizar ou remover |
| `DOC-RUIDO` | repete o código sem agregar decisão | remover e melhorar nome se preciso |
| `DUP-EXTRAIR` | lógica igual deve ter fonte única | criar helper/componente/composable |
| `DUP-MANTER` | forma parecida, mas responsabilidades divergem | registrar por que não extrair |
| `COESAO` | arquivo/função mistura responsabilidades | separar em unidades testáveis |
| `RISCO` | erro pode afetar segurança, jurídico ou dados | bloquear PR e escalar |

Severidade:

- **P0:** autorização, segredo, assinatura/documento jurídico, perda ou
  corrupção de dados, exposição de dados pessoais.
- **P1:** regra de negócio incorreta, comportamento de API ou validação que
  pode produzir resultado errado.
- **P2:** manutenção, entendimento ou duplicação sem impacto funcional
  conhecido.
- **P3:** estilo, nomenclatura e comentário redundante localizado.

---

## 5. Ficha obrigatória de arquivo

Copiar este modelo para o registro de cada arquivo revisado. Uma issue,
checklist de PR ou seção deste documento é aceitável, desde que mantenha todos
os campos e um link para o diff que resolveu cada achado.

```md
## REV-<DOMINIO>-<NNN> — caminho/do/arquivo.ts

**Linhas no início:** NNN
**Domínio:** auth | assinatura | export | db | escalas | gise | api | ui | infra
**Risco:** P0 | P1 | P2 | P3
**Revisor:** nome/agente
**Data:** AAAA-MM-DD
**Status:** pendente | em revisão | bloqueado | revisado | corrigido

### Contexto e consumidores
- Responsabilidade:
- Consumidores principais:
- Testes e documentação consultados:

### Cabeçalho do módulo
- [ ] Não necessário, por quê:
- [ ] Presente e correto
- [ ] Criado/corrigido no PR:

### Funções e exports
| Símbolo | Evidência verificada | Situação do comentário | Ação / achado |
| --- | --- | --- | --- |
| `nomeDaFuncao` | chamador + teste | correto | nenhuma |

### Comentários incorretos ou ausentes
| ID | Linha | Comentário / contexto atual | Comportamento comprovado | Severidade | Decisão |
| --- | --- | --- | --- | --- | --- |
| DOC-ERR-001 | 42 | ... | ... | P1 | corrigir |

### Duplicação, coesão e código morto
| ID | Trechos/arquivos comparados | Evidência | Decisão | Teste necessário |
| --- | --- | --- | --- | --- |
| DUP-EXTRAIR-001 | A ↔ B | mesma regra em 3 fluxos | extrair | unitário |

### Verificação
- [ ] `npm run docs:inventario`
- [ ] lint/check aplicáveis
- [ ] testes do domínio
- [ ] golden de PDF/e-mail, se aplicável
- [ ] documentação viva atualizada, se comportamento mudou
```

---

## 6. Organização em lotes

Cada lote é uma unidade independente de diagnóstico e correção. Um agente só
deve reivindicar um lote por vez; dois agentes não editam o mesmo domínio sem
um responsável de integração definido.

| Lote | Domínio e caminhos-alvo | Risco predominante | Condição especial |
| --- | --- | --- | --- |
| 0 | baseline, inventário, convenções e registro | P1 | sem mudanças de produção |
| 1 | `src/lib/server/assinatura/**` | P0 | validar fluxos e preservar artefatos |
| 2 | `src/lib/server/export/**`, `email.ts`, `server/gise/termo-presenca.ts` | P0 | golden antes/depois |
| 3 | `src/lib/auth.ts`, `hooks.server.ts`, `server/auth/**`, login e senha | P0 | não enfraquecer gates |
| 4 | `src/routes/api/**` de assinatura, validação, download e webhook | P0 | conferir autenticação e erro API |
| 5 | `src/routes/escalas/**`, `server/escalas/**`, `lib/db/escalas.ts` | P1 | fuso, conflito e estado da escala |
| 6 | `src/routes/gise/**`, `lib/db/gise/**`, `server/gise/**` | P1 | status, presença e seccionais |
| 7 | `src/lib/db/**`, `server/schema.ts`, auditoria e LGPD | P1 | contratos de dados e retenção |
| 8 | composables e componentes de assinatura | P1 | Svelte 5, efeitos e cancelamento |
| 9 | páginas grandes compartilhadas: layout, login, painel, produtividade, recebidos, auditoria | P2 | cabeçalho e coesão de UI |
| 10 | policiais, unidades, perfil, res-gise e telas restantes | P1/P2 | autorização e dados pessoais |
| 11 | testes grandes, scripts e escopo complementar abaixo de 200 linhas | P1/P2 | contrato e regressões |
| 12 | consolidação, regressão completa e aceitação de dívidas | P0–P3 | nenhum item sem decisão |

### Ordem obrigatória

Os lotes 1–4 precedem quaisquer refactors amplos de UI, pois segurança e
documentos jurídicos têm maior custo de regressão. Lotes 5–11 podem rodar em
paralelo quando não compartilharem arquivos. O lote 12 só começa após todos
os registros terem estado final.

---

## 7. Protocolo de mudança

### 7.1 Separar diagnóstico de implementação

1. Primeiro registrar achados e evidências sem alterar comportamento.
2. Agrupar correções pequenas e relacionadas em PRs revisáveis.
3. Separar mudanças documentais de refactors de alto risco quando isso
   permitir revisar a intenção com clareza.
4. Não misturar “limpeza geral” com correções de permissão, criptografia ou
   assinatura.

### 7.2 Regras para extração de duplicação

Antes de extrair:

1. escrever ou localizar testes que fixem o comportamento atual;
2. comparar entradas, saídas, erros, autorização, fuso e efeitos de todas as
   cópias;
3. definir um contrato único e o domínio proprietário do novo código;
4. mover o teste para `__tests__/` junto do código extraído;
5. atualizar todos os chamadores no mesmo PR;
6. registrar na ficha por que as cópias eram equivalentes.

Se as implementações são visualmente semelhantes, mas têm regras distintas,
não usar um componente comum que esconda a diferença. Manter a separação e
documentar a decisão perto dos dois usos.

### 7.3 Regras para documentos jurídicos e e-mail

Antes de modificar `pdf.ts`, assinatura, termo ou template de e-mail:

1. rodar o golden aplicável e confirmar que está verde;
2. implementar a alteração;
3. rodar o mesmo golden novamente;
4. só usar `UPDATE_PDF_GOLDENS=1` ou `UPDATE_EMAIL_GOLDENS=1` quando a saída
   visual tiver mudança intencional, revisada e registrada.

Nunca atualizar golden apenas para fazer o teste passar.

---

## 8. Verificação por tipo de alteração

| Alteração | Verificação mínima |
| --- | --- |
| comentário, cabeçalho ou JSDoc apenas | `npm run docs:inventario`, `npm run lint` |
| TypeScript de domínio | testes adjacentes + `npm run check` |
| Svelte ou `.svelte.ts` | documentação oficial Svelte/SvelteKit, autofixer Svelte, `npm run check` |
| autorização, sessão, webhook ou endpoint | testes do domínio + teste de rota relevante |
| banco/schema/query | teste da camada DB e consumidores afetados |
| PDF, assinatura, termo ou e-mail | golden antes/depois + testes específicos |
| extração compartilhada | testes das cópias anteriores e do novo contrato |

O conjunto completo (`npm run lint:ci`, `npm run check`, `npm run test` e,
quando aplicável, `npm run test:e2e`) é obrigatório no lote 12 e em PRs de
alto risco. O revisor deve registrar comandos executados e resultado.

---

## 9. Registro de execução

Atualizar esta tabela ao iniciar e concluir um lote. “Bloqueado” só é válido
com uma razão, dono e próximo passo explícitos.

| Lote | Responsável | Início | Fim | Estado | PRs / achados principais |
| --- | --- | --- | --- | --- | --- |
| 0 | — | — | — | pendente | — |
| 1 | — | — | — | pendente | — |
| 2 | — | — | — | pendente | — |
| 3 | — | — | — | pendente | — |
| 4 | — | — | — | pendente | — |
| 5 | — | — | — | pendente | — |
| 6 | — | — | — | pendente | — |
| 7 | — | — | — | pendente | — |
| 8 | — | — | — | pendente | — |
| 9 | — | — | — | pendente | — |
| 10 | — | — | — | pendente | — |
| 11 | — | — | — | pendente | — |
| 12 | — | — | — | pendente | — |

### Métricas de acompanhamento

Reportar a cada lote:

- arquivos do escopo revisados / total do snapshot;
- número de achados por tipo e severidade;
- achados corrigidos, aceitos e bloqueados;
- duplicações investigadas, extraídas e mantidas intencionalmente;
- baseline e variação de `docs:inventario`;
- testes e goldens executados.

Não definir como meta “100% de arquivos comentados” ou “X% de comentários”.
A meta é 100% de arquivos **revisados com evidência** e zero comentário
conhecidamente incorreto ou sem decisão registrada.

---

## 10. Critérios de aceite final

O trabalho pode ser encerrado apenas quando:

- [ ] o snapshot do escopo mínimo foi revisado integralmente;
- [ ] todo arquivo complementar de alto risco foi revisado;
- [ ] cada ficha possui revisor, evidência e estado final;
- [ ] P0 e P1 foram corrigidos ou possuem aceitação explícita do responsável;
- [ ] todo `DUP-EXTRAIR` foi implementado, reclassificado ou possui decisão
  justificada;
- [ ] os comentários de permissões foram confrontados com o gate efetivo;
- [ ] os comentários de data/fuso foram confrontados com os helpers centrais;
- [ ] artefatos jurídicos e e-mail foram protegidos por golden quando tocados;
- [ ] documentação viva foi atualizada junto das mudanças comportamentais;
- [ ] `docs:inventario`, lint, check e testes finais foram registrados;
- [ ] nenhuma dívida ficou apenas em conversa: cada uma tem ID, severidade,
  dono, prazo ou justificativa de aceitação.

---

## 11. Riscos conhecidos desta revisão

1. **Falso senso de qualidade por JSDoc:** presença de comentário não comprova
   contrato correto.
2. **Extração excessiva:** tornar componentes e helpers genéricos demais pode
   reduzir, não aumentar, a compreensão.
3. **Regressão silenciosa em documentos:** PDFs e e-mails precisam de golden,
   não apenas teste unitário.
4. **Confusão de papéis:** nomes como “Admin Geral” e “Super Admin” não são
   intercambiáveis; sempre verificar o gate real.
5. **Datas e UTC:** lógica local/UTC não pode ser deduplicada por aparência.
6. **Concorrência de agentes:** modificar o mesmo módulo em lotes diferentes
   sem coordenação cria conflitos e perde contexto.
7. **Heurísticas tratadas como verdade:** `docs:inventario`, `knip` e
   `fallow` sinalizam investigação; a decisão final é humana e baseada em
   evidência.

---

## 12. Prompt operacional para o próximo agente

```text
Execute o lote <N> do arquivo
docs/auditorias/PLANO_REVISAO_COMPREENSIBILIDADE_2026-08-02.md.

1. Atualize o Registro de execução para “em revisão” e gere o snapshot atual
   dos arquivos do lote.
2. Não faça refactor automático. Para cada arquivo, preencha a ficha prevista
   no plano e confronte cada comentário relevante com implementação,
   consumidores e testes.
3. Pesquise duplicação estrutural e semântica nos temas obrigatórios do lote.
4. Classifique cada achado com ID, tipo, severidade, evidência e ação.
5. Para mudanças propostas, siga o protocolo de alteração e a matriz de
   verificação do plano. Preserve goldens de documentos.
6. Antes de encerrar, atualize o Registro de execução com arquivos revisados,
   achados, comandos rodados, bloqueios e PRs/diffs.

Não marque um arquivo como revisado apenas porque ele tem comentários:
“revisado” exige evidência de que os comentários são corretos e úteis.
```
