-- OW-DMS 0003: 비동기 worker용 시스템 사용자(로그인 불가: disabled_at 설정)
insert into users (id, username, display_name, disabled_at)
values ('00000000-0000-4000-8000-000000000000', 'system.worker', '시스템 작업', now())
on conflict do nothing;
