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
			// Tech debt pré-existente — rebaixado para warning para não bloquear o
			// CI. Item explícito no plano de remediação (Sprint 2/3). Não relaxar
			// para 'off': queremos que cada nova ocorrência apareça no diff de PR.
			'svelte/require-each-key': 'warn',
			'svelte/no-navigation-without-resolve': 'warn',
			'svelte/prefer-svelte-reactivity': 'warn',
			'svelte/prefer-writable-derived': 'warn',
			'svelte/no-unused-svelte-ignore': 'warn',
			'no-useless-assignment': 'warn',
			'no-unused-expressions': 'warn',
			'prefer-const': 'warn'
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
