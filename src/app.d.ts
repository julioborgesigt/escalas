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
		/**
		 * DSN do Sentry. Quando vazio/ausente, o SDK é inicializado em modo no-op
		 * (útil em dev/local). Configure em produção para receber 5xx do worker.
		 */
		SENTRY_DSN?: string;
		/** Identifica o ambiente nos eventos do Sentry (production, staging, dev). */
		SENTRY_ENVIRONMENT?: string;
		/** Sample rate para tracing (0.0 a 1.0). Default 0.1 em produção. */
		SENTRY_TRACES_SAMPLE_RATE?: string;
		/** Login admin via variáveis de ambiente (opcional) */
		ADMIN_GERAL_LOGIN?: string;
		ADMIN_GERAL_SENHA?: string;
		SUPER_ADMIN_LOGIN?: string;
		SUPER_ADMIN_SENHA?: string;
		/** Web App URL do Google Apps Script que grava na aba Base_Equipe (POST JSON). */
		GISE_BASE_EQUIPE_WEBHOOK_URL?: string;
		/** Segredo compartilhado com ScriptProperties BASE_EQUIPE_SECRET na planilha. */
		GISE_BASE_EQUIPE_SECRET?: string;
		/**
		 * Quando truthy (1/true/yes/on), trust store ICP-Brasil vazio é tratado
		 * como hard error nas verificações de assinatura qualificada. Sem ela
		 * (legado), o sistema aceita assinaturas com aviso "cadeia indisponível"
		 * — útil em fase de implantação, perigoso em produção.
		 *
		 * Ativar APÓS popular roots.pem/intermediates.pem via
		 * `src/lib/server/icp-brasil/update-trust-store.sh`.
		 */
		ICP_BRASIL_TRUST_STORE_REQUIRED?: string;
		/**
		 * URL HTTP(S) do Time-Stamp Authority RFC 3161 para anexar carimbo de
		 * tempo qualificado às assinaturas. Quando ausente, o sistema usa
		 * apenas o `signingTime` do servidor (sem oponibilidade a terceiros).
		 *
		 * Exemplos: ACT da ITI, Bry, Soluti, Certisign, etc.
		 */
		TSA_URL?: string;
		/** Basic auth username para o TSA (se a ACT exigir). */
		TSA_USERNAME?: string;
		/** Basic auth password para o TSA (se a ACT exigir). */
		TSA_PASSWORD?: string;
		/**
		 * Quando truthy (1/true/yes/on), recusa finalizar a assinatura se o
		 * carimbo de tempo não for de uma ACT credenciada ICP-Brasil verificada
		 * (tipo `act_icp`). Sem a flag, carimbos não-ICP (ex.: DigiCert) ou a
		 * ausência/invalidez de carimbo apenas REBAIXAM o rótulo (para
		 * `tsa_externa`/`servidor`), sem bloquear. Recomendado em produção para
		 * garantir tempestividade oponível (DOC-ICP-15, Decreto 10.278/2020).
		 */
		EXIGIR_TSA_QUALIFICADA?: string;
		/**
		 * Chave de licença comercial do Lacuna Web PKI para uso em produção
		 * (qualquer domínio que não seja localhost). Sem ela, o fluxo Web PKI
		 * falha com erro de licença em produção — recomenda-se fallback para
		 * SERPRO na UI.
		 *
		 * Esta chave é EXPOSTA ao cliente via `+layout.server.ts` — não é
		 * segredo, é assinada pelo emissor da Lacuna como identificador
		 * de domínio. NÃO use como credencial.
		 */
		WEBPKI_LICENSE?: string;
	}

	namespace App {
		interface Locals {
			usuario: UsuarioLogado | null;
			requestId: string;
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

export {};
