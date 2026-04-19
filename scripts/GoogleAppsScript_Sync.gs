/**
 * Sincronização da planilha Google Sheets com o backend Cloudflare (D1).
 *
 * SETUP INICIAL (execute UMA VEZ por planilha):
 *   1. Abra o menu "🚀 Sincronização D1" → "⚙️ Configurar tokens".
 *   2. Cole o SYNC_TOKEN (segredo do Cloudflare Pages).
 *   3. Cole o RESET_TOKEN apenas se for usar o reset (segredo separado, distinto).
 *
 * Os segredos ficam guardados no PropertiesService da planilha — NÃO no código.
 * Assim, quem tem acesso de leitura à planilha não vê os tokens.
 */

const API_BASE_URL = 'https://escalas.pages.dev/api/webhook';

const TAB_SERVIDORES = 'DB_SERVIDORES';
const TAB_UNIDADES = 'DB_UNIDADES';

const PROP_SYNC_TOKEN = 'SYNC_TOKEN';
const PROP_RESET_TOKEN = 'RESET_TOKEN';

// ─────────────────────────────────────────────────────────────────────────────
// Property helpers
// ─────────────────────────────────────────────────────────────────────────────

function getSyncToken_() {
  const t = PropertiesService.getScriptProperties().getProperty(PROP_SYNC_TOKEN);
  if (!t) {
    throw new Error('SYNC_TOKEN não configurado. Use "⚙️ Configurar tokens" no menu.');
  }
  return t;
}

function getResetToken_() {
  const t = PropertiesService.getScriptProperties().getProperty(PROP_RESET_TOKEN);
  if (!t) {
    throw new Error('RESET_TOKEN não configurado. Use "⚙️ Configurar tokens" no menu.');
  }
  return t;
}

/** Menu: configura ambos os tokens via prompt. */
function configurarTokens() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();

  const syncRes = ui.prompt(
    'SYNC_TOKEN',
    'Cole o SYNC_TOKEN do Cloudflare Pages (deixe vazio para manter o atual):',
    ui.ButtonSet.OK_CANCEL
  );
  if (syncRes.getSelectedButton() === ui.Button.OK) {
    const v = syncRes.getResponseText().trim();
    if (v) props.setProperty(PROP_SYNC_TOKEN, v);
  }

  const resetRes = ui.prompt(
    'RESET_TOKEN',
    'Cole o RESET_TOKEN (segredo separado, exigido para apagar o banco). Deixe vazio para manter o atual:',
    ui.ButtonSet.OK_CANCEL
  );
  if (resetRes.getSelectedButton() === ui.Button.OK) {
    const v = resetRes.getResponseText().trim();
    if (v) props.setProperty(PROP_RESET_TOKEN, v);
  }

  ui.alert('Tokens', 'Tokens armazenados em ScriptProperties.', ui.ButtonSet.OK);
}

// ─────────────────────────────────────────────────────────────────────────────
// Trigger automático ao editar
// ─────────────────────────────────────────────────────────────────────────────

function onEdit(e) {
  const sheet = e.source.getActiveSheet();
  const sheetName = sheet.getName();
  const range = e.range;
  const row = range.getRow();

  if (row < 2) return; // Pula cabeçalho

  if (sheetName === TAB_SERVIDORES) {
    syncServerRow(row);
  } else if (sheetName === TAB_UNIDADES) {
    syncUnitRow(row);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sincronização linha-a-linha
// ─────────────────────────────────────────────────────────────────────────────

function syncServerRow(row) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_SERVIDORES);
  if (!sheet) return;
  const data = sheet.getRange(row, 1, 1, 11).getValues()[0];

  if (!data[0] || String(data[0]).trim() === '') return;

  const payload = {
    matricula: data[0],
    nome: data[1],
    cargo: data[2],
    telefone: data[3],
    cpf: data[4],
    classe: data[5],
    lotacao: data[6],
    status: data[7],
    email: data[8],
    regime: data[9],
    papel: data[10]
  };

  const response = sendToAPI('/sync-policiais', payload);
  if (response && response.errorDetails) {
    SpreadsheetApp.getUi().alert(
      'Erro na Linha ' + row,
      response.errorDetails.join('\n'),
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  }
}

function syncUnitRow(row) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_UNIDADES);
  if (!sheet) return;
  const data = sheet.getRange(row, 1, 1, 3).getValues()[0];

  if (!data[1] || String(data[1]).trim() === '') return;

  const payload = {
    unidade: data[0],
    seccional: data[1],
    cidade: data[2]
  };

  sendToAPI('/sync-unidades', payload);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sincronização total
// ─────────────────────────────────────────────────────────────────────────────

function fullSyncUnits() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Sincronização Total de Unidades',
    'Isso atualizará todas as unidades no banco. Deseja continuar?',
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_UNIDADES);
  if (!sheet) return;
  const rows = sheet.getLastRow();
  const data = sheet.getRange(2, 1, rows - 1, 3).getValues();

  const cleanData = data.filter(r => r[1] && String(r[1]).trim() !== '');

  // Fase 1: Apenas Seccionais
  const seccionais = cleanData.filter(r => !r[0] || String(r[0]).trim() === '');
  if (seccionais.length > 0) {
    const payloads = seccionais.map(item => ({ unidade: '', seccional: item[1], cidade: item[2] }));
    sendToAPI('/sync-unidades', payloads);
  }

  // Fase 2: Apenas Delegacias
  const delegacias = cleanData.filter(r => r[0] && String(r[0]).trim() !== '');
  if (delegacias.length > 0) {
    const payloads = delegacias.map(item => ({ unidade: item[0], seccional: item[1], cidade: item[2] }));
    const chunkSize = 50;
    for (let i = 0; i < payloads.length; i += chunkSize) {
      sendToAPI('/sync-unidades', payloads.slice(i, i + chunkSize));
    }
  }

  ui.alert('Sucesso', 'Unidades e Seccionais sincronizadas.', ui.ButtonSet.OK);
}

function fullSyncServers() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Sincronização Total de Servidores',
    'Isso atualizará todos os servidores no banco. Deseja continuar?',
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_SERVIDORES);
  if (!sheet) return;
  const rows = sheet.getLastRow();
  const data = sheet.getRange(2, 1, rows - 1, 11).getValues();

  const cleanData = data.filter(r => r[0] && String(r[0]).trim() !== '');

  const payloads = cleanData.map(item => ({
    matricula: item[0],
    nome: item[1],
    cargo: item[2],
    telefone: item[3],
    cpf: item[4],
    classe: item[5],
    lotacao: item[6],
    status: item[7],
    email: item[8],
    regime: item[9],
    papel: item[10]
  }));

  const chunkSize = 25; // Reduzido de 50 para 25 para evitar timeout no backend
  let totalImported = 0;
  let allErrors = [];

  for (let i = 0; i < payloads.length; i += chunkSize) {
    const res = sendToAPI('/sync-policiais', payloads.slice(i, i + chunkSize));
    if (res) {
      if (res.imported) totalImported += res.imported;
      if (res.errorDetails) allErrors = allErrors.concat(res.errorDetails);
      if (res.success === false && res.details) allErrors.push(`Lote ${i}: ${res.details}`);
      if (res.error) allErrors.push(`Lote ${i}: ${res.error}`);
    } else {
      allErrors.push(`Lote ${i}: Falha silenciosa de comunicação com o servidor.`);
    }
    Utilities.sleep(500); // Mitiga rate limit do Cloudflare
  }

  let report = 'Resumo da Sincronização:\n';
  report += '- Linhas válidas na planilha: ' + payloads.length + '\n';
  report += '- Importados com sucesso: ' + totalImported + '\n';
  report += '- Falhas identificadas: ' + allErrors.length + '\n';

  if (allErrors.length > 0) {
    report += '\nDetalhes dos Erros (Visão Parcial):\n';
    report += allErrors.slice(0, 15).join('\n');
    ui.alert('Concluído com Alertas', report, ui.ButtonSet.OK);
  } else {
    ui.alert('Concluído', report, ui.ButtonSet.OK);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reset destrutivo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apaga TODAS as tabelas operacionais. O endpoint backend exige:
 *   - Authorization: Bearer <SYNC_TOKEN>
 *   - X-Reset-Token: <RESET_TOKEN>           (segredo separado)
 *   - X-Confirm-Reset: <YYYY-MM-DD em UTC>   (anti-replay)
 *
 * Aqui também pedimos ao operador que digite "APAGAR TUDO" para evitar clique
 * acidental no menu.
 */
function resetDatabase() {
  const ui = SpreadsheetApp.getUi();

  // 1. Confirmação simples
  const r1 = ui.alert(
    '⚠️ AVISO CRÍTICO',
    'Isso apagará TODOS os servidores, unidades, escalas, GISE e documentos. Tem certeza?',
    ui.ButtonSet.YES_NO
  );
  if (r1 !== ui.Button.YES) return;

  // 2. Confirmação digitada
  const r2 = ui.prompt(
    'Confirmação final',
    'Digite exatamente "APAGAR TUDO" para prosseguir:',
    ui.ButtonSet.OK_CANCEL
  );
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  if (r2.getResponseText().trim() !== 'APAGAR TUDO') {
    ui.alert('Cancelado', 'Texto de confirmação não corresponde. Reset abortado.', ui.ButtonSet.OK);
    return;
  }

  // 3. Cabeçalhos especiais exigidos pelo endpoint hardened
  let resetToken;
  try {
    resetToken = getResetToken_();
  } catch (e) {
    ui.alert('Erro', e.message, ui.ButtonSet.OK);
    return;
  }

  const extraHeaders = {
    'X-Reset-Token': resetToken,
    'X-Confirm-Reset': todayIsoUtc_()
  };

  const res = sendToAPI('/reset-policiais', {}, extraHeaders);

  if (res && res.success) {
    let msg = 'O banco de dados foi limpo completamente.';
    if (res.snapshot) {
      msg += '\n\nSnapshot pré-deleção:\n';
      Object.keys(res.snapshot).forEach(k => {
        msg += `  ${k}: ${res.snapshot[k]}\n`;
      });
    }
    ui.alert('Sucesso', msg, ui.ButtonSet.OK);
  } else {
    ui.alert(
      'Erro',
      'Falha ao limpar banco: ' + (res ? res.error || res.details || JSON.stringify(res) : 'sem resposta'),
      ui.ButtonSet.OK
    );
  }
}

/** Retorna a data de hoje em UTC no formato YYYY-MM-DD (esperado por X-Confirm-Reset). */
function todayIsoUtc_() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helper
// ─────────────────────────────────────────────────────────────────────────────

function sendToAPI(endpoint, payload, extraHeaders) {
  let syncToken;
  try {
    syncToken = getSyncToken_();
  } catch (e) {
    SpreadsheetApp.getUi().alert('Token ausente', e.message, SpreadsheetApp.getUi().ButtonSet.OK);
    return { success: false, error: e.message };
  }

  const headers = Object.assign(
    { Authorization: 'Bearer ' + syncToken },
    extraHeaders || {}
  );

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(API_BASE_URL + endpoint, options);
    const content = response.getContentText();
    const code = response.getResponseCode();

    if (code !== 200) {
      Logger.log('Status ' + code + ' na URL ' + endpoint + ' | Resp: ' + content.substring(0, 500));
    }

    return JSON.parse(content);
  } catch (e) {
    return { success: false, details: 'Falha ao ler servidor: ' + e.toString() };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Menu
// ─────────────────────────────────────────────────────────────────────────────

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🚀 Sincronização D1')
    .addItem('1. Sincronizar UNIDADES (Total)', 'fullSyncUnits')
    .addItem('2. Sincronizar SERVIDORES (Total)', 'fullSyncServers')
    .addSeparator()
    .addItem('⚙️ Configurar tokens', 'configurarTokens')
    .addSeparator()
    .addItem('⚠️ ZERAR Banco de Dados (Global)', 'resetDatabase')
    .addToUi();
}
