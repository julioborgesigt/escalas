/// <reference types="@sveltejs/adapter-cloudflare" />

import type { UsuarioLogado } from '$lib/auth';

declare global {
	namespace App {
		interface Locals {
			usuario: UsuarioLogado | null;
		}
		interface Error {
			message: string;
			errorId?: string;
		}
		interface Platform {
			env: {
				escalas_db: D1Database;
				escalas_docs: R2Bucket;
				GMAIL_USER?: string;
				GMAIL_APP_PASSWORD?: string;
				SENTRY_DSN?: string;
				ADMIN_GERAL_LOGIN?: string;
				ADMIN_GERAL_SENHA?: string;
			};
			cf: CfProperties;
			ctx: ExecutionContext;
		}
	}
}

export { };
