-- Ortakların araç plakası giriş talepleri (site girişindeki plaka listesine eklenmesi için).
-- Talep kooperatif e-posta adresine gönderilir; burada da kaydı tutulur.
create table if not exists plaka_talepleri (
  id           bigserial primary key,
  cihaz        text,
  ad           text not null,
  ortak_no     int,
  telefon      text,
  arac         text not null check (arac in ('kendi', 'yakin')),
  plaka        text not null,
  arac_sahibi  text,
  eposta_gitti boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists plaka_talepleri_tarih on plaka_talepleri (created_at desc);
alter table plaka_talepleri enable row level security;
