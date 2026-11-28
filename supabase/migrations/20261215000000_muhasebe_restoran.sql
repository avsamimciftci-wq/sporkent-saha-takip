-- Muhasebe alt bölümleri: Sporkent 87 ("muhasebe") ve Restoran ("muhasebe_restoran")
alter table restoran_paylasim drop constraint if exists restoran_paylasim_bolum_check;
alter table restoran_paylasim add constraint restoran_paylasim_bolum_check check (bolum in ('restoran', 'duyuru', 'muhasebe', 'muhasebe_restoran'));
