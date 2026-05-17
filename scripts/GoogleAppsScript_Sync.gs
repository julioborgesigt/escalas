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
 *
 * Base_Equipe (recebimento do portal ao finalizar GISE):
 *   1. Menu → "⚙️ Secret Base_Equipe (portal)" e cole o mesmo valor de GISE_BASE_EQUIPE_SECRET do Cloudflare.
 *   2. Implantar como aplicativo da Web (executar como: Eu; acesso: Qualquer pessoa) e copiar a URL para GISE_BASE_EQUIPE_WEBHOOK_URL no Pages.
 *   3. A aba "Base_Equipe" deve existir (colunas A–J conforme seu modelo).
 *
 * IMPORTANTE: em Web App, getActiveSpreadsheet() costuma ser null. O script tenta
 * ScriptApp.getScriptContainerInfo().spreadsheetId quando a API existir (runtime V8);
 * senão use o menu "⚙️ ID planilha Base_Equipe (portal)" (BASE_EQUIPE_SPREADSHEET_ID).
 * Em Projeto → Configurações do editor, use o motor **V8** (recomendado).
 */

const API_BASE_URL = 'https://escalas.pages.dev/api/webhook';

const TAB_SERVIDORES = 'DB_SERVIDORES';
const TAB_UNIDADES = 'DB_UNIDADES';
const TAB_BASE_EQUIPE = 'Base_Equipe';

/**
 * Planilha DB_UNIDADES (linhas de dados a partir da linha 2):
 *   A — Unidade operacional (delegacia / UAA etc.); vazio para níveis organizacionais.
 *   B — Seccional; vazio para departamento, subdepartamento ou seccional “sem coluna B”.
 *   C — Subdepartamento (filho do departamento em D); vazio se a seccional for filha direta do D.
 *   D — Departamento (pai do subdepartamento em C, ou pai direto da seccional quando C vazio).
 *   E — Cidade.
 *
 * Inferência enviada ao backend (payload unidade / seccional / cidade / nivel):
 *   • A,B,C vazios e D preenchido → DEPARTAMENTO (nome em D).
 *   • A,B vazios, C e D preenchidos → SUB_DEPARTAMENTO (C subordinado a D).
 *   • A vazio, B preenchido, C preenchido → SECCIONAL com pai organizacional C (subdepartamento).
 *   • A vazio, B preenchido, C vazio, D preenchido → SECCIONAL com pai organizacional D (departamento).
 *   • A vazio, B preenchido, C e D vazios → SECCIONAL raiz (legado; nivel vazio).
 *   • A e B preenchidos → DELEGACIA (A sob seccional B; C/D ignorados pelo upsert da delegacia).
 */

const PROP_SYNC_TOKEN = 'SYNC_TOKEN';
const PROP_RESET_TOKEN = 'RESET_TOKEN';
const PROP_BASE_EQUIPE_SECRET = 'BASE_EQUIPE_SECRET';
const PROP_BASE_EQUIPE_SPREADSHEET_ID = 'BASE_EQUIPE_SPREADSHEET_ID';

/**
 * ID da planilha quando o script é container-bound (API pode não existir em runtime antigo).
 * @return {string} id ou string vazia
 */
function getSpreadsheetIdFromContainer_() {
  try {
    if (typeof ScriptApp.getScriptContainerInfo !== 'function') {
      return '';
    }
    var info = ScriptApp.getScriptContainerInfo();
    if (info && info.spreadsheetId) {
      return String(info.spreadsheetId).trim();
    }
  } catch (ignore) {
    // Motor antigo ou projeto sem container
  }
  return '';
}

/**
 * Planilha onde grava a Base_Equipe (Web App não tem "planilha ativa").
 * 1) ScriptApp.getScriptContainerInfo().spreadsheetId (se disponível; motor V8).
 * 2) Script Property BASE_EQUIPE_SPREADSHEET_ID (menu no script).
 * 3) Último recurso: getActiveSpreadsheet() (ex.: teste pelo editor).
 */
function getSpreadsheetForPortal_() {
  var fromContainer = getSpreadsheetIdFromContainer_();
  if (fromContainer) {
    return SpreadsheetApp.openById(fromContainer);
  }
  var sid = PropertiesService.getScriptProperties().getProperty(PROP_BASE_EQUIPE_SPREADSHEET_ID);
  if (sid && String(sid).trim()) {
    return SpreadsheetApp.openById(String(sid).trim());
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  throw new Error(
    'planilha_nao_resolvida: use o menu "ID planilha Base_Equipe (portal)" com o ID da URL docs.google.com/.../d/ID/... ou vincule o script à planilha (motor V8).'
  );
}

/**
 * POST do Cloudflare após finalizar GISE: body JSON { secret, gise_id, rows }.
 * Remove todas as linhas cuja coluna A = gise_id e reinsere `rows` (cada linha = 10 células A–J).
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const expected = PropertiesService.getScriptProperties().getProperty(PROP_BASE_EQUIPE_SECRET);
    if (!expected || body.secret !== expected) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'unauthorized' })).setMimeType(
        ContentService.MimeType.JSON
      );
    }
    var giseId = body.gise_id;
    if (giseId === undefined || giseId === null || String(giseId).trim() === '') {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'gise_id_required' })).setMimeType(
        ContentService.MimeType.JSON
      );
    }
    giseId = Number(giseId);
    var rows = body.rows;
    if (!Array.isArray(rows)) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'rows_must_be_array' })).setMimeType(
        ContentService.MimeType.JSON
      );
    }
    for (var i = 0; i < rows.length; i++) {
      if (!Array.isArray(rows[i]) || rows[i].length !== 10) {
        return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'invalid_row' })).setMimeType(
          ContentService.MimeType.JSON
        );
      }
    }
    var ss = getSpreadsheetForPortal_();
    var sh = ss.getSheetByName(TAB_BASE_EQUIPE);
    if (!sh) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'sheet_not_found' })).setMimeType(
        ContentService.MimeType.JSON
      );
    }
    removerLinhasBaseEquipePorGiseId_(sh, giseId);
    if (rows.length > 0) {
      var start = sh.getLastRow() + 1;
      // getRange: 3º/4º args são numRows e numCols, não linha/coluna de fim.
      sh.getRange(start, 1, rows.length, 10).setValues(rows);
    }
    return ContentService.createTextOutput(JSON.stringify({ ok: true, inserted: rows.length })).setMimeType(
      ContentService.MimeType.JSON
    );
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) })).setMimeType(
      ContentService.MimeType.JSON
    );
  } finally {
    lock.releaseLock();
  }
}

/** Apaga linhas de dados (≥2) cuja coluna A numérica coincide com giseId. */
function removerLinhasBaseEquipePorGiseId_(sh, giseId) {
  var last = sh.getLastRow();
  if (last < 2) return;
  for (var r = last; r >= 2; r--) {
    var v = sh.getRange(r, 1).getValue();
    if (Number(v) === giseId) {
      sh.deleteRow(r);
    }
  }
}

/** Menu: grava BASE_EQUIPE_SECRET (mesmo valor do Cloudflare GISE_BASE_EQUIPE_SECRET). */
function configurarSecretBaseEquipePortal() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt(
    'Secret Base_Equipe (portal)',
    'Cole o segredo GISE_BASE_EQUIPE_SECRET configurado no Cloudflare Pages:',
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const v = res.getResponseText().trim();
  if (!v) {
    ui.alert('Valor vazio', 'Nada foi alterado.', ui.ButtonSet.OK);
    return;
  }
  PropertiesService.getScriptProperties().setProperty(PROP_BASE_EQUIPE_SECRET, v);
  ui.alert('OK', 'BASE_EQUIPE_SECRET salvo em ScriptProperties.', ui.ButtonSet.OK);
}

/** Menu: ID do arquivo Google Sheets (só necessário se o Apps Script NÃO for vinculado à planilha). */
function configurarIdPlanilhaBaseEquipePortal() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt(
    'ID planilha Base_Equipe (portal)',
    'Cole o ID da planilha (trecho da URL .../spreadsheets/d/ESTE_ID/edit). ' +
      'Deixe vazio para remover e depender só do script vinculado ao arquivo:',
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const v = res.getResponseText().trim();
  const props = PropertiesService.getScriptProperties();
  if (!v) {
    props.deleteProperty(PROP_BASE_EQUIPE_SPREADSHEET_ID);
    ui.alert('OK', 'BASE_EQUIPE_SPREADSHEET_ID removido.', ui.ButtonSet.OK);
    return;
  }
  props.setProperty(PROP_BASE_EQUIPE_SPREADSHEET_ID, v);
  ui.alert('OK', 'BASE_EQUIPE_SPREADSHEET_ID salvo.', ui.ButtonSet.OK);
}

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
    papel: data[10],
    // Regra de negócio: unidade de exercício do papel = lotação do servidor.
    papel_unidade: data[6]
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

/** Normaliza célula para string trimada (planilha com 4 ou 5 colunas). */
function trimUnidadeCell_(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/**
 * Converte uma linha DB_UNIDADES (A–E) no payload esperado por /sync-unidades.
 * Retorna null se a linha não for reconhecível.
 */
function parseUnidadesRow_(row) {
  const a = trimUnidadeCell_(row[0]);
  const b = trimUnidadeCell_(row[1]);
  const c = trimUnidadeCell_(row[2]);
  const d = trimUnidadeCell_(row[3]);
  const e = trimUnidadeCell_(row[4]);

  if (a && b) {
    return { unidade: a, seccional: b, cidade: e, nivel: 'DELEGACIA' };
  }
  if (!a && !b && !c && d) {
    return { unidade: '', seccional: d, cidade: e, nivel: 'DEPARTAMENTO' };
  }
  if (!a && !b && c && d) {
    return { unidade: c, seccional: d, cidade: e, nivel: 'SUB_DEPARTAMENTO' };
  }
  if (!a && b && c) {
    return { unidade: b, seccional: c, cidade: e, nivel: 'SECCIONAL' };
  }
  if (!a && b && !c && d) {
    return { unidade: b, seccional: d, cidade: e, nivel: 'SECCIONAL' };
  }
  if (!a && b && !c && !d) {
    return { unidade: '', seccional: b, cidade: e, nivel: '' };
  }
  return null;
}

function syncUnitRow(row) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_UNIDADES);
  if (!sheet) return;
  const data = sheet.getRange(row, 1, 1, 5).getValues()[0];
  const payload = parseUnidadesRow_(data);
  if (!payload) return;
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
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    ui.alert('Planilha vazia', 'Não há linhas de dados em DB_UNIDADES.', ui.ButtonSet.OK);
    return;
  }
  const data = sheet.getRange(2, 1, lastRow, 5).getValues();

  const parsedRows = [];
  for (let i = 0; i < data.length; i++) {
    const p = parseUnidadesRow_(data[i]);
    if (p) parsedRows.push(p);
  }

  const departamentos = parsedRows.filter((p) => p.nivel === 'DEPARTAMENTO');
  const subDepartamentos = parsedRows.filter((p) => p.nivel === 'SUB_DEPARTAMENTO');
  const seccionaisRaiz = parsedRows.filter((p) => p.nivel === '' && !p.unidade && p.seccional);
  const seccionaisComPai = parsedRows.filter((p) => p.nivel === 'SECCIONAL');
  const delegacias = parsedRows.filter((p) => p.nivel === 'DELEGACIA');

  function sendChunked(list) {
    const chunkSize = 50;
    for (let i = 0; i < list.length; i += chunkSize) {
      sendToAPI('/sync-unidades', list.slice(i, i + chunkSize));
    }
  }

  if (departamentos.length > 0) sendChunked(departamentos);
  if (subDepartamentos.length > 0) sendChunked(subDepartamentos);
  if (seccionaisRaiz.length > 0) sendChunked(seccionaisRaiz);
  if (seccionaisComPai.length > 0) sendChunked(seccionaisComPai);
  if (delegacias.length > 0) sendChunked(delegacias);

  ui.alert('Sucesso', 'Departamentos, seccionais e delegacias sincronizados (ordem respeitada).', ui.ButtonSet.OK);
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
    papel: item[10],
    // Regra de negócio: unidade de exercício do papel = lotação do servidor.
    papel_unidade: item[6]
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

  // Replay protection (P1.3 da auditoria): X-Webhook-Timestamp em segundos
  // Unix + X-Webhook-Nonce único por requisição. O servidor rejeita reenvio
  // do mesmo nonce (UNIQUE em webhook_nonces) e qualquer timestamp fora da
  // janela de 5min. Sem essas headers o servidor aceita por padrão (modo
  // rollout), mas loga warning; ative `WEBHOOK_REPLAY_ENFORCE=1` no
  // Cloudflare para tornar obrigatório.
  const replayHeaders = {
    'X-Webhook-Timestamp': String(Math.floor(Date.now() / 1000)),
    'X-Webhook-Nonce': Utilities.getUuid() + '-' + Date.now()
  };

  const headers = Object.assign(
    { Authorization: 'Bearer ' + syncToken },
    replayHeaders,
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
    .addItem('⚙️ Secret Base_Equipe (portal)', 'configurarSecretBaseEquipePortal')
    .addItem('⚙️ ID planilha Base_Equipe (portal)', 'configurarIdPlanilhaBaseEquipePortal')
    .addSeparator()
    .addItem('⚠️ ZERAR Banco de Dados (Global)', 'resetDatabase')
    .addToUi();
}
