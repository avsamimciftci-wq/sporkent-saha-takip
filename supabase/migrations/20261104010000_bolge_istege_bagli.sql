-- Formdan bölge seçimi kaldırıldı.
alter table kayitlar alter column bolge drop not null;
