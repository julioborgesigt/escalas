import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { visualizer } from 'rollup-plugin-visualizer';
import { readFileSync } from 'node:fs';

// Build de E2E (e2e/servidor-e2e.ts): inlina a raiz de CA de TESTE no trust
// store ICP-Brasil para o spec do fluxo A3 qualificado. Fora desse build a
// constante fica indefinida e o ramo em trust-store.ts é código morto — não
// há como ligar a raiz de teste por env de runtime.
const e2eTestCa = process.env.E2E_TEST_CA === '1';
if (e2eTestCa) {
	console.warn(
		'[vite] ⚠️ E2E_TEST_CA=1 — inlinando raiz de CA de TESTE no trust store (build de teste, não deployável).'
	);
}

export default defineConfig({
	define: e2eTestCa
		? {
				__E2E_TEST_TRUST_ROOTS_PEM__: JSON.stringify(
					readFileSync('e2e/ca-teste/artefatos/root.pem', 'utf8')
				)
			}
		: undefined,
	plugins: [
		tailwindcss(),
		sveltekit(),
		visualizer({ open: false, filename: 'bundle-stats.html', gzipSize: true, brotliSize: true })
	],
	build: {
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (id.includes('node_modules')) {
						if (id.includes('@vladmandic/face-api') || id.includes('@tensorflow'))
							return 'face-api';
						if (id.includes('pdf-lib') || id.includes('jspdf') || id.includes('@signpdf'))
							return 'pdf';
						if (id.includes('docx') || id.includes('exceljs')) return 'office';
						if (id.includes('chart.js')) return 'charts';
						if (id.includes('node-forge')) return 'crypto';
						// @skeletonlabs/@zag-js: SEM agrupamento manual — o Rollup divide
						// por uso real de cada rota. Antes, um chunk 'skeleton' único
						// (~229 kB raw) era baixado por TODAS as rotas mesmo quando a
						// página usava só Dialog; medição pós-mudança: /login -22 kB gz.
						// (Retornar undefined ≠ cair no 'vendor' abaixo — por isso o
						// early-return explícito.)
						if (id.includes('@skeletonlabs') || id.includes('@zag-js')) return undefined;
						if (id.includes('@lucide/svelte') || id.includes('lucide')) return 'lucide';
						// Chunk próprio: o SDK é carregado via import() dinâmico no idle
						// (hooks.client.ts). Sem esta linha ele cairia no 'vendor', que é
						// importado estaticamente por todas as rotas — anulando o lazy-load.
						if (id.includes('@sentry')) return 'sentry';
						return 'vendor';
					}
				}
			},
			onwarn(warning, warn) {
				if (warning.code === 'UNUSED_EXTERNAL_IMPORT') return;
				warn(warning);
			}
		}
	},
	ssr: {
		noExternal: ['@skeletonlabs/skeleton-svelte', '@zag-js/svelte', '@zag-js/utils']
	},
	test: {
		include: ['src/**/*.test.ts'],
		// `node`, sem DOM, e isso é DECISÃO, não pendência: componente Svelte é
		// exercitado pela suíte E2E (Playwright), não por render em jsdom. A
		// revisão de componentização de 13/ago/2026 levantou "zero testes de
		// componente" como achado; foi formalmente ACEITO em 19/ago pelo que
		// custa o contrário — um segundo projeto vitest com jsdom/happy-dom mais
		// testing-library, para cobrir o que o E2E já cobre com o browser de
		// verdade (view transitions, `inert`, foco, media query).
		//
		// O que a revisão pedia de fato — tirar lógica de dentro do markup para
		// que ela fique testável — foi feito, e por vitest: `menu-visibilidade`,
		// `bem-vindo-cards`, `status-escala`, `mensagens-download`. Regra
		// derivada: se uma regra precisa de teste, ela sai do `.svelte` para um
		// `.ts` puro. Montar componente para testá-la é o sinal de que ela está
		// no arquivo errado.
		environment: 'node',
		// Cobertura restrita a src/lib (lógica de negócio unit-testável).
		// Informativa por ora — sem threshold; quando os números
		// estabilizarem, trave um piso (mesma estratégia ratchet do lint).
		coverage: {
			provider: 'v8',
			reporter: ['text-summary', 'html'],
			include: ['src/lib/**/*.ts'],
			exclude: ['src/lib/**/__tests__/**', 'src/lib/**/*.test.ts']
		}
	}
});
