// eslint.config.js — Flat config (ESLint 9+)
import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	prettier,
	...svelte.configs['flat/prettier'],
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte']
			}
		}
	},
	{
		// Arquivos TypeScript normais
		files: ['**/*.ts'],
		rules: {
			'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
			'@typescript-eslint/no-explicit-any': 'warn',
			'no-console': ['warn', { allow: ['warn', 'error'] }]
		}
	},
	{
		// Arquivos Svelte
		files: ['**/*.svelte'],
		processor: svelte.processors.svelte,
		rules: {
			'@typescript-eslint/no-unused-vars': 'off',
			'svelte/no-at-html-tags': 'warn'
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
