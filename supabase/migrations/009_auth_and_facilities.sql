-- 009_auth_and_facilities.sql
--
-- PRD v1.3: authentication moves from phone-primary to email-primary
-- (§4 US-1.1, §6.1 profiles). Phone becomes an optional recovery channel and is
-- never a login method (AC-1.4.3).
--
-- SCOPE NOTE — why this migration contains no facilities DDL despite its name:
-- the facilities half of the v1.3 correction was already delivered by step 2 and
-- is live in the committed migrations. Re-creating any of it here would fail on
-- `create type`/`create table` already existing. Specifically:
--   * facility_type enum                    -> 002_enums.sql
--   * facilities + its three indexes        -> 003_reference.sql
--   * user_facilities + its index           -> 005_clinical.sql
--   * RLS: owner_all on user_facilities,
--          ref_read on facilities, no write -> 008_rls.sql
-- No server table exists for discovered facilities, and none is created here:
-- per §5.5 and §6.4 those are a device-local Dexie cache that never syncs.

-- ── profiles: add email, nullable first so existing rows can be backfilled ──
alter table profiles add column email text;
alter table profiles add column phone_verified_at timestamptz;

-- Backfill. `.invalid` is reserved by RFC 2606 and can never be deliverable, so
-- a placeholder can never collide with, or be mistaken for, a real address.
-- At the time this migration was written no Sana database had ever been created,
-- so in practice this backfills zero rows on a clean `supabase db reset`. The
-- notice exists so that if it ever does touch rows, that fact is visible in the
-- migration output rather than silent.
do $$
declare
  backfilled int;
begin
  update profiles
     set email = 'placeholder+' || id::text || '@sana.invalid'
   where email is null;

  get diagnostics backfilled = row_count;

  if backfilled > 0 then
    raise notice
      '009: backfilled % profiles row(s) with placeholder emails. If this database ever held real users, those rows now carry unusable addresses and must be reconciled.',
      backfilled;
  end if;
end $$;

alter table profiles alter column email set not null;
alter table profiles add constraint profiles_email_key unique (email);

-- ── phone: demoted to an optional recovery channel ──
-- The unique constraint is deliberately KEPT. Postgres treats NULLs as distinct
-- in a unique index, so many profiles may have no phone while any phone that is
-- present remains unique.
alter table profiles alter column phone drop not null;
