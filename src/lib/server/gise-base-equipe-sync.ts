/**
 * Envio pós-finalização da GISE para a planilha Google (aba Base_Equipe).
 *
 * Configure no Cloudflare Pages (variáveis de **runtime** da função / Worker):
 *   GISE_BASE_EQUIPE_WEBHOOK_URL — URL do Web App do Google (script.google.com/macros/.../exec), não do portal.
 *   GISE_BASE_EQUIPE_SECRET      — mesmo valor armazenado em ScriptProperties
 *                                   como BASE_EQUIPE_SECRET na planilha.
 *
 * O código lê `platform.env` **e** `$env/dynamic/private` (recomendado pelo SvelteKit
 * no adapter-cloudflare): no Pages, variáveis do painel costumam aparecer só no módulo `$env`.
 *
 * A finalização da GISE não falha se o envio à planilha falhar; erros vão para o log.
 *
 * Regras de dados:
 *   — Uma linha por policial em gise_membros (mesmo sem presença), mais o quadro «Supervisão e apoio»
 *     (supervisor, assessor, SEINT) quando não estiverem alocados em equipe.
 *   — Cidade: unidade do slot, exceto supervisor/assessor/SEINT da escala → cidade pela lotação
 *     (nome da unidade = texto de lotação, case-insensitive).
 *   — Datas/horas: presença quando existir; senão alinhado ao PDF (data prevista, hora vazia se ausente).
 *   — Refinalizar: o POST manda gise_id; o Apps Script apaga linhas antigas desse ID e grava de novo.
 */

import { env as envPrivate } from '$env/dynamic/private';
import { atualizarGiseEscala } from '$lib/db';
import { montarLinhasBaseEquipeGise } from '$lib/db/gise/planilha-base-equipe-dados';
import type { Database } from '$lib/db/core';
import { logger } from '$lib/server/logger';

/** Mensagem retornada à UI quando URL ou secret não existem em nenhuma fonte. */
export const ERRO_BASE_EQUIPE_ENV_AUSENTE =
	'Integração com a planilha não está configurada no servidor (URL ou secret ausente).';

export type BaseEquipeEnv = {
	GISE_BASE_EQUIPE_WEBHOOK_URL?: string;
	GISE_BASE_EQUIPE_SECRET?: string;
};

/** Link de abrir a planilha no navegador — não é o endpoint POST do Web App. */
function erroSeWebhookUrlEhLinkDaPlanilha(urlStr: string): string | null {
	const u = urlStr.trim().toLowerCase();
	if (u.includes('docs.google.com/spreadsheets') || u.includes('drive.google.com/file')) {
		return (
			'GISE_BASE_EQUIPE_WEBHOOK_URL não pode ser o link da planilha (docs.google.com/spreadsheets/d/…). ' +
			'Esse endereço abre o arquivo no navegador; o portal precisa do URL do Web App do Apps Script: ' +
			'no Google, Implantar → aplicativo da Web → copiar o link https://script.google.com/macros/s/…/exec. ' +
			'O ID …/d/ID/… da planilha só é usado no menu «ID planilha Base_Equipe (portal)» do script, se o projeto não estiver vinculado ao arquivo.'
		);
	}
	return null;
}

function isUrlWebAppAppsScript(u: string): boolean {
	return /https?:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec\b/i.test(u.trim());
}

function isUrlAbrirPlanilhaNoNavegador(u: string): boolean {
	const l = u.trim().toLowerCase();
	return l.includes('docs.google.com/spreadsheets') || l.includes('drive.google.com/file');
}

/**
 * Escolhe o URL do webhook quando existem duas fontes (`platform.env` e `$env/dynamic/private`).
 * Se uma ainda for o link errado da planilha (docs.google.com/...) e a outra for script.google.com/.../exec,
 * usa a do Web App — evita ficar preso a valor antigo no wrangler / binding.
 */
function escolherUrlWebhookAppsScript(
	dePlatform?: string,
	dePrivate?: string
): string | undefined {
	const a = dePlatform?.trim();
	const b = dePrivate?.trim();
	if (a && isUrlWebAppAppsScript(a)) return a;
	if (b && isUrlWebAppAppsScript(b)) return b;
	if (a && isUrlAbrirPlanilhaNoNavegador(a) && b && !isUrlAbrirPlanilhaNoNavegador(b)) return b;
	if (b && isUrlAbrirPlanilhaNoNavegador(b) && a && !isUrlAbrirPlanilhaNoNavegador(a)) return a;
	return a || b;
}

/** URL e secret: mescla `workerEnv` com `$env/dynamic/private`; URL prioriza Web App /exec válido. */
function resolveBaseEquipeUrls(workerEnv: BaseEquipeEnv | undefined): { url: string; secret: string } | null {
	const url = escolherUrlWebhookAppsScript(
		workerEnv?.GISE_BASE_EQUIPE_WEBHOOK_URL,
		envPrivate.GISE_BASE_EQUIPE_WEBHOOK_URL
	);
	const secretPlat = workerEnv?.GISE_BASE_EQUIPE_SECRET?.trim();
	const secretPriv = envPrivate.GISE_BASE_EQUIPE_SECRET?.trim();
	const secret = secretPlat || secretPriv;
	if (!url || !secret) return null;
	return { url, secret };
}

export type SyncBaseEquipeResult =
	| { ok: true; linhas: number }
	| { ok: false; error: string };

/** Resposta JSON do próprio SvelteKit (fetch a uma rota do portal), não do Apps Script. */
function detalheSeRespostaNaoEhPlanilha(
	parsed: Record<string, unknown>,
	raw: string
): string | null {
	if (parsed.type === 'redirect' && typeof parsed.location === 'string') {
		const loc = parsed.location;
		if (/\/login/i.test(loc) || loc === '/login') {
			return (
				'A variável GISE_BASE_EQUIPE_WEBHOOK_URL aponta para o site do portal (houve redirecionamento para login), ' +
				'e não para o Web App do Google Apps Script. No Google: Implantar como aplicativo da Web e copie o URL ' +
				'no formato https://script.google.com/macros/s/…/exec (não use endereço do escalas/pages).'
			);
		}
		return (
			`O POST foi enviado a uma URL que redireciona para "${loc}". ` +
				'Use exclusivamente o URL de implantação do Apps Script (script.google.com/macros/.../exec).'
		);
	}
	if (parsed.type === 'redirect') {
		return (
			'Resposta de redirecionamento em JSON (não é o Web App da planilha). ' +
				'Corrija GISE_BASE_EQUIPE_WEBHOOK_URL para o link script.google.com/macros/.../exec.'
		);
	}
	// Corpo parece HTML de login (alguns ambientes não serializam redirect em JSON)
	if (typeof raw === 'string' && /<html[\s>]/i.test(raw) && /login/i.test(raw)) {
		return (
			'A URL do webhook parece ser do portal (página de login em HTML). ' +
				'Configure GISE_BASE_EQUIPE_WEBHOOK_URL com o URL do Apps Script (script.google.com/macros/.../exec).'
		);
	}
	return null;
}

async function postLinhasParaPlanilha(
	url: string,
	secret: string,
	giseId: number,
	rows: (string | number)[][]
): Promise<{ ok: boolean; detail?: string }> {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ secret, gise_id: giseId, rows }),
		signal: AbortSignal.timeout(25_000)
	});
	const text = await res.text();
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(text) as Record<string, unknown>;
	} catch {
		const preview = text.trim().slice(0, 280).replace(/\s+/g, ' ');
		return {
			ok: false,
			detail: `Resposta não é JSON (HTTP ${res.status}). Prévia: ${preview || '(vazio)'}`
		};
	}
	if (!res.ok) {
		const portal = detalheSeRespostaNaoEhPlanilha(parsed, text);
		if (portal) return { ok: false, detail: portal };
		const err = parsed.error != null ? String(parsed.error) : '';
		return { ok: false, detail: err || `HTTP ${res.status}` };
	}
	if (parsed.ok !== true) {
		const portal = detalheSeRespostaNaoEhPlanilha(parsed, text);
		if (portal) return { ok: false, detail: portal };
		const err = parsed.error != null ? String(parsed.error) : '';
		if (err) return { ok: false, detail: err };
		const preview = text.trim().slice(0, 280).replace(/\s+/g, ' ');
		return {
			ok: false,
			detail: `A planilha respondeu HTTP ${res.status} mas sem ok:true. Prévia: ${preview || '(corpo vazio)'}`
		};
	}
	return { ok: true };
}

/**
 * Envia (ou reenvia) as linhas da GISE para a planilha Base_Equipe; retorna resultado para UI ou logs.
 */
export async function executarSyncBaseEquipeGiseComResultado(
	env: BaseEquipeEnv | undefined,
	db: Database,
	giseId: number
): Promise<SyncBaseEquipeResult> {
	const resolved = resolveBaseEquipeUrls(env);
	if (!resolved) {
		return { ok: false, error: ERRO_BASE_EQUIPE_ENV_AUSENTE };
	}
	const { url, secret } = resolved;
	const urlErr = erroSeWebhookUrlEhLinkDaPlanilha(url);
	if (urlErr) return { ok: false, error: urlErr };

	try {
		const rows = await montarLinhasBaseEquipeGise(db, giseId);
		if (rows === null) {
			return { ok: false, error: 'GISE não encontrada.' };
		}
		const result = await postLinhasParaPlanilha(url, secret, giseId, rows);
		if (!result.ok) {
			logger.error('[GISE Base_Equipe] Falha ao enviar linhas', { giseId, detail: result.detail });
			return { ok: false, error: result.detail ?? 'Falha ao comunicar com a planilha.' };
		}
		logger.info('[GISE Base_Equipe] Linhas sincronizadas', { giseId, count: rows.length });
		return { ok: true, linhas: rows.length };
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		logger.error('[GISE Base_Equipe] Exceção no sync', { giseId, error: msg });
		return { ok: false, error: msg };
	}
}

export async function syncGiseBaseEquipeAposFinalizar(
	env: BaseEquipeEnv | undefined,
	db: Database,
	giseId: number
): Promise<void> {
	const r = await executarSyncBaseEquipeGiseComResultado(env, db, giseId);
	if (!r.ok) {
		if (r.error === ERRO_BASE_EQUIPE_ENV_AUSENTE) {
			logger.warn('[GISE Base_Equipe] Sync desativado (URL ou secret ausente)', { giseId });
			return;
		}
		logger.error('[GISE Base_Equipe] Falha no sync pós-finalizar', { giseId, error: r.error });
		return;
	}
	try {
		await atualizarGiseEscala(db, giseId, {
			planilha_base_equipe_alimentada_em: new Date().toISOString()
		});
	} catch (e) {
		logger.error('[GISE Base_Equipe] Sync OK mas falhou ao gravar planilha_base_equipe_alimentada_em', {
			giseId,
			error: e instanceof Error ? e.message : String(e)
		});
	}
	logger.info('[GISE Base_Equipe] Sync pós-finalizar OK', { giseId, linhas: r.linhas });
}

/** Dispara o sync sem bloquear a resposta ao cliente (Cloudflare waitUntil). */
export function agendarSyncBaseEquipeAposFinalizar(
	platform: App.Platform | undefined,
	db: Database,
	giseId: number
): void {
	// Mesma regra que getDB: em alguns ambientes os bindings ficam em `platform` direto.
	const raw = (platform?.env ?? platform) as BaseEquipeEnv | undefined;
	const job = syncGiseBaseEquipeAposFinalizar(raw, db, giseId);
	if (platform?.ctx?.waitUntil) {
		platform.ctx.waitUntil(job);
	} else {
		void job.catch((e) =>
			logger.error('[GISE Base_Equipe] Sync (sem waitUntil) falhou', {
				giseId,
				error: e instanceof Error ? e.message : String(e)
			})
		);
	}
}
