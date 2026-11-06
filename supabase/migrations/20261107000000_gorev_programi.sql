-- Günlük / haftalık görev programında müdür ve şefin "yapıldı" işaretleri.
-- donem: günlük için o gün (YYYY-MM-DD), haftalık için o haftanın pazartesisi; tur ayrı tutulur.
create table if not exists gorev_isaretleri (
  tur        text not null check (tur in ('gunluk', 'haftalik')),
  donem      date not null,
  kalem      text not null,
  cihaz      text not null,
  ad         text,
  rol        text,
  isaret_at  timestamptz not null default now(),
  primary key (tur, donem, kalem)
);
alter table gorev_isaretleri enable row level security;

-- Her sabah 08.15 (Türkiye, 05.15 UTC) müdür ve şefe günlük görevleri, pazartesileri haftalıkları da hatırlat.
create or replace function gorev_hatirlat_cagir() returns void
language plpgsql security definer set search_path = public as $$
declare
  anahtar text;
begin
  select decrypted_secret into anahtar from vault.decrypted_secrets where name = 'cron_anahtari';
  if anahtar is null then
    raise warning 'cron_anahtari bulunamadı, görev hatırlatması atlandı';
    return;
  end if;
  perform net.http_post(
    url := 'https://inhqkwuvlxhabkiulyrd.supabase.co/functions/v1/api',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('eylem', 'gorev_hatirlat', 'cron', anahtar)
  );
end $$;
revoke all on function gorev_hatirlat_cagir() from public, anon, authenticated;

select cron.unschedule('gorev-hatirlat') where exists (select 1 from cron.job where jobname = 'gorev-hatirlat');
select cron.schedule('gorev-hatirlat', '15 5 * * *', 'select gorev_hatirlat_cagir()');
