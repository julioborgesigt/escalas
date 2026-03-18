/// <reference types="@sveltejs/adapter-cloudflare" />

declare global {
	namespace App {
		interface Platform {
			env: {
				escalas_db: D1Database;
			};
		}
	}
}

export {};
