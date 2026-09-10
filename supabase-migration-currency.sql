-- One-time migration: replace the `who` column with multi-currency support.
-- Run this in the Supabase SQL Editor if you already created the `expenses`
-- table with the original schema. Safe to run once.

alter table expenses add column if not exists original_amount numeric;
alter table expenses add column if not exists currency text not null default 'ILS';
alter table expenses add column if not exists rate numeric not null default 1;

-- Backfill existing rows: they were all entered in ILS.
update expenses set original_amount = amount where original_amount is null;

alter table expenses drop column if exists who;
