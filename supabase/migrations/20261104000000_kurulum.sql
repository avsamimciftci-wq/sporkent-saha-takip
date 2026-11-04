-- Sporkent Müdür Takip: veritabanı kurulumu
-- Tablolara yalnızca "api" Edge Function (service role) erişir; RLS açık, politika yok.

create table if not exists kayitlar (
  id            bigserial primary key,
  no            text unique,
  created_at    timestamptz not null default now(),
  bildiren      text not null,
  cihaz         text,
  bolge         text not null,
  yer           text not null,
  sorun         text not null,
  oncelik       text not null default 'normal' check (oncelik in ('acil','oncelikli','normal')),
  durum         text not null default 'acik'   check (durum in ('acik','devam','tamam')),
  foto_once     text,
  sorumlu       text,
  son_tarih     date,
  mudahale_at   timestamptz,
  gecikme_nedeni text,
  sonuc         text,
  foto_sonra    text,
  kapanis_at    timestamptz
);

create or replace function kayit_no_ver() returns trigger language plpgsql as $$
begin
  new.no := to_char(new.created_at at time zone 'Europe/Istanbul', 'YYYY') || '-' || lpad(new.id::text, 3, '0');
  return new;
end $$;

drop trigger if exists kayit_no on kayitlar;
create trigger kayit_no before insert on kayitlar for each row execute function kayit_no_ver();

create index if not exists kayitlar_durum on kayitlar (durum, created_at desc);

create table if not exists abonelikler (
  endpoint   text primary key,
  abonelik   jsonb not null,
  rol        text not null,
  cihaz      text,
  created_at timestamptz not null default now()
);

alter table kayitlar   enable row level security;
alter table abonelikler enable row level security;

insert into storage.buckets (id, name, public)
values ('fotograflar', 'fotograflar', false)
on conflict (id) do nothing;
