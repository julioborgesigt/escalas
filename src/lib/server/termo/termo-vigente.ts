/**
 * Termo de Uso e Política de Privacidade — versão vigente.
 *
 * O conteúdo é versionado em código (não no banco) para que toda alteração
 * passe por code review e gere uma nova versão obrigando reaceite. O banco
 * armazena apenas as manifestações de aceite (tabela `aceites_termos`).
 *
 * Quando atualizar:
 *   1. Bump da `VERSAO` (ex: '1.0' → '1.1')
 *   2. Atualize `VIGENTE_DESDE` para a data de publicação
 *   3. Edite `CONTEUDO_HTML` conforme necessário
 *   4. Após deploy, todos os usuários cairão na tela /aceitar-termo no
 *      próximo acesso até manifestarem novo aceite.
 *
 * ⚠️ JURÍDICO: o texto deste termo é uma BASE TÉCNICA elaborada a partir
 * das normas vigentes (MP 2.200-2/2001, Lei 14.063/2020, LGPD, Decreto
 * 10.278/2020). Antes de entrar em produção, deve ser revisado e validado
 * pela assessoria jurídica da PCCE.
 *
 * v1.3 (2026-07): reescrito para um órgão público sem fins lucrativos — o
 * Sistema é instrumento de controle interno, não serviço ao usuário. Base
 * legal do tratamento de dados migrada de CONSENTIMENTO (frágil, revogável)
 * para CUMPRIMENTO DE OBRIGAÇÃO LEGAL / EXERCÍCIO DE COMPETÊNCIAS (art. 7º,
 * II e III, e art. 23 da LGPD), adequada a uso funcional obrigatório. Mantida
 * a ÚNICA cláusula que exige manifestação expressa: a aceitação da assinatura
 * avançada como equivalente à manuscrita (Lei 14.063/2020 art. 4º, II). O
 * aceite passou a ser ÚNICO e implícito (um clique em "Li e aceito"), sem as
 * múltiplas caixas anteriores.
 *
 * v1.4 (2026-08): a assinatura avançada passou a admitir CHAVE DE ASSINATURA
 * no aparelho (passkey/WebAuthn) — chave privada no enclave do celular,
 * liberada por biometria ou PIN a cada uso. Muda o que o Usuário aceita como
 * equivalente à assinatura manuscrita (cláusula 2), acrescenta um dado pessoal
 * tratado (chave pública e identificador da credencial, cláusula 3) e cria um
 * dever novo de guarda (cláusula 4). A cláusula 2.4 diz, com todas as letras,
 * o que essa chave prova e o que NÃO prova: dizer menos no termo do que o
 * manifesto do PDF afirma seria abrir a divergência que a defesa explora.
 */

import { sha256Hex } from '$lib/crypto/digest';

export const VERSAO = '1.4';
export const VIGENTE_DESDE = '2026-08-14';

export const CONTEUDO_HTML = `
<h2>Termo de Uso e Política de Privacidade</h2>
<p class="subtitulo">Sistema de Gestão de Escalas — Polícia Civil do Estado do Ceará<br />
Versão ${VERSAO} — vigente desde ${VIGENTE_DESDE}</p>

<p><strong>Resumo:</strong> este é um sistema interno da Polícia Civil do Estado do Ceará (PCCE) para gerir escalas, registrar presença e assinar eletronicamente os documentos correspondentes — atividade que antes era feita em papel. O uso é funcional e restrito a servidores cadastrados. Ao aceitar, você declara ciência destas regras e aceita a assinatura eletrônica do Sistema como equivalente à sua assinatura de próprio punho.</p>

<h3>1. Objeto e âmbito</h3>
<p><strong>1.1.</strong> O Sistema é uma ferramenta institucional da <strong>PCCE</strong> destinada ao gerenciamento de escalas de plantão, expediente e GISE, ao registro de presença e à assinatura eletrônica dos documentos correspondentes. Não é um serviço prestado ao usuário: é um instrumento de controle administrativo interno.</p>
<p><strong>1.2.</strong> O acesso é restrito a servidores identificados por matrícula funcional e CPF (o “Usuário”) e destina-se exclusivamente ao exercício de suas atribuições.</p>

<h3>2. Assinatura eletrônica e sua validade</h3>
<p><strong>2.1.</strong> O Sistema gera assinaturas eletrônicas em duas modalidades, nos termos do art. 4º da Lei nº 14.063/2020:</p>
<ul>
	<li><strong>Qualificada</strong> — com certificado ICP-Brasil (e-CPF, token A1/A3). Goza da presunção de autenticidade do art. 10, §1º, da MP nº 2.200-2/2001.</li>
	<li><strong>Avançada</strong> — assinatura em tela, vinculada ao signatário por login e senha, segundo fator por código enviado ao e-mail cadastrado, rubrica gráfica e, quando habilitadas, fotografia (selfie), geolocalização e <strong>chave de assinatura do aparelho</strong> (cláusula 2.4), mais um <strong>selo criptográfico da PCCE</strong> que torna o documento verificável e detecta qualquer alteração posterior.</li>
</ul>
<p><strong>2.2.</strong> O selo institucional é gerado com certificado próprio da PCCE, <strong>não emitido pela ICP-Brasil</strong>; por isso a modalidade avançada não tem a presunção automática do art. 10, §1º, da MP nº 2.200-2/2001. Sua validade decorre da <strong>aceitação expressa</strong> do Usuário (art. 4º, II, da Lei nº 14.063/2020 e art. 10, §2º, da MP nº 2.200-2/2001).</p>
<p><strong>2.3.</strong> O Usuário <strong>aceita expressamente</strong> a assinatura eletrônica avançada do Sistema como meio válido e suficiente de comprovação de autoria e integridade, <strong>equivalente à sua assinatura manuscrita</strong> para todos os fins no âmbito da PCCE, e compromete-se a não impugná-la apenas por ser eletrônica ou por não usar certificado ICP-Brasil. Fica ressalvado o direito de alegar fraude, coação ou adulteração comprovadas.</p>

<p><strong>2.4.</strong> Quando a administração exigir <strong>chave de assinatura</strong> (passkey), o Usuário cadastra no próprio celular uma chave criptográfica que <strong>nunca sai do aparelho</strong> e só é usada após confirmação por biometria ou PIN. O Sistema guarda apenas a parte pública dessa chave. Para transparência, fica registrado o que esse mecanismo comprova e o que não comprova: ele comprova que a assinatura foi feita com a chave cadastrada pelo Usuário e liberada pela verificação dele no aparelho; <strong>não</strong> comprova qual aparelho físico foi usado (celulares sincronizam essa chave entre os dispositivos da mesma conta) nem substitui o certificado ICP-Brasil da modalidade qualificada. Perdido o celular, o Usuário solicita a revogação e cadastra nova chave — a revogação é registrada em auditoria e não afeta documentos já assinados.</p>

<h3>3. Dados pessoais (LGPD)</h3>
<p><strong>3.1.</strong> O tratamento de dados pelo Sistema tem por base o <strong>cumprimento de obrigação legal e o exercício regular de competências da PCCE</strong> (art. 7º, II e III, e art. 23 da Lei nº 13.709/2018 — LGPD), e não depende de consentimento, por se tratar de atividade funcional obrigatória.</p>
<p><strong>3.2.</strong> Para gerir as escalas e comprovar as assinaturas, o Sistema trata: nome, matrícula e CPF; e-mail (funcional e, se informado, pessoal, usado apenas para acesso e recuperação de senha); endereço IP; dispositivo/navegador; rubrica e, quando exigidas, fotografia com prova de vida, geolocalização e a <strong>parte pública da chave de assinatura</strong> do aparelho com seu identificador (nunca a parte privada, que permanece no celular); além dos dados técnicos da assinatura (hash SHA-256, estrutura criptográfica, data/hora e carimbo de tempo).</p>
<p><strong>3.3.</strong> A finalidade é exclusivamente administrativa e de auditoria. Os dados são retidos pelo prazo mínimo de 5 (cinco) anos a contar da assinatura (Decreto nº 10.278/2020 e art. 16 da LGPD) e não são compartilhados com terceiros nem usados para fins comerciais.</p>
<p><strong>3.4.</strong> O Usuário pode exercer os direitos do art. 18 da LGPD junto ao <strong>Encarregado de Dados (DPO)</strong> da PCCE pelo e-mail <strong>dpis@pc.ce.gov.br</strong>. Detalhes em <a href="/termo/dpo">/termo/dpo</a>.</p>

<h3>4. Deveres do Usuário</h3>
<ul>
	<li>Manter sob guarda exclusiva sua senha, token criptográfico, <strong>chave de assinatura do aparelho</strong> e dispositivos de acesso;</li>
	<li>Manter bloqueio de tela com biometria ou PIN no celular em que cadastrar a chave de assinatura, e <strong>solicitar a revogação imediata</strong> em caso de perda, furto ou troca do aparelho;</li>
	<li>Não compartilhar credenciais, sob pena de responder pessoalmente pelas assinaturas geradas com elas;</li>
	<li>Comunicar de imediato à Corregedoria-Geral da PCCE qualquer suspeita de uso indevido de suas credenciais.</li>
</ul>

<h3>5. Acesso por órgãos de controle</h3>
<p><strong>5.1.</strong> Os registros e dados de auditoria (IP, geolocalização, dispositivo, data/hora e hash) podem ser acessados, mediante requisição formal, pela Corregedoria-Geral da PCCE e pelos órgãos de controle interno e externo (Ministério Público, Poder Judiciário e Tribunal de Contas do Estado do Ceará), nos termos da lei.</p>

<h3>6. Atualizações deste termo</h3>
<p><strong>6.1.</strong> Este termo pode ser atualizado por alteração legal, técnica ou operacional; a nova versão exigirá novo aceite no próximo acesso. A versão vigente fica sempre acessível em <code>/termo/${VERSAO}</code> e as anteriores são preservadas para auditoria.</p>

<h3>7. Aceite</h3>
<p>Ao clicar em <strong>“Li e aceito”</strong>, o Usuário declara ciência e concordância com este termo e <strong>aceita expressamente a assinatura eletrônica avançada do Sistema como equivalente à sua assinatura manuscrita</strong>, nos termos da cláusula 2.3. O aceite registra a data/hora, o endereço IP e o dispositivo utilizados.</p>
`;

let _hashCache: string | null = null;

/**
 * Hash SHA-256 do conteúdo (versão + corpo) — usado para detectar
 * que o usuário aceitou EXATAMENTE este texto. Se o conteúdo mudar
 * sem bumpar a versão, o hash muda e o aceite anterior é considerado
 * obsoleto (defesa contra adulteração silenciosa).
 */
export async function calcularHashTermo(): Promise<string> {
	if (_hashCache) return _hashCache;
	const payload = `v${VERSAO}\n${VIGENTE_DESDE}\n${CONTEUDO_HTML}`;
	_hashCache = await sha256Hex(payload);
	return _hashCache;
}
