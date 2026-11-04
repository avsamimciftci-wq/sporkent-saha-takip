-- Gruba katılan her telefon: kodu girdikten sonra yönetici (YK başkanı) onaylayana kadar bekler.
create table if not exists uyeler (
  cihaz        text primary key,
  anahtar      text not null,
  ad           text not null,
  rol          text not null,
  durum        text not null default 'bekliyor' check (durum in ('bekliyor','onayli','cikarildi')),
  created_at   timestamptz not null default now(),
  onay_at      timestamptz,
  son_gorulme  timestamptz
);
alter table uyeler enable row level security;

-- Yöneticinin değiştirebildiği giriş kodları (boşsa sunucu sırlarındaki kod geçerlidir).
create table if not exists ayarlar (
  ad     text primary key,
  deger  text not null
);
alter table ayarlar enable row level security;

-- Yöneticinin "tüm kayıtları sil" işlemi: kayıtları ve bildirim günlüğünü temizler, numarayı sıfırlar.
create or replace function kayitlari_sifirla() returns void
language sql security definer set search_path = public as $$
  truncate kayitlar restart identity;
  truncate bildirim_gunlugu restart identity;
$$;
revoke all on function kayitlari_sifirla() from public, anon, authenticated;
grant execute on function kayitlari_sifirla() to service_role;
