/// <reference types="@sveltejs/adapter-cloudflare" />

import type { UsuarioLogado } from '$lib/auth';

declare global {
	interface Env {
		escalas_db: D1Database;
		escalas_docs: R2Bucket;
		/** Binding do Cloudflare Email Sending (serviço primário de envio). */
		EMAIL?: SendEmail;
		/**
		 * Origem canônica da aplicação (ex.: `https://escalas.exemplo.gov.br`).
		 * Quando definida, os links de e-mail (redefinição/primeiro acesso) usam
		 * esta origem em vez de `url.origin` (derivado do header Host) — defesa em
		 * camadas contra host-header injection. Opcional.
		 */
		APP_ORIGIN?: string;
		SYNC_TOKEN: string;
		/**
		 * Segredo separado, **distinto de SYNC_TOKEN**, exigido pelo endpoint
		 * `/api/webhook/reset-policiais`. Sem ele, o reset retorna 401.
		 * Manter offline e rodar manualmente a partir de máquina conhecida.
		 */
		RESET_TOKEN?: string;
		/**
		 * Pepper de senha (achado A3). Segredo GLOBAL aplicado via HMAC-SHA256
		 * sobre a senha ANTES do PBKDF2 (formato de hash `pbkdf2v3`). Com ele, um
		 * dump do D1 sozinho não permite brute-force offline (o atacante precisa
		 * também deste segredo). Opcional: sem ele, `hashSenha` emite `pbkdf2v2`
		 * (fallback). Ao defini-lo, o login re-hasha v1/v2/legado → v3
		 * progressivamente. NUNCA rotacionar sem plano de migração: trocar o valor
		 * invalida todos os hashes v3 existentes (exige reset de senha). Gere com
		 * `openssl rand -hex 32`.
		 */
		PASSWORD_PEPPER?: string;
		/**
		 * Cifragem de CPF em repouso (LGPD). Chave AES-256-GCM em hex de 32 bytes
		 * (`openssl rand -hex 32`). Quando definida, o CPF é gravado cifrado
		 * (`enc:v1:...`) em `policiais.cpf` e decifrado em memória ao montar a
		 * sessão / exibir. Sem ela, grava em texto (fallback). LOAD-BEARING como o
		 * PASSWORD_PEPPER: trocar invalida os CPFs cifrados (exige re-cifrar ou
		 * wipe + re-sincronizar).
		 */
		CPF_ENCRYPTION_KEY?: string;
		/**
		 * Chave do índice cego de CPF (lookup do login por certificado). HMAC-SHA256
		 * em hex de 32 bytes, **distinta** da CPF_ENCRYPTION_KEY. Gera `cpf_index`
		 * determinístico para `WHERE cpf_index = ?` sem decifrar. LOAD-BEARING.
		 */
		CPF_INDEX_KEY?: string;
		RESEND_API_KEY?: string;
		RESEND_FROM_EMAIL?: string;
		CLOUDFLARE_API_TOKEN?: string;
		CLOUDFLARE_ACCOUNT_ID?: string;
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
		/**
		 * Opcional. Quando definido, o login do Admin Geral via bootstrap por env
		 * passa a exigir 2FA por e-mail (código enviado a este endereço) — espelha
		 * o `SUPER_ADMIN_EMAIL`. Sem ele, mantém o login direto (sem 2FA).
		 */
		ADMIN_GERAL_EMAIL?: string;
		SUPER_ADMIN_LOGIN?: string;
		SUPER_ADMIN_SENHA?: string;
		/**
		 * Opcional. Quando definido, o login do Super Admin via bootstrap por env
		 * passa a exigir 2FA por e-mail (código enviado a este endereço) — fecha o
		 * bypass de 2FA da conta root. Sem ele, mantém o login direto (break-glass).
		 */
		SUPER_ADMIN_EMAIL?: string;
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
		 * `src/lib/server/assinatura/icp-brasil/update-trust-store.sh`.
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
