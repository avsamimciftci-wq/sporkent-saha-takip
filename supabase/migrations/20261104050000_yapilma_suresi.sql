-- Süresi olmayan açık işlere açıldığı günden itibaren 3 gün ver (Türkiye saati).
update kayitlar
set son_tarih = (created_at at time zone 'Europe/Istanbul')::date + 3
where son_tarih is null and durum <> 'tamam';
