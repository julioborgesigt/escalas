# Índice da Documentação

Mapa de toda a documentação do projeto, separada em **documentos vivos** (mantidos atualizados — se o código mudar, eles mudam junto) e **registros históricos** (fotografias de auditorias/decisões em uma data específica — arquivados no histórico do Git e catalogados em [`HISTORICO.md`](HISTORICO.md)).

## Documentos vivos

| Documento                                                                       | Conteúdo                                                                                                                                    | Público-alvo                       |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| [`README.md`](../README.md) (raiz)                                              | Visão geral, stack, setup local, arquitetura, módulos, padrões de código, troubleshooting                                                   | Qualquer dev entrando no projeto   |
| [`DEPLOY.md`](../DEPLOY.md) (raiz)                                              | Runbook de produção: variáveis/secrets, papéis de admin, backup/rollback, staging, trust store ICP-Brasil, TSA, go-live                     | Operador / responsável pelo deploy |
| [`TESTING.md`](../TESTING.md) (raiz)                                            | Roteiro manual de **exceção** (hardware/ambiente real); o gate de regressão é a suíte automatizada — casos cobertos por spec estão anotados | QA / dev antes de release          |
| [`CLAUDE.md`](../CLAUDE.md) (raiz)                                              | Diretrizes de código (Svelte 5 runes, padrão de erros de API) para agentes e devs                                                           | Dev / agente de IA                 |
| [`QA_ASSINATURA_A3_DESKTOP.md`](QA_ASSINATURA_A3_DESKTOP.md)                    | Roteiro de QA manual do fluxo de presença GISE por Token A3 (exige hardware; não roda em CI)                                                | QA com token físico                |
| [`.env.example`](../.env.example) (raiz)                                        | **Fonte autoritativa** de todas as variáveis de ambiente, comentadas                                                                        | Dev / operador                     |
| [`scripts/README.md`](../scripts/README.md)                                     | Scripts utilitários (migrações, senhas) e setup detalhado da integração Google Sheets / Base_Equipe                                         | Operador                           |
| [`src/lib/server/assinatura/icp-brasil/README.md`](../src/lib/server/assinatura/icp-brasil/README.md) | Trust store ICP-Brasil: o que é, como atualizar (script Windows/Linux), frequência                                                          | Dev / operador                     |
| [`static/face-api/README.md`](../static/face-api/README.md)                     | Modelos de reconhecimento facial servidos localmente e como atualizá-los                                                                    | Dev                                |

## Registros históricos e decisões arquivadas

Os relatórios de auditoria e as avaliações arquivadas **não vivem mais no working tree** — foram removidos em 2026-07-20 para enxugar o repositório e continuam preservados no histórico do Git. O catálogo completo (o que cada um registra, quais achados vieram de cada um e o comando `git show` para lê-los) está em [`HISTORICO.md`](HISTORICO.md).

## Convenções

- **Novas auditorias** podem ser commitadas em `docs/auditorias/` (data no nome ou no cabeçalho) enquanto seus achados estão sendo tratados; quando encerradas, o arquivo é removido e catalogado no [`HISTORICO.md`](HISTORICO.md) — o histórico do Git mantém a rastreabilidade dos achados (A1–A8, I-1…I-4, M-3/M-4, R2-1…R2-4, B-1…B-6…) citados em comentários do código.
- Documentos **vivos** que ficarem defasados devem ser corrigidos no mesmo PR que muda o comportamento correspondente.
