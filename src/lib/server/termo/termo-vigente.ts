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
 * 10.748/2021). Antes de entrar em produção, deve ser revisado e validado
 * pela assessoria jurídica da PCCE.
 */

export const VERSAO = '1.1';
export const VIGENTE_DESDE = '2026-05-15';

export const CONTEUDO_HTML = `
<h2>Termo de Uso e Política de Privacidade</h2>
<p class="subtitulo">Sistema de Gestão de Escalas — Polícia Civil do Estado do Ceará<br />
Versão ${VERSAO} — vigente desde ${VIGENTE_DESDE}</p>

<h3>1. Partes e objeto</h3>
<p><strong>1.1.</strong> Este termo é celebrado entre a <strong>Polícia Civil do Estado do Ceará (PCCE)</strong>, por intermédio da área responsável pelo Sistema de Gestão de Escalas (doravante “Sistema”), e o usuário cadastrado, identificado por matrícula funcional e CPF (doravante “Usuário”).</p>
<p><strong>1.2.</strong> O Sistema tem por objeto o gerenciamento de escalas de plantão, expediente e GISE (Grupo de Intervenção e Suporte Especializado), o registro de presença e a assinatura digital dos documentos correspondentes.</p>

<h3>2. Admissibilidade da assinatura eletrônica</h3>
<p><strong>2.1.</strong> O Usuário reconhece, nos termos do art. 4º, §1º, da Lei nº 14.063/2020, a admissibilidade das assinaturas eletrônicas geradas pelo Sistema, nas seguintes modalidades:</p>
<ul>
	<li><strong>Qualificada:</strong> com certificado digital ICP-Brasil (e-CPF), emitido por Autoridade Certificadora credenciada pela ITI;</li>
	<li><strong>Avançada:</strong> com biometria (selfie), rubrica gráfica, geolocalização (GPS) e endereço IP;</li>
	<li><strong>Simples:</strong> com confirmação textual e captura dos metadados de auditoria.</li>
</ul>
<p><strong>2.2.</strong> Tais assinaturas têm valor jurídico equivalente à manuscrita, conforme:</p>
<ul>
	<li>art. 10, §1º, da Medida Provisória nº 2.200-2/2001 — para a modalidade qualificada;</li>
	<li>art. 4º, II e art. 5º, II, da Lei nº 14.063/2020 — para a modalidade avançada.</li>
</ul>
<p><strong>2.3.</strong> O Usuário declara compreender que cada ato de assinatura no Sistema constitui manifestação inequívoca de vontade, atestando a autoria, a integridade e a tempestividade do documento assinado.</p>

<h3>3. Coleta e tratamento de dados pessoais (LGPD)</h3>
<p><strong>3.1.</strong> Para os fins exclusivos de comprovação e auditoria das assinaturas, com base no art. 7º, V, da Lei nº 13.709/2018 (LGPD), o Usuário <strong>consente</strong> com a coleta, o armazenamento e o tratamento dos seguintes dados:</p>
<ul>
	<li>Nome, matrícula funcional e CPF;</li>
	<li>E-mail pessoal, quando fornecido voluntariamente como canal de recuperação de senha;</li>
	<li>Endereço IP no momento da assinatura (anonimizado quando exibido em logs);</li>
	<li>Coordenadas geográficas (latitude e longitude, padrão WGS-84);</li>
	<li>Identificação do dispositivo e navegador (User-Agent);</li>
	<li>Rubrica gráfica e fotografia (selfie), quando aplicáveis à modalidade;</li>
	<li>Hash criptográfico (SHA-256) do documento assinado;</li>
	<li>Data e hora do servidor (UTC) e, quando emitido, carimbo de tempo qualificado da Autoridade de Carimbo do Tempo da ICP-Brasil (ACT-ICP).</li>
</ul>
<p><strong>3.2.</strong> A finalidade exclusiva do tratamento é a comprovação da autenticidade, integridade e autoria das assinaturas. Os dados são retidos por prazo mínimo de 5 (cinco) anos a contar da data da assinatura, conforme Decreto nº 10.748/2021 e art. 16 da LGPD.</p>
<p><strong>3.3.</strong> O Usuário poderá exercer os direitos previstos no art. 18 da LGPD (acesso, correção, anonimização, portabilidade, exclusão e oposição) mediante contato com o <strong>Encarregado de Dados (DPO)</strong> da PCCE pelo e-mail <strong>lgpd@pc.ce.gov.br</strong>, com o assunto “Direitos do Titular – LGPD”. O prazo de resposta é de 15 (quinze) dias úteis, prorrogável por igual período, conforme art. 18, §5º, da LGPD. Informações completas disponíveis em <a href="/termo/dpo">/termo/dpo</a>.</p>
<p><strong>3.4.</strong> O e-mail pessoal informado pelo Usuário é tratado exclusivamente para o envio de link de recuperação de senha e verificação de identidade, com base no legítimo interesse (art. 7º, IX, da LGPD). Não é compartilhado com terceiros nem utilizado para fins de marketing.</p>

<h3>4. Obrigações do Usuário</h3>
<p><strong>4.1.</strong> O Usuário obriga-se a:</p>
<ul>
	<li>Manter sob guarda exclusiva sua senha de acesso, token criptográfico (A1/A3) e dispositivos pessoais utilizados para acessar o Sistema;</li>
	<li>Não compartilhar credenciais de acesso, sob qualquer pretexto, sob pena de imputação pessoal de eventuais assinaturas indevidamente realizadas;</li>
	<li>Comunicar, de imediato, à Corregedoria-Geral da PCCE qualquer suspeita de comprometimento de credenciais;</li>
	<li>Não permitir que terceiros assinem documentos em seu nome, ainda que pretendam fazê-lo a serviço.</li>
</ul>

<h3>5. Auditoria e acesso por terceiros</h3>
<p><strong>5.1.</strong> Os registros de assinatura, incluindo dados de auditoria (IP, GPS, dispositivo, timestamp e hash), poderão ser acessados, mediante requisição formal e fundamentada, por:</p>
<ul>
	<li>Corregedoria-Geral da PCCE;</li>
	<li>Ministério Público do Estado do Ceará;</li>
	<li>Tribunal de Justiça do Estado do Ceará e demais órgãos do Poder Judiciário;</li>
	<li>Tribunal de Contas do Estado do Ceará;</li>
	<li>Outros órgãos de controle interno e externo, nos termos da legislação.</li>
</ul>

<h3>6. Atualizações deste termo</h3>
<p><strong>6.1.</strong> Em caso de alteração legislativa, técnica ou operacional, este termo poderá ser atualizado. A nova versão exigirá novo aceite expresso do Usuário na próxima sessão de acesso, com bloqueio do uso do Sistema até a manifestação de aceitação.</p>
<p><strong>6.2.</strong> A versão vigente fica permanentemente acessível em <code>/termo/${VERSAO}</code>; versões anteriores ficam preservadas para fins de auditoria.</p>

<h3>7. Responsabilidades</h3>
<p><strong>7.1.</strong> A PCCE compromete-se a empregar boas práticas técnicas para garantir a integridade e a disponibilidade do Sistema, incluindo:</p>
<ul>
	<li>Verificação criptográfica das assinaturas (CMS/PKCS#7);</li>
	<li>Validação da cadeia de confiança ICP-Brasil;</li>
	<li>Consulta a respostas OCSP (revogação) e seu armazenamento carimbado;</li>
	<li>Padrão PAdES-LT (Long-Term) para arquivamento auto-suficiente.</li>
</ul>
<p><strong>7.2.</strong> A PCCE não se responsabiliza por assinaturas indevidamente geradas em decorrência de comprometimento de credenciais do Usuário, ressalvada a hipótese de comunicação imediata nos termos da cláusula 4.</p>

<h3>8. Foro</h3>
<p><strong>8.1.</strong> As partes elegem o foro da Comarca de Fortaleza/CE para dirimir quaisquer questões oriunas deste termo, com renúncia expressa a qualquer outro, por mais privilegiado que seja.</p>

<h3>9. Manifestação de aceite</h3>
<p>Ao marcar as opções de aceite e clicar em <strong>“Aceitar e seguir”</strong>, o Usuário declara que:</p>
<ul>
	<li>leu integralmente o presente termo;</li>
	<li>compreendeu as obrigações e os direitos aqui estabelecidos;</li>
	<li>concorda livre e expressamente com seus termos.</li>
</ul>
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
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
	const arr = new Uint8Array(buf);
	_hashCache = Array.from(arr)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
	return _hashCache;
}
