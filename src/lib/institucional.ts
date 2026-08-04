/**
 * O nome da corporação e dos órgãos, na grafia oficial — fonte única.
 *
 * Mora em `lib/` e não em `lib/server/` porque a página do DPO também o exibe,
 * e são strings puras: importar daqui no cliente não arrasta nada.
 *
 * Existe porque a divergência é o estado natural destas strings. Em ago/2026
 * havia **quatro** grafias da corporação espalhadas por cabeçalho de PDF, DOCX,
 * planilha, carimbo de assinatura, dois e-mails e uma página web — mais um
 * "DEPARTAMENTO DE POLÍCIA JUDICIÁRIA DO INTERIOR SUL", órgão que não existe,
 * sobrevivendo num documento impresso e assinado. Cada artefato nascia de um
 * copiar-colar do anterior, então a correção de um nunca chegava aos outros.
 *
 * São documentos oficiais e comunicação institucional: a grafia é a que consta
 * do organograma da corporação, não uma escolha de estilo. Mudar aqui muda em
 * todos os lugares de uma vez — que é o ponto — e exige regravar os goldens de
 * PDF (`UPDATE_PDF_GOLDENS=1`) e de e-mail (`UPDATE_EMAIL_GOLDENS=1`).
 */

/** Timbre de documento e carimbo — caixa alta. */
export const CORPORACAO = 'POLÍCIA CIVIL DO ESTADO DO CEARÁ';
export const DELEGACIA_GERAL = 'DELEGACIA GERAL DE POLÍCIA CIVIL';
export const DEPARTAMENTO = 'DEPARTAMENTO DE POLÍCIA DO INTERIOR SUL - DPI SUL';

/** A mesma corporação em texto corrido: e-mails e páginas. */
export const CORPORACAO_PROSA = 'Polícia Civil do Estado do Ceará';
