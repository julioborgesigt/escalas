# Parecer Técnico‑Jurídico — Assinaturas Eletrônicas das Escalas

> **Data:** 2026‑05‑30
> **Escopo:** fluxos de assinatura **avançada** (em tela) e **qualificada**
> (token A3) aplicados a escalas mensais (plantão/expediente), escalas GISE e
> relatórios de extraordinário.
> **Objetivo declarado pelo cliente:** que **ambos** os fluxos sejam
> juridicamente incontestáveis.
>
> ⚠️ **Natureza deste documento:** análise técnica do código + enquadramento
> da legislação aplicável, para **apoiar decisão**. **Não é parecer jurídico
> vinculante.** A adoção definitiva — sobretudo a oponibilidade a terceiros e
> o termo de aceitação — deve ser validada pela assessoria jurídica da
> corporação.

---

## 1. Sumário executivo

| Fluxo | Hoje | Pode ser "incontestável"? |
|---|---|---|
| **Qualificada** (token A3 ICP‑Brasil) | Tecnicamente **forte e maduro** | **Sim**, em sentido pleno (presunção legal) — faltam **2 ajustes operacionais**, não código. |
| **Avançada** (tela: GPS/foto + 2FA) | Modelo **custodial** + **1 defeito grave** na escala mensal | **Sim, na prática** — mas exige mudança de arquitetura (**selo ICP‑Brasil institucional**) + aceitação. A presunção *automática* da lei nunca será dela. |

**A verdade jurídica que nenhum código altera:** a presunção de
autenticidade (inversão do ônus da prova) do **art. 10 §1º da MP 2.200‑2/2001**
é **exclusiva da assinatura qualificada ICP‑Brasil**. A assinatura avançada
(Lei 14.063/2020 art. 4º II; MP 2.200‑2 art. 10 §2º) só é oponível **"desde
que admitida pelas partes ou aceita pela pessoa a quem for oposto"**.

→ Por isso, tornar a avançada "incontestável" **não é trabalho de captar mais
provas**; é (a) dar ao documento **integridade ICP‑Brasil autoverificável**
via **selo institucional**, e (b) garantir a **aceitação prévia** de cada
signatário. É exatamente a arquitetura do **gov.br / SEI**.

---

## 2. Modelo atual

- **Simples** — usada apenas para escalas de FDS; **descontinuada**. Fora de escopo.
- **Avançada** — assinatura **em tela**, com 2FA por e‑mail corporativo
  (sempre obrigatório) + GPS e/ou foto com *liveness* ativo (piscar/sorrir).
- **Qualificada** — assinatura com **token A3 ICP‑Brasil** (Web PKI/Lacuna ou
  Assinador SERPRO).

Os **mesmos documentos** podem ser assinados por **qualquer um dos dois
fluxos**, conforme o dispositivo de acesso.

---

## 3. Marco legal aplicável

| Norma | O que diz | Efeito |
|---|---|---|
| **MP 2.200‑2/2001, art. 10 §1º** | Documentos com certificação ICP‑Brasil **presumem‑se verdadeiros** quanto aos signatários (remete ao art. 219 do CC/2002). | **Presunção** *juris tantum* → **inverte o ônus** da prova. Exclusivo da **qualificada**. |
| **MP 2.200‑2/2001, art. 10 §2º** | Admite outros meios de comprovar autoria/integridade (inclusive certs não‑ICP) **"desde que admitido pelas partes como válido ou aceito pela pessoa a quem for oposto"**. | Base legal da **avançada** — **depende de aceitação**. Sem presunção automática. |
| **Lei 14.063/2020, art. 4º** | I = simples; II = **avançada**; III = **qualificada**. | Taxonomia oficial. |
| **Lei 14.063/2020, art. 5º** | Define em quais interações com o ente público cada modalidade é admitida; reserva a **qualificada** para atos de maior impacto. | Pode **exigir qualificada** para certos atos. |
| **CPC (Lei 13.105/2015), art. 411, II** | Considera‑se autêntico o documento cuja autoria esteja identificada por meio legal de certificação, **inclusive eletrônico**. | Reconhece valor probatório da certificação eletrônica. |
| **Decreto 10.543/2020** | Níveis de assinatura **gov.br** (bronze/prata/ouro) e seu uso pela Adm. Pública federal. | **Precedente** do modelo "avançada com lastro forte" reconhecida. |
| **Decreto 10.278/2020** | Para o documento digitalizado ter os **mesmos efeitos do original**, exige assinatura **ICP‑Brasil**. | Reforça a necessidade do **selo ICP** para equivalência ao original. |

**Conclusão da seção:** "incontestável" no sentido forte (presunção) =
**qualificada** ou **documento selado em ICP‑Brasil**. A avançada "pura"
(custodial) é sempre, por definição legal, **contestável** por terceiro que
não aceitou o método.

---

## 4. Diagnóstico — fluxo QUALIFICADA (token A3)

**Caminho:** `preparar-assinatura` → assinatura no cliente → `finalizar-assinatura`
→ `signature-service.ts` → `cades-finalizer.ts`.

Implementação verificada (real, não fachada):

| Camada | Status | Referência |
|---|---|---|
| Integridade byte‑range × `messageDigest` | ✅ | `pdf-verification.ts:781` |
| Assinatura SignerInfo: RSA PKCS#1, **RSA‑PSS, ECDSA P‑256/384/521** | ✅ | `crypto-verify.ts` |
| Cadeia ICP‑Brasil validada **na data do carimbo** | ✅ | `pdf-verification.ts:478` |
| Trust store: AC Raiz **v5 e v10** autênticas (ITI) + 172 intermediárias | ✅ | `icp-brasil/roots.pem` |
| Vínculo token↔signatário (CPF do cert = CPF logado, **sem bypass admin**) | ✅ | `signature-service.ts:182` |
| OCSP (nonce RFC 8954 + verificação da assinatura do responder) | ✅ | `ocsp.ts` |
| PAdES‑LT (DSS: cadeia + OCSP embarcados) | ✅ | `pades-lt.ts` |
| Política PA‑AD‑RB v2.3 (hash oficial embutido) | ✅ | `icp-policy.ts:56` |

### Pendências (operacionais, NÃO código)

1. **Carimbo de tempo de ACT ICP‑Brasil.** Hoje `wrangler.toml:14` aponta
   `TSA_URL = "http://timestamp.digicert.com"` — TSA RFC 3161 real, porém
   **não‑ICP** → classificada como `tsa_externa` (`cades-finalizer.ts:60`).
   Para tempestividade qualificada oponível a terceiros, apontar `TSA_URL`
   para uma **ACT credenciada** (Bry, Soluti, Certisign, AC Safeweb, ou
   ICP‑EDU se elegível). **Atenção:** ligar `EXIGIR_TSA_QUALIFICADA=1`
   mantendo a DigiCert faz o sistema **recusar todas as assinaturas**.
2. **`ICP_BRASIL_TRUST_STORE_REQUIRED=1`** em produção (cinto de segurança
   contra trust store vazio aceitar cert autoassinado — `cades-finalizer.ts:155`).

> **Veredito:** pronto. Vira "qualificada plena" assim que uma ACT ICP for
> contratada/configurada e as duas envs forem ligadas.

---

## 5. Diagnóstico — fluxo AVANÇADA (tela)

**Caminho:** `assinar-simples` → `validarEvidenciasAvancada` → estampa
rubrica + página de auditoria → salva no R2.

**Lastro probatório coletado (é bom):** 2FA por e‑mail (sempre), rubrica,
selfie com *liveness* revalidado no servidor, GPS, IP, User‑Agent, sessão
autenticada, log de auditoria — tudo no manifesto e em `/validar`.

**Modelo de integridade — custodial, não autocontido:**
a prova de não‑adulteração é o `arquivo_hash` (banco) comparado ao blob no R2
(`validar/[hash]/+page.server.ts:141`). Isso detecta corrupção no R2, **mas
os dois lados são controlados pelo servidor** — não há assinatura
criptográfica ligando o documento ao signatário. Se o PDF circular fora do
sistema, um terceiro só consegue confiar nele acessando o portal `/validar`.

→ Sem assinatura ICP no documento, ele é **avançada** (art. 4º II) — válido,
mas **contestável** por terceiro que não aceitou o método.

### 5.1 🔴 Defeito grave — escala mensal em tela

O `assinar-simples` **das escalas mensais** chama
`prepararPdfParaAssinatura()` — a **mesma função do fluxo qualificado** — e
salva o resultado **sem nunca preencher o PKCS#7**
(`src/routes/api/escalas/[id]/assinar-simples/+server.ts:111‑135`).

**Comprovação empírica** (executando a função real do projeto sobre um PDF de
teste):

```json
{ "hasTypeSig": true, "hasSigSubfilter": "adbe.pkcs7.detached",
  "hasByteRange": true, "contentsLenBytes": 8192,
  "/Contents": "00 00 00 … (placeholder NUNCA preenchido)" }
```

O PDF resultante contém:
1. Um **dicionário de assinatura digital real** (`/Type /Sig`,
   `adbe.pkcs7.detached`, `/ByteRange`) → **Adobe/Foxit exibe um campo de
   assinatura e o marca como INVÁLIDO** (PKCS#7 só de bytes nulos não parseia).
2. Carimbo visual escrito **"ASSINATURA DIGITAL — ICP‑BRASIL"** e
   **"Assinado conforme MP 2.200‑2/2001 — ICP‑Brasil"**
   (`pdf-signing-prepare.ts:540,672`) — **sem nenhum certificado**.
3. Página de auditoria que, corretamente, diz **"AVANÇADA · TELA/MOBILE /
   Lei 14.063/2020"**.

**Por que é grave:** o mesmo documento **se autocontradiz** (selo "ICP‑Brasil"
no corpo × "avançada/Lei 14.063" no manifesto) e embute uma **assinatura
digital quebrada**. Numa perícia, isso caracteriza o documento como
pretensamente qualificado quando não é — munição direta para **invalidá‑lo**.
**Enfraquece em vez de fortalecer.**

> O fluxo **GISE** simples já faz **certo**: usa `adicionarRodapeSimples()` —
> rodapé honesto "Confirmado eletronicamente por:", **sem** placeholder e
> **sem** branding ICP (`pdf-signing-visual.ts:28`). A divergência está só na
> escala mensal.

---

## 6. Caminho recomendado — AVANÇADA incontestável na prática

A peça central é trocar o modelo **custodial** por um documento **autocontido
e ICP‑válido**, via:

### → Selo ICP‑Brasil institucional (carimbo de pessoa jurídica), server‑side

O servidor assina cada PDF do fluxo avançado com um **certificado da
corporação**, anexando carimbo de tempo. Efeitos:

- O documento passa a ter uma **assinatura ICP‑Brasil válida no Adobe**, com
  **integridade presumida** (MP 2.200‑2 §1º — agora do **documento/instituição**).
- As evidências do policial (2FA + biometria/liveness + GPS) ficam **dentro**
  como **manifestação de vontade** do signatário, atestada pela instituição.
- **Elimina o defeito da §5.1**: o placeholder passa a ser preenchido por uma
  assinatura **real** → some o "ICP‑Brasil falso".
- **Reusa o código de CMS já existente** (`buildCmsSignedData`,
  `embedCmsBytesNoPlaceholder`, TSA, OCSP, DSS).

> **Importante (precisão jurídica):** o selo institucional dá ao **documento**
> integridade ICP‑Brasil e atesta a **custódia/origem institucional**; ele
> **não** transforma o ato do policial em assinatura **qualificada pessoal**
> (isso só o token A3 faz). O ato do policial continua **avançado**, porém
> agora **lacrado em ICP** e com lastro forte — que é, na prática, o teto
> alcançável para a avançada e o modelo que o Judiciário já aceita do gov.br.

### 6.1 Decisão de credencial — **e‑CNPJ, não e‑CPF**

| Opção | Produção? | Por quê |
|---|---|---|
| **e‑CNPJ A1 da corporação** (ou cert. de pessoa jurídica/aplicação) | ✅ **Recomendado** | Identifica a **instituição** → o selo significa "a PC‑CE atesta". É o que dá peso jurídico. |
| **e‑CPF A1 do desenvolvedor** | ❌ **Não** | Imputa **autoria pessoal** ao dev em todos os documentos; **facilita** a contestação ("o dev não assinou minha escala"); provável **violação da DPC** do certificado pessoal; expira anualmente e some com a saída da pessoa. |
| Qualquer A1 de teste | ⚠️ Só **dev/homologação** | Para validar o pipeline; **nunca** servir documento de produção. |

**Requisitos do e‑CNPJ A1:** tipo **A1** (chave em arquivo PKCS#12,
exportável) — A3 (token) **não** serve para assinatura automática
server‑side. A chave deve ser guardada como **secret** do Cloudflare
(`wrangler secret put`), nunca no repositório.

---

## 7. Plano de implementação (proposto)

### Fase 0 — Correção imediata do defeito (independe de credencial)
- Alinhar `escalas/[id]/assinar-simples` ao padrão honesto do GISE:
  trocar `prepararPdfParaAssinatura` por `adicionarRodapeSimples` **ou**
  parametrizar o carimbo para "Assinatura Eletrônica Avançada — Lei
  14.063/2020" no fluxo sem token; remover o placeholder PKCS#7 vazio.
- **Esforço:** ~2 h. **Risco:** baixo. **Ganho:** remove a vulnerabilidade
  pericial já hoje.

### Fase 1 — Selo institucional server‑side (avançada)
1. **Carregar a chave** do e‑CNPJ A1 a partir de secret (PKCS#12 → cert+chave).
2. **Assinar server‑side** o `signedAttrs` (SHA‑256/RSA) — via Web Crypto
   (`crypto.subtle.sign`, RSASSA‑PKCS1‑v1_5) ou node‑forge.
3. **Montar e embutir** o CMS com `buildCmsSignedData` + `embedCmsBytesNoPlaceholder`
   (código já existe).
4. **Carimbar tempo** (`tsa.ts`) + **OCSP/DSS** (`cades-finalizer.ts`, `pades-lt.ts`)
   — reaproveitados.
5. **Rotular** o documento/`/validar` como "Assinatura avançada do signatário
   + selo institucional ICP‑Brasil (PC‑CE)".
- **Esforço:** ~2–3 dias. **Arquivos:** novo `server-seal.ts`, ajustes em
  `signature-service.ts` e nos 3 endpoints `assinar-simples`/`assinar`.

### Fase 2 — Aceitação / termo (oponibilidade jurídica)
- Garantir que cada policial **aceite** o termo de uso que estabelece a
  assinatura avançada como válida entre as partes (art. 4º II / MP 2.200‑2 §2º).
  O sistema já tem `aceites_termos` com snapshot HTML — confirmar cobertura e
  versão. Validar texto com o jurídico.

### Fase 3 — Qualificada: pendências operacionais
- Contratar/configurar **ACT ICP‑Brasil** em `TSA_URL`; ligar
  `EXIGIR_TSA_QUALIFICADA=1` e `ICP_BRASIL_TRUST_STORE_REQUIRED=1`.

---

## 8. Decisões em aberto

1. **Credencial do selo:** a corporação consegue um **e‑CNPJ A1** (ou cert.
   de aplicação PJ)? Em quanto tempo? (Bloqueia a Fase 1 em produção.)
2. **ACT de carimbo de tempo:** qual provedor ICP (Bry/Soluti/ICP‑EDU…)?
   (Bloqueia a qualificada plena e o selo institucional com tempestividade.)
3. **Custódia da chave A1:** quem é o responsável operacional pela rotação
   anual e pelo secret no Cloudflare?
4. **Validação jurídica** do termo de aceitação e do enquadramento do selo
   institucional pela assessoria da corporação.

---

## 9. Referências

- **MP 2.200‑2/2001** — art. 10 §1º (presunção) e §2º (outros meios + aceitação)
- **Lei 14.063/2020** — art. 4º (taxonomia) e art. 5º (uso por ente público)
- **CPC (Lei 13.105/2015)** — art. 411, II (autenticidade por certificação eletrônica)
- **CC/2002** — art. 219 (declarações presumem‑se verdadeiras quanto aos signatários)
- **Decreto 10.543/2020** — níveis de assinatura gov.br (precedente do modelo)
- **Decreto 10.278/2020** — digitalização com efeitos de original (exige ICP)
- **DOC‑ICP‑15.03** — Política de Assinatura ICP‑Brasil (PA‑AD‑RB v2.3)
- **RFC 3161** (TSA), **RFC 5126** (CAdES), **RFC 5280** (X.509), **RFC 5652**
  (CMS), **RFC 6960/8954** (OCSP), **ETSI EN 319 142‑1** (PAdES)
- Arquivos do projeto citados ao longo (caminhos `src/...`)
