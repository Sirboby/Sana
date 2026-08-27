-- 003_reference.sql
create table drug_catalog (
  id                 uuid primary key,
  rxnorm_cui         text,
  nafdac_reg_no      text,
  generic_name       text not null,
  brand_names        text[] not null default '{}',
  active_ingredients jsonb not null,
  drug_classes       text[] not null default '{}',
  dosage_form        text,
  is_otc             boolean not null default false,
  region             text not null default 'NG',
  updated_at         timestamptz not null default now()
);
create index drug_generic_trgm on drug_catalog using gin (generic_name gin_trgm_ops);
create index drug_brands_idx    on drug_catalog using gin (brand_names);
create index drug_classes_idx   on drug_catalog using gin (drug_classes);

create table drug_interactions (
  id             uuid primary key,
  class_a        text not null,
  class_b        text not null,
  severity       text not null,
  mechanism      text not null,
  recommendation text not null,
  source         text not null,
  evidence_url   text,
  updated_at     timestamptz not null default now(),
  unique (class_a, class_b)
);

create table allergy_cross_reference (
  id               uuid primary key,
  allergen_class   text not null,
  reactive_class   text not null,
  risk_level       text not null,
  note             text not null,
  source           text not null,
  unique (allergen_class, reactive_class)
);

create table condition_contraindications (
  id              uuid primary key,
  condition_code  text not null,
  drug_class      text not null,
  severity        text not null,
  explanation     text not null,
  source          text not null,
  unique (condition_code, drug_class)
);

create table facilities (
  id             uuid primary key,
  facility_type  facility_type not null,
  name           text not null,
  address        text not null,
  state          text not null,
  lga            text not null,
  latitude       numeric(9,6) not null,
  longitude      numeric(9,6) not null,
  phone_numbers  text[] not null default '{}',
  has_emergency  boolean not null default false,
  is_24_hours    boolean not null default false,
  opening_hours  jsonb,
  verified_at    date not null,
  verified_by    text not null,
  source         text not null,
  region         text not null default 'NG',
  updated_at     timestamptz not null default now()
);
create index facilities_state_idx on facilities(state, lga);
create index facilities_type_idx  on facilities(facility_type);
create index facilities_emerg_idx on facilities(state) where has_emergency = true;

create table rulepacks (
  id            uuid primary key,
  version       text unique not null,
  checksum      text not null,
  content       jsonb not null,
  review_status text not null default 'draft',
  reviewed_by   text,
  reviewed_at   timestamptz,
  published_at  timestamptz,
  created_at    timestamptz not null default now()
);
