# Apostilas

Duas apostilas, dois públicos. Cada uma tem uma FONTE em Markdown e dois
derivados (`.docx` e `.pdf`) gerados por [`gerar/`](gerar/).

## 1. Apostila do Desenvolvedor

Onboarding de quem vai **escrever código** no projeto sem ter participado dele:
domínio, stack, arquitetura, as regras verificadas pelo CI, os módulos e o passo
a passo da primeira contribuição.

| Arquivo | O que é |
| --- | --- |
| [`APOSTILA.md`](APOSTILA.md) | **Fonte de verdade.** É este arquivo que se edita |
| `Apostila-Desenvolvedor-Escalas-PCCE.docx` | Versão Word |
| `Apostila-Desenvolvedor-Escalas-PCCE.pdf` | Versão PDF (A4, 79 páginas) |

## 2. Apostila de Implantação

Do repositório à **produção no Cloudflare**, para quem vai operar o deploy:
infraestrutura (D1, R2, Pages, tokens), o catálogo COMPLETO de variáveis e
secrets — com a função de cada uma e a consequência de deixá-la vazia —,
GitHub Actions (os quatro workflows e seus secrets), primeiro deploy, go-live e
solução de problemas por sintoma.

| Arquivo | O que é |
| --- | --- |
| [`APOSTILA-IMPLANTACAO.md`](APOSTILA-IMPLANTACAO.md) | **Fonte de verdade.** É este arquivo que se edita |
| `Apostila-Implantacao-Cloudflare-Escalas-PCCE.docx` | Versão Word |
| `Apostila-Implantacao-Cloudflare-Escalas-PCCE.pdf` | Versão PDF (A4, 56 páginas) |

Ela é derivada de [`DEPLOY.md`](../../DEPLOY.md), [`.env.example`](../../.env.example)
e dos workflows em `.github/workflows/`, que continuam sendo a referência
oficial. Duas divergências encontradas ao escrevê-la estão registradas no
próprio texto: `scripts/hash-password.ts` (citado no `DEPLOY.md`) não existe — o
apêndice D traz um substituto testado —, e o `README.md` ainda diz que a sessão
dura 8 horas quando o código está em 1 hora.

## Relação com os documentos vivos

A apostila **ensina**; ela não substitui `README.md`, `DEPLOY.md`, `TESTING.md`
nem `CLAUDE.md`, que continuam sendo a referência oficial e mudam no mesmo PR
que muda o comportamento.

Ela é **derivada**: quando um documento vivo mudar de forma relevante para quem
está chegando (uma regra nova de código, um módulo novo, uma mudança de fluxo),
atualize o `APOSTILA.md` e **regenere os dois binários** — um `.docx` que
descreve um sistema que não existe mais é pior que nenhum, porque circula fora
do repositório e ninguém confere a data.

## Como regenerar

Os conversores usam apenas dependências que o projeto já tem: `docx`
(dependência) e o Chromium do `@playwright/test` (devDependency).

```bash
# Apostila do Desenvolvedor
node docs/apostila/gerar/md-para-docx.cjs \
     docs/apostila/APOSTILA.md \
     docs/apostila/Apostila-Desenvolvedor-Escalas-PCCE.docx
node docs/apostila/gerar/md-para-html.cjs \
     docs/apostila/APOSTILA.md /tmp/apostila.html
node docs/apostila/gerar/html-para-pdf.cjs \
     /tmp/apostila.html \
     docs/apostila/Apostila-Desenvolvedor-Escalas-PCCE.pdf

# Apostila de Implantação
node docs/apostila/gerar/md-para-docx.cjs \
     docs/apostila/APOSTILA-IMPLANTACAO.md \
     docs/apostila/Apostila-Implantacao-Cloudflare-Escalas-PCCE.docx
node docs/apostila/gerar/md-para-html.cjs \
     docs/apostila/APOSTILA-IMPLANTACAO.md /tmp/implantacao.html
node docs/apostila/gerar/html-para-pdf.cjs \
     /tmp/implantacao.html \
     docs/apostila/Apostila-Implantacao-Cloudflare-Escalas-PCCE.pdf
```

O cabeçalho de página do PDF é fixo no `html-para-pdf.cjs`; ajuste-o se gerar
um documento com outro título.

O `qpdf` é opcional: com ele a capa sai sem o cabeçalho de página; sem ele, o
PDF é gerado do mesmo jeito, com o cabeçalho também na capa.

## O que os conversores suportam

Um subconjunto deliberadamente pequeno de Markdown — o que a apostila usa:
títulos `#` a `####`, parágrafos com `**negrito**`, `` `código` ``, `*itálico*` e
`[link](url)`, listas com `-` e `1.`, caixas `- [ ]`, tabelas em pipe, blocos
de código com crase tripla, citações `>` e régua `---`.

O cabeçalho do `.md` traz os metadados da capa:

```
%%TITULO%% Apostila do Desenvolvedor
%%SUBTITULO%% Sistema de Gestão de Escalas — PCCE
%%LINHA%% Guia completo de onboarding...
%%DATA%% Setembro de 2026
```

No Word, o sumário é um campo real (`TOC`): ao abrir o arquivo, aceite a
atualização de campos para que os números de página apareçam. No PDF o sumário
não tem número de página — as entradas são **links internos**.
