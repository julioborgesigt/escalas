/**
 * Nome do provedor da chave de assinatura, a partir do AAGUID.
 *
 * O AAGUID identifica o MODELO/fabricante do autenticador (ex.: "Google
 * Password Manager", "iCloud Keychain") — nunca a conta específica do
 * titular. O WebAuthn não expõe e-mail/Apple ID/conta Google ao site em
 * nenhuma hipótese: é uma barreira deliberada do protocolo, não uma
 * limitação deste sistema. O nome aqui é só um rótulo de conveniência para
 * o titular reconhecer qual gerenciador de senhas ele usou.
 *
 * A tabela abaixo é o subconjunto de consumo mais comum (gerenciadores de
 * senha de plataforma e de terceiros) da lista pública mantida pela
 * comunidade em github.com/passkeydeveloper/passkey-authenticator-aaguids
 * (licença MIT). Chaves em hex minúsculo, sem hífens — o mesmo formato que
 * `authenticator-data.ts` grava em `credenciais_webauthn.aaguid`.
 *
 * Assim como o resto do módulo `webauthn/`, este dado é DECLARADO pelo
 * autenticador na cerimônia (`attestation: 'none'`), não verificado contra
 * uma raiz de confiança — por isso nunca entra no manifesto do PDF, só nas
 * telas de perfil e da ficha do policial, sempre como informação não
 * verificada.
 */

const AAGUID_PROVEDOR: Record<string, string> = {
	bada5566a7aa401fbd9645619a55120d: '1Password',
	a11a5faa9f324b8c8c5d2f7d13e8c942: 'AliasVault',
	fbfc3007154e4ecc8c0b6e020557d7bd: 'Apple Passwords',
	a4a2d88e979643569164e2a5a8bd019c: 'Avast Password Manager',
	'6bb49926160a4306a1004eb39ba6ac45': 'AVG Password Manager',
	e7db2bd3f2fe4d71ad787e7aa166cfd1: 'Avira Password Manager',
	d548826e79b4db40a3d811116f7e8349: 'Bitwarden',
	c9cadfc989a9489ea25ac7e86a4d5f15: 'Burp Suite Navigation Recorder',
	adce000235bcc60a648b0b25f1f05503: 'Chrome on Mac',
	b53976664885aa6bcebfe52262a439a2: 'Chromium Browser',
	'531126d6e717415c93203d9aa6981239': 'Dashlane',
	de503f9c21a44f76b4b7558eb55c6f89: 'Devolutions',
	'771b48fdd3d44f749232fc157ab0507a': 'Edge on Mac',
	f38095407f1449c1a8b38f813b225541: 'Enpass',
	d2717a32985148a89961b264c97a411a: 'Fenko Vault',
	ea9b8d664d011d213ce4b6b48cb575d4: 'Google Password Manager',
	d49b2120b86541918ceabe84a52b0485: 'Heimlane Vault',
	da583154ce164cdf9fe61dba788c0998: 'Hey Be Safe',
	dd4ec289e01d41c9bb8970fa845d4bf2: 'iCloud Keychain (Managed)',
	'39a5647e1853446ca1f6a79bae9f5bc7': 'IDmelon',
	cb6f666638ea48739161ff456a82d316: 'iPass Secure Auth',
	bfc748bb34294faab9f97cfa9f3b76d0: 'iPasswords',
	a10c6dd9465e42268198c7c44b91c555: 'Kaspersky Password Manager',
	eaecdef21c3156348639f1cbd9c00a08: 'KeePassDX',
	'9addb28cb46f4402808f019651441ff3': 'KeePassPasskey',
	fdb141b25d84443e8a354698c205a502: 'KeePassXC',
	'0ea242b443c44a1b8b17dd6d0b6baec6': 'Keeper',
	b78a0a556ef8d246a042ba0f6d55050c: 'LastPass',
	'22248c4c7a1246e29a4144291b373a4d': 'LogMeOnce',
	d345266801fd4c12926c83a4204853aa: 'Microsoft Password Manager',
	b84e404815dc4dd08640f4f60813c8af: 'NordPass',
	fa37f553f9b64adbac538bbb57ebdf0d: 'Norton Password Manager',
	'5ca471bba56d46ada49667e70e9ed9fb': 'Parcel',
	'87f5ec51f7214feb9fe4be18c4971894': 'PassCard',
	'7061737377616c6c6669646f32303236': 'Passwall',
	'53e7a7a5e75f4d3d948312fc779cdf23': 'Password Depot',
	'50726f746f6e5061737350726f746f6e': 'Proton Pass',
	d350af5203514ba2acd3dfeeadc3f764: 'pwSafe',
	'65c97700f5ef4d5c8a42f30e45ac94b7': 'Royal Vault',
	'53414d53554e47000000000000000000': 'Samsung Pass',
	e8b7f4a2c3d5e6f7890ab1c2d3e4f567: 'Sherlocked',
	d9be9d39e6a64c28a58132b044d986e4: 'Sticky Password Manager',
	'891494da2c904d31a9cd4eab0aed1309': 'Sésame',
	'8836336af5900921301d46427531eee6': 'Thales Bio Android SDK',
	'66a0ccb3bd6a191fee06e375c50b9846': 'Thales Bio iOS SDK',
	cd69adb53c7adeb931776800ea6cb72a: 'Thales PIN Android SDK',
	'17290f1ec21234d01423365d729f09d9': 'Thales PIN iOS SDK',
	cc45f64e52a2451b831a4edd8022a202: 'ToothPic Passkey Provider',
	'45e3057eb2f948ed912f9b901e153b16': 'Uniqkey',
	'477b05cd7f784fe7b62927247f296138': 'WALLIX Vault',
	'08987058cadc4b81b6e130de50dcbe96': 'Windows Hello',
	'9ddd1817af5a4672a2b93e3dd95000a9': 'Windows Hello',
	'6028b017b1d44c02b4b3afcdafc96bb2': 'Windows Hello',
	b35a26b28f6e4697ab1dd44db4da28c6: 'Zoho Vault'
};

/**
 * Nome do provedor para o AAGUID gravado no registro, ou `null` quando não
 * há AAGUID ou ele não está no mapa (autenticador novo/raro).
 */
export function nomeProvedorAaguid(aaguid: string | null): string | null {
	if (!aaguid) return null;
	return AAGUID_PROVEDOR[aaguid.toLowerCase().replace(/-/g, '')] ?? null;
}
