-- Devriye izi: müdür / şef "Devriyeyi Başlat" ile "Devriyeyi Bitir" arasında konum kaydeder.
-- Konum yalnızca bu aralıkta, mesai saatinde ve devriye alanında alınır.
create table if not exists devriye_turlari (
  id            bigserial primary key,
  cihaz         text not null,
  ad            text not null,
  rol           text not null,
  gun           date not null,                 -- Türkiye günü
  basla         timestamptz not null default now(),
  bitis         timestamptz,                   -- boşsa devriye sürüyor
  bitis_nedeni  text,                          -- kullanici | mesai | otomatik
  mesafe_m      int not null default 0,
  nokta_sayisi  int not null default 0,
  kesinti_sn    int not null default 0         -- uygulama arka plandayken kayıt yapılamayan süre
);
create index if not exists devriye_turlari_gun on devriye_turlari(gun);
create index if not exists devriye_turlari_acik on devriye_turlari(cihaz) where bitis is null;
alter table devriye_turlari enable row level security;

create table if not exists devriye_izleri (
  id        bigserial primary key,
  tur_id    bigint not null references devriye_turlari(id) on delete cascade,
  zaman     timestamptz not null,
  lat       double precision not null,
  lng       double precision not null,
  dogruluk  int,
  kopuk     boolean not null default false,    -- önceki noktayla arası kesik (kayıt durmuştu)
  unique (tur_id, zaman)
);
create index if not exists devriye_izleri_tur on devriye_izleri(tur_id, zaman);
alter table devriye_izleri enable row level security;

insert into ayarlar(ad, deger) values ('devriye_mesai', '08:00-18:00') on conflict (ad) do nothing;
