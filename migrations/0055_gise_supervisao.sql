ALTER TABLE `gise_escalas` ADD `assessor_id` integer;
ALTER TABLE `gise_escalas` ADD `seint1_id` integer;
ALTER TABLE `gise_escalas` ADD `seint2_id` integer;
CREATE INDEX `idx_gise_escalas_assessor` ON `gise_escalas` (`assessor_id`);
CREATE INDEX `idx_gise_escalas_seint1` ON `gise_escalas` (`seint1_id`);
CREATE INDEX `idx_gise_escalas_seint2` ON `gise_escalas` (`seint2_id`);
