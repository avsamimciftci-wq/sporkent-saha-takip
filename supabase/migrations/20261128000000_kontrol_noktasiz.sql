-- Devriye artık kontrol noktası kullanmıyor: Başlat / Bitir arası iz kaydı yeterli.
-- Konumun yalnızca site içinde alınması kuralı için site sınırı (eski 12 noktanın kapsadığı alan + 200 m) saklanır.
insert into ayarlar(ad, deger) values ('devriye_alan', '37.13113,27.31756,37.14353,27.32683')
  on conflict (ad) do update set deger = excluded.deger;
-- Eski kontrol noktaları ve "Kontrol edildi" kayıtları (yedeği alındı: SAHA TAKİP PROGRAMI YEDEĞİ klasörü)
drop table if exists devriye_kayitlari;
drop table if exists devriye_noktalari;
