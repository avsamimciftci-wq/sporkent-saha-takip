-- İşi "yapıldı" olarak kapatan kişinin adı (müdür veya şef).
alter table kayitlar add column if not exists kapatan text;
