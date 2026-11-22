-- Restoran paylaşımları: restoran yetkilisi ya da yönetici; görsel, metin, PDF veya video.
-- Her paylaşım uygulamayı kullanan herkese bildirilir.
create table if not exists restoran_paylasim (
  id         bigserial primary key,
  tur        text not null check (tur in ('gorsel', 'metin', 'pdf', 'video')),
  metin      text,
  yol        text,
  ekleyen    text,
  rol        text,
  cihaz      text,
  created_at timestamptz not null default now()
);
create index if not exists restoran_paylasim_tarih on restoran_paylasim (created_at desc);
alter table restoran_paylasim enable row level security;

-- Eski menü resimleri görsel paylaşım olarak taşınır
insert into restoran_paylasim (tur, metin, yol, ekleyen, rol, created_at)
select 'gorsel', baslik, yol, ekleyen, 'baskan', created_at from restoran_menu
where not exists (select 1 from restoran_paylasim p where p.yol = restoran_menu.yol);
