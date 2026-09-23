-- Google Takvim entegrasyonu için blocked_slots tablosuna eklemeler
-- SQL Editor'de çalıştırın.

alter table blocked_slots add column if not exists google_event_id text;
alter table blocked_slots add column if not exists source text not null default 'manual';
