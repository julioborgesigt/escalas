/**
 * CONFIGURAÇÃO: Altere os valores abaixo conforme necessário.
 */
const API_BASE_URL = 'https://escalas.pages.dev/api/webhook';
const SYNC_TOKEN = 'f363ccf36c299cbdb01d184904dd61b9'; 

const TAB_SERVIDORES = "DB_SERVIDORES";
const TAB_UNIDADES = "DB_UNIDADES";

/**
 * Função acionada automaticamente ao editar a planilha.
 */
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

/**
 * Sincroniza uma linha de SERVIDOR.
 */
function syncServerRow(row) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_SERVIDORES);
  if (!sheet) return;
  const data = sheet.getRange(row, 1, 1, 11).getValues()[0];

  // Ignora se não houver matrícula
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
    SpreadsheetApp.getUi().alert('Erro na Linha ' + row, response.errorDetails.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

/**
 * Sincroniza uma linha de UNIDADE.
 */
function syncUnitRow(row) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_UNIDADES);
  if (!sheet) return;
  const data = sheet.getRange(row, 1, 1, 3).getValues()[0];

  // Ignora se estiver totalmente vazio
  if (!data[1] || String(data[1]).trim() === '') return;

  const payload = {
    unidade: data[0],
    seccional: data[1],
    cidade: data[2]
  };

  sendToAPI('/sync-unidades', payload);
}

/**
 * Sincronização Total de Unidades (em Duas Fases para garantir hierarquia).
 */
function fullSyncUnits() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert('Sincronização Total de Unidades', 'Isso atualizará todas as unidades no banco. Deseja continuar?', ui.ButtonSet.YES_NO);
  if (response !== ui.Button.YES) return;

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_UNIDADES);
  if (!sheet) return;
  const rows = sheet.getLastRow();
  const data = sheet.getRange(2, 1, rows - 1, 3).getValues();

  // Limpa dados vazios
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

/**
 * Sincronização Total de Servidores com Relatório de Erros.
 */
function fullSyncServers() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert('Sincronização Total de Servidores', 'Isso atualizará todos os servidores no banco. Deseja continuar?', ui.ButtonSet.YES_NO);
  if (response !== ui.Button.YES) return;

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_SERVIDORES);
  if (!sheet) return;
  const rows = sheet.getLastRow();
  const data = sheet.getRange(2, 1, rows - 1, 11).getValues();

  // Filtra linhas sem matrícula
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
    Utilities.sleep(500); // 0.5s de pausa entre requisições para mitigar Rate Limit (Cloudflare Anti-DDoS)
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

/**
 * Limpa o Banco de Dados e aguarda confirmação.
 */
function resetDatabase() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert('AVISO CRÍTICO', 'Isso apagará TODOS os servidores e TODAS as unidades. Tem certeza?', ui.ButtonSet.YES_NO);
  if (response !== ui.Button.YES) return;

  const res = sendToAPI('/reset-policiais', {});
  if (res && res.success) {
    ui.alert('Sucesso', 'O banco de dados foi limpo completamente.', ui.ButtonSet.OK);
  } else {
    ui.alert('Erro', 'Falha ao limpar banco: ' + (res ? res.details || res.error : 'Erro desconhecido'), ui.ButtonSet.OK);
  }
}

/**
 * Helper para envio HTTP.
 */
function sendToAPI(endpoint, payload) {
  const url = API_BASE_URL + endpoint;
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + SYNC_TOKEN },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const content = response.getContentText();
    const code = response.getResponseCode();
    
    if (code !== 200) {
      Logger.log('Status ' + code + ' na URL ' + endpoint + ' | Resp: ' + content.substring(0, 500));
      // Tenta decodificar erro JSON do sveltekit, se falhar (ex: HTML do Cloudflare), captura abaixo.
    }
    
    return JSON.parse(content);
  } catch (e) {
    return { success: false, details: 'Falha ao ler servidor: ' + e.toString() };
  }
}

/**
 * Adiciona menu personalizado.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🚀 Sincronização D1')
    .addItem('1. Sincronizar UNIDADES (Total)', 'fullSyncUnits')
    .addItem('2. Sincronizar SERVIDORES (Total)', 'fullSyncServers')
    .addSeparator()
    .addItem('⚠️ ZERAR Banco de Dados (Global)', 'resetDatabase')
    .addToUi();
}
