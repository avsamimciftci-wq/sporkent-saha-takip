-- Muhasebe bölümü: restoran ve duyuru paylaşımlarıyla aynı yapı (yalnızca yönetim görür)
alter table restoran_paylasim drop constraint if exists restoran_paylasim_bolum_check;
alter table restoran_paylasim add constraint restoran_paylasim_bolum_check check (bolum in ('restoran', 'duyuru', 'muhasebe'));
