-- Müdür ve şefin bir kaydı ilk ne zaman açtığı (yönetici görür)
create table if not exists goruntulemeler (
  kayit_id  bigint not null references kayitlar(id) on delete cascade,
  cihaz     text not null,
  ad        text,
  rol       text,
  ilk_at    timestamptz not null default now(),
  primary key (kayit_id, cihaz)
);
alter table goruntulemeler enable row level security;

-- Yöneticinin "Bu iş N gün içinde yapılacaktır." cevabı
alter table kayitlar add column if not exists yanit text;
alter table kayitlar add column if not exists yanit_veren text;
alter table kayitlar add column if not exists yanit_at timestamptz;
