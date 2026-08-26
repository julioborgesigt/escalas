# Roteiro de QA Manual — Assinatura por Token A3 no Desktop (Presença GISE)

Cobre o fluxo de **confirmação de presença GISE por Token A3 no computador**
(termo qualificado) e os relatórios derivados. Os passos
exigem ambiente real: este roteiro **não roda em CI** (depende do Assinador
Desktop SERPRO, do navegador com a extensão e de um Token A3 físico).

> Legenda: ✅ esperado · ⚠️ ponto de atenção · 🐞 regressão a vigiar (já corrigida).

---

## 0. Pré-requisitos

- [ ] Migrações aplicadas no ambiente (`gise_presenca_termos`, e a 0066 que removeu a rubrica).
      Verificar: `SELECT count(*) FROM pragma_table_info('policiais') WHERE name='rubrica';` → `0`.
- [ ] **Assinador Desktop SERPRO** instalado e em execução; extensão do navegador ativa.
- [ ] **Token A3 ICP-Brasil** conectado, com PIN, e certificado **dentro da validade**.
- [ ] Usuário de teste é **policial** vinculado a uma escala GISE com horário **liberado**.
- [ ] Acesso por **desktop** (o fluxo A3 só aparece quando `restringirSmartphone` está ligado e não é mobile).

---

## 1. Confirmação de ENTRADA com Token A3

> A **rubrica** saiu do sistema em ago/2026 (migração 0066): não há mais cadastro
> no perfil, nem pré-requisito de rubrica para confirmar pelo computador, nem
> desenho na cerimônia em tela. O campo de assinatura do PDF fica **em branco**,
> como no documento impresso; quem identifica o signatário é o rodapé
> ("Assinado digitalmente por…") mais a página de manifesto.

1. Na tela de entrada, clicar **"Confirmar entrada com Token A3"**.
2. ✅ O Assinador SERPRO abre; selecionar o certificado do Token e informar o PIN.
3. ✅ Ao concluir: toast "Entrada confirmada com Token A3.".
4. 🐞 **O container muda de estado SEM precisar recarregar a página** (stepper marca Entrada ✓ e libera Produtividade). _(Regressão do `invalidateAll` sem repatch corrigida.)_
5. ⚠️ **Não há mais download automático** ao assinar: ao lado do aviso "Entrada Confirmada" aparece o botão **"Comprovante"**, que baixa o termo qualificado guardado no R2 (`GET /api/gise/[id]/presenca/termo?tipo=entrada`). _(Na presença confirmada em tela — mobile —, o mesmo botão gera o comprovante **avançado** sob demanda, sem menção a ICP-Brasil.)_

### 1.1 Conferência visual do termo (PDF)

Abrir o PDF baixado:

1. ✅ O **campo de assinatura** fica em branco sobre a linha; o **selo ICP** fica à **direita**. Nada é desenhado dentro do campo.
2. ✅ Página do **Manifesto**: a assinatura aparece na seção **"ASSINATURAS QUALIFICADAS (ICP-BRASIL)"**.
3. 🐞 O cartão qualificado **não** mostra quadro de **foto**, e **não** mostra **Localização** nem **Prova de Vida**.
4. ✅ O grid do cartão qualificado é **2×2** (Identificação · IP | Dispositivo · Carimbo de Tempo), sem coluna vazia.
5. 🐞 O texto vertical do selo aponta para o **domínio real** do ambiente (não `escalas.pages.dev` fixo).
6. ✅ O **QR/Identificador do topo** do manifesto resolve para **este** documento (não para um hash `PRES-…`).
7. 🐞 **Horário (fuso):** a hora no cabeçalho do termo ("Data/Hora da Confirmação") e a hora "Assinado em" no manifesto devem ser **iguais entre si** e corresponder ao **horário de Brasília** real da assinatura (não 3h a menos nem a mais).

---

## 2. Confirmação de SAÍDA com Token A3

1. Preencher e enviar o **Relatório de Produtividade** (quando aplicável à equipe).
2. Com horário de saída liberado, clicar **"Confirmar saída com Token A3"** → assinar no SERPRO.
3. ✅ Toast "Saída confirmada com Token A3."; 🐞 estado muda para **Saída Confirmada** **sem reload**.
4. Repetir a conferência visual do **termo de saída** (mesmos itens da seção 1.1).

---

## 3. Validação pública (`/validar`)

1. Ler o **QR do termo** (ou acessar `/validar/<código>`).
2. ✅ A página reconfere a assinatura (status válido) e exibe metadados do certificado.
3. ⚠️ **Privacidade**: CPF **mascarado** (`123.***.***-99`), nome mascarado; **sem** IP, user-agent ou coordenadas.

---

## 4. Relatório Extraordinário (supervisor) com presenças A3 — 🐞 classificação corrigida

> Exige uma seccional em que **todos** confirmaram a saída; pelo menos um participante via **Token A3**.
>
> **Automação:** a cadeia qualificada do relatório (preparar → CMS → finalizar → `/validar`) e as guardas do endpoint já rodam em CI com CA de teste (`e2e/relatorio-extra-gise.spec.ts`); a classificação QUALIFICADA×AVANÇADA no manifesto é coberta por `manifesto-signers.test.ts`. Este roteiro cobre o que exige hardware: o Assinador SERPRO real e a **conferência visual** do PDF abaixo.

- [ ] 🐞 **Entrada pela listagem (`/gise`), no desktop:** no card da escala, clicar **"Ass. Extra"** → diálogo de confirmação → **"Assinar N relatório(s)"** dispara o fluxo SERPRO em sequência para todos os extras prontos (antes o clique não fazia nada no desktop; no mobile abre a cerimônia em tela, como sempre).

1. Como **supervisor**, assinar o **Relatório Extraordinário** da seccional com **Token A3**.
2. Abrir o PDF → página(s) de Manifesto:
   - 🐞 As presenças confirmadas por **Token A3** aparecem na seção **QUALIFICADAS** (não mais como avançadas), **sem** quadro de foto.
   - ✅ As presenças confirmadas por **tela/mobile** permanecem na seção **AVANÇADAS**, com a prova de vida.
   - ✅ A assinatura do **supervisor** aparece como qualificada.
   - 🐞 O **Identificador/QR do topo** referencia a assinatura do **documento** (supervisor), não a 1ª presença.
   - 🐞 **Horários (fuso):** entrada, saída e supervisor mostram o **horário de Brasília** real e **coerente entre si** (sem a antiga diferença de 3h das confirmações).

---

## 5. Casos de borda

- [ ] **Horário não liberado** → botão indisponível / mensagem de horário; o servidor também recusa (`409`).
- [ ] **Sem vínculo** na GISE → servidor recusa (`403`) mesmo forçando a chamada.
- [ ] **Cancelar no SERPRO** (fechar sem assinar) → sem toast de sucesso, presença **não** gravada, estado inalterado.
- [ ] **Certificado expirado/!ICP** → erro tratado; presença não gravada.
- [ ] **Queda de rede** após preparar e antes de finalizar → repetir não gera presença duplicada inconsistente.
- [ ] **Re-confirmação** (assinar de novo) → o `/validar` aponta para o termo mais recente.

---

## 6. Registro do resultado

| Seção                          | Resultado (OK/NOK) | Observações |
| ------------------------------ | ------------------ | ----------- |
| 1. Entrada A3 + termo          |                    |             |
| 2. Saída A3 + termo            |                    |             |
| 3. Validação pública           |                    |             |
| 4. Relatório extra (manifesto) |                    |             |
| 5. Casos de borda              |                    |             |

> Anexar os PDFs de termo (entrada/saída) e do relatório extraordinário usados no teste.
