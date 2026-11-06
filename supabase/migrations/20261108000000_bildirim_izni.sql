-- Telefonun bildirim izni (granted / denied / default / ios-tarayici / desteklenmiyor):
-- yönetici üye listesinde kimin bildirim alamadığını ve nedenini görür.
alter table uyeler add column if not exists bildirim_izni text;
