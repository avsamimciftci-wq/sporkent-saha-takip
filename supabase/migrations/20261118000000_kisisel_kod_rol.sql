-- Kişisel kodlar yalnızca TG için değil, yönetim kurulu üyeleri için de: hangi görevle girileceği
alter table tg_uyeleri add column if not exists rol text not null default 'uye' check (rol in ('uye', 'yonetim'));
