-- ============================================================================
-- Mii Plaza — accountless badge ecosystem
-- ============================================================================
-- Run this in the Supabase SQL editor (or `supabase db push`) once per project.
-- It is written to be idempotent so re-running is safe.
--
-- Identity model: there are no user accounts. A row in `miis` is claimed by
-- whoever holds a signed JWT naming its id, delivered as an HTTP-only cookie.
-- Email is the uniqueness key (one Mii per person) and the recovery channel,
-- never a login credential.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- miis
-- ---------------------------------------------------------------------------
create table if not exists public.miis (
  id         uuid        primary key default gen_random_uuid(),
  email      text        not null,
  name       text        not null,
  mii_data   jsonb       not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One Mii per person. Case/whitespace folded so Gage@x.com == gage@x.com.
create unique index if not exists miis_email_key
  on public.miis (lower(btrim(email)));

create index if not exists miis_created_at_idx
  on public.miis (created_at);

-- Keep updated_at honest without trusting the client.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists miis_touch_updated_at on public.miis;
create trigger miis_touch_updated_at
  before update on public.miis
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Magic links (single-use, short-lived cookie recovery)
-- ---------------------------------------------------------------------------
-- Only the SHA-256 of the token is stored, so a database leak cannot be
-- replayed into a session.
create table if not exists public.mii_magic_links (
  token_hash text        primary key,
  mii_id     uuid        not null references public.miis (id) on delete cascade,
  email      text        not null,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists mii_magic_links_mii_id_idx
  on public.mii_magic_links (mii_id);

create index if not exists mii_magic_links_expires_at_idx
  on public.mii_magic_links (expires_at);

-- ---------------------------------------------------------------------------
-- Rate limiting (fixed window per IP)
-- ---------------------------------------------------------------------------
-- ip_hash is a salted digest, so the table holds no raw addresses.
create table if not exists public.mii_rate_limits (
  bucket     text        primary key,
  hits       integer     not null default 0,
  expires_at timestamptz not null
);

-- Atomic increment: returns the running count for the current window so the
-- API never has to read-then-write and race itself under concurrency.
create or replace function public.bump_rate_limit(
  p_bucket      text,
  p_window_secs integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits integer;
begin
  delete from public.mii_rate_limits where expires_at < now();

  insert into public.mii_rate_limits (bucket, hits, expires_at)
  values (p_bucket, 1, now() + make_interval(secs => p_window_secs))
  on conflict (bucket) do update
    set hits = case
                 when public.mii_rate_limits.expires_at < now() then 1
                 else public.mii_rate_limits.hits + 1
               end,
        expires_at = case
                       when public.mii_rate_limits.expires_at < now()
                         then now() + make_interval(secs => p_window_secs)
                       else public.mii_rate_limits.expires_at
                     end
  returning hits into v_hits;

  return v_hits;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.miis            enable row level security;
alter table public.mii_magic_links enable row level security;
alter table public.mii_rate_limits enable row level security;

-- The browser reads the plaza directly (and subscribes to Realtime, which
-- authorizes against these same policies). Writes always go through the API
-- with the service role, which bypasses RLS entirely.
drop policy if exists "plaza is publicly readable" on public.miis;
create policy "plaza is publicly readable"
  on public.miis for select
  to anon, authenticated
  using (true);

-- No anon/authenticated policies on the support tables: they are service-role
-- only, and RLS with zero policies denies everything by default.

-- ---------------------------------------------------------------------------
-- Column privileges — this is what actually keeps email private
-- ---------------------------------------------------------------------------
-- RLS filters rows, not columns. Granting per-column SELECT is what stops an
-- anonymous client from reading email out of `miis` with a crafted query.
revoke all on public.miis from anon, authenticated;
grant select (id, name, mii_data, created_at, updated_at)
  on public.miis to anon, authenticated;

revoke all on public.mii_magic_links from anon, authenticated;
revoke all on public.mii_rate_limits from anon, authenticated;
revoke all on function public.bump_rate_limit(text, integer) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
-- Publish only the public columns so email never rides along in a Realtime
-- payload. Column lists in publications need PG15+; fall back to the whole
-- table (still email-safe for direct queries thanks to the grants above).
do $$
begin
  begin
    alter publication supabase_realtime drop table public.miis;
  exception
    when undefined_object then null;
    when others then null;
  end;

  begin
    alter publication supabase_realtime
      add table public.miis (id, name, mii_data, created_at, updated_at);
  exception
    when others then
      begin
        alter publication supabase_realtime add table public.miis;
      exception when others then null;
      end;
  end;
end;
$$;

-- DELETE payloads only carry the primary key unless the replica identity is
-- widened; id is all the client needs to animate someone out.
alter table public.miis replica identity default;

-- ---------------------------------------------------------------------------
-- Storage: public bucket for rendered Mii previews (badge + email artwork)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('mii-previews', 'mii-previews', true)
on conflict (id) do update set public = true;

drop policy if exists "mii previews are publicly readable" on storage.objects;
create policy "mii previews are publicly readable"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'mii-previews');
