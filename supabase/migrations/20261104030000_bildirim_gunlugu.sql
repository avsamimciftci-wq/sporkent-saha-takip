-- Gönderilen her bildirimin sonucu: kaç cihaza gitti, hangileri hata verdi.
create table if not exists bildirim_gunlugu (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  baslik      text,
  hedef       int not null default 0,
  basarili    int not null default 0,
  hatalar     jsonb
);
alter table bildirim_gunlugu enable row level security;
