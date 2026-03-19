import { json } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import { excluirSessao } from '$lib/auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform, cookies }) => {
	const token = cookies.get('session_token');
	if (token) {
		const db = getDB(platform);
		await excluirSessao(db, token);
		cookies.delete('session_token', { path: '/' });
	}
	return json({ success: true });
};
