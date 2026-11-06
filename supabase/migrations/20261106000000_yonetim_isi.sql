-- Yönetim işi: yalnızca yönetici, yönetim kurulu, müdür ve şefin gördüğü kayıt
alter table kayitlar add column if not exists gizli boolean not null default false;
