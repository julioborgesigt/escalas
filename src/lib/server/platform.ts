/**
 * Typed helpers for accessing Cloudflare platform bindings.
 *
 * Cloudflare D1/R2 types don't resolve during svelte-check because
 * @sveltejs/adapter-cloudflare declares `env: unknown`. These helpers
 * centralize the type cast at a single boundary.
 */

export interface R2Bucket {
	get(key: string): Promise<R2ObjectBody | null>;
	put(key: string, value: ArrayBuffer | ArrayBufferView | ReadableStream | string | Blob | null, options?: Record<string, unknown>): Promise<unknown>;
	delete(keys: string | string[]): Promise<void>;
	list(options?: Record<string, unknown>): Promise<{ objects: Array<{ key: string }>; truncated: boolean; cursor?: string }>;
}

export interface R2ObjectBody {
	body: ReadableStream;
	arrayBuffer(): Promise<ArrayBuffer>;
	text(): Promise<string>;
}

interface CloudflareEnv {
	escalas_docs?: R2Bucket;
	SENTRY_DSN?: string;
}

/**
 * Safely extract R2 bucket from platform env.
 * Returns undefined if platform or R2 binding is not available.
 */
export function getR2(platform: unknown): R2Bucket | undefined {
	const env = (platform as { env?: CloudflareEnv } | undefined)?.env;
	return env?.escalas_docs;
}
