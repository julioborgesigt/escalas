/**
 * Estado de UI da edição inline de uma seccional (GiseSeccional e filhos).
 *
 * Vive numa classe única — e não em `$state` locais de cada componente —
 * porque os fluxos de edição são MUTUAMENTE EXCLUSIVOS entre os slots e
 * equipes renderizados: abrir a edição de vagas de uma equipe fecha a das
 * demais (`editandoEquipe` guarda o id ativo), e os callbacks de sucesso do
 * composable `useGiseSeccionalActions` precisam resetar esses campos de fora
 * do componente que os exibe.
 */
export class GiseSeccionalEstado {
	modoEdicaoSeccional = $state(false);

	editandoHorariosSeccional = $state(false);
	editSecHoraEnt = $state('');
	editSecHoraSai = $state('');

	editandoEquipe = $state<number | null>(null);
	editSlotsDpc = $state(0);
	editSlotsOip = $state(0);

	editandoHorariosEquipeId = $state<number | null>(null);
	editEqHoraEnt = $state('');
	editEqHoraSai = $state('');

	selecionandoUnidadeSlotId = $state<number | null>(null);
	slotUnidadeId = $state<number | ''>('');

	equipeParaAdicionar = $state<number | null>(null);
	cargoParaAdicionar = $state<'OIP' | 'DPC' | null>(null);
	policialParaAdicionar = $state<number | ''>('');

	adicionandoEquipe = $state(false);
	adicionandoEquipeSlotId = $state<number | null>(null);
	novaEquipeTipo = $state<'operacional' | 'seint'>('operacional');
	novaEquipeDpc = $state(1);
	novaEquipeOip = $state(3);

	adicionandoSlot = $state(false);
	novoSlotUnidadeId = $state<number | ''>('');
}
