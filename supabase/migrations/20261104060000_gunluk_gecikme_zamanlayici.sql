-- Her sabah 09:00 (Türkiye, 06:00 UTC) süresi geçen işleri yönetime bildir.
-- Sunucu anahtarı depoda değil, Supabase Vault'ta "cron_anahtari" adıyla saklanır.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function gunluk_gecikme_cagir() returns void
language plpgsql security definer set search_path = public as $$
declare
  anahtar text;
begin
  select decrypted_secret into anahtar from vault.decrypted_secrets where name = 'cron_anahtari';
  if anahtar is null then
    raise warning 'cron_anahtari bulunamadı, gecikme bildirimi atlandı';
    return;
  end if;
  perform net.http_post(
    url := 'https://inhqkwuvlxhabkiulyrd.supabase.co/functions/v1/api',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('eylem', 'gunluk_gecikme', 'cron', anahtar)
  );
end $$;
revoke all on function gunluk_gecikme_cagir() from public, anon, authenticated;

select cron.unschedule('gunluk-gecikme') where exists (select 1 from cron.job where jobname = 'gunluk-gecikme');
select cron.schedule('gunluk-gecikme', '0 6 * * *', 'select gunluk_gecikme_cagir()');
