-- 004_accounts.sql
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  phone         text unique not null,
  display_name  text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table persons (
  id             uuid primary key,
  owner_id       uuid not null references profiles(id) on delete cascade,
  display_name   text not null,
  relationship   text not null default 'self',
  date_of_birth  date,
  sex_at_birth   sex_at_birth not null default 'undisclosed',
  is_pregnant    boolean not null default false,
  weight_kg      numeric(5,2),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index persons_owner_idx on persons(owner_id) where deleted_at is null;

create table consents (
  id            uuid primary key,
  owner_id      uuid not null references profiles(id) on delete cascade,
  consent_type  text not null,
  version       text not null,
  granted_at    timestamptz not null,
  revoked_at    timestamptz,
  unique (owner_id, consent_type, version)
);
