-- 006_audit.sql
create table audit_log (
  id          bigserial primary key,
  owner_id    uuid references profiles(id) on delete set null,
  action      text not null,
  resource    text not null,
  resource_id uuid,
  ip_address  inet,
  user_agent  text,
  occurred_at timestamptz not null default now()
);
create index audit_owner_time_idx on audit_log(owner_id, occurred_at desc);
