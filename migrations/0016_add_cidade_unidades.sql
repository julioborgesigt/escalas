-- Migration: 0016_add_cidade_unidades
ALTER TABLE unidades ADD COLUMN cidade TEXT NOT NULL DEFAULT '';
