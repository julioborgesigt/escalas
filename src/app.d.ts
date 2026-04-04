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
				SENTRY_DSN?: string;
			};
		}
	}
}

export {};
