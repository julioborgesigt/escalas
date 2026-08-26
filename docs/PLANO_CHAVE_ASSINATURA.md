# Plano — chave de assinatura (passkey) em toda avançada

**Data:** 15/ago/2026
**Status:** fases 0–3 no código (asserção gravada, senha na cerimônia, ciclo de vida da chave, duas fases em GISE/extra/presença). Fase 4 (trancar a flag) **fora deste ciclo**.
**Não é:** cadastro de aparelho, Authenticator/TOTP, nem substituição da qualificada (Token A3)

Este documento registra a releitura acordada do plano de passkey. Linguagem
obrigatória: **chave de assinatura** (credencial WebAuthn da pessoa). Não se
fala em “dispositivo cadastrado”, “celular registrado” nem “este aparelho
assinou”, salvo quando o manifesto descreve credencial _não sincronizável_
(`backupElegivel = false`) — e mesmo aí a atestação continua `none`.

---

## 1. O que este plano muda

A assinatura avançada (“em tela”) passa a ter um **piso único** em todos os
documentos que hoje a usam — escala de serviço, GISE, relatório extraordinário
e termo de presença — composto por:

| Piso                              | Papel                                | Base                                               |
| --------------------------------- | ------------------------------------ | -------------------------------------------------- |
| Sessão autenticada                | quem é                               | art. 4º II “a” (parcial)                           |
| **Reinserir a senha de acesso**   | vontade atual; sessão não é bastante | step-up / intenção de assinar                      |
| **2FA no e-mail institucional**   | posse da caixa corporativa           | art. 4º II “b” (piso atual, mantido)               |
| **Chave de assinatura (passkey)** | controle exclusivo da chave privada  | art. 4º II “b” (reforço que de fato toca o inciso) |
| Hash SHA-256 + selo institucional | integridade detectável               | art. 4º II “c”                                     |

Reforços **opcionais** (não rebaixam o nível se desligados): selfie/liveness,
GPS, restrição da avançada a user-agent móvel.

A qualificada (Token A3) **não entra** neste piso. Continua no desktop, por
projeto.

---

## 2. Decisões travadas

Estas frases não se reabrem na implementação sem nova decisão explícita.

1. **A passkey prova o titular, não o aparelho.** iOS e Android sincronizam
   passkeys por padrão. Uma chave, vários celulares da mesma conta. O
   manifesto já diz isso (`descreverVinculoCredencial`); UI, termo e suporte
   usam a mesma frase.
2. **Uma credencial ativa por pessoa.** É o que permite o manifesto nomear a
   chave _antes_ do hash. “Cadastrar neste celular” **substitui** a chave
   anterior; não acumula aparelhos. Quem perdeu o celular revoga (titular ou
   Admin Geral) e cadastra de novo.
3. **Cadastro da chave só no celular**, com autenticador de plataforma,
   `userVerification: required`, só ES256, `attestation: none`. Alinhado à
   política de restringir a avançada a smartphones.
4. **A chave é obrigatória antes da primeira assinatura avançada, não como
   trava do primeiro acesso.** `/alterar-senha` (senha + e-mail pessoal +
   termo) completa a identidade em qualquer tela. Se esse primeiro acesso já
   for no celular, oferece o cadastro da chave na hora, pulável. Sem chave
   ativa, o usuário **entra e lê**; o POST de assinar avançada morre no
   servidor.
5. **Dois e-mails só na reposição da chave** (troca de celular, furto,
   segundo cadastro). Código no e-mail institucional **e** no pessoal, os
   dois. No primeiro acesso isso é redundante: a caixa pessoal acabou de ser
   verificada.
6. **Não se detecta “este browser é o cadastrado” em silêncio.** Gate de
   leitura × assinatura: _há chave ativa nesta pessoa?_ Se não há, CTA de
   cadastro **somente** se a tela for móvel. Se há chave e _este_ celular não
   consegue afirmá-la (outro SO, sem sync), a cerimônia falha e a mensagem é
   “cadastre a chave neste celular” — o que **substitui** a anterior, com o
   step-up do item 5.
7. **O 2FA de e-mail na hora de assinar permanece** neste plano. A passkey
   não o substitui. Tirar o e-mail da cerimônia de assinatura é decisão
   futura, depois da adesão medida.
8. **A senha na hora de assinar é piso, não teatro.** Recusa no servidor,
   uma vez por janela de cerimônia (mesma ideia dos 10 min do código de
   e-mail, para lote). Não se pede matrícula/login de novo. Não se aceita
   flag vinda do cliente.
9. **Admin Geral revoga; o titular cadastra.** Ninguém registra chave na
   conta alheia. Revogar não invalida documento já assinado.
10. **O teste sobe no mesmo PR; o gate local espelha o Actions.** Fase sem
    o inventário da §11.2 não está pronta. Push com §11.3 vermelho não
    sobe — lint, knip, guards e Playwright pegam o que o spec focado não
    vê.

---

## 3. Piso da avançada — senha + 2FA + chave

### 3.1 Senha (novo)

Ameaça que este passo cobre: sessão aberta em mesa compartilhada ou celular
desbloqueado. **Não** cobre o inciso “b” e **não** sobe o nível jurídico
sozinha.

Regras:

- Campo “senha de acesso” na cerimônia de assinatura avançada. Sem
  matrícula.
- O servidor confere contra o hash da senha (mesmo `verificarSenha` do
  login, com pepper). Tentativas limitadas; falha não revela se a sessão é
  de outro.
- Sucesso abre uma **janela de reautenticação** de ~10 min, amarrada à
  sessão e ao usuário, gravada no servidor (irmã do desafio 2FA de
  assinatura, reutilizável no lote). Cada POST de assinar consome essa
  janela, não um booleano do body.
- Autofill do navegador enfraquece o controle; aceita-se o risco. Não se
  luta contra o gerenciador de senhas com truques de `autocomplete`.
- Com a passkey ligada, a senha **continua** — são ameaças diferentes
  (sessão vs. controle da chave). A biometria da passkey não dispensa a
  senha neste plano.

### 3.2 2FA de e-mail (já é piso)

Inalterado: código no e-mail institucional, obrigatório, não desligável no
`/conf-ass`. Reutilizável na janela de 10 min para lote.

### 3.3 Chave de assinatura (hoje opcional; neste plano vira piso)

Hoje `exigir_passkey_assinatura` default `false`, só escala, e o caminho de
um tiro (`assinar-simples`) é recusado quando a flag está ligada. Neste
plano a chave passa a ser **requisito obrigatório da avançada**, no mesmo
espírito do 2FA: o Super Admin não desliga. A virada da flag trancada
acontece na **fase 4**, depois das fases que constroem o cano — ligar no
primeiro deploy deixaria a corporação sem assinar.

Enquanto a flag não estiver trancada, o comportamento visível é o das fases
1–3 (senha já no piso; chave oferecida e exigível por flag).

---

## 4. Ciclo de vida da chave

```
primeiro acesso          cadastro da chave         assinar avançada
(qualquer tela)          (só celular)              (só celular, se a
                                                   política móvel estiver
senha + e-mail pessoal   plataforma + UV           ligada)
+ termo                  ─────────────────────►    senha + 2FA e-mail
     │                   se já houver chave:          + cerimônia da chave
     │                   substitui a anterior
     ▼
conta entra no sistema
sem chave: lê, não assina
```

**Reposição** (perda, furto, troca, celular que não afirma a chave atual):

1. Revogação — titular em `/perfil`, ou Admin Geral na ficha do policial.
2. Dois códigos: institucional **e** pessoal, os dois válidos.
3. Cerimônia de criação no celular.
4. Documentos antigos seguem conferíveis pela linha `revogado_em`.

**Primeiro cadastro** (ainda não há chave ativa): basta sessão autenticada
no celular. Os dois e-mails _não_ se empilham aqui.

---

## 5. Ler sem assinar

Quem não tem chave ativa vê escalas, GISE, extra e presença normalmente.
Os controles de **assinar em tela** não são oferecidos; um POST direto
toma 403 com mensagem que distingue “cadastre a chave no celular” de
“use o Token A3” quando o desktop estiver na política móvel.

No celular sem chave: convite explícito para cadastrar. No desktop: texto
de que a avançada é no celular (A3 permanece). Não se afirma que “este
dispositivo não está registrado”.

---

## 6. Ampliação de escopo

O fluxo de duas fases da escala (`preparar-assinatura-avancada` →
cerimônia → `finalizar-assinatura-avancada`) vira o caminho único da
avançada com chave. Cada documento ganha o par preparar/finalizar, a
intenção de 15 min e o desafio = hash do PDF montado.

| Documento                      | Situação hoje             | Neste plano                        |
| ------------------------------ | ------------------------- | ---------------------------------- |
| Escala de serviço              | duas fases; flag opcional | mesmo cano; chave no piso (fase 4) |
| GISE (assinatura do documento) | um tiro                   | duas fases + chave                 |
| Relatório extraordinário       | um tiro                   | duas fases + chave                 |
| Termo de presença              | um tiro                   | duas fases + chave                 |
| Escala FDS / e-mail            | fora da avançada em tela  | fora                               |
| Token A3                       | desktop, qualificada      | inalterado                         |

Quem **assina** cada um não muda: a passkey não amplia legitimidade. OIP
não passa a assinar escala; policial sem participação não passa a assinar
GISE. A chave é do **titular que já podia** assinar.

### 6.1 Contraparte forense (pré-requisito)

O `finalizar` da escala hoje confere a asserção ao vivo e **não grava**
`webauthn_*` em `escala_documentos` (`passkeyMeta` existe e não é passado).
Sem isso, `reconferirAssercaoDocumento` não tem o que reconferir. A fase 0
grava a asserção **antes** de copiar o cano para GISE/extra/presença —
senão a cópia nasce já furada.

---

## 7. O que o PDF e o termo podem afirmar

Permitido:

- chave cadastrada pelo titular, liberada por biometria/PIN;
- asserção sobre o hash deste PDF;
- vínculo: aparelho não sincronizável **ou** conta do titular (as três
  frases já existentes);
- senha revalidada nesta cerimônia; código enviado ao e-mail institucional.

Proibido (regressão, não melhoria):

- “assinado neste aparelho cadastrado”;
- “dispositivo registrado no primeiro acesso”;
- equivalência a ICP-Brasil / validação no Adobe por causa da passkey.

O termo (`termo-vigente.ts`) sobe de versão quando a chave e a senha
passarem a piso da avançada (hoje a cláusula 2.1 cita login, senha, 2FA e
chave _quando habilitada_). Novo aceite geral. Goldens de PDF e de e-mail
só se regravam se a mudança visual for intencional (`UPDATE_PDF_GOLDENS=1`).

`signature-level.ts` continua a fonte única: senha e chave saem de
`REFORCOS_OPCIONAIS` / “sessão já conta como senha” e entram em
`REQUISITOS_OBRIGATORIOS_AVANCADA`. O PUT de `/conf-ass` recusa desligar.

---

## 8. Fases de execução

Não executar em bloco. Cada fase é um PR revisável; a corporação continua
assinando entre uma e outra. **Teste faz parte da fase, não vem depois:**
o inventário está na §11.2; o PR não abre (e o push não sobe) com o gate
local da §11.3 vermelho — é o mesmo job `test` de
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml).

### Fase 0 — contraparte da asserção (escala)

Gravar `passkeyMeta` no `finalizar-assinatura-avancada`. Sem isto, ampliar
é replicar o furo. Testes: §11.2 fase 0.

### Fase 1 — senha na cerimônia, todas as avançadas

Piso de senha + janela de reautenticação no servidor, em escala, GISE,
extra e presença. UI: um campo de senha na cerimônia, não a cada PDF do
lote. Sem matrícula. Rate-limit. Ainda **não** trava a chave. Testes:
§11.2 fase 1.

### Fase 2 — cadastro da chave no fluxo de vida

- Oferta no primeiro acesso **se** o UA for móvel; pulável.
- Sem chave ativa: lê, não assina (UI + 403 no POST).
- Cadastro só no celular (espelhar `restringir_smartphone` no
  `/api/webauthn/registro`).
- Reposição: 2FA institucional **e** pessoal antes da cerimônia de
  criação. Primeiro cadastro: não.
- Textos de `/perfil` e da ficha do policial alinhados ao item 2
  (chave da pessoa, substitui, sync).

Testes: §11.2 fase 2.

### Fase 3 — duas fases em GISE, extra e presença

Extrair o orquestrador da escala (`assinarEscalaComPasskey`) para um
helper por recurso, sem copiar o miolo. Intenção, desafio = hash,
permissão refeita no finalizar. Caminho de um tiro recusado quando a
flag de chave estiver ligada (`recusarSePasskeyExigida`). Goldens dos
PDFs desses documentos: linha da chave no manifesto, sem overclaim.
Testes: §11.2 fase 3.

### Fase 4 — trancar a chave como piso

Adesão medida (quem assina avançada já tem chave ativa). Super Admin não
desliga mais `exigir_passkey` (mesmo tratamento do 2FA de e-mail). Termo
novo. `/conf-ass` e `signature-level.ts` atualizados. Quem ainda não
cadastrou lê e não assina — o recado da fase 2 deixa de ser “quando a
administração exigir” e passa a ser o piso. Testes: §11.2 fase 4.

### Fora deste plano

- Várias chaves por pessoa / lista de aparelhos.
- Recusar credencial sincronizável (`BE = 0`) como política.
- Trocar 2FA de e-mail por TOTP.
- Pedir senha em toda assinatura qualificada (A3 já é presença da chave).
- Detectar IMEI, “device fingerprint” ou user-agent como vínculo da chave.

---

## 9. Riscos que o plano aceita

| Risco                                              | Por que se aceita                                                  | Mitigação                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------- |
| Primeiro acesso no PC da unidade, sem chave        | Identidade não pode depender de ter o celular na mão               | Lê; assina depois no telefone                                   |
| iPhone B assina sem “cadastrar” (sync)             | É o modelo da Apple/Google; a prova é da conta                     | Manifesto diz “sincronizada na conta”                           |
| Cadastro neste celular revoga o outro              | Uma chave é a condição do manifesto completo                       | Aviso claro antes de substituir                                 |
| Dois e-mails na reposição travam se uma caixa cair | Melhor que TI sozinha repor a chave                                | Admin Geral revoga; titular tenta de novo quando a caixa voltar |
| Senha com autofill                                 | Step-up contra colega na cadeira, não contra o dono do gerenciador | Rate-limit; janela curta                                        |
| Ligar a fase 4 cedo demais                         | Corporação inteira sem avançada                                    | Adesão medida; A3 como válvula                                  |

---

## 10. Critério de pronto

O plano está executado quando:

1. Toda avançada recusa, no servidor, ausência de senha na janela, de 2FA
   de e-mail e de asserção da chave do titular sobre o hash daquele PDF.
2. GISE, extra e presença usam o mesmo cano de duas fases da escala, com
   asserção gravada e reconferível.
3. Sem chave ativa, qualquer perfil lê e nenhum POST de avançada passa.
4. Cadastro da chave só em UA móvel; reposição exige os dois e-mails;
   primeiro cadastro não.
5. Termo, manifesto, `/conf-ass` e `signature-level.ts` dizem a mesma
   coisa, e nenhum deles afirma aparelho onde só há titular.
6. Token A3 no desktop segue intacto.
7. Goldens de PDF/e-mail verdes; se regravados, a mudança visual foi
   intencional e revisada.
8. Cada fase tem os testes da §11.2 no mesmo PR que o comportamento.
9. Nenhum push/PR sobe com o gate da §11.3 vermelho — é o mesmo job
   `test` do GitHub Actions.

---

## 11. Testes e gate de CI

O Actions (job `test` de `deploy.yml`) é o juiz. O trabalho local existe
para **não descobrir a falha lá**: lint, prettier, knip, svelte-check,
Vitest, build, guards e Playwright rodam todos nesse job, e um aviso de
ESLint ou um spec novo sem 403 derruba o merge.

Princípio: **o teste nasce no mesmo PR da mudança.** Fase sem o inventário
abaixo não está pronta, mesmo com o app “funcionando na mão”.

### 11.1 Onde o teste mora

Convenção do CI (`find src -name '*.test.ts' -not -path '*/__tests__/*'`):
todo `*.test.ts` em `src/` vai na pasta `__tests__/` **junto** do código
testado. E2E vai em `e2e/`. Rota nova de mutação entra sozinha no
`e2e/autorizacao-negativa.spec.ts` (varre `src/routes/**`) e no
`npm run guard:autorizacao` — se o POST não recusar alguém, o Actions
falha mesmo sem spec escrito à mão.

Já existem e **não se reescrevem**, só se estendem:

| Superfície                                          | Arquivo                                                                                  |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Registro / asserção / reconferência WebAuthn        | `src/lib/server/assinatura/webauthn/__tests__/{registro,assercao,reconferencia}.test.ts` |
| Classificação legal                                 | `src/lib/server/assinatura/__tests__/signature-level.test.ts`                            |
| Política de dispositivo                             | `src/lib/server/assinatura/__tests__/politica-dispositivo.test.ts`                       |
| Manifesto visual da passkey                         | `src/lib/server/assinatura/__tests__/carimbos-visuais.test.ts`                           |
| Avançada em tela (escala, um tiro + 403 da passkey) | `e2e/assinatura-simples.spec.ts`                                                         |
| Extra avançada                                      | `e2e/relatorio-extra-avancado.spec.ts`                                                   |
| Presença                                            | `e2e/presenca-gise.spec.ts`                                                              |
| Flag 2FA trancada                                   | `e2e/conf-ass.spec.ts`                                                                   |
| Autorização de rota nova                            | `e2e/autorizacao-negativa.spec.ts` + `scripts/guard-autorizacao.mjs`                     |

Cerimônia biométrica real (Face ID) **não** é gate. No Vitest, gera-se par
ES256 e monta-se a asserção como os testes de `assercao.ts` já fazem. No
E2E de API, o padrão de `assinatura-simples.spec.ts` (POST autenticado,
status, body). Virtual authenticator do Playwright/CDP só se a fase 3
precisar de um happy-path de UI; não atrasa a fase por isso.

### 11.2 O que criar em cada fase

**Fase 0** — `reconferencia.test.ts` deixa de ser só fixture: um caso em
que `persistirEscalaAssinada` (ou o `finalizar`) recebe `passkeyMeta` e as
colunas `webauthn_*` saem preenchidas; documento sem passkey continua
`sem-passkey`; revogar a credencial **depois** não invalida. E2E: assinar
escala com a flag de passkey (o 403 do um-tiro já existe) e conferir que o
GET do documento traz as colunas, ou que a reconferência no servidor
devolve `valida`.

**Fase 1** — módulo novo da janela de reautenticação em
`src/lib/server/assinatura/__tests__/` (nome junto do código). Casos
mínimos, todos no servidor:

- POST de avançada sem senha → 401/403, documento não nasce;
- senha errada → recusa, rate-limit depois de N tentativas;
- senha certa abre janela; segundo PDF do lote na janela passa sem
  redigitar;
- janela expirada → recusa;
- matrícula no body, se vier, é ignorada (não é fator);
- os quatro recursos (escala, GISE, extra, presença).

E2E: um spec (ou casos nos specs já existentes) cobrindo o 403 sem senha
por POST direto — o mesmo gênero da política de dispositivo, para a senha
não viver só na UI.

**Fase 2** — registro:

- POST `/api/webauthn/registro` com UA de desktop e política móvel ligada
  → 403;
- reposição sem os dois 2FA → 400/403; com um só e-mail → recusa;
- primeiro cadastro (sem chave ativa) **não** exige os dois e-mails;
- cadastrar de novo revoga a anterior (`revogado_em` preenchido, uma
  ativa);
- POST de avançada sem chave ativa → 403 em escala **e** nos outros
  recursos que a fase 3 ainda não migrou, se o endpoint já recusar.

E2E: policial autenticado sem chave lê a escala (200) e o POST de assinar
morre. Desktop não oferece cadastro. `guard:autorizacao` já lista o
registro; se nascer rota de reposição, declarar o helper ou a dispensa
**com motivo**.

**Fase 3** — um teste de intenção + hash por recurso novo (espelhar
`intencao.test.ts`): preparar A / finalizar B recusa; PDF trocado recusa;
um-tiro com flag ligada → 403 (`recusarSePasskeyExigida`). Goldens
(`carimbos-visuais`, e os de GISE/extra/presença se o manifesto mudar):
rodar **antes** de mexer; só regravar com `UPDATE_PDF_GOLDENS=1` se a
linha da chave for a mudança visual intencional. E2E: o par
preparar/finalizar de cada recurso, no mesmo estilo de
`assinatura-simples.spec.ts`. Rota nova **tem** que passar no
`autorizacao-negativa` — anônimo 401, outra unidade 403, sem documento
criado.

**Fase 4** — `signature-level.test.ts`: avançada **exige** chave (e senha,
se a classificação passar a encará-la como requisito, não só evidência de
cerimônia). PUT `/api/configuracoes/assinatura` com `exigirPasskey: false`
→ 400, igual ao 2FA de e-mail (`e2e/conf-ass.spec.ts`). Hash do termo
muda; teste do aceite obsoleto, se existir, atualiza a versão — não se
edita o hash na mão para “passar”.

### 11.3 Gate local, antes do push

Espelho do job `test`. Rodar **inteiro** na fase, não só o spec tocado:
knip, prettier e `autorizacao-negativa` pegam arquivo que o Vitest
focado não vê.

```bash
npx svelte-kit sync
npm run lint:ci
npm run format:check
npm run format:check:e2e
npm run knip
npx svelte-check --threshold error
npx vitest run --reporter=verbose --coverage
npm run build
npm run guard:autorizacao
npm run docs:guard
npx wrangler d1 migrations apply escalas-db --local
npx playwright test
```

Atalhos que **não** substituem o gate: `npm run test` (Vitest sem o resto),
`npm run check` (svelte-check com warnings; o CI é `--threshold error`),
`npm run test:e2e` sem ter rodado lint/format/knip. Se o prettier falhar:
`npm run format` e `npm run format:e2e` — não commitar o format no PR da
fase misturado com lógica, a menos que o diff seja só o que a fase tocou.

Arquivo novo em `src/lib/db/` precisa de cabeçalho + JSDoc (`docs:guard`).
Handler novo de mutação precisa recusar alguém (`guard:autorizacao`);
`requireAuth` sozinho não basta. `return json({ error: ... })` em rota
nova derruba o guard de API.

### 11.4 Goldens e o que não é CI

PDF assinado, termo e e-mail transacional: harness verde **antes** de
refatorar; depois, byte a byte. Regravar (`UPDATE_PDF_GOLDENS=1` /
`UPDATE_EMAIL_GOLDENS=1`) só com mudança visual deliberada, arquivo
aberto e conferido — regravar para o teste passar altera documento que
alguém já assinou.

Fora do Actions, e por isso **não** desbloqueia o PR: Face ID real,
caixa de e-mail institucional de verdade, Token A3 físico
(`TESTING.md`, `docs/QA_ASSINATURA_A3_DESKTOP.md`). O que o CI cobre da
avançada é evidência + status + PDF + banco, como já faz
`assinatura-simples.spec.ts`.
