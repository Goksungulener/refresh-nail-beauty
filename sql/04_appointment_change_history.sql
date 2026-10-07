-- Randevu değişiklik geçmişi. Supabase SQL Editor'de bir kez çalıştırın.
create extension if not exists btree_gist;

alter table public.appointments
  add column if not exists staff_name text not null default '';

alter table public.appointments
  add column if not exists staff_key text generated always as (lower(btrim(staff_name))) stored;

-- Aynı personelin saatleri çakışamaz; farklı personeller paralel çalışabilir.
alter table public.appointments drop constraint if exists no_overlapping_appts;
alter table public.appointments
  add constraint no_overlapping_appts
  exclude using gist (staff_key with =, appt_range with &&)
  where (status <> 'cancelled');

create table if not exists public.appointment_change_history (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id) on delete set null,
  old_record jsonb not null,
  new_record jsonb not null
);

alter table public.appointment_change_history enable row level security;

drop policy if exists owner_read_appointment_change_history on public.appointment_change_history;
create policy owner_read_appointment_change_history
  on public.appointment_change_history
  for select to authenticated
  using (true);

grant select on public.appointment_change_history to authenticated;
revoke all on public.appointment_change_history from anon;

create or replace function public.log_appointment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (to_jsonb(old) - 'appt_range' - 'staff_key') is distinct from (to_jsonb(new) - 'appt_range' - 'staff_key') then
    insert into public.appointment_change_history (
      appointment_id, changed_by, old_record, new_record
    ) values (
      new.id,
      auth.uid(),
      to_jsonb(old) - 'appt_range' - 'staff_key',
      to_jsonb(new) - 'appt_range' - 'staff_key'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_appointment_change on public.appointments;
create trigger trg_log_appointment_change
  after update on public.appointments
  for each row execute function public.log_appointment_change();