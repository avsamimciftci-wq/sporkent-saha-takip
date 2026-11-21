-- Devriyenin hangi telefonda yapıldığı ve ekranın açık tutulabildiği (iPhone / Android davranışını izlemek için)
alter table devriye_turlari add column if not exists cihaz_turu text;
alter table devriye_turlari add column if not exists ekran text;  -- kilit (Wake Lock) | video (iPhone yedeği) | yok
