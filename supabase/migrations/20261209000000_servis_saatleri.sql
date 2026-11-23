-- Servis sefer saatleri: yönetici uygulamadan değiştirir (JSON dizi)
insert into ayarlar(ad, deger) values ('servis_saatleri', '["10:00","11:00","12:00","14:00","15:00","16:00","17:00","18:00","19:00","20:00"]')
  on conflict (ad) do nothing;
