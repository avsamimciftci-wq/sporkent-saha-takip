-- Muhasebe: Excel dosyası paylaşımı (xlsx, xls, csv)
alter table restoran_paylasim drop constraint if exists restoran_paylasim_tur_check;
alter table restoran_paylasim add constraint restoran_paylasim_tur_check check (tur in ('gorsel', 'metin', 'pdf', 'video', 'excel'));
