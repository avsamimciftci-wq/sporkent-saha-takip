-- Plaka-Kimlik Bildirimi: yakının aracında yakının telefonu
alter table plaka_talepleri add column if not exists arac_sahibi_tel text;

-- Restoran: menü resimleri (yönetici ekler, herkes görür). Sipariş telefonu ayarlar tablosunda (restoran_tel).
create table if not exists restoran_menu (
  id         bigserial primary key,
  yol        text not null,
  baslik     text,
  ekleyen    text,
  created_at timestamptz not null default now()
);
alter table restoran_menu enable row level security;
