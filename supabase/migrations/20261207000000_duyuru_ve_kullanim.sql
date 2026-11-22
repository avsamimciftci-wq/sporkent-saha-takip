-- Duyurular: restoran paylaşımlarıyla aynı yapı, "bolum" sütunuyla ayrılır (yalnızca yönetici paylaşır)
alter table restoran_paylasim add column if not exists bolum text not null default 'restoran';
alter table restoran_paylasim drop constraint if exists restoran_paylasim_bolum_check;
alter table restoran_paylasim add constraint restoran_paylasim_bolum_check check (bolum in ('restoran', 'duyuru'));
create index if not exists restoran_paylasim_bolum_tarih on restoran_paylasim (bolum, created_at desc);

-- Kullanım raporu: ana ekrana yükleyenler ve günlük bölüm kullanımı
alter table uyeler add column if not exists kurulu boolean not null default false;
alter table uyeler add column if not exists kurulu_at timestamptz;

create table if not exists kullanim (
  cihaz text not null,
  bolum text not null,
  gun   date not null,
  sayi  integer not null default 1,
  primary key (cihaz, bolum, gun)
);
create index if not exists kullanim_gun on kullanim (gun);
alter table kullanim enable row level security;

-- Bir açılışı sayar (Türkiye günüyle)
create or replace function kullanim_say(p_cihaz text, p_bolum text) returns void
language sql as $$
  insert into kullanim (cihaz, bolum, gun, sayi)
  values (p_cihaz, p_bolum, (now() at time zone 'Europe/Istanbul')::date, 1)
  on conflict (cihaz, bolum, gun) do update set sayi = kullanim.sayi + 1;
$$;
revoke all on function kullanim_say(text, text) from public, anon, authenticated;
