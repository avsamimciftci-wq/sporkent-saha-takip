-- Yapılan işi (notuyla) kimin ilk ne zaman gördüğü; yalnızca yönetici görür
create table if not exists yapildi_gorulme (
  kayit_id  bigint not null references kayitlar(id) on delete cascade,
  cihaz     text not null,
  ad        text,
  rol       text,
  unvan     text,
  ilk_at    timestamptz not null default now(),
  primary key (kayit_id, cihaz)
);
alter table yapildi_gorulme enable row level security;
