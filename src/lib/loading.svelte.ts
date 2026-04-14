export class LoadingState {
	#message = $state('Carregando...');
	#active = $state(false);

	get message() {
		return this.#message;
	}

	get active() {
		return this.#active;
	}

	show(msg = 'Carregando...') {
		this.#message = msg;
		this.#active = true;
	}

	hide() {
		this.#active = false;
	}
}

export const loading = new LoadingState();
