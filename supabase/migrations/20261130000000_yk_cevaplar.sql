-- YK iş emrine yönetici ve yönetim kurulunun yazdığı cevaplar: [{ad, rol, metin, at}, ...]
alter table kayitlar add column if not exists cevaplar jsonb not null default '[]'::jsonb;
