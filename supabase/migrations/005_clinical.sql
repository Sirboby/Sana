-- 005_clinical.sql
create table allergies (
  id              uuid primary key,
  person_id       uuid not null references persons(id) on delete cascade,
  owner_id        uuid not null references profiles(id) on delete cascade,
  allergen_type   allergen_type not null,
  allergen_code   text,
  allergen_label  text not null,
  drug_classes    text[] not null default '{}',
  severity        severity_level not null,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index allergies_person_idx on allergies(person_id) where deleted_at is null;

create table conditions (
  id              uuid primary key,
  person_id       uuid not null references persons(id) on delete cascade,
  owner_id        uuid not null references profiles(id) on delete cascade,
  condition_code  text,
  condition_label text not null,
  onset_date      date,
  is_active       boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index conditions_person_idx on conditions(person_id) where deleted_at is null;

create table medications (
  id            uuid primary key,
  person_id     uuid not null references persons(id) on delete cascade,
  owner_id      uuid not null references profiles(id) on delete cascade,
  drug_id       uuid references drug_catalog(id),
  is_custom     boolean not null default false,
  display_name  text not null,
  dose_amount   numeric(10,3),
  dose_unit     text,
  schedule      jsonb not null default '{}'::jsonb,
  start_date    date not null,
  end_date      date,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index medications_person_idx on medications(person_id) where deleted_at is null;
create index medications_active_idx on medications(person_id)
  where deleted_at is null and end_date is null;

create table clinical_events (
  id                uuid primary key,
  person_id         uuid not null references persons(id) on delete cascade,
  owner_id          uuid not null references profiles(id) on delete cascade,
  event_type        event_type not null,
  occurred_at       timestamptz not null,
  recorded_at       timestamptz not null default now(),
  payload           jsonb not null,
  rulepack_version  text,
  ruleset_checksum  text,
  client_id         text not null,
  corrects_event_id uuid references clinical_events(id),
  deleted_at        timestamptz,
  created_at        timestamptz not null default now()
);
create index events_person_time_idx on clinical_events(person_id, occurred_at desc)
  where deleted_at is null;
create index events_type_idx on clinical_events(person_id, event_type, occurred_at desc);
create index events_sync_idx on clinical_events(owner_id, created_at);

create table user_facilities (
  id             uuid primary key,
  owner_id       uuid not null references profiles(id) on delete cascade,
  facility_id    uuid references facilities(id),
  label          text not null,
  phone_number   text,
  address        text,
  is_emergency   boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index user_facilities_owner_idx on user_facilities(owner_id)
  where deleted_at is null;
