-- ═══════════════════════════════════════════════════════════════
-- eCom Tracking System — Supabase SQL Schema
-- ═══════════════════════════════════════════════════════════════
-- Pokreni ovo u Supabase SQL Editor-u (SQL Editor → New query)
-- Posle kreiranja tabele, omoguci Realtime za app_state
-- ═══════════════════════════════════════════════════════════════

-- 1. Glavna tabela — svi podaci aplikacije u jednom JSONB redu
create table if not exists public.app_state (
  id text primary key default 'main',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone default now()
);

-- 2. Ubaci inicijalni red
insert into public.app_state (id, data)
values ('main', '{"orders":[],"finances":[],"inventory":[],"history":[],"models":[],"costs":[],"adSpend":[]}'::jsonb)
on conflict (id) do nothing;

-- 3. Omoguci Row Level Security, ali sa politikama koje dozvoljavaju pristup
alter table public.app_state enable row level security;

-- 4. Politika koja dozvoljava svima da citaju i pisu (za anon key)
-- NAPOMENA: Ovo je jednostavna konfiguracija. U produkciji razmisli o pravljenju
-- Supabase korisnika i uvodjenju autentifikacije.
drop policy if exists "Allow all access" on public.app_state;
create policy "Allow all access" on public.app_state
  for all using (true) with check (true);

-- 5. Omoguci Realtime na tabeli
alter publication supabase_realtime add table public.app_state;

-- ═══════════════════════════════════════════════════════════════
-- GOTOVO! Sada mozes da koristis SUPABASE_URL i SUPABASE_ANON_KEY
-- iz Supabase Dashboard-a (Settings → API) u Vercel-u kao env variables.
-- ═══════════════════════════════════════════════════════════════
