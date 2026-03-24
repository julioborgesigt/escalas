const cp = require('child_process');
try {
  const out = cp.execSync('wrangler d1 execute escalas_db --remote --command "SELECT nome FROM unidades" --json', {encoding: 'utf8'});
  const data = JSON.parse(out);
  const nomes = data[0].results.map(r => r.nome);
  console.log(nomes.join('\n'));
} catch (e) {
  console.error(e.message);
}
