# 🖋️ Auditoria — Fluxo de Assinatura & Ciclo de Vida no R2

| | |
|---|---|
| **Data** | 11 de julho de 2026 |
| **Escopo** | (1) Correção técnica e segurança jurídica do fluxo de assinatura; (2) comportamento do R2 na exclusão/edição/revogação/reabertura de documentos (órfãos e retenção de PII). |
| **Stack** | SvelteKit 5 + Cloudflare Pages / D1 / R2 |
| **Branch** | `claude/code-security-audit-q92jrp` (base `main` @ `b345908`) |
| **Complementa** | `ANALISE_JURIDICA_ASSINATURAS.md` (parecer jurídico) e `SIGNATURE_HARDENING.md`. |

> Registro histórico (ver `CLAUDE.md`). Reflete o estado na data acima.

---

## 📊 Resumo executivo

**Fluxo de assinatura (parte técnica/jurídica): 🟢 forte e maduro.** A verificação
criptográfica é rigorosa e defensiva; a modelagem jurídica é honesta (não finge
ICP-Brasil onde é avançada) e alinhada à Lei 14.063/2020 + MP 2.200-2. **Nenhum
defeito de correção** encontrado no núcleo de assinar/verificar.

**Ciclo de vida no R2: 🟠 requer atenção.** Vários caminhos de exclusão, revogação
e **reabertura** removem as linhas do banco mas **deixam objetos órfãos no R2**
(PDFs assinados e, o mais sensível, **selfies biométricas**). Como não há
garbage-collector e a rotina de retenção LGPD **não varre o storage**, esses
objetos — que contêm PII forense (CPF/IP/GPS/selfie) — podem persistir
**indefinidamente**, o que conflita com a minimização/retenção da LGPD (arts. 15–16)
e infla custo de armazenamento.

| Severidade | Achado | Área | Status |
|---|---|---|---|
| 🟠 Alta | **R2-1** Exclusão de escala não apaga nada do R2 (órfão irrastreável) | R2 / LGPD | ✅ Corrigido |
| 🟠 Alta | **R2-2** Reabrir GISE apaga linhas mas não os objetos R2 | R2 / LGPD | ✅ Corrigido |
| 🟡 Média | **R2-3** Revogação/exclusão nunca apaga a **selfie** (dado biométrico) | R2 / LGPD art. 11 | ✅ Corrigido |
| 🟡 Média | **R2-4** Re-assinatura deixa o PDF/selfie/conferência anteriores órfãos | R2 | ✅ Corrigido |
| 🔵 Baixa | **R2-5** Preparar-assinatura abandonado deixa cópia de conferência órfã | R2 | ⏳ Coberto por GC (R2-6) |
| 🔵 Baixa | **R2-6** Sem GC de órfãos; retenção LGPD não cobre o R2 | R2 / LGPD art. 16 | ⏳ Follow-up |
| ⚪ Info | **J-1..J-3** Pendências jurídicas operacionais (TSA/ selo / termo) | Jurídico | ⏳ Operacional |

> **Remediação (branch `claude/code-security-audit-q92jrp`).** R2-1..R2-4 foram
> **corrigidos** com um helper unificado `src/lib/server/r2-cleanup.ts`
> (`limparR2DocumentoEscala`, `limparR2ObsoletoEscala`, `limparR2DaGise`,
> `coletarChavesR2DaGise`), aplicado em **todos** os caminhos: excluir escala
> (`escalas` e `recebidos`), revogar documento (escala e GISE), **reabrir GISE**,
> exclusão total da GISE (agora sem duplicação) e o ramo de re-assinatura dos dois
> endpoints de escala. Descoberta adicional já corrigida: as cópias de conferência
> vivem no prefixo **plano** `conferencia/<hash>.pdf` e escapavam da varredura por
> prefixo `gise/...` mesmo na exclusão total — o helper as coleta pelo hash.
> Cobertura: `__tests__/r2-cleanup.test.ts` (9 casos). **R2-5/R2-6** (garbage
> collector de órfãos legados no ciclo de retenção) ficam como follow-up, por serem
> destrutivos e merecerem um passo *dry-run* dedicado.

---

## ✅ Fluxo de assinatura — o que está correto (não regredir)

Verificado em `signature-service.ts`, `cades-finalizer.ts`, `pdf-verification.ts`,
`server-seal.ts`, `pades-lt.ts`, `tsa.ts`:

- **Verificação em profundidade** (`verificarECarimbarAssinatura`), na ordem certa:
  1. integridade byte-range × `messageDigest`;
  2. **cobertura do ByteRange cobrindo o arquivo inteiro** — barra *shadow attack*
     (bytes anexados após a região assinada);
  3. assinatura RSA/PSS/ECDSA dos `SignedAttributes`;
  4. **política criptográfica mínima** (rejeita SHA-1, RSA < 2048, cert sem keyUsage);
  5. **cadeia ICP-Brasil** fail-closed (com `ICP_BRASIL_TRUST_STORE_REQUIRED`);
  6. **carimbo de tempo** (TST do cliente, ou anexado server-side via `TSA_URL`);
  7. **OCSP** com snapshot persistido (CAdES-LT) — revogado → 422; resposta OCSP
     com assinatura inválida → 422 (anti-MITM).
- **Sem bypass de admin:** `validarPropriedadeToken` exige CPF cadastrado e
  casa CPF/nome do certificado com a sessão — fecha "assinar em nome de".
- **`arquivo_hash` recalculado no servidor** a partir do PDF final (nunca o hash
  enviado pelo cliente) — é o que a `/validar` reconfere.
- **2FA por e-mail sempre obrigatório** na modalidade avançada (`signature-level`).
- **Honestidade jurídica:** avançada usa rodapé + manifesto reais (sem placeholder
  PKCS#7 vazio nem rótulo "ICP-Brasil" falso); selo institucional autoassinado
  transforma o PDF em CMS tamper-evident, degradando para rodapé honesto sem a chave.

Conclusão: a **cadeia probatória técnica é sólida**. As ressalvas jurídicas
remanescentes (abaixo) são **operacionais/de configuração**, não de código.

---

## 🟠 R2-1 (Alta) — Excluir escala não remove nada do R2

**Arquivo:** `src/routes/escalas/+page.server.ts` (action `excluir`)

```ts
await excluirEscala(db, escalaId);   // DELETE FROM escalas WHERE id = ?
```

`escala_documentos.escala_id` tem **FK `ON DELETE CASCADE`** → a linha do documento
é apagada junto. Mas o handler **não toca o R2**: o PDF assinado
(`escalas/<ano>/<id>_<hash>.pdf`), a cópia de conferência (`conferencia/<hash>.pdf`)
e eventuais selfies (`escalas/<ano>/<id>/selfies/*`) **permanecem no bucket**. Pior:
como o cascade apaga a linha que continha o `r2_key`, o órfão fica **irrastreável**
(não há mais como descobrir qual objeto pertencia àquela escala).

> Contraste: a action `excluir` de `src/routes/recebidos/+page.server.ts` **busca o
> documento e apaga `r2_key` antes** de excluir — porém ainda não apaga a conferência
> nem a selfie (ver R2-3). Os dois caminhos de exclusão de escala estão inconsistentes.

**Impacto.** Vazamento permanente de PII forense (CPF/IP/GPS/selfie) no storage +
crescimento de custo. **Recomendação:** buscar o documento e limpar **todos** os
objetos R2 associados (blob + conferência + selfies do prefixo) **antes** de excluir
a escala — idealmente por um helper único compartilhado com `recebidos`.

---

## 🟠 R2-2 (Alta) — Reabrir GISE apaga as linhas mas não os objetos R2

**Arquivos:** `src/routes/api/gise/[id]/reabrir/+server.ts` →
`reabrirGiseEscala` (`src/lib/db/gise/escalas-crud.ts`)

```ts
await Promise.all([
  db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId)),
  db.delete(giseAssinaturasRelatorios).where(eq(...)),
  db.delete(gisePresencas).where(eq(...)),
  atualizarGiseEscala(db, giseId, { status: 'em_preenchimento', ... })
]);
```

Reabrir para edição **apaga as linhas** de documentos, assinaturas de relatório e
presenças, mas **não apaga nada do R2**: PDFs qualificados assinados, **selfies de
entrada/saída de presença** (dado biométrico) e cópias de conferência ficam órfãos
e irrastreáveis.

> Contraste correto: o **DELETE** de `gise/[id]/documento-assinado` (revogar) apaga
> `r2_key` + conferência **antes** de chamar `reabrirGiseEscala`. Só a **reabertura
> direta** (esta rota) esquece o storage. Note que `reabrirGiseEscala` é chamada por
> **ambos** os caminhos, então a limpeza não pode viver só no handler de revogação.

**Impacto.** Igual a R2-1, agravado por incluir **selfies biométricas** e por ser
uma operação de admin geral relativamente comum (reabrir para corrigir). A exclusão
**total** da GISE (`gise/[id]/_actions/actions-escala.ts`) faz o certo (list por
prefixo + delete) — a reabertura deveria reusar a mesma varredura por prefixo.

---

## 🟡 R2-3 (Média) — Revogação/exclusão nunca apaga a selfie (biométrico)

**Arquivos:** `escalas/[id]/documento-assinado` (DELETE), `recebidos` (excluir),
`gise/[id]/documento-assinado` (DELETE)

Todos apagam `r2_key` (+ conferência no caso da escala/gise) mas **nenhum apaga
`selfie_key`**. A selfie é **dado biométrico sensível** (LGPD art. 11) — deveria ser
o primeiro a sumir numa revogação. Só a exclusão total da GISE, que varre por
prefixo, remove selfies.

**Recomendação.** Incluir `selfie_key` (e, para GISE, `entrada_selfie_key` /
`saida_selfie_key`) em toda limpeza de documento revogado/excluído.

---

## 🟡 R2-4 (Média) — Re-assinar a mesma escala deixa o objeto anterior órfão

**Arquivos:** `finalizar-assinatura`, `assinar-simples` (escala e GISE)

A chave inclui um `verificationHash` **novo a cada assinatura**
(`escalas/<ano>/<id>_<hash>.pdf`), e `salvarDocumentoEscala` faz
`onConflictDoUpdate(target: escala_id)` — **substitui** a linha, apontando para a
nova key. O objeto R2 **anterior** (PDF + conferência + selfie) fica órfão, pois
nada o apaga e a referência foi sobrescrita.

**Recomendação.** No caminho de conflito (re-assinatura), apagar os objetos R2 da
key anterior antes de gravar a nova — ou padronizar a key por `escala_id`
(determinística) para que o `put` sobrescreva o mesmo objeto.

---

## 🔵 R2-5 (Baixa) — Preparar-assinatura abandonado deixa conferência órfã

`preparar-assinatura` grava `conferencia/<hash>.pdf` **antes** da finalização
(best-effort). Se o usuário prepara e nunca finaliza, essa cópia (sem manifesto
forense) fica órfã. Baixo impacto (sem PII forense), mas acumula sem GC.

---

## 🔵 R2-6 (Baixa / LGPD art. 16) — Não há GC de órfãos; retenção não cobre o R2

`executarLimpezaRetencao` (`src/lib/db/lgpd-retencao.ts`) remove apenas linhas de
`sessoes`, `login_attempts`, `dois_fatores_tokens`, `reset_senha_tokens`,
`recovery_attempts`, `webhook_nonces` e `audit_log`. **Não toca o R2.** Somados R2-1…R2-5,
PII em PDFs/selfies órfãos pode ultrapassar qualquer prazo de retenção sem nunca ser
removida.

**Recomendação.** Adicionar ao ciclo de retenção uma varredura de órfãos do R2
(por exemplo: `r2.list()` por prefixo × chaves referenciadas no banco → apagar o que
não é referenciado e é mais antigo que o prazo). Como é destrutivo, começar em modo
*dry-run* (só logar) e só então habilitar a exclusão.

---

## ⚪ Pendências jurídicas (operacionais — já mapeadas)

Não são código; reforço para o go-live (detalhe em `ANALISE_JURIDICA_ASSINATURAS.md`):

- **J-1 · Tempestividade plena (qualificada).** `TSA_URL` default é DigiCert
  (**não** ACT ICP-Brasil) → carimbo `tsa_externa`. Para tempestividade oponível
  plena, apontar `TSA_URL` para uma ACT ICP e ligar `EXIGIR_TSA_QUALIFICADA=1`.
  ⚠️ Ligar `EXIGIR_TSA_QUALIFICADA=1` **sem** trocar a TSA rejeita 100% das
  assinaturas qualificadas (422) — `avaliarConfiguracaoTsa` já alerta no log.
- **J-2 · Selo institucional.** Gerar e configurar `SELO_INSTITUCIONAL_PEM`
  (`scripts/gerar-selo-institucional.mjs`); sem ele, a avançada usa o rodapé honesto
  (sem CMS tamper-evident). Definir custódia/rotação da chave (validade 10 anos).
- **J-3 · Termo de aceite.** Validar o texto de `aceites_termos` com o jurídico
  (Lei 14.063/2020 art. 4º II — a avançada é oponível "desde que aceita").
- **Liveness client-side (informativo).** O veredito blink/smile é calculado no
  cliente (decisão de produto "Nível 0", A2). É reforço da avançada, não prova de
  identidade forte — o não-repúdio pleno vem da qualificada (Token A3). Documentado.

---

## Recomendação de correção (R2)

Os achados R2-1..R2-4 têm a mesma raiz: **a limpeza do storage não acompanha a
remoção/rotação da linha do banco**, e a lógica está espalhada e inconsistente. A
correção sugerida é um **helper único** — algo como `limparObjetosR2DaEscala(db, r2, id)`
e `limparObjetosR2DaGise(db, r2, id)` — que reúna blob + conferência + selfies (e
varra o prefixo, como já faz a exclusão total da GISE) e seja chamado por **todos**
os caminhos: excluir escala, revogar/excluir documento, **reabrir GISE** e o ramo de
conflito da re-assinatura. Depois, um passo *dry-run* de GC no ciclo de retenção
(R2-6) cobre o histórico já órfão.
