-- Parsel temsilcisinin ortağın Saha Takip kaydına yazdığı cevaplar: [{ad, metin, at}]
alter table kayitlar add column if not exists temsilci_cevaplari jsonb not null default '[]'::jsonb;
