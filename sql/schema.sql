-- Nail Art Stüdyo Randevu Takvimi - Supabase şema kurulumu
-- Bu dosyayı Supabase projenizde SQL Editor'e yapıştırıp çalıştırın.
-- (Bu dosya sıfırdan kurulum içindir. Zaten schema.sql'i çalıştırdıysanız ve
--  sadece hizmet çeşitlerini eklemek istiyorsanız sql/02_add_services.sql'i kullanın.)

-- 1) Hizmetler
create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  duration_minutes int not null default 60,
  price numeric(10,2) not null default 0,
  is_active boolean not null default true,
  sort_order int not null default 0
);

insert into services (name, duration_minutes, price, sort_order) values
  ('Manikür', 45, 0, 1),
  ('Pedikür', 60, 0, 2),
  ('Protez Tırnak', 120, 0, 3),
  ('G5 Masajı', 45, 0, 4),
  ('Cilt Bakımı', 60, 0, 5),
  ('Hydrafacial', 60, 0, 6),
  ('Altın Oran Kaş Tasarımı', 30, 0, 7),
  ('Kirpik Lifting', 60, 0, 8)
on conflict do nothing;

-- 2) Randevular
create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  appt_date date not null,
  appt_time time not null,
  duration_minutes int not null default 60,
  service_id uuid references services(id) on delete set null,
  service_name text,
  service_price numeric(10,2),
  customer_name text not null,
  customer_phone text not null,
  note text,
  status text not null default 'pending' check (status in ('pending','confirmed','cancelled')),
  created_at timestamptz not null default now(),
  appt_range tsrange
);

-- Farklı sürelerdeki hizmetlerin (örn. 2 saatlik protez tırnak) çakışmasını önler
create or replace function appointments_set_range() returns trigger as $$
begin
  new.appt_range := tsrange(
    (new.appt_date + new.appt_time),
    (new.appt_date + new.appt_time + (new.duration_minutes * interval '1 minute'))
  );
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_appointments_set_range on appointments;
create trigger trg_appointments_set_range
  before insert or update on appointments
  for each row execute function appointments_set_range();

update appointments set appt_range = tsrange(
  (appt_date + appt_time),
  (appt_date + appt_time + (duration_minutes * interval '1 minute'))
);

alter table appointments drop constraint if exists no_overlapping_appts;
alter table appointments
  add constraint no_overlapping_appts
  exclude using gist (appt_range with &&)
  where (status <> 'cancelled');

-- 3) Haftalık çalışma saatleri şablonu (0=Pazar ... 6=Cumartesi)
create table if not exists working_hours (
  weekday int primary key check (weekday between 0 and 6),
  is_open boolean not null default true,
  start_time time,
  end_time time,
  slot_minutes int not null default 60
);

insert into working_hours (weekday, is_open, start_time, end_time, slot_minutes)
values
  (0, false, null, null, 60),
  (1, true, '10:00', '19:00', 60),
  (2, true, '10:00', '19:00', 60),
  (3, true, '10:00', '19:00', 60),
  (4, true, '10:00', '19:00', 60),
  (5, true, '10:00', '19:00', 60),
  (6, true, '10:00', '17:00', 60)
on conflict (weekday) do nothing;

-- 4) Özel kapatmalar (tatil, mola, vb.) - start/end null ise tüm gün kapalı
create table if not exists blocked_slots (
  id uuid primary key default gen_random_uuid(),
  block_date date not null,
  start_time time,
  end_time time,
  reason text
);

-- Row Level Security
alter table services enable row level security;
alter table appointments enable row level security;
alter table working_hours enable row level security;
alter table blocked_slots enable row level security;

drop policy if exists anon_select_services on services;
create policy anon_select_services on services
  for select to anon using (is_active = true);

drop policy if exists owner_all_services on services;
create policy owner_all_services on services
  for all to authenticated using (true) with check (true);

-- Herkes (anon) sadece dolu saatleri görebilir, müşteri bilgilerini göremez
drop policy if exists anon_select_slots on appointments;
create policy anon_select_slots on appointments
  for select to anon
  using (status <> 'cancelled');

-- Herkes (anon) yeni randevu (pending) oluşturabilir
drop policy if exists anon_insert_booking on appointments;
create policy anon_insert_booking on appointments
  for insert to anon
  with check (status = 'pending');

-- Stüdyo sahibi (giriş yapmış kullanıcı) her şeyi yönetebilir
drop policy if exists owner_all_appointments on appointments;
create policy owner_all_appointments on appointments
  for all to authenticated
  using (true) with check (true);

drop policy if exists anon_select_hours on working_hours;
create policy anon_select_hours on working_hours
  for select to anon using (true);

drop policy if exists owner_all_hours on working_hours;
create policy owner_all_hours on working_hours
  for all to authenticated using (true) with check (true);

drop policy if exists anon_select_blocks on blocked_slots;
create policy anon_select_blocks on blocked_slots
  for select to anon using (true);

drop policy if exists owner_all_blocks on blocked_slots;
create policy owner_all_blocks on blocked_slots
  for all to authenticated using (true) with check (true);

-- Kolon bazlı izinler: anon kullanıcı müşteri bilgilerini okuyamaz, sadece tarih/saat/süre görebilir
grant usage on schema public to anon, authenticated;
grant select on services to anon;
grant select (appt_date, appt_time, duration_minutes) on appointments to anon;
grant insert (appt_date, appt_time, duration_minutes, service_id, service_name, service_price, customer_name, customer_phone, note)
  on appointments to anon;
grant select on working_hours to anon;
grant select on blocked_slots to anon;

grant all on services to authenticated;
grant all on appointments to authenticated;
grant all on working_hours to authenticated;
grant all on blocked_slots to authenticated;
