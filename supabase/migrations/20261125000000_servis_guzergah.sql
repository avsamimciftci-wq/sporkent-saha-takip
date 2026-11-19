-- Servis aracı güzergahı: yönetici servisle bir tur atarken telefondan kaydeder.
-- Yalnızca sadeleştirilmiş çizgi ve duraklar (turun başından kaç saniye sonra) saklanır; ham konum geçmişi tutulmaz.
create table if not exists servis_guzergah (
  id          bigserial primary key,
  cizgi       jsonb not null,               -- [[lat, lng], ...]
  duraklar    jsonb not null default '[]',  -- [{ad, lat, lng, sn}]
  sure_sn     int not null,                 -- bir turun süresi
  mesafe_m    int not null,
  kaydeden    text not null,
  aktif       boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table servis_guzergah enable row level security;
