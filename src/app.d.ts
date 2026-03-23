/// <reference types="@sveltejs/adapter-cloudflare" />

import type { UsuarioLogado } from '$lib/auth';

declare global {
	namespace App {
		interface Locals {
			usuario: UsuarioLogado | null;
		}
		interface Platform {
			env: {
				escalas_db: D1Database;
				escalas_docs: R2Bucket;
			};
		}
	}
}

export {};
