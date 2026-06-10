import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
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
						if (id.includes('@vladmandic/face-api') || id.includes('@tensorflow')) return 'face-api';
						if (id.includes('pdf-lib') || id.includes('jspdf') || id.includes('@signpdf')) return 'pdf';
						if (id.includes('docx') || id.includes('exceljs')) return 'office';
						if (id.includes('chart.js')) return 'charts';
						if (id.includes('node-forge')) return 'crypto';
						if (id.includes('@skeletonlabs') || id.includes('@zag-js')) return 'skeleton';
						if (id.includes('lucide-svelte') || id.includes('lucide')) return 'lucide';
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
		environment: 'node'
	}
});

