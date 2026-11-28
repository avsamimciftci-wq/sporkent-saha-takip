-- İş Programı: "Yapıldı" işareti ve "bu hafta" işleri (pazar hariç haftanın her günü, yapılana kadar)
alter table is_programi drop constraint if exists is_programi_tekrar_check;
alter table is_programi add constraint is_programi_tekrar_check check (tekrar in ('yok', 'gunluk', 'haftalik', 'aylik', 'hafta'));
alter table is_programi add column if not exists yapildi_at timestamptz;
alter table is_programi add column if not exists yapildi_gun date;
alter table is_programi add column if not exists yapan text;
alter table is_programi add column if not exists yapan_cihaz text;

-- Aylık Faaliyet Raporları (PDF'ler "fotograflar" deposunda raporlar/ klasöründe; haftalık yedeğe de girer)
create table if not exists faaliyet_raporlari (
  ay          text primary key,            -- YYYY-MM
  yol         text not null,
  is_sayisi   int not null default 0,
  program_sayisi int not null default 0,
  olusturma   timestamptz not null default now()
);
alter table faaliyet_raporlari enable row level security;

-- Her akşam 20.00'de (Türkiye, 17.00 UTC) çağrılır; sunucu yalnızca ayın son günüyse raporu hazırlar ve yöneticiye bildirir.
create or replace function aylik_rapor_cagir() returns void
language plpgsql security definer set search_path = public as $$
declare
  anahtar text;
begin
  select decrypted_secret into anahtar from vault.decrypted_secrets where name = 'cron_anahtari';
  if anahtar is null then
    raise warning 'cron_anahtari bulunamadı, aylık rapor atlandı';
    return;
  end if;
  perform net.http_post(
    url := 'https://inhqkwuvlxhabkiulyrd.supabase.co/functions/v1/api',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('eylem', 'aylik_rapor', 'cron', anahtar),
    timeout_milliseconds := 120000
  );
end $$;
revoke all on function aylik_rapor_cagir() from public, anon, authenticated;

select cron.unschedule('aylik-rapor') where exists (select 1 from cron.job where jobname = 'aylik-rapor');
select cron.schedule('aylik-rapor', '0 17 * * *', 'select aylik_rapor_cagir()');
