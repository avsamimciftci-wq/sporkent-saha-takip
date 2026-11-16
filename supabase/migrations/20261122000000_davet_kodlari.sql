-- Kişiye özel davet kodu: yönetici ortağın kayıtlı telefonuna gönderir; kayıt ancak bu kodla yapılır.
-- Kodun kendisi saklanmaz, gizli anahtarlı özeti saklanır. Tek kullanımlık, 14 gün geçerli, 5 yanlış denemede düşer.
create table if not exists davet_kodlari (
  id             bigserial primary key,
  ortak_no       int not null,
  kod_ozet       text not null,
  olusturan      text,
  created_at     timestamptz not null default now(),
  son_tarih      timestamptz not null,
  deneme         int not null default 0,
  kullanildi_at  timestamptz,
  kullanan_cihaz text
);
create index if not exists davet_kodlari_no on davet_kodlari(ortak_no);
alter table davet_kodlari enable row level security;

-- Üyenin davet koduyla kayıt olduğu an (onay ekranında "davet kodu doğru" için)
alter table uyeler add column if not exists davetli_at timestamptz;
