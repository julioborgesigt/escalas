# Índice da Documentação

Mapa de toda a documentação do projeto, separada em **documentos vivos** (mantidos atualizados — se o código mudar, eles mudam junto) e **registros históricos** (fotografias de auditorias/decisões em uma data específica — não são atualizados retroativamente).

## Documentos vivos

| Documento | Conteúdo | Público-alvo |
|-----------|----------|--------------|
| [`README.md`](../README.md) (raiz) | Visão geral, stack, setup local, arquitetura, módulos, padrões de código, troubleshooting | Qualquer dev entrando no projeto |
| [`DEPLOY.md`](../DEPLOY.md) (raiz) | Runbook de produção: variáveis/secrets, papéis de admin, backup/rollback, staging, trust store ICP-Brasil, TSA, go-live | Operador / responsável pelo deploy |
| [`TESTING.md`](../TESTING.md) (raiz) | Roteiro de regressão manual (100+ casos) de todos os fluxos de negócio | QA / dev antes de release |
| [`CLAUDE.md`](../CLAUDE.md) (raiz) | Diretrizes de código (Svelte 5 runes, padrão de erros de API) para agentes e devs | Dev / agente de IA |
| [`ARQUIVOS.md`](ARQUIVOS.md) | Mapa arquivo-a-arquivo do repositório (o que cada arquivo faz) + achados de código morto/duplicado | Dev entrando no projeto / refatorações |
| [`QA_ASSINATURA_A3_DESKTOP.md`](QA_ASSINATURA_A3_DESKTOP.md) | Roteiro de QA manual do fluxo de presença GISE por Token A3 (exige hardware; não roda em CI) | QA com token físico |
| [`.env.example`](../.env.example) (raiz) | **Fonte autoritativa** de todas as variáveis de ambiente, comentadas | Dev / operador |
| [`scripts/README.md`](../scripts/README.md) | Scripts utilitários (migrações, senhas) e setup detalhado da integração Google Sheets / Base_Equipe | Operador |
| [`src/lib/server/icp-brasil/README.md`](../src/lib/server/icp-brasil/README.md) | Trust store ICP-Brasil: o que é, como atualizar (script Windows/Linux), frequência | Dev / operador |
| [`static/face-api/README.md`](../static/face-api/README.md) | Modelos de reconhecimento facial servidos localmente e como atualizá-los | Dev |

## Registros históricos e decisões arquivadas

Estes documentos **não devem ser lidos como estado atual do sistema** — cada um reflete a data em que foi escrito. Muitos achados já foram remediados (o histórico de remediação costuma estar anotado no próprio documento ou em auditorias posteriores).

| Documento | Data | O que registra |
|-----------|------|----------------|
| [`MIGRACAO-WORKERS.md`](MIGRACAO-WORKERS.md) | jun/2026 | Avaliação da migração Pages→Workers — **ARQUIVADA** (o teto de 100k iterações PBKDF2 é do runtime, não da plataforma; o achado A3 foi resolvido pelo `PASSWORD_PEPPER`) |
| [`auditorias/AUDITORIA_GERAL_2026-06-28.md`](auditorias/AUDITORIA_GERAL_2026-06-28.md) | 28/jun/2026 | Auditoria geral mais recente (segurança, código, banco, dependências, CI, LGPD) com plano de ação e status |
| [`auditorias/LGPD_AUDIT.md`](auditorias/LGPD_AUDIT.md) | mai/2026 | Auditoria de conformidade LGPD (4 críticos, 11 altos, 7 médios na época) |
| [`auditorias/LGPD_REMEDIATION_PLAN.md`](auditorias/LGPD_REMEDIATION_PLAN.md) | mai/2026 | Plano de remediação derivado do `LGPD_AUDIT.md` (a maior parte já implementada — ver auditoria geral de jun/2026) |
| [`auditorias/SIGNATURE_HARDENING.md`](auditorias/SIGNATURE_HARDENING.md) | mai/2026 | Sessão de endurecimento das assinaturas digitais (16 achados resolvidos/documentados) + ações operacionais de go-live |
| [`auditorias/ANALISE_JURIDICA_ASSINATURAS.md`](auditorias/ANALISE_JURIDICA_ASSINATURAS.md) | mai/2026 | Parecer técnico-jurídico das assinaturas avançada × qualificada (não vinculante) |
| [`auditorias/AUDITORIA_PERFORMANCE_UX.md`](auditorias/AUDITORIA_PERFORMANCE_UX.md) | jun/2026 | Auditoria de performance/UX — 3 fases **implementadas** (resultados medidos no topo do documento) |
| [`auditorias/AUDITORIA_VISUAL.md`](auditorias/AUDITORIA_VISUAL.md) | jun/2026 | Auditoria de consistência visual (tipografia, ícones, tokens de tema) |
| [`auditorias/skeleton_audit_final.md`](auditorias/skeleton_audit_final.md) | jun/2026 | **Consolidação final** das 3 auditorias de aproveitamento do Skeleton UI v4 |
| [`auditorias/SKELETON_AUDIT.md`](auditorias/SKELETON_AUDIT.md) | jun/2026 | ⚠️ Supersedida — consolidada em `skeleton_audit_final.md` |
| [`auditorias/SKELETON_DEEP_AUDIT.md`](auditorias/SKELETON_DEEP_AUDIT.md) | jun/2026 | ⚠️ Supersedida — consolidada em `skeleton_audit_final.md` |

## Convenções

- **Novas auditorias** entram em `docs/auditorias/` com data no nome ou no cabeçalho (ex.: `AUDITORIA_GERAL_2026-06-28.md`).
- Quando um documento for **supersedido** por outro, adicione um banner no topo apontando para o sucessor (não apague — o histórico tem valor de rastreabilidade para achados como A1–A8, I-1…I-4, M-3/M-4, citados em comentários do código).
- Documentos **vivos** que ficarem defasados devem ser corrigidos no mesmo PR que muda o comportamento correspondente.
