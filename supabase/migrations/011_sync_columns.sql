-- 011_sync_columns.sql
--
-- Clock-skew diagnostics for sync (§7.5, step 9 HAZARD 1).
--
-- NUMBERING: the v1.3 correction took 009 for the auth/facilities change and
-- step 5 took 010 for auth_rate_limits, so step 9's sync columns land at 011.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY BOTH TIMESTAMPS
-- ─────────────────────────────────────────────────────────────────────────────
-- §7.5 resolves conflicts by comparing `client_updated_at`, which comes from the
-- DEVICE clock. A phone set two years fast wins every conflict it ever enters,
-- permanently. One set slow loses every one. Both look identical to the user —
-- "my changes keep disappearing" — and neither leaves a trace anywhere.
--
-- Last-write-wins still compares client_updated_at, because that is the only
-- value that reflects the order the user actually did things in. But recording
-- when the SERVER received each write makes the skew visible afterwards: a row
-- whose client time is wildly out of step with its receipt time is the evidence
-- that would otherwise not exist.

alter table persons     add column server_received_at timestamptz not null default now();
alter table allergies   add column server_received_at timestamptz not null default now();
alter table conditions  add column server_received_at timestamptz not null default now();
alter table medications add column server_received_at timestamptz not null default now();

-- Supports "show me rows whose client clock disagreed with ours", which is the
-- query someone runs when a user reports vanishing edits.
create index persons_skew_idx     on persons     (server_received_at, updated_at);
create index allergies_skew_idx   on allergies   (server_received_at, updated_at);
create index conditions_skew_idx  on conditions  (server_received_at, updated_at);
create index medications_skew_idx on medications (server_received_at, updated_at);
