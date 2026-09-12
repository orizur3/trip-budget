-- One-time migration: support multi-day expenses (car rental, hotel...)
-- that get spread evenly across every day they cover.
-- Run this in the Supabase SQL Editor. Safe to run once.

alter table expenses add column if not exists end_date date;
