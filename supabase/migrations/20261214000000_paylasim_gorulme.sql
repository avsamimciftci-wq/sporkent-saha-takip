-- Duyuru ve Restoran paylaşımlarını kimin ilk ne zaman gördüğü (yalnızca yönetici Kullanım Raporu'nda görür)
create table if not exists paylasim_gorulme (
  paylasim_id bigint not null references restoran_paylasim(id) on delete cascade,
  cihaz       text not null,
  ad          text,
  rol         text,
  unvan       text,
  ilk_at      timestamptz not null default now(),
  primary key (paylasim_id, cihaz)
);
alter table paylasim_gorulme enable row level security;
