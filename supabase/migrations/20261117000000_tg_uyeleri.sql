-- TG Başkanı ve TG üyeleri: her birinin kişiye özel giriş kodu (onaysız girer)
create table if not exists tg_uyeleri (
  id serial primary key,
  ad text not null unique,
  unvan text not null default 'TG Üyesi',
  kod text not null unique,
  created_at timestamptz not null default now()
);
alter table tg_uyeleri enable row level security;

-- Üyenin unvanı (örn. "TG Başkanı"); boşsa görev adı gösterilir
alter table uyeler add column if not exists unvan text;
