-- 007_triggers.sql
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

create trigger persons_set_updated_at
  before update on persons
  for each row execute function set_updated_at();

create trigger allergies_set_updated_at
  before update on allergies
  for each row execute function set_updated_at();

create trigger conditions_set_updated_at
  before update on conditions
  for each row execute function set_updated_at();

create trigger medications_set_updated_at
  before update on medications
  for each row execute function set_updated_at();

create trigger user_facilities_set_updated_at
  before update on user_facilities
  for each row execute function set_updated_at();
