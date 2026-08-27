-- 008_rls.sql
alter table profiles        enable row level security;
alter table persons         enable row level security;
alter table consents        enable row level security;
alter table allergies       enable row level security;
alter table conditions      enable row level security;
alter table medications     enable row level security;
alter table clinical_events enable row level security;
alter table user_facilities enable row level security;
alter table audit_log       enable row level security;

-- Owner-scoped policies for clinical & user tables
create policy owner_all on persons
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy owner_all on consents
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy owner_all on allergies
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy owner_all on conditions
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy owner_all on medications
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy owner_all on clinical_events
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy owner_all on user_facilities
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Self-profile policy
create policy self_profile on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

-- Append-only enforcement on clinical_events (UPDATE permitted only when deleted_at is set).
--
-- DEVIATION FROM PRD §6.2: the PRD declares this policy without `as restrictive`.
-- Postgres combines permissive policies with OR, so `owner_all` above (which is
-- `for all`, and therefore covers UPDATE) would on its own authorise an UPDATE
-- that leaves deleted_at NULL — silently defeating append-only. `as restrictive`
-- makes this policy AND with `owner_all`, so a tombstone is the only legal
-- mutation. Without this, step 2 assertion (e) cannot pass.
create policy events_no_mutation on clinical_events
  as restrictive
  for update using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and deleted_at is not null);

-- Audit log policies
create policy audit_insert on audit_log for insert with check (owner_id = auth.uid());
create policy audit_read   on audit_log for select using (owner_id = auth.uid());

-- Reference tables: read-only to authenticated users, no write policies
alter table drug_catalog                enable row level security;
alter table drug_interactions           enable row level security;
alter table allergy_cross_reference     enable row level security;
alter table condition_contraindications enable row level security;
alter table facilities                  enable row level security;
alter table rulepacks                   enable row level security;

create policy ref_read on drug_catalog
  for select to authenticated using (true);

create policy ref_read on drug_interactions
  for select to authenticated using (true);

create policy ref_read on allergy_cross_reference
  for select to authenticated using (true);

create policy ref_read on condition_contraindications
  for select to authenticated using (true);

create policy ref_read on facilities
  for select to authenticated using (true);

create policy ref_read on rulepacks
  for select to authenticated using (true);
