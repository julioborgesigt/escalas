/**
 * Recorte + centralização + escala do traço de uma rubrica capturada em
 * canvas — usado tanto pelo desenho ao vivo (`RubricaCanvas`) quanto pela
 * foto enviada no cadastro (`ModalCadastrarRubrica`). As duas telas acham a
 * caixa delimitadora do traço por critérios diferentes (alpha vs luminância),
 * mas o que fazem com a caixa — recortar, centralizar numa tela de proporção
 * `aspecto` e exportar PNG — é o mesmo cálculo, replicado antes desta extração.
 */

export interface CaixaTraco {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

/**
 * Recorta `fonte` pela caixa do traço, centraliza numa tela de saída
 * 1000×(1000/`aspecto`) com margem de 24px e devolve o PNG como dataURL.
 */
export function recortarCentralizarTraco(
	fonte: CanvasImageSource,
	caixa: CaixaTraco,
	aspecto: number
): string {
	const margem = 24;
	const recW = caixa.maxX - caixa.minX + 1;
	const recH = caixa.maxY - caixa.minY + 1;

	const outW = 1000;
	const outH = Math.round(outW / aspecto);
	const out = document.createElement('canvas');
	out.width = outW;
	out.height = outH;
	const octx = out.getContext('2d')!;

	const escala = Math.min((outW - 2 * margem) / recW, (outH - 2 * margem) / recH);
	const drawW = recW * escala;
	const drawH = recH * escala;
	const dx = (outW - drawW) / 2;
	const dy = (outH - drawH) / 2;

	octx.drawImage(fonte, caixa.minX, caixa.minY, recW, recH, dx, dy, drawW, drawH);
	return out.toDataURL('image/png');
}
