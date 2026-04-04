# API - Sistema de Escalas Policiais

API REST do sistema de gerenciamento de escalas policiais. Todas as rotas estão sob o prefixo `/api/`.

## Autenticacao

A autenticacao utiliza **sessoes baseadas em cookies**. Apos o login via `/api/auth/login`, o servidor define um cookie de sessao que deve ser enviado em todas as requisicoes subsequentes.

- **Cookie de sessao**: definido automaticamente apos login
- **CSRF**: protecao contra Cross-Site Request Forgery via tokens
- Endpoints publicos (sem autenticacao): `/api/health`, `/api/validar/[hash]/download`

---

## Endpoints

### Auth

| Metodo | Rota | Descricao | Auth |
|--------|------|-----------|------|
| POST | `/api/auth/login` | Autenticar usuario | Nao |
| POST | `/api/auth/logout` | Encerrar sessao | Sim |
| POST | `/api/auth/alterar-senha` | Alterar senha do usuario | Sim |

### Policiais

| Metodo | Rota | Descricao | Auth |
|--------|------|-----------|------|
| GET | `/api/policiais` | Listar policiais | Sim |
| POST | `/api/policiais` | Criar policial | Sim |
| DELETE | `/api/policiais` | Remover policiais em lote | Sim |
| GET | `/api/policiais/[id]` | Obter policial por ID | Sim |
| PUT | `/api/policiais/[id]` | Atualizar policial | Sim |
| DELETE | `/api/policiais/[id]` | Remover policial | Sim |
| POST | `/api/policiais/upload` | Upload de planilha de policiais | Sim |

### Lotacoes

| Metodo | Rota | Descricao | Auth |
|--------|------|-----------|------|
| GET | `/api/lotacoes` | Listar lotacoes | Sim |
| GET | `/api/lotacoes/regimes` | Listar regimes de trabalho | Sim |

### Escalas

| Metodo | Rota | Descricao | Auth |
|--------|------|-----------|------|
| GET | `/api/escalas` | Listar escalas | Sim |
| POST | `/api/escalas` | Criar escala | Sim |
| DELETE | `/api/escalas` | Remover escalas em lote | Sim |
| GET | `/api/escalas/[id]/policiais` | Listar policiais da escala | Sim |
| POST | `/api/escalas/[id]/policiais` | Adicionar policial a escala | Sim |
| PUT | `/api/escalas/[id]/policiais` | Atualizar dados do policial na escala | Sim |
| PATCH | `/api/escalas/[id]/policiais` | Atualizar parcialmente policial na escala | Sim |
| DELETE | `/api/escalas/[id]/policiais` | Remover policial da escala | Sim |
| PATCH | `/api/escalas/[id]/visto` | Registrar visto na escala | Sim |
| POST | `/api/escalas/[id]/proximo-mes` | Gerar escala do proximo mes | Sim |
| GET | `/api/escalas/[id]/download` | Download da escala em PDF | Sim |
| POST | `/api/escalas/[id]/preparar-assinatura` | Preparar documento para assinatura digital | Sim |
| POST | `/api/escalas/[id]/assinar-simples` | Assinar escala (assinatura simples) | Sim |
| POST | `/api/escalas/[id]/finalizar-assinatura` | Finalizar processo de assinatura | Sim |
| POST | `/api/escalas/[id]/finalizar-assinatura-serpro` | Finalizar assinatura via SERPRO | Sim |
| GET | `/api/escalas/[id]/documento-assinado` | Obter documento assinado | Sim |
| DELETE | `/api/escalas/[id]/documento-assinado` | Remover documento assinado | Sim |
| GET | `/api/escalas/[id]/documento-assinado/info` | Obter info do documento assinado | Sim |

### GISE

| Metodo | Rota | Descricao | Auth |
|--------|------|-----------|------|
| GET | `/api/gise` | Listar GISEs | Sim |
| POST | `/api/gise` | Criar GISE | Sim |
| GET | `/api/gise/[id]` | Obter GISE por ID | Sim |
| PATCH | `/api/gise/[id]` | Atualizar GISE | Sim |
| DELETE | `/api/gise/[id]` | Remover GISE | Sim |
| GET | `/api/gise/modelo` | Obter modelo de GISE | Sim |
| POST | `/api/gise/modelo` | Criar/atualizar modelo de GISE | Sim |

#### GISE - Seccionais

| Metodo | Rota | Descricao | Auth |
|--------|------|-----------|------|
| GET | `/api/gise/[id]/seccionais` | Listar seccionais da GISE | Sim |
| POST | `/api/gise/[id]/seccionais` | Adicionar seccional | Sim |
| PATCH | `/api/gise/[id]/seccionais/[sec_id]` | Atualizar seccional | Sim |
| POST | `/api/gise/[id]/seccionais/[sec_id]` | Acao em seccional especifica | Sim |
| DELETE | `/api/gise/[id]/seccionais/[sec_id]` | Remover seccional | Sim |

#### GISE - Equipes e Membros

| Metodo | Rota | Descricao | Auth |
|--------|------|-----------|------|
| PATCH | `/api/gise/[id]/equipes/[eq_id]` | Atualizar equipe | Sim |
| DELETE | `/api/gise/[id]/equipes/[eq_id]` | Remover equipe | Sim |
| DELETE | `/api/gise/[id]/membros/[mem_id]` | Remover membro da equipe | Sim |

#### GISE - Presenca

| Metodo | Rota | Descricao | Auth |
|--------|------|-----------|------|
| POST | `/api/gise/[id]/presenca/entrada` | Registrar entrada de presenca | Sim |
| POST | `/api/gise/[id]/presenca/saida` | Registrar saida de presenca | Sim |

#### GISE - Resposta e Finalizacao

| Metodo | Rota | Descricao | Auth |
|--------|------|-----------|------|
| GET | `/api/gise/[id]/resposta` | Obter resposta da GISE | Sim |
| POST | `/api/gise/[id]/resposta` | Enviar resposta da GISE | Sim |
| POST | `/api/gise/[id]/finalizar` | Finalizar GISE | Sim |
| POST | `/api/gise/[id]/reabrir` | Reabrir GISE finalizada | Sim |

#### GISE - Download e Assinatura

| Metodo | Rota | Descricao | Auth |
|--------|------|-----------|------|
| GET | `/api/gise/[id]/download` | Download da GISE em PDF | Sim |
| POST | `/api/gise/[id]/preparar-assinatura` | Preparar para assinatura digital | Sim |
| POST | `/api/gise/[id]/assinar` | Assinar GISE | Sim |
| POST | `/api/gise/[id]/assinar-simples` | Assinar GISE (assinatura simples) | Sim |
| POST | `/api/gise/[id]/finalizar-assinatura` | Finalizar processo de assinatura | Sim |
| GET | `/api/gise/[id]/documento-assinado` | Obter documento assinado | Sim |
| DELETE | `/api/gise/[id]/documento-assinado` | Remover documento assinado | Sim |
| GET | `/api/gise/[id]/documento-assinado/info` | Obter info do documento assinado | Sim |

#### GISE - Relatorios por Seccional

| Metodo | Rota | Descricao | Auth |
|--------|------|-----------|------|
| POST | `/api/gise/[id]/relatorios/[seccionalId]/preparar-assinatura` | Preparar relatorio para assinatura | Sim |
| POST | `/api/gise/[id]/relatorios/[seccionalId]/assinar` | Assinar relatorio da seccional | Sim |
| POST | `/api/gise/[id]/relatorios/[seccionalId]/finalizar-assinatura` | Finalizar assinatura do relatorio | Sim |

### Unidades

| Metodo | Rota | Descricao | Auth |
|--------|------|-----------|------|
| GET | `/api/unidades` | Listar unidades | Sim |
| POST | `/api/unidades` | Criar unidade | Sim |
| PUT | `/api/unidades/[id]` | Atualizar unidade | Sim |
| DELETE | `/api/unidades/[id]` | Remover unidade | Sim |

### Admin

| Metodo | Rota | Descricao | Auth |
|--------|------|-----------|------|
| GET | `/api/admin/papeis` | Listar papeis de usuario | Sim |
| POST | `/api/admin/papeis` | Atribuir/alterar papel de usuario | Sim |
| GET | `/api/admin/compliance` | Verificar conformidade do sistema | Sim |

### Health

| Metodo | Rota | Descricao | Auth |
|--------|------|-----------|------|
| GET | `/api/health` | Verificar saude do sistema (DB, R2) | Nao |

### Validar

| Metodo | Rota | Descricao | Auth |
|--------|------|-----------|------|
| GET | `/api/validar/[hash]/download` | Baixar documento validado por hash | Nao |

---

## Codigos de Resposta

| Codigo | Significado |
|--------|-------------|
| 200 | Sucesso |
| 201 | Recurso criado |
| 400 | Requisicao invalida |
| 401 | Nao autenticado |
| 403 | Sem permissao |
| 404 | Recurso nao encontrado |
| 500 | Erro interno do servidor |
| 503 | Servico indisponivel (health degradado) |

## Fluxo de Status GISE

```
em_definicao_supervisor → em_preenchimento → aguardando_assinatura
→ em_andamento → aguardando_relatorios → aguardando_assinatura_relat
→ pronta_para_finalizar → finalizada
```

## Observacoes

- Todas as respostas sao em formato JSON, exceto endpoints de download que retornam PDF/XLSX.
- Parametros `[id]`, `[eq_id]`, `[sec_id]`, `[mem_id]`, `[seccionalId]` e `[hash]` sao substituidos pelos valores reais na URL.
- Rate limiting: 5 tentativas de login a cada 15 min por IP (HTTP 429).
- A infraestrutura utiliza Cloudflare D1 (banco de dados) e R2 (armazenamento de arquivos).
