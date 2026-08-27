-- supabase/seed/seed.sql
-- Test Users A and B
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at, phone, phone_confirmed_at, phone_change, phone_change_token, email_change, email_change_token_new, email_change_token_current, email_change_confirm_status, banned_until, reauthentication_token, reauthentication_sent_at, is_sso_user, deleted_at)
values
  ('aaaaaaaa-aaaa-4aaa-baaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'usera@example.com', crypt('password123', gen_salt('bf')), now(), null, now(), '{"provider":"email","providers":["email"]}', '{}', false, now(), now(), '+2348011111111', now(), '', '', '', '', '', 0, null, '', null, false, null),
  ('bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'userb@example.com', crypt('password123', gen_salt('bf')), now(), null, now(), '{"provider":"email","providers":["email"]}', '{}', false, now(), now(), '+2348022222222', now(), '', '', '', '', '', 0, null, '', null, false, null)
on conflict (id) do nothing;

insert into profiles (id, phone, display_name)
values
  ('aaaaaaaa-aaaa-4aaa-baaa-aaaaaaaaaaaa', '+2348011111111', 'Test User A'),
  ('bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', '+2348022222222', 'Test User B')
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
