-- Ortaklar kodsuz kayıt olur: ad soyad, telefon ve gerçek ortaklık numarası; yönetici onaylar
alter table uyeler add column if not exists ortak_no int;
alter table uyeler add column if not exists telefon text;
create index if not exists uyeler_ortak_no on uyeler(ortak_no);
