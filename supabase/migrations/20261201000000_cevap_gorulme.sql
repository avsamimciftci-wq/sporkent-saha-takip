-- YK iş emri cevabını kimin ne zaman gördüğü. sira: o anda iş emrindeki cevap sayısı (bu sıraya kadarki cevaplar görüldü sayılır)
create table if not exists cevap_gorulme (
  kayit_id  bigint not null references kayitlar(id) on delete cascade,
  sira      int not null,
  cihaz     text not null,
  ad        text,
  rol       text,
  ilk_at    timestamptz not null default now(),
  primary key (kayit_id, sira, cihaz)
);
alter table cevap_gorulme enable row level security;
