-- AI Boş Saat Doldur: aynı müşteri/slot/personel için tekrar iletişim önerisini önler.
create table if not exists public.appointment_gap_contacts (
  id uuid primary key default gen_random_uuid(),
  slot_date date not null,
  slot_time time not null,
  staff_key text not null default '',
  phone_key text not null,
  customer_name text not null,
  service_name text not null,
  contacted_at timestamptz not null default now(),
  contacted_by uuid references auth.users(id) on delete set null,
  constraint appointment_gap_contacts_unique_contact
    unique (slot_date, slot_time, staff_key, phone_key)
);

create index if not exists appointment_gap_contacts_slot_idx
  on public.appointment_gap_contacts (slot_date, slot_time, staff_key);

alter table public.appointment_gap_contacts enable row level security;

drop policy if exists owner_read_appointment_gap_contacts on public.appointment_gap_contacts;
create policy owner_read_appointment_gap_contacts
  on public.appointment_gap_contacts
  for select to authenticated
  using (true);

drop policy if exists owner_insert_appointment_gap_contacts on public.appointment_gap_contacts;
create policy owner_insert_appointment_gap_contacts
  on public.appointment_gap_contacts
  for insert to authenticated
  with check (true);

revoke all on public.appointment_gap_contacts from anon;
grant select, insert on public.appointment_gap_contacts to authenticated;