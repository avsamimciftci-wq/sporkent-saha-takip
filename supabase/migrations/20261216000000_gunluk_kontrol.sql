-- Günlük İşler › Günlük Kontrol: müdür / şef her gün işaretler, isterse fotoğraf ekler.
-- Aynı tabloya "kontrol" türü eklenir; foto: depodaki dosya yolu (kontrol/YYYY-MM-DD/....jpg).
alter table gorev_isaretleri drop constraint if exists gorev_isaretleri_tur_check;
alter table gorev_isaretleri add constraint gorev_isaretleri_tur_check check (tur in ('gunluk', 'haftalik', 'kontrol'));
alter table gorev_isaretleri add column if not exists foto text;
