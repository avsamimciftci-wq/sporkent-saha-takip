-- Kayıt onayı: TG üyeleri ve muhasebenin yazdığı kayıt önce yönetici / yönetim kurulu onayına düşer.
-- Mevcut kayıtlar onaylı sayılır.
alter table kayitlar add column if not exists onay_durumu text not null default 'onayli';
alter table kayitlar add column if not exists onaylayan text;
alter table kayitlar add column if not exists onaylama_at timestamptz;

-- Ortak hesapları: "Ortak 1", "Ortak 2" … her birinin kendi şifresi var
create table if not exists ortaklar (
  no integer primary key,
  sifre text not null unique,
  created_at timestamptz not null default now()
);
alter table ortaklar enable row level security;

-- Aidat: yıl içindeki parasal yükümlülükler resim olarak
create table if not exists aidat_resimleri (
  id bigserial primary key,
  yol text not null,
  baslik text,
  ekleyen text,
  created_at timestamptz not null default now()
);
alter table aidat_resimleri enable row level security;

-- Yönetim iş programı (takvim): bir kez / her gün / her hafta / her ay
create table if not exists is_programi (
  id bigserial primary key,
  tarih date not null,
  saat text,
  tekrar text not null default 'yok' check (tekrar in ('yok', 'gunluk', 'haftalik', 'aylik')),
  baslik text not null,
  aciklama text,
  ekleyen text,
  cihaz text,
  rol text,
  created_at timestamptz not null default now()
);
alter table is_programi enable row level security;
create index if not exists is_programi_tarih on is_programi (tarih);
