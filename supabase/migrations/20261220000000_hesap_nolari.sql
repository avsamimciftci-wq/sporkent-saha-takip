-- Hesap Özeti: kişisel kodlu kişinin (TG, YK, Denetim Kurulu) ortak numaraları.
-- Boşsa ad, resmi ortak listesindeki adla eşleştirilerek bulunur; ad listede farklı yazılmışsa buraya elle girilir.
alter table tg_uyeleri add column if not exists hesap_nolari int[];
