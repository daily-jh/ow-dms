-- 실제 로그인: 비밀번호(scrypt)·2단계 인증(TOTP)·서버 세션·잠금, 기관관리자의 직원 계정 관리.
-- 인증정보·세션 테이블은 앱 계정에 직접 권한을 주지 않고 SECURITY DEFINER 함수로만 접근한다.

create table user_credentials (
  user_id uuid primary key references users(id),
  password_hash text not null,               -- scrypt$N$r$p$salt$hash (앱에서 생성·검증)
  must_change boolean not null default true, -- 관리자가 정한 임시 비밀번호는 첫 로그인 때 바꾼다
  password_changed_at timestamptz not null default now(),
  totp_secret_enc text,                      -- AES-256-GCM(앱 키), 등록 대기 중이면 totp_enabled_at is null
  totp_enabled_at timestamptz,
  totp_last_step bigint,                     -- 같은 OTP 재사용 방지
  failed_count int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create table auth_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  foreign key (tenant_id, user_id) references memberships (tenant_id, user_id)
);
create index auth_sessions_user on auth_sessions (user_id) where revoked_at is null;

alter table user_credentials enable row level security;
alter table user_credentials force row level security;
alter table auth_sessions enable row level security;
alter table auth_sessions force row level security;
-- 정책·권한 없음: owdms_app은 아래 함수로만 접근한다.
revoke all on user_credentials, auth_sessions from owdms_app;

-- ───────────── 로그인(기관 컨텍스트 이전) ─────────────
create or replace function auth_login_info(p_username text)
returns table (user_id uuid, display_name text, password_hash text, must_change boolean,
               totp_secret_enc text, totp_enabled boolean, totp_last_step bigint, locked_until timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, u.display_name, c.password_hash, c.must_change, c.totp_secret_enc, c.totp_enabled_at is not null,
         c.totp_last_step, c.locked_until
  from users u join user_credentials c on c.user_id = u.id
  where u.username = p_username and u.disabled_at is null
$$;

-- 실패 횟수 누적, p_max회 실패 시 p_lock 동안 잠근다. 감사기록은 계정이 속한 기관마다 남긴다.
create or replace function auth_login_failed(p_user_id uuid, p_max int, p_lock interval, p_request_id text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  update user_credentials set failed_count = failed_count + 1, updated_at = now()
    where user_id = p_user_id returning failed_count into n;
  if n >= p_max then
    update user_credentials set locked_until = now() + p_lock, failed_count = 0 where user_id = p_user_id;
  end if;
  insert into audit_events (tenant_id, actor_user_id, category, action, result, reason, request_id)
    select m.tenant_id, p_user_id, 'AUTH', 'login.password', 'FAILED',
           case when n >= p_max then 'locked' else 'bad_credentials' end, p_request_id
    from memberships m where m.user_id = p_user_id and m.revoked_at is null;
end $$;

-- 성공: 실패 횟수 초기화, (OTP를 썼으면) 사용한 시간칸 기록, 세션 생성. 활성 멤버십이 없으면 실패.
create or replace function auth_login_succeeded(p_user_id uuid, p_tenant_id uuid, p_totp_step bigint, p_ttl interval, p_request_id text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare sid uuid;
begin
  if not exists (select 1 from auth_memberships(p_user_id) m where m.tenant_id = p_tenant_id) then
    raise exception 'no active membership' using errcode = '42501';
  end if;
  if p_totp_step is not null then
    update user_credentials set totp_last_step = p_totp_step
      where user_id = p_user_id and (totp_last_step is null or totp_last_step < p_totp_step);
    if not found then raise exception 'otp reused' using errcode = '42501'; end if;
  end if;
  update user_credentials set failed_count = 0, locked_until = null, updated_at = now() where user_id = p_user_id;
  insert into auth_sessions (tenant_id, user_id, expires_at) values (p_tenant_id, p_user_id, now() + p_ttl) returning id into sid;
  insert into audit_events (tenant_id, actor_user_id, category, action, result, request_id)
    values (p_tenant_id, p_user_id, 'AUTH', 'login.password', 'SUCCESS', p_request_id);
  return sid;
end $$;

-- 개발·시연 로그인용 세션(비밀번호 없음). 앱이 DEV_LOGIN_ENABLED일 때만 부른다.
create or replace function auth_session_open(p_user_id uuid, p_tenant_id uuid, p_ttl interval)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare sid uuid;
begin
  if not exists (select 1 from auth_memberships(p_user_id) m where m.tenant_id = p_tenant_id) then
    raise exception 'no active membership' using errcode = '42501';
  end if;
  insert into auth_sessions (tenant_id, user_id, expires_at) values (p_tenant_id, p_user_id, now() + p_ttl) returning id into sid;
  return sid;
end $$;

-- 요청마다: 세션이 살아 있는지와 계정 상태(비밀번호 변경 필요, OTP 등록 여부)를 함께 돌려준다.
create or replace function auth_session_check(p_session_id uuid)
returns table (user_id uuid, tenant_id uuid, must_change boolean, totp_enabled boolean, has_password boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.user_id, s.tenant_id, coalesce(c.must_change, false), c.totp_enabled_at is not null, c.user_id is not null
  from auth_sessions s
  join users u on u.id = s.user_id and u.disabled_at is null
  left join user_credentials c on c.user_id = s.user_id
  where s.id = p_session_id and s.revoked_at is null and s.expires_at > now()
$$;

create or replace function auth_session_revoke(p_session_id uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  update auth_sessions set revoked_at = now() where id = p_session_id and revoked_at is null
$$;

-- ───────────── 본인 계정(기관 컨텍스트 안, app_user() 본인만) ─────────────
create or replace function auth_self_credentials()
returns table (password_hash text, totp_secret_enc text, totp_enabled boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select password_hash, totp_secret_enc, totp_enabled_at is not null from user_credentials where user_id = app_user()
$$;

-- 비밀번호 변경: 다른 세션은 모두 끊는다(현재 세션 p_keep_session만 유지).
create or replace function auth_self_set_password(p_hash text, p_keep_session uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app_user() is null then raise exception 'no actor' using errcode = '42501'; end if;
  update user_credentials set password_hash = p_hash, must_change = false, password_changed_at = now(), updated_at = now()
    where user_id = app_user();
  if not found then raise exception 'no credentials' using errcode = '42501'; end if;
  update auth_sessions set revoked_at = now() where user_id = app_user() and id <> p_keep_session and revoked_at is null;
  insert into audit_events (tenant_id, actor_user_id, category, action, result) values (app_tenant(), app_user(), 'AUTH', 'password.change', 'SUCCESS');
end $$;

-- OTP 등록: 대기 비밀키 저장(이미 켜져 있으면 거부) → 코드 확인 후 켬
create or replace function auth_self_totp_begin(p_secret_enc text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update user_credentials set totp_secret_enc = p_secret_enc, updated_at = now()
    where user_id = app_user() and totp_enabled_at is null;
  if not found then raise exception 'totp already enabled' using errcode = '42501'; end if;
end $$;

create or replace function auth_self_totp_enable(p_step bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update user_credentials set totp_enabled_at = now(), totp_last_step = p_step, updated_at = now()
    where user_id = app_user() and totp_enabled_at is null and totp_secret_enc is not null;
  if not found then raise exception 'totp not pending' using errcode = '42501'; end if;
  insert into audit_events (tenant_id, actor_user_id, category, action, result) values (app_tenant(), app_user(), 'AUTH', 'mfa.enable', 'SUCCESS');
end $$;

-- ───────────── 기관관리자(현재 기관 안에서만) ─────────────
create or replace function auth_is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from auth_memberships(app_user()) m where m.tenant_id = app_tenant() and 'INSTITUTION_ADMIN' = any (m.roles))
$$;

create or replace function auth_admin_users()
returns table (user_id uuid, username text, display_name text, roles text[], revoked_at timestamptz,
               has_password boolean, must_change boolean, totp_enabled boolean, locked_until timestamptz, last_login_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not auth_is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
    select u.id, u.username, u.display_name, m.roles, m.revoked_at, c.user_id is not null, coalesce(c.must_change, false),
           c.totp_enabled_at is not null, c.locked_until,
           (select max(s.created_at) from auth_sessions s where s.user_id = u.id and s.tenant_id = app_tenant())
    from memberships m join users u on u.id = m.user_id left join user_credentials c on c.user_id = u.id
    where m.tenant_id = app_tenant() and 'SYSTEM_WORKER' <> all (m.roles)
    order by m.revoked_at nulls first, u.display_name;
end $$;

-- 직원 계정 생성: 아이디는 전체 시스템에서 유일(자동 병합 없음). 임시 비밀번호로 시작.
create or replace function auth_admin_create_user(p_username text, p_display_name text, p_hash text, p_roles text[])
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid;
begin
  if not auth_is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if 'SYSTEM_WORKER' = any (p_roles) then raise exception 'invalid role' using errcode = '22023'; end if;
  insert into users (username, display_name) values (p_username, p_display_name) returning id into uid;
  insert into user_credentials (user_id, password_hash, must_change) values (uid, p_hash, true);
  insert into memberships (tenant_id, user_id, roles) values (app_tenant(), uid, p_roles);
  insert into audit_events (tenant_id, actor_user_id, category, action, resource_type, resource_id, result)
    values (app_tenant(), app_user(), 'ADMIN', 'user.create', 'USER', uid::text, 'SUCCESS');
  return uid;
end $$;

-- 비밀번호 초기화(임시 비밀번호), 선택적으로 OTP 초기화(휴대폰 분실). 대상의 모든 세션을 끊는다.
create or replace function auth_admin_reset_password(p_user_id uuid, p_hash text, p_reset_totp boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not auth_is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if not exists (select 1 from memberships where tenant_id = app_tenant() and user_id = p_user_id) then
    raise exception 'not in tenant' using errcode = '42501';
  end if;
  insert into user_credentials (user_id, password_hash, must_change) values (p_user_id, p_hash, true)
    on conflict (user_id) do update set password_hash = excluded.password_hash, must_change = true, failed_count = 0,
      locked_until = null, password_changed_at = now(), updated_at = now(),
      totp_secret_enc = case when p_reset_totp then null else user_credentials.totp_secret_enc end,
      totp_enabled_at = case when p_reset_totp then null else user_credentials.totp_enabled_at end;
  update auth_sessions set revoked_at = now() where user_id = p_user_id and revoked_at is null;
  insert into audit_events (tenant_id, actor_user_id, category, action, resource_type, resource_id, result, reason)
    values (app_tenant(), app_user(), 'ADMIN', 'user.reset_password', 'USER', p_user_id::text, 'SUCCESS',
            case when p_reset_totp then 'with_mfa_reset' end);
end $$;

-- 역할 변경·권한 회수. 자기 자신의 관리자 권한은 스스로 없앨 수 없다(기관에 관리자가 사라지는 사고 방지).
create or replace function auth_admin_set_membership(p_user_id uuid, p_roles text[], p_revoke boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not auth_is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_user_id = app_user() and (p_revoke or not ('INSTITUTION_ADMIN' = any (p_roles))) then
    raise exception 'cannot remove own admin' using errcode = '42501';
  end if;
  if 'SYSTEM_WORKER' = any (p_roles) then raise exception 'invalid role' using errcode = '22023'; end if;
  update memberships set roles = p_roles, revoked_at = case when p_revoke then coalesce(revoked_at, now()) else null end
    where tenant_id = app_tenant() and user_id = p_user_id;
  if not found then raise exception 'not in tenant' using errcode = '42501'; end if;
  if p_revoke then
    update auth_sessions set revoked_at = now() where user_id = p_user_id and tenant_id = app_tenant() and revoked_at is null;
  end if;
  insert into audit_events (tenant_id, actor_user_id, category, action, resource_type, resource_id, result, reason)
    values (app_tenant(), app_user(), 'ADMIN', case when p_revoke then 'user.revoke' else 'user.roles' end, 'USER', p_user_id::text,
            'SUCCESS', array_to_string(p_roles, ','));
end $$;

revoke all on function
  auth_login_info(text), auth_login_failed(uuid, int, interval, text), auth_login_succeeded(uuid, uuid, bigint, interval, text),
  auth_session_open(uuid, uuid, interval), auth_session_check(uuid), auth_session_revoke(uuid),
  auth_self_credentials(), auth_self_set_password(text, uuid), auth_self_totp_begin(text), auth_self_totp_enable(bigint),
  auth_is_admin(), auth_admin_users(), auth_admin_create_user(text, text, text, text[]),
  auth_admin_reset_password(uuid, text, boolean), auth_admin_set_membership(uuid, text[], boolean)
from public;
grant execute on function
  auth_login_info(text), auth_login_failed(uuid, int, interval, text), auth_login_succeeded(uuid, uuid, bigint, interval, text),
  auth_session_open(uuid, uuid, interval), auth_session_check(uuid), auth_session_revoke(uuid),
  auth_self_credentials(), auth_self_set_password(text, uuid), auth_self_totp_begin(text), auth_self_totp_enable(bigint),
  auth_is_admin(), auth_admin_users(), auth_admin_create_user(text, text, text, text[]),
  auth_admin_reset_password(uuid, text, boolean), auth_admin_set_membership(uuid, text[], boolean)
to owdms_app;
