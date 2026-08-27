-- supabase/seed/seed.sql
--
-- Fixture data. Exists to prove RLS isolation, not to seed real data — the real
-- catalog arrives in step 6.
--
-- DESTRUCTIVE-TEST TARGET: tests/unit/rls.test.ts deletes and re-inserts rows
-- keyed to these fixtures on every run. Never apply this to a database holding
-- real users.
--
-- `crypt()` and `gen_salt()` come from pgcrypto, which sits in different schemas
-- depending on where this runs: local Supabase creates it in `public` via
-- 001_extensions.sql, while hosted Supabase ships it pre-installed in
-- `extensions`. Naming both keeps this file portable across the two.
set search_path = public, extensions;

-- Test Users A and B.
--
-- NOTE ON THE TOKEN COLUMNS: GoTrue scans confirmation_token, recovery_token and
-- their siblings into NON-NULLABLE Go strings. auth.users leaves them nullable,
-- so a hand-inserted row that omits any of them makes every subsequent auth
-- query fail with the opaque error "Database error querying schema" — including
-- sign-in, and for all users, not just the malformed one. They must be '', never
-- NULL. This is the price of inserting into auth.users directly; the alternative
-- is the Auth admin API, which cannot assign the fixed UUIDs the RLS test needs.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at, phone, phone_confirmed_at, confirmation_token, recovery_token, phone_change, phone_change_token, email_change, email_change_token_new, email_change_token_current, email_change_confirm_status, banned_until, reauthentication_token, reauthentication_sent_at, is_sso_user, deleted_at)
values
  ('aaaaaaaa-aaaa-4aaa-baaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'usera@example.com', crypt('password123', gen_salt('bf')), now(), null, now(), '{"provider":"email","providers":["email"]}', '{}', false, now(), now(), '+2348011111111', now(), '', '', '', '', '', '', '', 0, null, '', null, false, null),
  ('bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'userb@example.com', crypt('password123', gen_salt('bf')), now(), null, now(), '{"provider":"email","providers":["email"]}', '{}', false, now(), now(), '+2348022222222', now(), '', '', '', '', '', '', '', 0, null, '', null, false, null)
on conflict (id) do nothing;

-- Repair databases seeded before the token columns were included above. The
-- INSERT uses `on conflict do nothing`, so it will not correct rows that already
-- exist with NULLs in place. Scoped to the two fixture users by id so it can
-- never touch a real account.
update auth.users
   set confirmation_token         = coalesce(confirmation_token, ''),
       recovery_token             = coalesce(recovery_token, ''),
       email_change               = coalesce(email_change, ''),
       email_change_token_new     = coalesce(email_change_token_new, ''),
       email_change_token_current = coalesce(email_change_token_current, ''),
       phone_change               = coalesce(phone_change, ''),
       phone_change_token         = coalesce(phone_change_token, ''),
       reauthentication_token     = coalesce(reauthentication_token, '')
 where id in (
   'aaaaaaaa-aaaa-4aaa-baaa-aaaaaaaaaaaa',
   'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'
 );

-- Email is the login identifier since PRD v1.3; phone is recovery only.
insert into profiles (id, email, phone, phone_verified_at, display_name)
values
  ('aaaaaaaa-aaaa-4aaa-baaa-aaaaaaaaaaaa', 'usera@example.com', '+2348011111111', now(), 'Test User A'),
  ('bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', 'userb@example.com', null, null, 'Test User B')
on conflict (id) do nothing;

insert into persons (id, owner_id, display_name, relationship, sex_at_birth)
values
  ('11111111-1111-4111-a111-111111111111', 'aaaaaaaa-aaaa-4aaa-baaa-aaaaaaaaaaaa', 'User A Person', 'self', 'female'),
  ('22222222-2222-4222-b222-222222222222', 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', 'User B Person', 'self', 'male')
on conflict (id) do nothing;

insert into drug_catalog (id, generic_name, brand_names, active_ingredients, drug_classes, is_otc)
values
  ('d1111111-1111-4111-a111-111111111111', 'Paracetamol', array['Panadol', 'Emzor Paracetamol'], '[{"code":"PAR01","name":"Paracetamol","strength":"500","unit":"mg"}]'::jsonb, array['Analgesics', 'Antipyretics'], true),
  ('d2222222-2222-4222-a222-222222222222', 'Amoxicillin', array['Amoxil'], '[{"code":"AMX01","name":"Amoxicillin","strength":"500","unit":"mg"}]'::jsonb, array['Penicillins', 'Beta-lactam Antibiotics'], false),
  ('d3333333-3333-4333-a333-333333333333', 'Ibuprofen', array['Nurofen', 'Advuk'], '[{"code":"IBU01","name":"Ibuprofen","strength":"400","unit":"mg"}]'::jsonb, array['NSAIDs'], true)
on conflict (id) do nothing;

-- Facility fixtures for later steps. DELIBERATELY FICTIONAL: these names,
-- addresses and numbers do not correspond to real places. A seeded facility that
-- looked real could send someone in crisis to a wrong address or make them dial
-- a stranger. The curated, human-verified dataset arrives in step 6.
-- verified_at is NOT NULL by design (§6.3) — an unverified facility on the
-- escalation screen is a safety defect, not a data-quality one.
insert into facilities (
  id, facility_type, name, address, state, lga, latitude, longitude,
  phone_numbers, has_emergency, is_24_hours, verified_at, verified_by, source
)
values
  ('f1111111-1111-4111-a111-111111111111', 'hospital',
   'Test Emergency Hospital (FIXTURE — NOT A REAL FACILITY)',
   '1 Test Road, Fixture District', 'Lagos', 'Ikeja',
   6.605874, 3.349149, array['+2348000000001'], true, true,
   date '2026-01-15', 'seed-fixture', 'test-fixture'),
  ('f2222222-2222-4222-a222-222222222222', 'pharmacy',
   'Test Pharmacy (FIXTURE — NOT A REAL FACILITY)',
   '2 Test Road, Fixture District', 'Lagos', 'Ikeja',
   6.601838, 3.351806, array['+2348000000002'], false, false,
   date '2026-01-15', 'seed-fixture', 'test-fixture')
on conflict (id) do nothing;
