/// <reference types="@sveltejs/adapter-cloudflare" />

import type { UsuarioLogado } from '$lib/auth';

declare global {
	interface Env {
		escalas_db: D1Database;
		escalas_docs: R2Bucket;
		SYNC_TOKEN: string;
		GMAIL_USER?: string;
		GMAIL_APP_PASSWORD?: string;
		/** Login admin via variáveis de ambiente (opcional) */
		ADMIN_GERAL_LOGIN?: string;
		ADMIN_GERAL_SENHA?: string;
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
