-- Run this once in the Supabase SQL Editor (Project > SQL Editor > New Query)

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  "desc" text not null,
  amount numeric not null check (amount > 0),
  date date not null,
  category text not null default 'אחר',
  who text,
  created_at timestamptz not null default now()
);

-- Allow the app's public anon key to read/write.
-- This is fine for a private trip-budget link shared only between two people.
-- Do NOT use this open policy for an app with sensitive or public data.
alter table expenses enable row level security;

create policy "Allow all reads" on expenses
  for select using (true);

create policy "Allow all inserts" on expenses
  for insert with check (true);

create policy "Allow all updates" on expenses
  for update using (true);

create policy "Allow all deletes" on expenses
  for delete using (true);

-- Enable realtime so both devices see updates live without refreshing.
alter publication supabase_realtime add table expenses;
