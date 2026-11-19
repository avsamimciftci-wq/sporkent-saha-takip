-- Devriye kontrol noktaları: müdür / şef her noktaya gelince "Buradayım" der; konum o anda bir kez alınır.
create table if not exists devriye_noktalari (
  id          bigserial primary key,
  ad          text not null,
  lat         double precision not null,
  lng         double precision not null,
  yaricap     int not null default 75,      -- metre: bu mesafe içinde "Buradayım" kabul edilir
  sira        int not null default 0,
  aktif       boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table devriye_noktalari enable row level security;

create table if not exists devriye_kayitlari (
  id          bigserial primary key,
  nokta_id    bigint not null references devriye_noktalari(id),
  gun         date not null,                -- Türkiye günü
  cihaz       text not null,
  ad          text not null,
  rol         text not null,
  zaman       timestamptz not null default now(),
  lat         double precision not null,
  lng         double precision not null,
  dogruluk    int,                          -- telefonun bildirdiği konum doğruluğu (metre)
  mesafe      int not null,                 -- noktaya uzaklık (metre)
  foto        text,                         -- isteğe bağlı fotoğraf (depo yolu)
  unique (gun, nokta_id, cihaz)
);
create index if not exists devriye_kayitlari_gun on devriye_kayitlari(gun);
alter table devriye_kayitlari enable row level security;
