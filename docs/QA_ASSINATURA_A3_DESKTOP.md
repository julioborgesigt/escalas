# Roteiro de QA Manual — Assinatura por Token A3 no Desktop (Presença GISE)

Cobre o fluxo de **confirmação de presença GISE por Token A3 no computador**
(rubrica reutilizável + termo qualificado) e os relatórios derivados. Os passos
exigem ambiente real: este roteiro **não roda em CI** (depende do Assinador
Desktop SERPRO, do navegador com a extensão e de um Token A3 físico).

> Legenda: ✅ esperado · ⚠️ ponto de atenção · 🐞 regressão a vigiar (já corrigida).

---

## 0. Pré-requisitos

- [ ] Migrações aplicadas no ambiente (`policiais.rubrica`, `gise_presenca_termos`).
      Verificar: `SELECT count(*) FROM pragma_table_info('policiais') WHERE name='rubrica';` → `1`.
- [ ] **Assinador Desktop SERPRO** instalado e em execução; extensão do navegador ativa.
- [ ] **Token A3 ICP-Brasil** conectado, com PIN, e certificado **dentro da validade**.
- [ ] Usuário de teste é **policial** vinculado a uma escala GISE com horário **liberado**.
- [ ] Acesso por **desktop** (o fluxo A3 só aparece quando `restringirSmartphone` está ligado e não é mobile).

---

## 1. Cadastro da rubrica reutilizável

### 1.1 Estado vazio (sem rubrica) — 🐞 regressão corrigida

1. Entrar em **Presença GISE** → selecionar a escala → tela de **Confirmação de Entrada**.
2. ✅ Deve aparecer o **aviso** "Você ainda não cadastrou sua rubrica…" e o botão **"Entendi — cadastrar rubrica"**.
3. 🐞 **NÃO** deve aparecer imagem quebrada nem o botão "Confirmar com Token A3" (bug do estado vazio tratado como imagem).
4. Clicar no botão → ✅ abre o modal **Cadastrar Rubrica**.

### 1.2 Desenhar e salvar — 🐞 erro 500 corrigido (era migração ausente)

1. Aba **Desenhar** → desenhar a rubrica → marcar o **consentimento LGPD** → **Salvar rubrica**.
2. ✅ Toast "Rubrica cadastrada com sucesso."; **sem erro 500**.
3. Recarregar a tela → ✅ a rubrica aparece no quadro branco "Assinar pelo computador".
4. ⚠️ Tentar salvar **sem** marcar o consentimento → ✅ bloqueado com aviso.

### 1.3 Enviar imagem

1. Reabrir **Gerenciar rubrica** → aba **Enviar imagem** → enviar foto de assinatura em papel.
2. Ajustar recorte e o slider de remoção de fundo → ✅ pré-visualização com fundo transparente.
3. Salvar → ✅ substitui a rubrica anterior.

---

## 2. Confirmação de ENTRADA com Token A3

1. Na tela de entrada, com rubrica cadastrada, clicar **"Confirmar entrada com Token A3"**.
2. ✅ O Assinador SERPRO abre; selecionar o certificado do Token e informar o PIN.
3. ✅ Ao concluir: toast "Entrada confirmada com Token A3.".
4. 🐞 **O container muda de estado SEM precisar recarregar a página** (stepper marca Entrada ✓ e libera Produtividade). _(Regressão do `invalidateAll` sem repatch corrigida.)_
5. ⚠️ O PDF do **termo** é devolvido/baixado (`termo_presenca_entrada.pdf`).

### 2.1 Conferência visual do termo (PDF) — 🐞 sobreposição corrigida

Abrir o PDF baixado:

1. 🐞 A **rubrica** assenta sobre a linha de assinatura à **esquerda**; o **selo ICP** fica à **direita**. **Não** há sobreposição entre rubrica e selo.
2. ✅ Página do **Manifesto**: a assinatura aparece na seção **"ASSINATURAS QUALIFICADAS (ICP-BRASIL)"**.
3. 🐞 O cartão qualificado **não** mostra quadros de **rubrica** nem **foto**, e **não** mostra **Localização** nem **Prova de Vida**.
4. ✅ O grid do cartão qualificado é **2×2** (Identificação · IP | Dispositivo · Carimbo de Tempo), sem coluna vazia.
5. 🐞 O texto vertical do selo aponta para o **domínio real** do ambiente (não `escalas.pages.dev` fixo).
6. ✅ O **QR/Identificador do topo** do manifesto resolve para **este** documento (não para um hash `PRES-…`).

---

## 3. Confirmação de SAÍDA com Token A3

1. Preencher e enviar o **Relatório de Produtividade** (quando aplicável à equipe).
2. Com horário de saída liberado, clicar **"Confirmar saída com Token A3"** → assinar no SERPRO.
3. ✅ Toast "Saída confirmada com Token A3."; 🐞 estado muda para **Saída Confirmada** **sem reload**.
4. Repetir a conferência visual do **termo de saída** (mesmos itens da seção 2.1).

---

## 4. Validação pública (`/validar`)

1. Ler o **QR do termo** (ou acessar `/validar/<código>`).
2. ✅ A página reconfere a assinatura (status válido) e exibe metadados do certificado.
3. ⚠️ **Privacidade**: CPF **mascarado** (`123.***.***-99`), nome mascarado; **sem** IP, user-agent ou coordenadas.

---

## 5. Relatório Extraordinário (supervisor) com presenças A3 — 🐞 classificação corrigida

> Exige uma seccional em que **todos** confirmaram a saída; pelo menos um participante via **Token A3**.

1. Como **supervisor**, assinar o **Relatório Extraordinário** da seccional com **Token A3**.
2. Abrir o PDF → página(s) de Manifesto:
   - 🐞 As presenças confirmadas por **Token A3** aparecem na seção **QUALIFICADAS** (não mais como avançadas), **sem** quadros de rubrica/foto.
   - ✅ As presenças confirmadas por **tela/mobile** permanecem na seção **AVANÇADAS**, com rubrica e prova de vida.
   - ✅ A assinatura do **supervisor** aparece como qualificada.
   - 🐞 O **Identificador/QR do topo** referencia a assinatura do **documento** (supervisor), não a 1ª presença.

---

## 6. Direito de exclusão da rubrica (LGPD Art. 18)

1. **Gerenciar rubrica** → **Excluir rubrica** → confirmar.
2. ✅ Toast "Rubrica removida."; a tela volta ao **estado vazio** (seção 1.1).
3. ⚠️ Conferir que documentos já assinados **permanecem válidos** (a exclusão não os afeta).
4. (Opcional, operador) Conferir evento `rubrica_excluida` no `audit_log`.

---

## 7. Casos de borda

- [ ] **Sem rubrica** + clicar confirmar → orienta a cadastrar primeiro (não chama o SERPRO).
- [ ] **Horário não liberado** → botão indisponível / mensagem de horário; o servidor também recusa (`409`).
- [ ] **Sem vínculo** na GISE → servidor recusa (`403`) mesmo forçando a chamada.
- [ ] **Cancelar no SERPRO** (fechar sem assinar) → sem toast de sucesso, presença **não** gravada, estado inalterado.
- [ ] **Certificado expirado/!ICP** → erro tratado; presença não gravada.
- [ ] **Queda de rede** após preparar e antes de finalizar → repetir não gera presença duplicada inconsistente.
- [ ] **Re-confirmação** (assinar de novo) → o `/validar` aponta para o termo mais recente.

---

## 8. Registro do resultado

| Seção                          | Resultado (OK/NOK) | Observações |
| ------------------------------ | ------------------ | ----------- |
| 1. Cadastro de rubrica         |                    |             |
| 2. Entrada A3 + termo          |                    |             |
| 3. Saída A3 + termo            |                    |             |
| 4. Validação pública           |                    |             |
| 5. Relatório extra (manifesto) |                    |             |
| 6. Exclusão de rubrica         |                    |             |
| 7. Casos de borda              |                    |             |

> Anexar os PDFs de termo (entrada/saída) e do relatório extraordinário usados no teste.
