-- 002_enums.sql
create type sex_at_birth   as enum ('male','female','intersex','undisclosed');
create type allergen_type  as enum ('drug','food','environmental');
create type severity_level as enum ('mild','moderate','severe','anaphylaxis');
create type event_type     as enum (
  'medication_taken','medication_skipped','symptom_reported',
  'triage_completed','allergy_recorded','condition_recorded',
  'vital_recorded','note_added','correction'
);
create type urgency_band   as enum (
  'EMERGENCY','SEE_DOCTOR_TODAY','SEE_DOCTOR_SOON','SELF_CARE_REASONABLE'
);
create type facility_type  as enum (
  'hospital','clinic','pharmacy','diagnostic_centre'
);
