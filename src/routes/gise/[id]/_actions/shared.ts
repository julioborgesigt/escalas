export function getInt(fd: FormData, key: string): number {
	const v = fd.get(key);
	if (v === null || v === undefined) return NaN;
	return parseInt(v as string);
}

function getIntParam(url: URL, key: string): number {
	const v = url.searchParams.get(key);
	if (!v) return NaN;
	return parseInt(v);
}
