/**
 * Evidências sintéticas da assinatura AVANÇADA em tela, compartilhadas pelos
 * specs que exercitam esse fluxo (assinatura-simples de escala, relatório
 * extraordinário avançado…). Antes cada spec duplicava os blobs base64.
 */

/** JPEG 1×1 válido — a câmera real produz JPEG; o manifesto embute a selfie. */
export const SELFIE_JPEG =
	'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';

/**
 * Reforços opcionais (flags padrão do banco: foto e GPS LIGADOS). O veredito de
 * liveness é calculado no cliente por decisão de produto (auditoria A2 —
 * "Nível 0"); o servidor confere consistência estrutural/temporal, que este
 * payload satisfaz (cumprido + duração plausível ≥ 500 ms).
 */
export function evidenciasReforco() {
	const agora = Date.now();
	return {
		latitude: -3.71839,
		longitude: -38.5434,
		selfieBase64: SELFIE_JPEG,
		livenessChallenge: {
			tipo: 'smile' as const,
			cumprido: true,
			tentativas: 1,
			iniciadoEm: new Date(agora - 2000).toISOString(),
			concluidoEm: new Date(agora).toISOString(),
			duracaoMs: 2000
		}
	};
}
