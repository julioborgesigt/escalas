// eslint.config.js — Flat config (ESLint 9+)
import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	prettier,
	...svelte.configs['flat/prettier'],
	{
		// Apenas .ts/.js puros: usa parser do typescript-eslint com project info
		// para regras que exigem type-aware analysis.
		files: ['**/*.ts', '**/*.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte']
			}
		},
		rules: {
			'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
			'@typescript-eslint/no-explicit-any': 'warn',
			'no-console': ['warn', { allow: ['warn', 'error'] }]
		}
	},
	{
		// Arquivos Svelte: o eslint-plugin-svelte já define o parser principal
		// (svelte-eslint-parser); aqui ensinamos esse parser a delegar para o
		// parser do typescript-eslint nos blocos <script lang="ts">. Sem isso,
		// destructurings com type annotation (`let { x }: T = ...`) explodem com
		// "Complex binding patterns require an initialization value".
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			globals: { ...globals.browser },
			parserOptions: {
				parser: ts.parser,
				extraFileExtensions: ['.svelte'],
				svelteFeatures: { runes: true }
			}
		},
		rules: {
			'@typescript-eslint/no-unused-vars': 'off',
			'svelte/no-at-html-tags': 'warn',
			// Base está limpa (lint:strict passa com zero warnings); o CI usa
			// --max-warnings 0, então qualquer nova ocorrência bloqueia o PR.
			'svelte/require-each-key': 'warn',
			// Desativada: projeto não configura paths.base (svelte.config.js sem 'kit.paths.base').
			// resolve() de '$app/paths' seria no-op; todos os warnings são falsos positivos.
			'svelte/no-navigation-without-resolve': 'off',
			'svelte/prefer-svelte-reactivity': 'warn',
			'svelte/prefer-writable-derived': 'warn',
			'svelte/no-unused-svelte-ignore': 'warn',
			'no-useless-assignment': 'warn',
			'no-unused-expressions': 'warn',
			'prefer-const': ['warn', { destructuring: 'all' }]
		}
	},
	{
		// Ignorar arquivos gerados e build
		ignores: [
			'.svelte-kit/**',
			'node_modules/**',
			'build/**',
			'.output/**',
			'.wrangler/**',
			'**/*.test.ts',
			'static/**'
		]
	}
];
