const fs = require('fs');
const path = require('path');
const base = path.join(__dirname, '..');

// 5. policiais/+server.ts - update POST to handle bulk dates
let api = fs.readFileSync(path.join(base, 'src/routes/api/escalas/[id]/policiais/+server.ts'), 'utf8');

// Update import
api = api.replace(
  "import { getDB, buscarEscala, listarPoliciaisEscala, adicionarPolicialEscala, removerPolicialEscala, atualizarEscalaPolicial, adicionarTodosPoliciais, type Database } from '$lib/db';",
  "import { getDB, buscarEscala, listarPoliciaisEscala, adicionarPolicialEscala, adicionarMultiplasDatasPlantao, removerPolicialEscala, atualizarEscalaPolicial, adicionarTodosPoliciais, type Database } from '$lib/db';"
);

// Build new POST content
const newPost = `export const POST: RequestHandler = async ({ platform, params, request, locals }) => {
\tconst db = getDB(platform);
\tconst escalaId = Number(params.id);

\tconst bloqueio = await verificarAcessoEscala(db, escalaId, locals);
\tif (bloqueio) return bloqueio;

\tconst data = await request.json();

\t// Bulk insert for plantão (array of dates)
\tif (data.datas && Array.isArray(data.datas)) {
\t\tif (!data.policial_id) {
\t\t\treturn json({ error: 'policial_id é obrigatório' }, { status: 400 });
\t\t}
\t\tawait adicionarMultiplasDatasPlantao(
\t\t\tdb,
\t\t\tescalaId,
\t\t\tNumber(data.policial_id),
\t\t\tdata.datas,
\t\t\tdata.hora_entrada || '',
\t\t\tdata.hora_saida || '',
\t\t\tdata.equipe || '',
\t\t\tdata.observacoes || ''
\t\t);
\t\treturn json({ success: true }, { status: 201 });
\t}

\t// Single date (existing behavior)
\tconst parsed = escalaPolicialSchema.safeParse(data);
\tif (!parsed.success) {
\t\treturn json({ error: parsed.error.issues[0].message }, { status: 400 });
\t}

\tconst validated = parsed.data;
\tif (!validated.data_plantao) {
\t\treturn json({ error: 'data_plantao é obrigatória' }, { status: 400 });
\t}
\tawait adicionarPolicialEscala(
\t\tdb,
\t\tescalaId,
\t\tvalidated.policial_id,
\t\tvalidated.data_plantao,
\t\tvalidated.data_saida || validated.data_plantao,
\t\tvalidated.hora_entrada,
\t\tvalidated.hora_saida,
\t\t'',
\t\tvalidated.equipe || ''
\t);
\treturn json({ success: true }, { status: 201 });
};`;

// Find and replace the old POST handler
// Use a regex to find from POST declaration to the closing };
const postRegex = /export const POST: RequestHandler = async \(\{ platform, params, request, locals \}\) => \{[\s\S]*?\n\};\n\nexport const PATCH/;
const match = api.match(postRegex);
if (match) {
  console.log('Found POST handler');
  api = api.replace(match[0], newPost + '\r\n\r\nexport const PATCH');
} else {
  console.log('POST handler not found via regex, trying line-based approach');
  // Find by lines
  const lines = api.split('\r\n');
  const postStart = lines.findIndex(l => l === 'export const POST: RequestHandler = async ({ platform, params, request, locals }) => {');
  const patchStart = lines.findIndex(l => l === 'export const PATCH: RequestHandler = async ({ platform, params, request, locals }) => {');
  console.log('POST at line:', postStart, 'PATCH at line:', patchStart);
  if (postStart >= 0 && patchStart >= 0) {
    const before = lines.slice(0, postStart);
    const after = lines.slice(patchStart);
    api = [...before, ...newPost.split('\n'), '', ...after].join('\r\n');
    console.log('Replaced via line approach');
  }
}

console.log('adicionarMultiplasDatasPlantao check:', api.includes('adicionarMultiplasDatasPlantao'));
fs.writeFileSync(path.join(base, 'src/routes/api/escalas/[id]/policiais/+server.ts'), api);
console.log('policiais +server.ts done');
