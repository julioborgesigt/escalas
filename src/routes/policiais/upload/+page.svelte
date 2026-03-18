<script lang="ts">
	let file = $state<File | null>(null);
	let uploading = $state(false);
	let result = $state<{ imported: number; errors: string[]; total: number } | null>(null);
	let error = $state('');

	function onFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		file = input.files?.[0] || null;
	}

	async function upload(e: Event) {
		e.preventDefault();
		if (!file) return;

		uploading = true;
		error = '';
		result = null;

		const formData = new FormData();
		formData.append('file', file);

		const res = await fetch('/api/policiais/upload', {
			method: 'POST',
			body: formData
		});

		if (res.ok) {
			result = await res.json();
		} else {
			const data = await res.json();
			error = data.error || 'Erro ao importar';
		}
		uploading = false;
	}
</script>

<div class="page-header">
	<h1>Importar Planilha</h1>
	<a href="/policiais" class="btn btn-outline">Voltar</a>
</div>

<div class="card">
	<p style="margin-bottom: 1rem; color: var(--text-light); font-size: 0.9rem;">
		A planilha deve conter as colunas: <strong>A</strong> (Nome), <strong>B</strong> (Matrícula),
		<strong>C</strong> (Cargo: DPC ou OIP), <strong>D</strong> (Telefone), <strong>E</strong> (Lotação).
		A primeira linha será ignorada (cabeçalho).
	</p>

	{#if error}
		<div class="alert alert-error">{error}</div>
	{/if}

	{#if result}
		<div class="alert alert-success">
			{result.imported} de {result.total} policiais importados com sucesso.
		</div>
		{#if result.errors.length > 0}
			<div class="alert alert-error">
				<strong>Erros:</strong>
				<ul style="margin-top: 0.5rem; padding-left: 1.5rem;">
					{#each result.errors as err}
						<li>{err}</li>
					{/each}
				</ul>
			</div>
		{/if}
	{/if}

	<form onsubmit={upload}>
		<div class="form-group">
			<label for="file">Arquivo (.xlsx, .xls, .ods)</label>
			<input id="file" type="file" accept=".xlsx,.xls,.ods,.csv" onchange={onFileChange} required />
		</div>
		<div class="actions">
			<button type="submit" class="btn btn-primary" disabled={uploading || !file}>
				{uploading ? 'Importando...' : 'Importar'}
			</button>
		</div>
	</form>
</div>
