-- Ortak muavinleri: Muhasebe İletişim Programı'nın her ortak için çıkardığı faiz dökümü.
-- Yalnızca son yükleme saklanır. Excel'ler yükleyenin bilgisayarında okunur; buraya yalnızca dökümün satırları gelir.
create table if not exists muavinler (
  ortak_no    int primary key,
  hesap       text not null,
  ad          text,
  bilgi       jsonb not null default '{}'::jsonb,   -- hesap tarihi, aylık faiz oranı, mahsup sırası
  satirlar    jsonb not null default '[]'::jsonb,   -- Hesap Dökümü satırları
  toplam      jsonb not null default '{}'::jsonb,   -- TOPLAM, ödenmemiş anapara, ödenmemiş faiz
  kalemler    jsonb not null default '[]'::jsonb,   -- Kalem Faizleri satırları
  yukleme_id  text not null,
  pdf_yol     text,                                  -- üretilen PDF (bir sonraki yüklemede silinir)
  yuklendi_at timestamptz not null default now(),
  yukleyen    text
);
alter table muavinler enable row level security;

-- Yükleme sürerken parçalar burada birikir; tamamlanınca tek seferde muavinler'in yerine geçer
create table if not exists muavin_yukleme (
  yukleme_id text not null,
  ortak_no   int not null,
  veri       jsonb not null,
  created_at timestamptz not null default now(),
  primary key (yukleme_id, ortak_no)
);
alter table muavin_yukleme enable row level security;

-- Bilgisayardan yükleme: telefondaki yönetici / muhasebe 30 dakika geçerli bir kod alır
create table if not exists muavin_kodlari (
  kod        text primary key,
  cihaz      text not null,
  ad         text,
  rol        text,
  yukleme_id text not null,
  son        timestamptz not null,
  kullanildi boolean not null default false,
  created_at timestamptz not null default now()
);
alter table muavin_kodlari enable row level security;

-- KVKK: kim hangi ortağın muavinini ne zaman açtı
create table if not exists muavin_gorulme (
  id       bigserial primary key,
  ortak_no int not null,
  cihaz    text,
  ad       text,
  rol      text,
  at       timestamptz not null default now()
);
alter table muavin_gorulme enable row level security;
create index if not exists muavin_gorulme_ortak on muavin_gorulme (ortak_no, at desc);

-- Yüklenen muavin eskisinin yerine tek işlemde geçer (yarım kalan yükleme eskisini bozmaz)
create or replace function muavin_degistir(p_yukleme text, p_yukleyen text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from muavin_yukleme where yukleme_id = p_yukleme;
  if n = 0 then raise exception 'Yüklenen muavin bulunamadı'; end if;
  delete from muavinler where ortak_no is not null;
  insert into muavinler (ortak_no, hesap, ad, bilgi, satirlar, toplam, kalemler, yukleme_id, yukleyen)
    select ortak_no, veri->>'hesap', veri->>'ad', coalesce(veri->'bilgi', '{}'::jsonb), coalesce(veri->'satirlar', '[]'::jsonb),
           coalesce(veri->'toplam', '{}'::jsonb), coalesce(veri->'kalemler', '[]'::jsonb), p_yukleme, p_yukleyen
    from muavin_yukleme where yukleme_id = p_yukleme;
  delete from muavin_yukleme where yukleme_id = p_yukleme or created_at < now() - interval '1 day';
  return n;
end $$;
revoke all on function muavin_degistir(text, text) from public, anon, authenticated;
