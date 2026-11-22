-- Kişisel kodla girenlere restoran yetkilisi de eklenir
alter table tg_uyeleri drop constraint if exists tg_uyeleri_rol_check;
alter table tg_uyeleri add constraint tg_uyeleri_rol_check check (rol in ('uye', 'yonetim', 'restoran'));
