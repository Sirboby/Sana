-- 010_auth_rate_limits.sql
--
-- Server-side rate limiting for one-time-code requests (AC-1.1.5).
--
-- NUMBERING NOTE: the v1.3 correction reserved 010 for step 9's sync columns.
-- Step 5 needed a migration first, so step 9's becomes 011.
--
-- WHY A TABLE RATHER THAN IN-MEMORY: AC-1.1.5 requires the limit to be enforced
-- server-side, and the server is serverless. An in-process counter resets on
-- every cold start and is not shared between concurrent instances, so it would
-- enforce nothing while appearing to work. Durable shared state is the only
-- thing that actually limits anything here.

create table auth_rate_limits (
  id              uuid primary key,
  -- SHA-256 of the normalised identifier, never the identifier itself.
  -- This table would otherwise become a second register of every email address
  -- that ever touched the service, including addresses that never completed
  -- signup. A hash rate-limits just as well and records nothing about who.
  identifier_hash text not null,
  -- 'email_otp' | 'sms_otp' — kept as text so a new channel needs no migration.
  kind            text not null,
  requested_at    timestamptz not null default now()
);

-- The lookup is always "how many requests for this identifier since T".
create index auth_rate_limits_lookup_idx
  on auth_rate_limits (identifier_hash, kind, requested_at desc);

-- Supports reaping rows past the window.
create index auth_rate_limits_reap_idx on auth_rate_limits (requested_at);

-- RLS on with NO policy: deny-by-default for anon and authenticated. Only the
-- service role, which bypasses RLS, may read or write this. A client that could
-- read it would learn which addresses have accounts; one that could write it
-- could clear its own limit.
alter table auth_rate_limits enable row level security;
revoke all on auth_rate_limits from anon, authenticated;
