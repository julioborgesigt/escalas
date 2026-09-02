-- A REGIÃO METROPOLITANA de cada município do Ceará.
--
-- Gerado por `node scripts/gerar-regioes-metropolitanas.mjs` — não edite à mão.
-- Fonte: IBGE (`/localidades/estados/23/regioes-metropolitanas`), a mesma de
-- onde saem os nomes em `municipios`. Chaveado por CÓDIGO, nunca por nome.
--
-- Serve à vedação do Decreto nº 35.922/2024, art. 4º, §1º, II: deslocamento
-- DENTRO da mesma região metropolitana, até 120 km e sem extrapolação de
-- jornada, não gera diária. As três condições precisam ocorrer juntas, e a
-- terceira depende de horário — por isso o código ALERTA em vez de bloquear
-- (ver `alertasDaViagem` em `$lib/diarias/vedacoes`).
--
-- NULL é o estado da maioria: dos 184 municípios do Ceará, 46 estão em alguma
-- região. Fora delas a vedação não tem como se aplicar.
ALTER TABLE `municipios` ADD COLUMN `regiao_metropolitana` text;
--> statement-breakpoint
-- Região Metropolitana de Sobral — 18 municípios:
-- Alcântaras, Cariré, Coreaú, Forquilha, Frecheirinha, Graça, Groaíras, Massapê, Meruoca, Moraújo, Mucambo, Pacujá, Pires Ferreira, Reriutaba, Santana do Acaraú, Senador Sá, Sobral, Varjota.
UPDATE `municipios` SET `regiao_metropolitana` = 'RMS'
 WHERE `ibge` IN ('2300507','2303105','2304004','2304350','2304509','2304657','2304905','2308005','2308203','2308807','2309003','2309904','2310951','2311702','2312007','2312809','2312908','2313955');
--> statement-breakpoint
-- Região Metropolitana de Fortaleza — 19 municípios:
-- Aquiraz, Cascavel, Caucaia, Chorozinho, Eusébio, Fortaleza, Guaiúba, Horizonte, Itaitinga, Maracanaú, Maranguape, Pacajus, Pacatuba, Paracuru, Paraipaba, Pindoretama, São Gonçalo do Amarante, São Luís do Curu, Trairi.
UPDATE `municipios` SET `regiao_metropolitana` = 'RMF'
 WHERE `ibge` IN ('2301000','2303501','2303709','2303956','2304285','2304400','2304954','2305233','2306256','2307650','2307700','2309607','2309706','2310209','2310258','2310852','2312403','2312601','2313500');
--> statement-breakpoint
-- Região Metropolitana do Cariri — 9 municípios:
-- Barbalha, Caririaçu, Crato, Farias Brito, Jardim, Juazeiro do Norte, Missão Velha, Nova Olinda, Santana do Cariri.
UPDATE `municipios` SET `regiao_metropolitana` = 'RMC'
 WHERE `ibge` IN ('2301901','2303204','2304202','2304301','2307106','2307304','2308401','2309201','2312106');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_municipios_rm` ON `municipios` (`regiao_metropolitana`);
