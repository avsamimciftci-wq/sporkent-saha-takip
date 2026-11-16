-- KVKK: resmi ortak listesi okunabilir ad ve telefon tutmaz. Yalnızca gizli anahtarlı özetler (HMAC-SHA256)
-- saklanır; başvuru karşılaştırması bu özetlerle yapılır. Liste her yüklemede baştan yazılır.
drop table if exists ortak_rehberi;
create table ortak_rehberi (
  no            int primary key,
  ad_ozet       text not null,
  tel_ozetleri  text[] not null default '{}'
);
alter table ortak_rehberi enable row level security;

-- Saklama süresi: çıkarılma zamanı (süre dolunca kayıt kendiliğinden silinir)
alter table uyeler add column if not exists cikarilma_at timestamptz;
update uyeler set cikarilma_at = now() where durum = 'cikarildi' and cikarilma_at is null;
