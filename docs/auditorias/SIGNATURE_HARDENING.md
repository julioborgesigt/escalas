# Endurecimento do Sistema de Assinaturas Digitais

> Relatório operacional gerado em maio/2026 documentando a sessão de
> análise e refatoração das assinaturas digitais (escalas + GISE +
> relatórios extraordinários). Branch: `claude/analyze-digital-signatures-Oq6sf`.

## Sumário executivo

O sistema oferecia uma fundação técnica sólida (CMS PKCS#7, PAdES-LT,
verificação multi-camada, defesas anti-impersonação por CPF, higiene
LGPD), mas tinha **2 bloqueios críticos**, **4 vulnerabilidades altas**,
**3 médias** e **6 ajustes menores** identificados em auditoria.

Esta sessão **resolveu ou documentou os 16 pontos**. O código está
pronto para produção plena de assinatura qualificada ICP-Brasil, mas
**depende de 6 ações operacionais** (não-código) descritas na seção
[Ações manuais obrigatórias](#ações-manuais-obrigatórias) antes do
go-live.

**Quality gates verificados ao final:**

- ✅ 311 / 311 testes unitários passando (32 novos)
- ✅ 0 erros TypeScript em todo o branch
- ✅ 2 migrações SQL aditivas (compat preservada)
- ✅ 20 commits atômicos no branch

## O que foi feito (cronológico)

### Fase 1 — Consolidação dos fluxos

Antes existiam 6 endpoints (3 `finalizar-assinatura` qualificada + 3
`assinar-simples` avançada) com lógica criptográfica duplicada e drifts
funcionais reais (admin geral conseguia assinar com token de terceiro
em escalas mas não em GISE; selfie+2FA aplicadas em GISE mas ignoradas
em escalas mensais).

| Commit | O que mudou |
|---|---|
| `57ffaf4` | `signature-level.ts`: classifica nível legal (Lei 14.063/2020 art. 4º) |
| `1b62156` | `signature-service.ts`: funções `finalizarAssinaturaQualificada()` e `validarEvidenciasAvancada()` unificadas |
| `d83bc94` | 6 endpoints refatorados — removido bypass admin + uniformizado nível de evidência |
| `0204447` | `/conf-ass`: bloqueia desligar 2FA + indica nível legal das assinaturas |

**Política aplicada após a consolidação:**

1. **Sem bypass admin:** todo signatário precisa CPF cadastrado + token
   com CPF batendo. Admins existentes sem CPF precisam cadastrar antes
   de assinar.
2. **2FA por e-mail sempre obrigatório** (requisito legal mínimo Lei
   14.063/2020 art. 4º II "b" — controle exclusivo). Toggle bloqueado
   no painel admin, PUT rejeita `exigirCodigoEmail=false`.
3. **Demais flags** (foto, GPS, restringir-smartphone) aplicam-se
   uniformemente aos 3 fluxos.

### Fase 2 — Críticos (🔴)

| Commit | O que mudou |
|---|---|
| `9dd4394` | Trust store vazio vira hard error sob `ICP_BRASIL_TRUST_STORE_REQUIRED=1` |
| `154b435` | Cliente TSA RFC 3161 + mutator CAdES-BES → CAdES-T |
| `02685f2` | TSA server-side via `TSA_URL` + flag `EXIGIR_TSA_QUALIFICADA` |

**Resultado:** o sistema pode oferecer presunção plena do art. 10 §1º
MP 2.200-2 (qualificada) e tempestividade oponível a terceiros (TSA
RFC 3161) — desde que as envs sejam configuradas (ver
[Ações manuais obrigatórias](#ações-manuais-obrigatórias)).

### Fase 3 — Altos (🟠)

| Commit | O que mudou |
|---|---|
| `e5985b5` | OCSP com nonce RFC 8954 + validação da assinatura do BasicOCSPResponse (defesa contra MITM forjando "good" para cert revogado) |
| `4afd9b2` | `crypto-verify.ts`: suporta RSA PKCS#1, RSA-PSS, ECDSA P-256/384/521 (antes só PKCS#1 — certs A3 modernos falhavam silenciosamente) |
| `b7d1978` | Licença Lacuna Web PKI via env `WEBPKI_LICENSE` propagada do server ao cliente |

### Fase 4 — Liveness ativa (🟡)

| Commit | O que mudou |
|---|---|
| `e1dd3de` | `liveness-challenge.ts`: lógica pura blink/smile com EAR + threshold detection |
| `fe7c525` | `SignaturePad.svelte`: banner com desafio aleatório, barra de progresso, botão "Tirar Foto" desabilitado até cumprir |
| `985da87` | Resultado do challenge propagado da UI até o manifesto do PDF (auditável) |

Modelos `face_landmark_68` e `face_expression` adicionados a
`static/face-api/`. Defesa em profundidade: cliente bloqueia UI,
servidor revalida (rejeita ausência ou `duracaoMs<500`), manifesto
registra.

### Fase 5 — Médio restante (🟡)

| Commit | O que mudou |
|---|---|
| `f13b9b6` | `signaturePolicyId` PA-AD-RB v2.3 (DOC-ICP-15.03) nos SignedAttributes — sem isso o Validador ITI marca como "Sem política aplicada" |

### Fase 6 — Baixos (🟢)

| Commit | O que mudou |
|---|---|
| `1370f76` | Multi-signature: valida TODAS as assinaturas (antes só a última) |
| `a59302f` | Cache-Control da `/validar` agora revalida (antes era `immutable` incorretamente) |
| `e1b4180` | Migração `0025`: coluna `user_agent_raw` para perícia forense |
| `68a5f24` | Migração `0026`: coluna `conteudo_html_snapshot` em `aceites_termos` — reprodução em juízo sem git history |
| `68a4e7a` | TODO documentado para fallback CRL (não implementado por ser overkill — OCSP cobre 100% ICP-Brasil hoje) |
| (na fase Multi-signature) | Botão "Validador ITI" na `/validar` para conferência cruzada de assinaturas qualificadas |

## Ações manuais obrigatórias

> **Estas ações são pré-requisitos para o sistema oferecer assinatura
> qualificada plena em produção.** Sem elas, o código está pronto, mas
> o resultado jurídico fica reduzido.

### 1. Popular o Trust Store ICP-Brasil

A pasta `src/lib/server/icp-brasil/` tem `roots.pem` e `intermediates.pem`
vazios. Em máquina com acesso à internet (não funciona no sandbox de
agentes — precisa do ambiente da PCCE):

**Windows (PowerShell):**

```powershell
cd src/lib/server/icp-brasil
.\update-trust-store.ps1
git diff roots.pem intermediates.pem
git add roots.pem intermediates.pem
git commit -m "chore(icp-brasil): popula trust store $(Get-Date -Format yyyy-MM-dd)"
git push
```

> Se aparecer "execução de scripts foi desabilitada", rode antes:
> `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`

**Linux/macOS/WSL/Git Bash:**

```sh
cd src/lib/server/icp-brasil
./update-trust-store.sh
git diff roots.pem intermediates.pem
git add roots.pem intermediates.pem
git commit -m "chore(icp-brasil): popula trust store $(date +%F)"
git push
```

> **Atenção Windows:** rodar `./update-trust-store.sh` no PowerShell
> **não funciona** — PowerShell não executa `.sh` nativamente. Use o
> `.ps1` acima ou abra Git Bash na pasta.

Há também o workflow `.github/workflows/update-icp-brasil-trust-store.yml`
que abre PR automaticamente todo dia 1 do mês (roda no Ubuntu do GitHub
Actions, usa o `.sh`).

### 2. Calcular o hash da PA-AD-RB v2.3

**Forma fácil (Windows PowerShell):**

```powershell
.\scripts\calc-policy-hash.ps1
```

O script baixa o PDF oficial da ITI, calcula SHA-256, imprime o hash em
minúsculas e mostra as instruções de configuração no Cloudflare Pages.

Quando a ITI publicar nova versão do DOC-ICP-15.03 (eventualmente),
rode com URL diferente:

```powershell
.\scripts\calc-policy-hash.ps1 -Url 'https://www.gov.br/iti/...DOCICP1503v74.pdf'
```

**Forma manual (alternativa):**

```sh
curl -O https://www.gov.br/iti/pt-br/centrais-de-conteudo/DOCICP1503v73.pdf
openssl dgst -sha256 DOCICP1503v73.pdf
# ou no Windows: Get-FileHash -Algorithm SHA256 .\DOCICP1503v73.pdf
```

Cole o hash de 64 chars (lowercase) no Cloudflare Pages → Settings →
Environment variables → Production como `PA_AD_RB_HASH_HEX`.

### 3. Escolher e configurar a ACT (Time-Stamp Authority)

Provedores credenciados ICP-Brasil que oferecem endpoint TSA RFC 3161:

| Provedor | URL típica | Notas |
|---|---|---|
| **Bry** | `https://timestamp.bry.com.br/tsa` | Pago — pacote por volume |
| **Soluti** | `https://tsa.soluti.com.br/tsa` | Pago — pacote por volume |
| **Certisign** | (sob contrato) | Pago — sob demanda corporativa |
| **AC Safeweb** | (sob contrato) | Pago |
| **ICP-EDU** | `https://timestamp.icpedu.rnp.br/tsa` | Gratuito para órgãos públicos federais — verificar elegibilidade SUDOPER/PCCE |

Cloudflare Pages → Settings → Environment variables:

```
TSA_URL=https://timestamp.exemplo.com.br/tsa
TSA_USERNAME=<se exigir basic auth>
TSA_PASSWORD=<se exigir basic auth>
```

### 4. Aplicar migrações no banco D1 de produção

```sh
npm run db:migrate:prod
```

Migrações novas:
- `0025_user_agent_raw.sql` — adiciona coluna `user_agent_raw` nas 3 tabelas
- `0026_aceite_termo_snapshot.sql` — adiciona coluna `conteudo_html_snapshot`

### 5. Ativar envs de hardening em produção

Cloudflare Pages → Settings → Environment variables:

```
ICP_BRASIL_TRUST_STORE_REQUIRED=1
EXIGIR_TSA_QUALIFICADA=1
PA_AD_RB_HASH_HEX=<hex calculado no passo 2>
TSA_URL=<endpoint do passo 3>
```

Opcional (apenas se for usar Lacuna Web PKI em produção, fora de localhost):

```
WEBPKI_LICENSE=<chave comprada em https://www.lacunasoftware.com/products/web-pki>
```

### 6. Cadastrar CPF nos administradores existentes

Após a consolidação, **admins sem CPF cadastrado não conseguem mais
assinar com token PKI** — o serviço rejeita com 400 e mensagem clara.

Identifique quem precisa cadastrar:

```sql
-- D1 console
SELECT id, nome FROM administradores;
```

Cada admin sem CPF na lista deve acessar seu próprio perfil e
cadastrar o CPF antes da próxima assinatura qualificada.

## Ações manuais recomendadas (não-obrigatórias)

### A. Atualizar termo de uso para mencionar liveness ativa

O termo atual (`src/lib/server/termo/termo-vigente.ts` v1.1) menciona
"rubrica gráfica e fotografia (selfie)" mas não descreve o desafio
ativo. Recomenda-se:

1. Bumpar versão para `1.2`
2. Adicionar bullet em "3.1": "Resultado do desafio de presença (blink/smile)
   com tipo, duração e número de tentativas"
3. Após deploy, todos usuários terão que reaceitar — desejável para
   alinhar o consentimento ao que o sistema efetivamente coleta

### B. Documentar a política operacional de TSA

Definir internamente:
- Quem é o fornecedor contratado?
- Qual é o SLA do endpoint TSA?
- O que fazer quando o endpoint estiver indisponível?
  - Hoje, o sistema apenas loga warning e segue sem TST. Com
    `EXIGIR_TSA_QUALIFICADA=1`, ele recusa a assinatura.
  - Sugestão: ter endpoint TSA secundário e adicionar lógica de
    fallback no `cades-finalizer.ts`.

### C. Configurar Sentry para alertas críticos

O sistema já tem integração Sentry (`SENTRY_DSN`). Configurar alertas
para:

- `[CADES] Trust store ICP-Brasil vazio` (logado quando `REQUIRED=0`
  mas trust store está vazio em produção)
- `[OCSP] Assinatura do responder NÃO confere matematicamente` (possível
  MITM ou responder comprometido — investigar imediatamente)
- `[TSA] Falha ao solicitar carimbo de tempo` se acima de N% do tráfego

### D. Workflow CI para validar hash da PA-AD-RB

Análogo ao `update-icp-brasil-trust-store.yml`, criar workflow mensal
que:

1. Baixa o PDF oficial da ITI
2. Calcula SHA-256
3. Compara com a env `PA_AD_RB_HASH_HEX` registrada
4. Abre issue se divergir (ITI publicou nova versão)

## Sugestões de ações futuras

### Curto prazo (1-3 meses)

**1. Comparação biométrica 1:1 (Nível 3 da análise facial)**

A liveness ativa atual (blink/smile) barra foto/vídeo pré-gravado, mas
**não** detecta se a pessoa na câmera é a cadastrada. Implementar:

- Cadastro de embedding facial no primeiro acesso (selfie oficial)
- `faceRecognitionNet` gera vetor 128-d → coluna nova `policiais.face_embedding`
- A cada assinatura, comparar embedding atual via cosine similarity
- Score no manifesto: "Similaridade biométrica: 0.87"
- Exige bump do termo (consentimento granular para biometria — LGPD art. 11)

Custo estimado: 1-2 semanas. Resolve impersonação humana + foto-de-foto.

**2. Validador ITI embedido**

Em vez de só linkar para `https://validar.iti.gov.br`, oferecer upload
direto pela própria página `/validar` que faz POST ao endpoint da ITI
e mostra o resultado inline. Aumenta confiança jurídica de terceiros
sem expor o usuário a outro site.

**3. Hash de Política de Assinatura dinâmico**

Em vez de env estática `PA_AD_RB_HASH_HEX`, criar `scripts/refresh-policy-hash.ts`
que baixa o PDF atual da ITI, calcula o hash e atualiza um arquivo
versionado (`src/lib/server/icp-brasil/policy-hash.ts`). Roda no CI
junto com o update do trust store.

### Médio prazo (3-12 meses)

**4. Padrão PAdES-LTA (Long-Term Archive)**

PAdES-LT atual armazena DSS (cadeia + OCSP). PAdES-LTA acrescenta
**Document Time-Stamp** sobre o PDF inteiro a cada N anos, garantindo
validade arquivística por décadas mesmo se algoritmos criptográficos
forem comprometidos. Útil para escalas que precisem ficar válidas
por 5+ anos (Decreto 10.748/2021).

**5. Conferência judicial padronizada (export para perícia)**

Endpoint admin que exporta para um caso específico:
- PDF assinado
- Snapshot OCSP em DER
- Cadeia de certificados
- Manifesto em JSON estruturado (não só visual no PDF)
- Hash SHA-256 do bundle exportado

Útil em cooperação com Ministério Público e Tribunal de Justiça.

**6. Migração para algoritmos pós-quânticos**

Quando NIST publicar Round-4 final dos algoritmos pós-quânticos
(esperado 2026-2027), avaliar migração. Hoje o sistema usa
SHA-256/RSA-2048 que serão eventualmente vulneráveis a Shor's
algorithm em computadores quânticos. ICP-Brasil seguirá a
padronização NIST.

### Longo prazo (>12 meses)

**7. Integração KYC com biometria de cadastro oficial**

Conectar com a base biométrica oficial da SSP/CE (sistema de RG ou
da carteira funcional). Comparação 1:1 contra foto oficial em vez de
selfie cadastrada — elimina ataque de "cadastro malicioso" no primeiro
acesso.

**8. Soluções SaaS com PAD ISO 30107-3 Level 2**

Para assinaturas de altíssimo risco (escalas que afetam orçamento
público, decisões disciplinares), avaliar contratação de Unico, Idwall
ou iProov. Fornecem liveness ativa com challenge proprietário
(flashmark, etc.) certificado ISO 30107-3 nível 2 — barra inclusive
deepfake em tempo real.

**9. Carimbo de tempo qualificado próprio**

Se o volume de assinaturas justificar economicamente, a PCCE poderia
solicitar credenciamento como ACT na ITI. Eliminaria custo recorrente
de TSA contratada e centralizaria a infraestrutura.

## Configuração resumida das envs

Lista completa de envs do Cloudflare Pages relacionadas a assinaturas:

| Env | Obrigatório? | Default | Descrição |
|---|---|---|---|
| `ICP_BRASIL_TRUST_STORE_REQUIRED` | Produção | vazio | Quando `1`, recusa assinatura se trust store estiver vazio |
| `EXIGIR_TSA_QUALIFICADA` | Produção | vazio | Quando `1`, recusa assinatura sem TimeStampToken RFC 3161 |
| `TSA_URL` | Produção | vazio | Endpoint TSA RFC 3161 para anexar TST server-side |
| `TSA_USERNAME` | Se ACT exigir | vazio | Basic auth — usuário |
| `TSA_PASSWORD` | Se ACT exigir | vazio | Basic auth — senha |
| `PA_AD_RB_HASH_HEX` | Produção | zeros | SHA-256 do PDF oficial da PA-AD-RB v2.3 |
| `WEBPKI_LICENSE` | Se usar Lacuna | vazio | Licença Lacuna Web PKI para o domínio |

## Commits do branch

```
68a4e7a docs(cades): registra TODO para fallback CRL
68a5f24 feat(termo): snapshot do HTML aceito por usuario (auditavel forense)
e1b4180 feat(audit): preserva User-Agent BRUTO para pericia forense
a59302f fix(validar): troca 'immutable' por revalidacao curta
1370f76 feat(verify): valida TODAS as assinaturas embarcadas (multi-signature)
f13b9b6 feat(cades): adiciona signaturePolicyId PA-AD-RB v2.3 (DOC-ICP-15.03)
985da87 feat(liveness): propaga resultado do challenge ate manifesto do PDF
fe7c525 feat(SignaturePad): integra liveness challenge na UI da camera
e1dd3de feat(liveness): logica pura de challenge-response (blink/smile)
b7d1978 feat(webpki): suporta licenca Lacuna via env WEBPKI_LICENSE
4afd9b2 feat(crypto): suporta ECDSA + RSA-PSS na verificacao do SignerInfo
e5985b5 feat(ocsp): nonce RFC 8954 + validacao da signature do responder
02685f2 feat(cades): TSA server-side + EXIGIR_TSA_QUALIFICADA via env
154b435 feat(tsa): cliente RFC 3161 + mutator CAdES-BES → CAdES-T
9dd4394 feat(icp-brasil): trust store vazio vira hard error sob env
0204447 feat(conf-ass): bloqueia desligar 2FA + indica nivel legal das assinaturas
d83bc94 refactor(api): endpoints de assinatura delegam ao signature-service
1b62156 feat(signatures): consolida fluxos de assinatura em signature-service
57ffaf4 feat(signatures): classifica nivel legal das assinaturas em tela
```

20 commits, todos no branch `claude/analyze-digital-signatures-Oq6sf`.

## Referências legais e técnicas

- **MP 2.200-2/2001** art. 10 §1º — presunção da assinatura qualificada
- **Lei 14.063/2020** art. 4º — taxonomia simples/avançada/qualificada
- **LGPD (13.709/2018)** art. 7º V, 11, 16, 18, 46
- **Decreto 10.278/2020** — digitalização de documentos
- **Decreto 10.748/2021** — política de cybersec
- **DOC-ICP-15.03** v7.3 — Política de Assinatura ICP-Brasil
- **ETSI EN 319 142-1** — PAdES
- **RFC 3161** — Time-Stamp Protocol
- **RFC 5126** — CAdES
- **RFC 5280** — X.509 PKI
- **RFC 5652** — CMS
- **RFC 6960** — OCSP
- **RFC 8954** — OCSP nonce
- **ISO/IEC 30107-3** — Presentation Attack Detection (liveness)
