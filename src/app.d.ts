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
		// Platform is declared by @sveltejs/adapter-cloudflare with env: unknown.
		// Cloudflare D1/R2 bindings are accessed via typed helpers (getDB, getR2)
		// that cast the platform env safely at the boundary.
	}
}

export {};
