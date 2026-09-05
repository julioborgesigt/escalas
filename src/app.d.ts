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
		/**
		 * Salt do rate-limit por IP. Com ele, a chave de `login_attempts` /
		 * `recovery_attempts` é o SHA-256 salteado do IP COMPLETO; sem ele, cai no
		 * `/24` de `anonimizarIp` e cinco falhas bloqueiam a rede inteira (o NAT de
		 * uma delegacia). Lido por `chaveRateLimitIp` via `$env/dynamic/private` —
		 * ver a nota lá sobre por que `process.env` não serve como fonte única.
		 */
		RATE_LIMIT_IP_SALT?: string;
		/**
		 * Chave da cadeia da trilha de auditoria. Com ela o encadeamento é
		 * HMAC-SHA256; sem ela, SHA-256 puro — detecta adulteração acidental, mas
		 * quem tem escrita no banco forja a cauda inteira. LOAD-BEARING: trocá-la
		 * torna as linhas antigas inverificáveis. Confira o modo em `/auditoria` →
		 * "Verificar integridade" (`HMAC-SHA256`, `SHA-256 puro` ou `misto`).
		 */
		AUDIT_CHAIN_KEY?: string;
		/**
		 * Cifra o IP COMPLETO de cada evento em `audit_log.ip_cifrado` (AES-256-GCM),
		 * decifrável só em perícia autorizada; a coluna `ip` segue anonimizada para
		 * exibição. Sem ela, o IP completo simplesmente não é preservado.
		 * DISTINTA das chaves de CPF.
		 */
		AUDIT_IP_ENCRYPTION_KEY?: string;
		/**
		 * TTL (s) do cache de sessão na borda. Default 60, clamp [0, 300]; `0`
		 * desliga (revogação imediata, mais consultas ao D1). É a janela em que um
		 * logout ou uma troca de papel ainda pode valer em outro data center —
		 * método que MUTA nunca usa o cache (`ttlCacheSessaoParaMetodo`).
		 */
		SESSION_CACHE_TTL_SECONDS?: string;
		/**
		 * Sem ele, `/api/health` devolve só `{ status }` (binário,
		 * anti-reconhecimento). Com `?detail=<token>`, devolve os checks, o estado
		 * dos segredos de proteção (`protecoesAusentes`) e a saúde do cron de
		 * retenção. Mínimo 16 chars.
		 */
		HEALTH_DETAIL_TOKEN?: string;
		/**
		 * Truthy (1/true/yes/on): os webhooks recusam requisição sem
		 * `X-Webhook-Timestamp` + `X-Webhook-Nonce`. Vazio: aceita por
		 * compatibilidade e loga `info`. **Não vale para `reset-policiais`**, onde
		 * os headers são obrigatórios sempre. Ligar só DEPOIS de republicar o Apps
		 * Script, que é quem passa a enviá-los.
		 */
		WEBHOOK_REPLAY_ENFORCE?: string;
		/**
		 * Truthy: permite que `sync-policiais` altere `papel`/`papel_unidade_id`.
		 * Vazio (default e recomendado): o webhook preserva o que está no banco —
		 * é o que impede um SYNC_TOKEN comprometido de promover matrícula a
		 * admin pela planilha.
		 */
		WEBHOOK_ALLOW_PAPEL_CHANGES?: string;
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
		/**
		 * Bundle base64 (chave privada PEM + certificado PEM) do selo institucional
		 * autoassinado que sela os PDFs da assinatura AVANÇADA (Lei 14.063/2020
		 * art. 4º II). Sem ele, o documento degrada para o rodapé honesto, sem selo.
		 * Gere com `node scripts/gerar-selo-institucional.mjs` — a chave privada não
		 * é regenerável: guarde em cofre.
		 */
		SELO_INSTITUCIONAL_PEM?: string;
		/**
		 * Truthy: anexa um DSS (certs + OCSP) à assinatura qualificada para LTV
		 * autocontido. **Deixe VAZIA** — nossas assinaturas usam o SubFilter legado
		 * `adbe.pkcs7.detached`, e o Adobe passa a marcar a assinatura como inválida
		 * apesar da cripto íntegra. Só reabilite após migrar para PAdES.
		 */
		EMBED_PADES_LT_DSS?: string;
		/**
		 * Sobrescreve o `sigPolicyHash` da PA-AD-RB v2.3 (64 hex) num bump de versão
		 * da política. O valor oficial já vem embutido no código, e o placeholder de
		 * zeros é explicitamente rejeitado — ver `resolverHashPolitica`.
		 */
		PA_AD_RB_HASH_HEX?: string;
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
