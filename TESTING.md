# Testes Manuais — ESCALAS

Roteiro de regressão manual dos fluxos de negócio. **Papel deste arquivo: exceção, não gate** — a regressão padrão é a suíte automatizada (`npm run test` + `npm run test:e2e`, ambas no CI). Use este roteiro para o que a automação não alcança (hardware físico, caixa de e-mail real, ACT ICP) e para QA exploratório antes de releases grandes. Casos já automatizados estão marcados com `[E2E: <spec>]` — não precisam de reexecução manual.

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
- [ ] Código 2FA incorreto 5 vezes → o desafio esgota e nem o código certo passa mais `[Vitest: desafio-2fa-uso-unico.test.ts]`
- [ ] Código 2FA correto usado DUAS vezes → só a primeira cria sessão `[Vitest: desafio-2fa-uso-unico.test.ts]`
- [ ] Pedir código de redefinição 4× em 10 min → o 4º é recusado sem enviar e-mail `[Vitest: janela-timestamp.test.ts]`

### 1.3 Redefinição de senha

- [ ] Abrir o link de redefinição duas vezes na MESMA tela e submeter as duas → só a primeira troca a senha; a segunda diz "inválido ou já utilizado" `[Vitest: token-redefinicao-uso-unico.test.ts]`
- [ ] Link expirado → "expirou, solicite um novo", e o link continua expirado (não vira "inválido") na segunda tentativa

### 1.4 Primeiro Acesso

- [ ] Login com credencial temporária → redirecionar para `/alterar-senha`
- [ ] Tentar acessar outra página sem alterar senha → redirecionado de volta
- [ ] Alterar senha com sucesso → liberar acesso ao sistema

### 1.5 Login por certificado A3 (desktop, Assinador SERPRO)

- [ ] Aba **Policial** → "Entrar com Certificado Digital" → assinar o desafio no token → sessão operacional criada (sem senha e sem 2FA)
- [ ] Aba **Administrador** → mesmo botão com módulo escolhido → sessão de admin criada se o policial do certificado tiver conta admin vinculada; redireciona para a boas-vindas do módulo
- [ ] Certificado de policial SEM vínculo admin na aba Administrador → 403 com mensagem clara
- [ ] Certificado revogado (OCSP) → login recusado

### 1.6 Logout

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

## 4. Escala extra (`/gise`)

### 4.1 Listagem

- [ ] A aba da sidebar chama-se **Escala extra** (não "Escalas GISE")
- [ ] Admin vê todas as escalas
- [ ] Supervisor vê apenas a sua
- [ ] Membro vê a escala atribuída
- [ ] Escalas com diferentes status exibidas corretamente
- [ ] Com mais de uma operação cadastrada, os chips de filtro aparecem; clicar em
      um deles deixa só as escalas daquela operação, e a paginação volta à
      página 1
- [ ] Cada card mostra o selo da operação (sigla, ou nome se não houver sigla)

### 4.2 Criar escala extra

- [ ] Criar com data de início, hora entrada/saída e supervisor
- [ ] Datas inválidas → validação
- [ ] Criada → aparece com status `em_definicao_supervisor`
- [ ] O modal pede a **operação**; a escala nasce com o selo dela
- [ ] Operação desativada não aparece no seletor

### 4.3 Clonar escala extra

- [ ] Clonar estrutura de escala anterior → nova com mesma estrutura de seccionais/equipes
- [ ] No modo "Copiar" o seletor de operação **não** aparece — a cópia herda a
      operação do original (clonar uma escala da CRAJUBAR não pode gerar uma do
      GISE)

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

### 4.9 Operações (`/gise/operacoes`, Admin Geral)

- [ ] A tela lista `GISE` e `OPERAÇÃO CRAJUBAR` (semeadas pelas migrações), com a
      contagem de escalas de cada uma
- [ ] Criar operação **EDGE** marcando só "Inteligência (SEINT)" e escolhendo
      `GISE` em "basear o formulário em" → a EDGE nasce com o formulário SEINT
      copiado e SEM o operacional
- [ ] Nome repetido → erro 409 legível ("Já existe uma operação chamada…")
- [ ] Desmarcar os dois tipos de equipe → erro de validação
- [ ] Desativar tira a operação do seletor de criação de escala e dos filtros,
      mas ela continua aparecendo no cadastro
- [ ] **Excluir** aparece só na operação sem escala nenhuma; na `GISE` e na
      `CRAJUBAR` só há "Desativar"
- [ ] Policial comum abrindo `/gise/operacoes` → redirecionado

### 4.11 Formulário da operação (`/gise/operacoes`)

> Criação, edição, redirecionamento do endereço antigo e a distinção `NULL` × `0`
> têm cobertura automatizada (`e2e/operacoes-formulario.spec.ts`). Manual: o que
> só se vê rolando a tela e gerando PDF.

**O slider:**

- [ ] "Nova operação" desliza a tela para a esquerda; a lista sai de vista e o
      formulário ocupa a largura toda
- [ ] "Editar" numa linha faz o mesmo deslize, com o formulário já preenchido
- [ ] O "voltar" do NAVEGADOR fecha o painel e devolve a lista
- [ ] Abrir uma operação, voltar e abrir outra → os campos são os da segunda (não
      sobra texto da primeira)
- [ ] A LISTA não tem botão de voltar — Operações tem entrada própria na barra
      lateral; o "Voltar às operações" existe só dentro do painel do formulário

**Os botões (§10 do README):**

- [ ] Com as três linhas do cadastro lado a lado, os botões de todas terminam na
      **mesma margem direita**, ancorados no topo — a linha com quatro botões não
      pode descer inteira para baixo do texto
- [ ] Faltando largura, o grupo quebra **dentro de si** (um botão desce), nunca
      em bloco
- [ ] "Nova operação" tem a altura de botão de navegação, não de CTA de modal

**Os campos:**

- [ ] Criar pede identificação **e** configuração na mesma tela — vagas, horários
      e textos do breve relatório
- [ ] Todos os campos de configuração começam vazios, mostrando em cinza o valor
      herdado
- [ ] Definir `0` em "DPC" da equipe operacional e salvar → o campo volta
      mostrando `0`, **não** vazio (zero é uma escolha, não ausência)
- [ ] Esvaziar um campo já preenchido e salvar → volta a mostrar o valor herdado
      em cinza
- [ ] Desmarcar um tipo de equipe → o bloco de vagas daquele tipo some na hora
- [ ] "Basear o formulário em" aparece só na criação
- [ ] Horário fora do formato `HH:MM` → erro de validação; vazio é aceito (herda)

**Efeitos:**

- [ ] Criar escala nova pela operação configurada → nasce com o horário e as
      vagas dela; trocar a operação no modal troca os horários sugeridos
- [ ] Alterar o texto do breve relatório e gerar o PDF de extra de uma escala
      daquela operação → o texto novo aparece; numa escala de OUTRA operação, não
- [ ] `/gise/config` redireciona para `/gise/operacoes`; `/gise/operacoes/<id>/config`
      redireciona para o painel de edição daquela operação

**Excluir** (só na operação sem escala nenhuma):

- [ ] Criar uma operação de teste baseando o formulário na CRAJUBAR, excluí-la e
      conferir que ela some da lista **e** que os formulários dela foram junto
      (`SELECT count(*) FROM gise_modelo_formulario WHERE operacao_id = <id>` → 0)
- [ ] A confirmação diz o nome da operação e cita o formulário que se perde
- [ ] Criar uma escala extra na operação de teste → o botão **Excluir** some da
      linha dela

### 4.12 Navegação do módulo (barra lateral)

- [ ] Admin Geral: **não** há mais "Conf. Form." nem "Dados base" no menu — os
      dois são botões na linha de cada operação em `/gise/operacoes`
- [ ] O botão **Dados base** aparece só na linha da operação que tem indicador de
      meta PERCENTUAL (a CRAJUBAR sim; a GISE não)
- [ ] `/res-gise` (Admin Geral) mostra "VOLTAR ÀS OPERAÇÕES" acima do título
- [ ] Admin de unidade escalada em operação com indicador percentual → **vê**
      "Dados base"
- [ ] Admin de unidade fora de qualquer escala → **não** vê "Dados base"
- [ ] Desativar a operação → o item some do menu do admin daquela unidade em até
      1 minuto (cache de 60s)

### 4.10 Indicadores e linha de base

**Configurar o indicador** (`/res-gise`, Admin Geral):

- [ ] O seletor de operação troca o formulário mostrado
- [ ] Numa operação de um tipo só, o alternador Operacional/SEINT mostra apenas
      o tipo habilitado
- [ ] Numa pergunta do tipo Número, marcar "usar como indicador de meta",
      escolher **diminuir**, meta **20%**, unidade "procedimentos" e salvar
- [ ] O bloco de indicador **não** aparece em pergunta de texto livre
- [ ] Em pergunta que não seja de cobertura, a opção "Cobertura — % do total
      atendido" do **Tipo de meta** aparece desabilitada, com a explicação abaixo

**Informar a base** (`/dados-base/<operação>`, admin de unidade/seccional):

- [ ] A tela **não** tem seletor de operação — ela vem do caminho, e o nome
      aparece no subtítulo
- [ ] `/dados-base` com uma pendência só redireciona direto ao preenchimento;
      com mais de uma, mostra a lista para escolher (e nenhum campo)
- [ ] `/dados-base/<id inexistente>` → 404, e **não** a tela de outra operação
- [ ] O **Voltar** segue por onde se entrou: Admin Geral volta a
      `/gise/operacoes`; admin de unidade com mais de uma pendência volta ao
      índice; com **uma só**, não há botão — o índice o traria de volta para cá
- [ ] Sem pendência nenhuma → texto explicando as duas condições (meta percentual
      **e** unidade escalada)

- [ ] O admin da unidade vê apenas as unidades que administra E que participam da
      operação escolhida
- [ ] O indicador criado acima aparece como pendente; informar o valor e salvar →
      o card passa a "Todos informados"
- [ ] Campo deixado em branco não grava nada (em branco é "ainda não sei", não zero)
- [ ] Admin de outra unidade não vê a unidade alheia

**Escape pelo formulário** (`/res-gise/relatorio/[giseId]`, policial):

- [ ] Com a base NÃO informada, o campo "valor antes da operação" aparece na
      etapa em que a pergunta está, e o valor é gravado ao enviar o relatório
- [ ] Com a base já informada pela aba, o campo **não** aparece — e retificar o
      relatório não sobrescreve o valor oficial da unidade

**Meta de cobertura** (o tipo `proporcao`):

- [ ] No editor, criar pergunta do tipo **Cobertura (total e atendidas)**,
      nomear os dois rótulos e marcá-la como indicador → o **Objetivo** some do
      bloco e o tipo de meta já vem em "Cobertura", com 100%
- [ ] Trocar o tipo de meta para "Percentual" e voltar para "Cobertura" → o
      `objetivo` não fica pendurado (confira o JSON salvo: a meta de cobertura só
      tem `metaTipo`, `metaValor` e `unidadeMedida`)
- [ ] No formulário do policial, preencher **12** e **9** → a tela mostra
      "Cobertura: 75% (9 de 12)"
- [ ] Preencher a parte MAIOR que o total → aparece o aviso de conferir os dois
      números (e o valor continua gravável — o aviso não bloqueia)
- [ ] Total **0** → nenhuma porcentagem é mostrada, e sim "sem ocorrências no
      período"
- [ ] No PDF do relatório de produtividade, a pergunta sai como "9 de 12 (75%)"
      numa linha só
- [ ] Em `/dados-base`, o indicador de cobertura **não** aparece — ele não pede
      valor inicial a ninguém

**Gráficos** (`/produtividade`):

- [ ] O filtro de operação troca os indicadores mostrados
- [ ] O card de um indicador de cobertura mostra UMA série em porcentagem, com o
      tique da meta no mesmo lugar em todas as unidades; a tabela dele traz
      Total, Atendidas e Cobertura (e não "Linha de base")
- [ ] Unidade sem nenhuma ocorrência no período aparece como "sem ocorrências", e
      **não** entra no contador "N/M unidades na meta" — não havia o que atender
- [ ] Cada card mostra base, realizado e a marca da meta por unidade, e o
      contador "N/M unidades na meta"
- [ ] Unidade sem base aparece no aviso de pendência, e a barra dela fica sem a
      marca de meta
- [ ] "Ver como tabela" mostra os mesmos números em texto
- [ ] Alternar tema claro/escuro redesenha o gráfico com a tinta certa
- [ ] Eixo em pt-BR (`1.240`, não `1,240`)
- [ ] Admin de unidade entra e vê **apenas** os dados da própria unidade

**O que entra no painel, e em que forma:**

> A regra tem cobertura automatizada em `e2e/produtividade-graficos.spec.ts` e em
> `produtividade/__tests__/questions`. Manual: a virada sobre os dados REAIS, que
> é o que as migrações `0053` e `0054` prometem não mudar.

- [ ] Depois do deploy, abrir `/produtividade` na GISE e na CRAJUBAR → os cards
      são **os mesmos de antes**, na mesma ordem: prisões, drogas e armas com
      ranking + detalhamento lado a lado, e as barras por pergunta abaixo
- [ ] Os títulos de drogas e armas perderam o sufixo do número da pergunta
      (`(P10)`, `(P11)`) e "Detalhamento de Substâncias" virou "Detalhamento de
      Drogas" — é a única mudança visível esperada
- [ ] No editor, cada pergunta contável traz o bloco **"Mostrar na
      produtividade"** com três caixinhas; nas numéricas, "Colunas por unidade"
      vem marcada
- [ ] A pergunta de **drogas** e a de **armas** vêm com "Ranking de unidades" e
      "Detalhamento por tipo" marcadas, e "Colunas" desmarcada
- [ ] Em pergunta que não seja de droga ou arma, "Detalhamento por tipo" aparece
      **desabilitada**, com a explicação abaixo
- [ ] Desmarcar **KM INICIAL** e **KM FINAL**, salvar e recarregar
      `/produtividade` → os dois cards somem, e os demais ficam
- [ ] Desmarcar só o "Ranking" da pergunta de drogas → o ranking some e o
      detalhamento continua (e vice-versa)
- [ ] Reabrir o formulário do policial → os campos continuam lá e continuam
      sendo preenchidos (a marca é de exibição, não de coleta)
- [ ] Marcar uma sub-pergunta (nível 1) → ela também vira card
- [ ] Numa operação NOVA, com formulário próprio sem pergunta de droga/arma/
      flagrante → **não** aparecem "Ranking de Prisões", "Ranking de Drogas" nem
      "Ranking de Armas"
- [ ] Na mesma operação, sem indicador e sem pergunta marcada → aparece "Nada a
      mostrar nesta operação", com a instrução de marcar no formulário
- [ ] Desmarcar a pergunta **7. PRISÕES/APREENSÕES FLAGRANTE** → o card "Total de
      Presos (P7)" do bloco de prisões **continua** com o número certo (ele não
      depende da marca)
- [ ] Com cards desmarcados, "Selecionar Todos (N)" conta só o que está na tela,
      e a exportação em PNG não gera imagem de card ausente
- [ ] Exportar o PNG do ranking de drogas → o peso sai em **kg**; o do
      detalhamento, em **g** (é a mesma conta em unidades diferentes)

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

> `[E2E: presenca-gise.spec.ts]` cobre entrada/saída em tela com rubrica + 2FA + GPS (2FA **sempre** obrigatório — as actions leem a fonte única `lerFlagsAssinatura`, que o força ligado), o comprovante sob demanda dos dois sentidos, o **vínculo na escrita** (não-participante com 2FA válido → 403, não grava) e as guardas do comprovante (anônimo 401, não-participante 403, tipo inválido 400, sem presença 404). Manual: selfie/câmera real (liveness é client-side) e o fluxo por Token A3 (janela de horário + hardware — QA A3).

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

> `[E2E: email-pessoal.spec.ts]` também protege o contrato do `ModalShell`:
> foco inicial e restaurado, fechamento por Escape/backdrop e bloqueio desses
> dismisses enquanto a requisição está pendente.

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

> `[E2E: auditoria.spec.ts]` cobre o caminho do Super Admin: `/api/admin/audit` lista paginado; a trilha **captura** um evento ponta a ponta (webhook `sync_policiais` recuperável filtrando por ação); export CSV → 200 `text/csv`; janela longa demais → 400. Os negativos de RBAC (anônimo 401, policial/Admin Geral 403) estão em `boas-vindas-rbac.spec.ts`. A cadeia de hash/canonicalização está no unitário `audit-forense.test.ts`.

- [ ] Ver log de auditoria das ações do sistema
- [ ] Filtrar por usuário, ação ou entidade
- [ ] Endpoint `/api/admin/audit` retorna dados no formato esperado

### 10.4 Logs técnicos (`/auditoria/logs`)

> Acesso exclusivo do **Super Admin** (mesma política de `/auditoria`). Grava apenas `warn`/`error` do servidor; a persistência acontece após a resposta (waitUntil), então o registro pode levar alguns segundos para aparecer.
>
> `[E2E: auditoria-logs.spec.ts]` prova o pipeline inteiro: um `logger.warn` real (webhook com bearer inválido) → flush pós-resposta → `app_log` → o console exibe o registro filtrado por busca. O redirect de não-Super-Admin está em `boas-vindas-rbac.spec.ts`.

- [ ] Botão "Logs técnicos" no cabeçalho de `/auditoria` abre a página
- [ ] Provocar um aviso (ex.: chamar um webhook com token errado) → registro aparece com nível "Aviso", rota e Request ID
- [ ] Filtrar por nível, busca livre e período
- [ ] Filtrar por Request ID (usar o link no detalhe de um evento da auditoria) → mostra os logs daquela request
- [ ] Expandir um registro → contexto JSON formatado
- [ ] Usuário não Super Admin acessando `/auditoria/logs` → redirecionado

---

## 11. Produtividade (`/produtividade`)

> `[E2E: produtividade.spec.ts]` cobre o acesso: Admin Geral entra e vê o dashboard; policial → 403; anônimo → `/login`. `[E2E: produtividade-visualizacao.spec.ts]` cobre o eixo: os seis controles da barra, o total que não muda ao alternar delegacias × seccionais, a equipe sem slot como linha própria, ordem/Top-N e o tipo de equipe desabilitado. A agregação tem cobertura unitária em `produtividade/__tests__/{stats,agrupamento}`. Manual: gráficos com dados reais e o PNG exportado.

- [ ] Carregar dados de produtividade das GISE finalizadas
- [ ] Gráficos renderizados corretamente
- [ ] Filtrar por período
- [ ] Dados vazios → estado vazio com mensagem
- [ ] Com mais de 200 respostas acumuladas → stats/rankings/gráficos contam o conjunto completo (o load pagina internamente em lotes de 500)

**O eixo (`Visualizar por`):**

- [ ] Abre em **Seccionais** — o comportamento de antes
- [ ] Alternar para **Delegacias** reparte a mesma produção: a SOMA das barras
      não muda, só a quebra
- [ ] O rótulo de cada linha do ranking acompanha ("Seccional" → "Delegacia"), e
      o nome curto mostra o MUNICÍPIO (não "Delegacia" repetido)
- [ ] Passar o mouse sobre uma barra mostra o nome COMPLETO da unidade
- [ ] Uma equipe escalada direto na seccional (sem slot) aparece como linha
      própria no modo Delegacias

**Quantidade e ordem:**

- [ ] Top 5 / Top 10 cortam o ranking, os gráficos por pergunta e os cards de
      indicador. Cada seção corta pela SUA métrica: o "top 5" de prisões pode ser
      um conjunto diferente do "top 5" de drogas — é o que "as 5 que mais X"
      significa
- [ ] "Piores primeiro" inverte; num indicador de REDUÇÃO, "melhores primeiro"
      traz quem mais reduziu (e não quem tem o maior número)
- [ ] Unidade sem linha de base fica no FIM do ranking de indicadores nos dois
      sentidos, e não no topo de "piores"
- [ ] O PNG exportado traz no cabeçalho o recorte aplicado ("Top 5 delegacias —
      piores primeiro"), e não só o nome da operação

**Tipo de equipe:**

- [ ] Numa operação só operacional, o botão "Inteligência" vem **desabilitado**
      (visível e apagado, não escondido), com dica ao passar o mouse
- [ ] Estando em "Inteligência" e trocando para uma operação que não a usa, o
      filtro cai sozinho em "Operacional" — sem painel vazio inexplicado

---

## 12. Configurações de Assinatura (`/conf-ass`)

> Acesso exclusivo do **Super Admin**. As flags são cacheadas no edge por até 5 min — a alteração deve refletir no fluxo de assinatura em ≤ 5 min.
>
> `[E2E: conf-ass.spec.ts]` cobre: GET com flags + `bloqueados` (base legal); anônimo barrado (CSRF antes da auth) e Admin Geral → 403; **invariante legal** — nem o Super Admin desliga o 2FA (PUT `false` → 400 e GET segue `true`); PUT vazio → 400; e a **invalidação do cache edge** (PUT → GET reflete na hora, sem esperar o TTL). Manual: o efeito das flags na tela de assinatura real.

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

### 13.1 Wizard do relatório (`/res-gise/relatorio/[giseId]`)

> O gate de entrada, a navegação entre etapas, o autosave e o envio têm
> cobertura E2E. Manual: o rascunho em condições que o navegador headless não
> reproduz.

- [ ] Preencher metade, **fechar a aba** e reabrir a rota → rascunho restaurado com o horário
- [ ] Aba anônima / `localStorage` cheio → o formulário continua funcionando (sem rascunho, sem erro)
- [ ] Dois policiais da mesma equipe no mesmo aparelho → cada um vê o próprio rascunho
- [ ] Colega entrega o relatório enquanto você tem rascunho → banner de oferta, e "Descartar" some com ele
- [ ] Admin Geral define etapas no editor → o wizard abre exatamente nesses grupos, na mesma ordem
- [ ] Modelo antigo (nenhuma pergunta com etapa) → uma etapa só, sem navegador
- [ ] Celular: o navegador mostra só a etapa anterior (esquerda) e a atual (direita); na 1ª etapa, só a atual, encostada à direita

### 13.2 Reordenar perguntas no editor

> Arraste, setas e renumeração têm cobertura automatizada
> (`e2e/reordenar-perguntas.spec.ts` + `lib/gise/renumerar-perguntas.test`).
> Manual: o que depende de aparelho real.

- [ ] Celular/tablet: as setas ↑/↓ movem (o arraste HTML5 não funciona no toque — é esperado)
- [ ] Arrastar um card sobre outro no desktop → destaque no destino e a ordem troca ao soltar
- [ ] Selecionar texto dentro do card **não** inicia arraste (só a alça inicia)
- [ ] Reordenar e **não salvar** → sair da tela desfaz tudo, inclusive a renumeração
- [ ] Pergunta cujo texto não começa com número ("Quantos?") → continua sem número após reordenar

### 13.3 Tipo "Quantidade + Lista Nome/Procedimento" (`lista_detalhada`)

> Escrita e expansão têm cobertura automatizada
> (`e2e/lista-reutilizavel.spec.ts` + `db/__tests__/produtividade-lista-reutilizavel`).
> Manual: o que só o PDF mostra.

- [ ] Duas perguntas do tipo, ambas preenchidas → **baixar o PDF de produtividade** e conferir que cada uma lista os SEUS itens
- [ ] Mesma conferência com um tipo original (ex.: "Prisões Maiores") junto na tela — as listas não podem se cruzar
- [ ] Trocar o tipo de uma pergunta já respondida → o detalhe antigo some do relatório (é esperado: a chave mudou)

### 13.4 Tipo "Cobertura (total e atendidas)" (`proporcao`)

> Escrita, rótulos e a reconstrução da meta ao trocar de tipo têm cobertura
> automatizada (`e2e/cobertura.spec.ts` + `gise/__tests__/indicadores` +
> `produtividade/__tests__/metas`). Manual: o PDF e o gráfico.

- [ ] Preencher a cobertura e **baixar o PDF de produtividade** → a pergunta sai numa linha só, no formato "9 de 12 (75%)"
- [ ] Duas perguntas de cobertura no mesmo formulário → cada uma com o seu par de números no PDF
- [ ] Em `/produtividade`, o card do indicador de cobertura mostra UMA série em porcentagem e o tique da meta no mesmo ponto em todas as unidades
- [ ] Unidade sem ocorrência no período → "sem ocorrências" na tabela, e fora do contador "N/M unidades na meta"
- [ ] Trocar uma pergunta de cobertura já respondida para outro tipo → os dois números somem do relatório (é esperado: as chaves mudaram)

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

---

## 19. Direitos do Titular — LGPD art. 18

> `[E2E: lgpd-solicitacoes.spec.ts]` cobre o ciclo completo: o titular abre a solicitação (`/api/lgpd/solicitar` → 201) e a vê na sua lista; um policial não acessa a lista administrativa (403); o Admin Geral lista, detalha e responde (conclui); o titular vê o desfecho; reencerrar uma solicitação já concluída → 409.

- [ ] (manual) Conferir o texto de prazo (15 dias úteis) e o e-mail do encarregado (DPO) exibidos ao titular
- [ ] (manual) Fluxo pela UI (`/perfil` / painel LGPD) além dos endpoints
