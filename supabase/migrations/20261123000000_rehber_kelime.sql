-- İsimle arama için: ad ve soyadın her kelimesinin ayrı gizli anahtarlı özeti (okunabilir ad yine yok)
alter table ortak_rehberi add column if not exists kelime_ozetleri text[] not null default '{}';
create index if not exists ortak_rehberi_kelime on ortak_rehberi using gin (kelime_ozetleri);
