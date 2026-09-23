-- Hizmet çeşitleri ekleme migrasyonu
-- Daha önce schema.sql'i çalıştırdıysanız, şimdi bunu da SQL Editor'de çalıştırın.

-- 1) Hizmetler tablosu
create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  duration_minutes int not null default 60,
  price numeric(10,2) not null default 0,
  is_active boolean not null default true,
  sort_order int not null default 0
);

alter table services enable row level security;

drop policy if exists anon_select_services on services;
create policy anon_select_services on services
  for select to anon
  using (is_active = true);

drop policy if exists owner_all_services on services;
create policy owner_all_services on services
  for all to authenticated
  using (true) with check (true);

grant select on services to anon;
grant all on services to authenticated;

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

-- 2) Randevulara hizmet bilgisi ekleme (o anki hizmet adı/fiyatı randevuda saklanır,
--    ileride hizmet adı/fiyatı değişse bile geçmiş randevu değişmez)
alter table appointments add column if not exists service_id uuid references services(id) on delete set null;
alter table appointments add column if not exists service_name text;
alter table appointments add column if not exists service_price numeric(10,2);

grant select (duration_minutes) on appointments to anon;
grant insert (service_id, service_name, service_price) on appointments to anon;

-- 3) Farklı sürelerdeki hizmetlerin çakışmasını önleme
--    (örn. 2 saatlik protez tırnak randevusu, o 2 saatlik dilimi tamamen kapatır)
drop index if exists unique_active_slot;

alter table appointments drop column if exists appt_range;
alter table appointments add column appt_range tsrange;

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
