# Trust Store ICP-Brasil

Este diretório contém os certificados raiz e intermediários da Infraestrutura de
Chaves Públicas Brasileira (ICP-Brasil), usados para validar a cadeia de confiança
de assinaturas digitais qualificadas (e-CPF, e-CNPJ).

## Arquivos

- `roots.pem` — Certificados das **Autoridades Certificadoras Raiz** (ACRaiz da ITI/MCTIC).
  Atualmente em uso: ACRaiz v5 e v10.
- `intermediates.pem` — Certificados das **Autoridades Certificadoras intermediárias**
  credenciadas pela ITI (Serasa, Certisign, Caixa, SERPRO, Soluti, AC ICP-EDU, etc.).
- `trust-store.ts` — Loader que carrega os PEMs em runtime e devolve uma estrutura
  consumível por `node-forge`.

## Por que está versionado

Cloudflare Workers não tem `fs`, então o conteúdo precisa ser embutido no bundle
em build-time via `?raw` do Vite. Manter os certificados versionados também garante
determinismo da validação ao longo do tempo (auditoria forense pode reproduzir
o resultado mesmo se o ITI mudar a estrutura do site).

## Como atualizar

A ITI publica os certificados raiz em PDF assinado em
<https://www.gov.br/iti/pt-br/assuntos/icp-brasil>. Os arquivos `.crt`/`.cer`
binários ficam em `https://acraiz.icpbrasil.gov.br/`.

### Procedimento (recomendado): script automatizado

Há duas versões equivalentes — use a que corresponde ao seu ambiente:

**Windows (PowerShell 5.1+ ou PowerShell Core 7+):**

```powershell
cd src/lib/server/icp-brasil
.\update-trust-store.ps1
git diff roots.pem intermediates.pem    # revise as mudanças
git add roots.pem intermediates.pem
git commit -m "chore(icp-brasil): atualiza trust store ($(Get-Date -Format yyyy-MM-dd))"
```

Não precisa de bash/curl/openssl/unzip externos — usa cmdlets nativos
do PowerShell e `System.Security.Cryptography.X509Certificates.X509Certificate2`.

> Se o PowerShell barrar a execução com erro de política, rode antes:
> `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`

**Linux/macOS/WSL (bash com `curl`, `openssl`, `unzip`):**

```sh
cd src/lib/server/icp-brasil
./update-trust-store.sh
git diff roots.pem intermediates.pem    # revise as mudanças
git add roots.pem intermediates.pem
git commit -m "chore(icp-brasil): atualiza trust store ($(date +%F))"
```

Os dois scripts são funcionalmente equivalentes: baixam as raízes
ativas (v5 e v10), o zip oficial das ACs intermediárias, anotam
subject / validade / SHA-256 antes de cada certificado, e substituem
os PEMs versionados. Idempotentes — rode quando precisar atualizar.

> **Aviso comum em Windows:** rodar `./update-trust-store.sh` no
> PowerShell **não funciona** (PowerShell não executa `.sh`
> nativamente). Use `.\update-trust-store.ps1` ou, se preferir o bash,
> abra o "Git Bash" (vem com Git for Windows) na pasta e rode lá.

### Procedimento manual (fallback)

Se o script falhar (mudança de URL no ITI, por exemplo):

1. Baixe **manualmente** cada `.crt` de
   `https://acraiz.icpbrasil.gov.br/credenciadas/RAIZ/ICP-Brasilv{5,10}.crt`
   e o zip `https://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil/ACcompactado.zip`.
2. Verifique o hash SHA-256 dos arquivos baixados contra o documento oficial
   do ITI (publicado em PDF assinado).
3. Converta cada `.crt` (DER binário) para PEM:
   ```sh
   openssl x509 -inform DER -in ACraizv10.crt -outform PEM -out ACraizv10.pem
   ```
4. Concatene em `roots.pem` (raízes) ou `intermediates.pem` (intermediárias).
   Mantenha um cabeçalho de comentário antes de cada certificado:
   ```
   # AC Raiz ICP-Brasil v10
   # Subject: C=BR, O=ICP-Brasil, OU=Instituto Nacional de Tecnologia da Informação - ITI, CN=Autoridade Certificadora Raiz Brasileira v10
   # Validade: 2020-09-21 até 2030-09-21
   # SHA-256: <hash>
   -----BEGIN CERTIFICATE-----
   ...
   -----END CERTIFICATE-----
   ```
5. Rode `npm run check && npm run test` para garantir que o loader continua
   funcionando.
6. Commit com mensagem `chore(icp-brasil): atualiza trust store (yyyy-mm-dd)`.

## Estado atual

⚠️ Os arquivos `roots.pem` e `intermediates.pem` neste commit estão **vazios**
(apenas com comentários explicativos). O loader detecta isso e retorna
`{ disponivel: false }` — a verificação de cadeia exibe "indisponível"
até que a equipe execute `./update-trust-store.sh` (ou rode o procedimento
manual) e commite os PEMs populados.

## Frequência de atualização

- **Raízes**: mudam raramente (a cada ~10 anos). v10 é válida até 2030.
- **Intermediárias**: novas ACs são credenciadas e descredenciadas periodicamente.
  Recomendado revisar a cada 6 meses.
