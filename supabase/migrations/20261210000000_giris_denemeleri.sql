-- Kodla giriş için deneme sınırı (kaba kuvvet denemelerine karşı).
-- anahtar: "c:<cihaz>", "ip:<adres>" ya da "genel". Yalnızca Edge Function (service_role) okur/yazar.
create table if not exists public.giris_denemeleri (
  anahtar text primary key,
  hata integer not null default 0,
  kilit_bitis timestamptz,
  guncel timestamptz not null default now()
);
alter table public.giris_denemeleri enable row level security;
