export function getInt(fd: FormData, key: string): number {
	const v = fd.get(key);
	if (v === null || v === undefined) return NaN;
	return parseInt(v as string);
}
