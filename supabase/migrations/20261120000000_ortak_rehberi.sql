-- Kooperatifin resmi ortak listesi (ortak no, ad soyad, telefonlar). Kayıt başvurusunu karşılaştırmak için.
-- Kişisel veri: yalnızca sunucu (service role) okur; herkese açık erişim yok.
create table if not exists ortak_rehberi (
  no         int primary key,
  ad         text not null,
  telefonlar text[] not null default '{}'
);
alter table ortak_rehberi enable row level security;
