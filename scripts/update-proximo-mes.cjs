const fs = require('fs');
const path = require('path');
const base = path.join(__dirname, '..');

let api = fs.readFileSync(path.join(base, 'src/routes/api/escalas/[id]/proximo-mes/+server.ts'), 'utf8');

// Find the plantão section and update it to copy equipe
// The key change: when iterating policiaisAtuais for plantão, collect equipe
// and pass it to adicionarPolicialEscala

const oldPlantaoSection = `\t} else {
\t\t// Para plantão: agrupa dias por servidor e calcula rotação
\t\tconst diasPorPolicial = new Map<number, { nome: string; dias: string[] }>();

\t\tfor (const p of policiaisAtuais) {
\t\t\tif (!diasPorPolicial.has(p.policial_id)) {
\t\t\t\tdiasPorPolicial.set(p.policial_id, { nome: p.nome, dias: [] });
\t\t\t}
\t\t\tdiasPorPolicial.get(p.policial_id)!.dias.push(p.data_plantao);
\t\t}

\t\tfor (const [policialId, { nome, dias }] of diasPorPolicial) {
\t\t\tconst { dias: novosDias, rotacao } = calcularProximoMesDias(dias, novoAno, novoMes);

\t\t\tif (novosDias.length === 0) {
\t\t\t\tnaoProcessados.push({
\t\t\t\t\tnome,
\t\t\t\t\tmotivo:
\t\t\t\t\t\trotacao === null
\t\t\t\t\t\t\t? 'Rotação não identificada (padrão de dias irregular ou poucos dados)'
\t\t\t\t\t\t\t: 'Nenhum dia calculado para o próximo mês'
\t\t\t\t});
\t\t\t\tcontinue;
\t\t\t}

\t\t\tfor (const dia of novosDias) {
\t\t\t\tconst dataSaida = calcularDataSaida(dia, horaEntrada, horaSaida);
\t\t\t\tawait adicionarPolicialEscala(
\t\t\t\t\tdb,
\t\t\t\t\tnovaEscalaId,
\t\t\t\t\tpolicialId,
\t\t\t\t\tdia,
\t\t\t\t\tdataSaida,
\t\t\t\t\thoraEntrada,
\t\t\t\t\thoraSaida
\t\t\t\t);
\t\t\t}
\t\t\tadicionados++;
\t\t}
\t}`;

const newPlantaoSection = `\t} else {
\t\t// Para plantão: agrupa dias por servidor e calcula rotação (preserva equipe)
\t\tconst diasPorPolicial = new Map<number, { nome: string; dias: string[]; equipe: string }>();

\t\tfor (const p of policiaisAtuais) {
\t\t\tif (!diasPorPolicial.has(p.policial_id)) {
\t\t\t\tdiasPorPolicial.set(p.policial_id, { nome: p.nome, dias: [], equipe: p.equipe || '' });
\t\t\t}
\t\t\tdiasPorPolicial.get(p.policial_id)!.dias.push(p.data_plantao);
\t\t}

\t\tfor (const [policialId, { nome, dias, equipe }] of diasPorPolicial) {
\t\t\tconst { dias: novosDias, rotacao } = calcularProximoMesDias(dias, novoAno, novoMes);

\t\t\tif (novosDias.length === 0) {
\t\t\t\tnaoProcessados.push({
\t\t\t\t\tnome,
\t\t\t\t\tmotivo:
\t\t\t\t\t\trotacao === null
\t\t\t\t\t\t\t? 'Rotação não identificada (padrão de dias irregular ou poucos dados)'
\t\t\t\t\t\t\t: 'Nenhum dia calculado para o próximo mês'
\t\t\t\t});
\t\t\t\tcontinue;
\t\t\t}

\t\t\tfor (const dia of novosDias) {
\t\t\t\tconst dataSaida = calcularDataSaida(dia, horaEntrada, horaSaida);
\t\t\t\tawait adicionarPolicialEscala(
\t\t\t\t\tdb,
\t\t\t\t\tnovaEscalaId,
\t\t\t\t\tpolicialId,
\t\t\t\t\tdia,
\t\t\t\t\tdataSaida,
\t\t\t\t\thoraEntrada,
\t\t\t\t\thoraSaida,
\t\t\t\t\t'',
\t\t\t\t\tequipe
\t\t\t\t);
\t\t\t}
\t\t\tadicionados++;
\t\t}
\t}`;

// Replace with CRLF
const oldCRLF = oldPlantaoSection.split('\n').join('\r\n');
const newCRLF = newPlantaoSection.split('\n').join('\r\n');
const found = api.includes(oldCRLF);
console.log('plantão section found:', found);

if (found) {
  api = api.replace(oldCRLF, newCRLF);
} else {
  console.log('Trying without CRLF...');
  const found2 = api.includes(oldPlantaoSection);
  console.log('without CRLF:', found2);
  if (found2) api = api.replace(oldPlantaoSection, newPlantaoSection);
}

console.log('equipe in result:', api.includes('equipe: p.equipe'));
fs.writeFileSync(path.join(base, 'src/routes/api/escalas/[id]/proximo-mes/+server.ts'), api);
console.log('proximo-mes done');
