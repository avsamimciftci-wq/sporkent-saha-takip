-- Aylık Masraflar Listesi: Sporkent 87 ve Restoran'dan bağımsız, kendi bölümü ("muhasebe_masraf")
alter table restoran_paylasim drop constraint if exists restoran_paylasim_bolum_check;
alter table restoran_paylasim add constraint restoran_paylasim_bolum_check check (bolum in ('restoran', 'duyuru', 'muhasebe', 'muhasebe_restoran', 'muhasebe_masraf'));
-- Daha önce Sporkent 87 ya da Restoran altında paylaşılmış masraf listeleri yeni bölüme taşınır
update restoran_paylasim set bolum = 'muhasebe_masraf'
  where bolum in ('muhasebe', 'muhasebe_restoran') and metin like 'Aylık Masraflar Listesi ·%';
