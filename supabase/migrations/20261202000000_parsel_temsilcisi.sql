-- Parsel temsilcileri: belli ortak numaralarının (no_bas..no_bit) temsilcisi.
-- Bu aralıktaki ortağın Saha Takip'e yazdığı kayıt önce temsilcinin onayına düşer.
-- Temsilci, uygulamaya şahsi koduyla giren TG üyesidir; "ad" alanı onun uygulamadaki adıyla aynı olmalı.
-- Kişi bilgileri (ad, telefon) bu dosyaya yazılmaz; veritabanına ayrıca eklenir.
create table if not exists parsel_temsilcileri (
  id         serial primary key,
  baslik     text not null,
  ad         text not null,
  telefon    text,
  no_bas     int not null,
  no_bit     int not null,
  resim      text,
  created_at timestamptz not null default now()
);
alter table parsel_temsilcileri enable row level security;

-- Kaydın onayını bekleyen parsel temsilcisi (boşsa onayı yönetici / yönetim kurulu verir)
alter table kayitlar add column if not exists temsilci_id int;
