# Apostila do Desenvolvedor

Material de **onboarding** para quem entra no projeto sem ter participado dele:
explica o domínio, a stack, a arquitetura, as regras verificadas pelo CI, os
módulos e o passo a passo da primeira contribuição.

| Arquivo | O que é |
| --- | --- |
| [`APOSTILA.md`](APOSTILA.md) | **Fonte de verdade.** É este arquivo que se edita |
| `Apostila-Desenvolvedor-Escalas-PCCE.docx` | Versão Word, gerada a partir do `.md` |
| `Apostila-Desenvolvedor-Escalas-PCCE.pdf` | Versão PDF (A4, 79 páginas), gerada a partir do `.md` |
| [`gerar/`](gerar/) | Os conversores que produzem o `.docx` e o `.pdf` |

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
# 1. Word
node docs/apostila/gerar/md-para-docx.cjs \
     docs/apostila/APOSTILA.md \
     docs/apostila/Apostila-Desenvolvedor-Escalas-PCCE.docx

# 2. HTML intermediário + PDF
node docs/apostila/gerar/md-para-html.cjs \
     docs/apostila/APOSTILA.md /tmp/apostila.html
node docs/apostila/gerar/html-para-pdf.cjs \
     /tmp/apostila.html \
     docs/apostila/Apostila-Desenvolvedor-Escalas-PCCE.pdf
```

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
