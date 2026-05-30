# Parecer Técnico‑Jurídico — Assinaturas Eletrônicas das Escalas

> **Data:** 2026‑05‑30 · **Atualização:** cenário **zero‑custo** + componentes já implementados.
> **Escopo:** fluxos de assinatura **avançada** (em tela) e **qualificada**
> (token A3) aplicados a escalas mensais (plantão/expediente), escalas GISE e
> relatórios de extraordinário.
> **Objetivo do cliente:** que **ambos** os fluxos sejam juridicamente
> incontestáveis, **sem custo financeiro** para o projeto.
>
> ⚠️ **Natureza deste documento:** análise técnica do código + enquadramento da
> legislação aplicável, para **apoiar decisão**. **Não é parecer jurídico
> vinculante** — a oponibilidade a terceiros e o termo de aceitação devem ser
> validados pela assessoria jurídica da corporação.

---

## 1. Sumário executivo

| Fluxo | Estado | "Incontestável"? |
|---|---|---|
| **Qualificada** (token A3 ICP‑Brasil) | Forte e maduro; **zero‑custo para o projeto** (o token é do policial) | **Sim**, em sentido pleno (presunção legal) — faltam 2 ajustes operacionais. |
| **Avançada** (tela) | **Selo institucional autoassinado IMPLEMENTADO** (custo zero) | **Robusta na prática**; a presunção *automática* da lei nunca será dela. |

**A verdade jurídica que nenhum código altera:** a presunção de autenticidade
(inversão do ônus da prova) do **art. 10 §1º da MP 2.200‑2/2001** é **exclusiva
da assinatura qualificada ICP‑Brasil**. A avançada (Lei 14.063/2020 art. 4º II;
MP 2.200‑2 §2º) só é oponível **"desde que admitida pelas partes ou aceita pela
pessoa a quem for oposto"**.

**Decisão de arquitetura (zero‑custo):** já que e‑CNPJ e ACT ICP‑Brasil têm
custo, a avançada é selada com um **certificado AUTOASSINADO gerado pelo próprio
projeto** + **carimbo de tempo gratuito** (DigiCert/FreeTSA). Isso torna o PDF um
**CMS real, autocontido e à prova de adulteração** — o teto alcançável a custo
zero. É o modelo do **gov.br/SEI** e o mesmo que ZapSign/Clicksign aplicam (com
a diferença de que elas usam e‑CNPJ ICP — vide [Anexo A](#anexo-a--estudo-de-caso-zapsign)).

---

## 2. Modelo atual

- **Simples** — só FDS; **descontinuada**. Fora de escopo.
- **Avançada** — assinatura **em tela**, 2FA por e‑mail corporativo (sempre) +
  GPS e/ou foto com *liveness* ativo + **selo institucional autoassinado**.
- **Qualificada** — **token A3 ICP‑Brasil** (Web PKI/Lacuna ou Assinador SERPRO).

Os **mesmos documentos** podem ir por **qualquer um dos dois** fluxos, conforme
o dispositivo.

---

## 3. Marco legal aplicável

| Norma | O que diz | Efeito |
|---|---|---|
| **MP 2.200‑2/2001, art. 10 §1º** | Documentos com certificação ICP‑Brasil **presumem‑se verdadeiros** quanto aos signatários. | **Presunção** *juris tantum* → **inverte o ônus**. Exclusivo da **qualificada**. |
| **MP 2.200‑2/2001, art. 10 §2º** | Admite outros meios (inclusive certs **não‑ICP**) **"desde que admitido pelas partes ou aceito pela pessoa a quem for oposto"**. | Base legal da **avançada** + do **selo autoassinado**. |
| **Lei 14.063/2020, art. 4º e 5º** | Taxonomia (simples/avançada/qualificada) e uso por ente público; reserva a qualificada para atos de maior impacto. | Pode **exigir qualificada** para certos atos. |
| **STJ (dez/2024)** | A falta de credenciamento ICP‑Brasil **não invalida, por si só**, a assinatura eletrônica. | Sustenta a validade do selo **não‑ICP** + lastro. |
| **CPC, art. 411, II** | Autêntico o documento com autoria identificada por certificação eletrônica. | Reconhece o valor probatório. |
| **Decreto 10.543/2020** | Níveis gov.br (avançada com infraestrutura estatal). | **Precedente** do modelo "selo institucional". |
| **Lei 11.419/2006** | Peticionamento em processo judicial exige assinatura ICP‑Brasil. | Para **atos processuais**, preferir a **qualificada** (token). |

**Conclusão:** presunção forte = **qualificada (token)**. A avançada com selo
autoassinado é **robusta e autoverificável**, porém sempre **contestável** por
terceiro que não aceitou o método — é o limite do custo zero.

---

## 4. Diagnóstico — fluxo QUALIFICADA (token A3)

Implementação verificada e madura (real, não fachada):

| Camada | Status | Referência |
|---|---|---|
| Integridade byte‑range × messageDigest | ✅ | `pdf-verification.ts` |
| SignerInfo: RSA PKCS#1, **RSA‑PSS, ECDSA P‑256/384/521** | ✅ | `crypto-verify.ts` |
| Cadeia ICP‑Brasil validada **na data do carimbo** | ✅ | `pdf-verification.ts` |
| Trust store: AC Raiz **v5 e v10** autênticas + 172 intermediárias | ✅ | `icp-brasil/roots.pem` |
| Vínculo token↔signatário (CPF, **sem bypass admin**) | ✅ | `signature-service.ts` |
| OCSP (nonce RFC 8954 + verificação do responder) | ✅ | `ocsp.ts` |
| PAdES‑LT (DSS embarcado) + política PA‑AD‑RB v2.3 | ✅ | `pades-lt.ts`, `icp-policy.ts` |

### Pendências (operacionais; algumas têm custo)
1. **Carimbo de tempo de ACT ICP‑Brasil** (pago) — só necessário para a
   *tempestividade qualificada* oponível. Sem ele, usa‑se a DigiCert grátis
   (`tsa_externa`). **Não** ligar `EXIGIR_TSA_QUALIFICADA=1` com a DigiCert.
2. **`ICP_BRASIL_TRUST_STORE_REQUIRED=1`** em produção (cinto de segurança, grátis).

> **Veredito:** o caminho zero‑custo para incontestabilidade plena **é o token**.
> Sempre que houver token, prefira‑o.

---

## 5. Diagnóstico — fluxo AVANÇADA (tela)

**Lastro coletado (bom):** 2FA por e‑mail, rubrica, selfie com *liveness*
revalidado no servidor, GPS, IP, User‑Agent, sessão autenticada, log de
auditoria — no manifesto e em `/validar`.

### 5.1 🟢 Defeito da escala mensal — **CORRIGIDO**

> Antes, a escala mensal em tela estampava **"ASSINATURA DIGITAL — ICP‑BRASIL /
> MP 2.200‑2"** + um **placeholder PKCS#7 vazio** (Adobe = "assinatura inválida"),
> contradizendo o manifesto "AVANÇADA". **Corrigido** (commit `78e2f20`): agora
> usa o rodapé honesto do padrão GISE, grava `arquivo_hash` e a `/validar` só
> roda verificação CMS quando há assinatura qualificada de fato.

### 5.2 🟢 Selo institucional autoassinado — **IMPLEMENTADO**

O modelo **custodial** (hash no banco) foi promovido a **CMS autocontido**:
o servidor sela o PDF da assinatura em tela com um **certificado autoassinado da
instituição** (commits `e3db89c`, `cf77c89`).

- O PDF vira **CMS real, à prova de adulteração** (qualquer alteração quebra a
  assinatura, independente do servidor). + carimbo de tempo grátis (`TSA_URL`).
- A `/validar` **verifica o selo** e exibe "Selo institucional: documento íntegro
  e à prova de adulteração" (+ "certificado confere com o selo oficial").
- **Fallback:** sem a chave (`SELO_INSTITUCIONAL_PEM`), degrada para o rodapé honesto.
- **Limite honesto:** não é ICP‑Brasil → o Adobe mostra "validade desconhecida"
  e **não** há a presunção do art. 10 §1º. A confiança vem do `/validar` + da
  publicação do certificado público.

---

## 6. Caminho recomendado — AVANÇADA incontestável a custo zero

**→ Selo institucional AUTOASSINADO (implementado) + carimbo de tempo grátis.**

### 6.1 Decisão de credencial

| Opção | Produção? | Por quê |
|---|---|---|
| **Autoassinado gerado pelo projeto** | ✅ **Em uso (custo zero)** | CMS real e tamper‑evident; base legal art. 4º II + MP 2.200‑2 §2º + STJ 2024. Custo: Adobe "não confiável" (mitigado por `/validar` + cert público). |
| **e‑CNPJ A1 da corporação** | 🔜 **Upgrade futuro (pago)** | Mesmo desenho, porém **ICP‑Brasil** → Adobe "válido" + integridade presumida (MP 2.200‑2 §1º). Trocar `SELO_INSTITUCIONAL_PEM` pelo e‑CNPJ ativa sem mudar código. |
| **e‑CPF do desenvolvedor** | ❌ **Nunca** | Imputa autoria pessoal; facilita a contestação; viola a DPC do cert pessoal. |

### 6.2 Reforços (grátis)
- **Termo de aceitação** por cada policial (art. 4º II) — confirmar cobertura de
  `aceites_termos` e validar texto com o jurídico.
- **Publicar** `selo-institucional.cert.pem` (fingerprint SHA‑256) para terceiros
  conferirem o selo fora do sistema.

### 6.3 Upgrades futuros (zero‑custo, com esforço/dependência)
- **gov.br** (avançada governamental): cada policial assina via conta gov.br
  prata/ouro. Exige habilitar a API gov.br e contas dos policiais.
- **ICP‑EDU** (ACT grátis): só órgãos **federais**; PC‑CE é estadual → verificar.

---

## 7. Plano de implementação — situação

| Fase | Item | Status |
|---|---|---|
| **0** | Corrigir o defeito da escala mensal (selo ICP falso + placeholder vazio) | ✅ **Feito** (`78e2f20`) |
| **1** | Selo institucional autoassinado server‑side + TSA grátis + fallback | ✅ **Feito** (`e3db89c`) |
| **1b** | `/validar` verifica e exibe o selo | ✅ **Feito** (`cf77c89`) |
| **op** | Gerar a chave + setar `SELO_INSTITUCIONAL_PEM` | ⏳ **Operacional (você)** |
| **2** | Termo de aceitação revisado pelo jurídico | ⏳ Pendente |
| **3** | (Qualificada) ACT ICP + envs de hardening | ⏳ Pendente (ACT é paga) |

**Ativação do selo (1×):**
```bash
node scripts/gerar-selo-institucional.mjs "Sistema de Escalas - PCCE" "Policia Civil do Ceara"
# cole o bundle base64 impresso em SELO_INSTITUCIONAL_PEM (Cloudflare Pages / wrangler secret)
```
Sem essa env, tudo funciona com o rodapé honesto (sem selo).

---

## 8. Decisões em aberto

1. **Custódia da chave autoassinada:** quem guarda `selo-institucional.key.pem`
   e administra o secret/rotação (validade 10 anos)?
2. **Termo de aceitação:** validar texto e cobertura com o jurídico.
3. **Quando** migrar o selo para **e‑CNPJ ICP** (se/quando houver orçamento) —
   é só trocar a env, sem mudar código.
4. **(Qualificada)** contratar **ACT ICP‑Brasil** para tempestividade plena.

---

## Anexo A — Estudo de caso ZapSign

Análise forense de um PDF real assinado na ZapSign (peça enviada pelo cliente),
**decodificado da estrutura interna** do arquivo:

| Elemento | Achado |
|---|---|
| Assinatura | 1 CMS PKCS#7 `adbe.pkcs7.detached` cobrindo o documento via `/ByteRange` |
| **Quem selou** | **`CN=ZAPSIGN PROCESSAMENTO DE DADOS LTDA`** — **e‑CNPJ** (PJ), `Tipo A3`, emitido por `AC Certisign Múltipla` |
| Cadeia | 4 certs, completa: ZapSign → AC Certisign Múltipla G7 → AC Certisign G7 → **AC Raiz Brasileira v5** |
| Longo prazo | **PAdES‑LT** (`/DSS` com `/Certs`, `/OCSPs`, `/CRLs`, `/VRI`) |
| **NÃO tinha** | ❌ carimbo de tempo de ACT, ❌ `sigPolicyId`, ❌ `signingCertificateV2` |

**Lições (confirmam a arquitetura adotada):**
1. A robustez vem de **selar o documento com o certificado da plataforma/instituição**
   — exatamente o nosso selo institucional. A diferença é só o tipo de certificado
   (eles e‑CNPJ ICP; nós autoassinado por custo zero).
2. Usa **pessoa jurídica (e‑CNPJ)**, nunca e‑CPF de pessoa — valida a §6.1.
3. **Podemos ficar melhores no eixo tempo:** aquele PDF **não tinha carimbo de
   tempo**; o nosso anexa um RFC 3161 grátis quando `TSA_URL` está setado.

---

## 9. Referências

- **MP 2.200‑2/2001** — art. 10 §1º (presunção) e §2º (outros meios + aceitação)
- **Lei 14.063/2020** — art. 4º e 5º · **CPC** art. 411, II · **CC/2002** art. 219
- **STJ** (dez/2024) — credenciamento ICP não é indispensável
- **Decreto 10.543/2020** (gov.br) · **Decreto 10.278/2020** (digitalização)
- **Lei 11.419/2006** — processo judicial eletrônico
- **DOC‑ICP‑15.03** (PA‑AD‑RB v2.3) · **RFC 3161/5126/5280/5652/6960/8954** · **ETSI EN 319 142‑1**
- Arquivos do projeto: `server-seal.ts`, `pdf-signing-prepare.ts`, `pdf-verification.ts`,
  `scripts/gerar-selo-institucional.mjs`, `validar/[hash]/+page.*`
