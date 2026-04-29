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
binários ficam em `https://estrutura.iti.gov.br/` (interface SPA — clicar em
"Repositório de Certificados das ACs").

### Procedimento

1. Baixe **manualmente** cada `.crt` em `https://www.gov.br/iti/pt-br/assuntos/icp-brasil/repositorio`.
2. Verifique o hash SHA-256 do arquivo baixado contra o documento oficial do ITI
   (publicado em PDF assinado).
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
até que a equipe popule os PEMs seguindo o procedimento acima.

## Frequência de atualização

- **Raízes**: mudam raramente (a cada ~10 anos). v10 é válida até 2030.
- **Intermediárias**: novas ACs são credenciadas e descredenciadas periodicamente.
  Recomendado revisar a cada 6 meses.
