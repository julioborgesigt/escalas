/// <reference types="@sveltejs/adapter-cloudflare" />

import type { UsuarioLogado } from '$lib/auth';

declare global {
	interface Env {
		escalas_db: D1Database;
		escalas_docs: R2Bucket;
		SYNC_TOKEN: string;
		/**
		 * Segredo separado, **distinto de SYNC_TOKEN**, exigido pelo endpoint
		 * `/api/webhook/reset-policiais`. Sem ele, o reset retorna 401.
		 * Manter offline e rodar manualmente a partir de máquina conhecida.
		 */
		RESET_TOKEN?: string;
		GMAIL_USER?: string;
		GMAIL_APP_PASSWORD?: string;
		/** Login admin via variáveis de ambiente (opcional) */
		ADMIN_GERAL_LOGIN?: string;
		ADMIN_GERAL_SENHA?: string;
		/** Web App URL do Google Apps Script que grava na aba Base_Equipe (POST JSON). */
		GISE_BASE_EQUIPE_WEBHOOK_URL?: string;
		/** Segredo compartilhado com ScriptProperties BASE_EQUIPE_SECRET na planilha. */
		GISE_BASE_EQUIPE_SECRET?: string;
	}

	namespace App {
		interface Locals {
			usuario: UsuarioLogado | null;
		}
		interface Error {
			message: string;
			errorId?: string;
		}
		interface Platform {
			env: Env;
			cf: CfProperties;
			ctx: ExecutionContext;
		}
	}
}

export { };
