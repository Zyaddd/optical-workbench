-- Optical Workbench accounts for the static (GitHub Pages) edition.
-- Run this once in the Supabase SQL editor. Running it again is safe.
--
-- Accounts use a username and password (no email). The tables live in the
-- private "workbench" schema, which the Supabase API does not expose. The
-- browser can only call the public workbench_* functions below, and each one
-- checks the caller's session token before touching any data.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists workbench;
revoke all on schema workbench from public;

create table if not exists workbench.accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists accounts_username on workbench.accounts (lower(username));

create table if not exists workbench.sessions (
  token_hash bytea primary key,
  account_id uuid not null references workbench.accounts(id) on delete cascade,
  expires timestamptz not null
);
create index if not exists sessions_expiry on workbench.sessions (expires);
create index if not exists sessions_account on workbench.sessions (account_id);

create table if not exists workbench.projects (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references workbench.accounts(id) on delete cascade,
  name text not null,
  body json not null,
  bytes integer not null,
  updated_at timestamptz not null default now(),
  revision integer not null default 1
);
create index if not exists projects_account on workbench.projects (account_id, updated_at desc);

create table if not exists workbench.attempts (
  key text primary key,
  count integer not null,
  until timestamptz not null
);

alter table workbench.accounts enable row level security;
alter table workbench.sessions enable row level security;
alter table workbench.projects enable row level security;
alter table workbench.attempts enable row level security;

-- Helpers (private) ---------------------------------------------------------

create or replace function workbench.fail(p_status integer, p_message text)
returns json language sql immutable set search_path = '' as $$
  select json_build_object('status', p_status, 'error', p_message)
$$;

-- Counts an attempt and reports whether it is still within the limit.
-- Failures return an error object instead of raising, so the count is kept.
create or replace function workbench.throttle(p_key text, p_limit integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  delete from workbench.attempts where until <= now();
  insert into workbench.attempts as a (key, count, until)
  values (p_key, 1, now() + interval '15 minutes')
  on conflict (key) do update set count = a.count + 1
  returning a.count into v_count;
  return v_count <= p_limit;
end $$;

-- The caller's address as reported by the Supabase edge, or null if unknown.
create or replace function workbench.client_ip()
returns text language plpgsql stable set search_path = '' as $$
declare v_headers json;
begin
  v_headers := nullif(current_setting('request.headers', true), '')::json;
  return coalesce(v_headers->>'cf-connecting-ip', v_headers->>'x-real-ip');
exception when others then
  return null;
end $$;

create or replace function workbench.session_account(p_token text)
returns workbench.accounts language sql stable security definer set search_path = '' as $$
  select a.* from workbench.sessions s
  join workbench.accounts a on a.id = s.account_id
  where s.token_hash = extensions.digest(coalesce(p_token, ''), 'sha256')
    and s.expires > now()
$$;

create or replace function workbench.authenticate(p_username text, p_password text, p_signup boolean, p_previous text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_username text := btrim(coalesce(p_username, ''));
  v_ip text := workbench.client_ip();
  v_account workbench.accounts;
  v_token text;
begin
  if v_ip is not null and not workbench.throttle('ip:' || v_ip, 30) then
    return workbench.fail(429, 'Too many attempts. Try again in a few minutes.');
  end if;
  if v_username !~ '^[A-Za-z0-9_]{3,32}$' then
    return workbench.fail(400, 'Use 3–32 letters, numbers or underscores for your username.');
  end if;
  if p_password is null or char_length(p_password) < (case when p_signup then 8 else 1 end) then
    return workbench.fail(400, case when p_signup then 'Use a password of at least 8 characters.' else 'Enter your password.' end);
  end if;
  if octet_length(p_password) > 72 then
    return workbench.fail(400, 'Use a password of at most 72 characters.');
  end if;
  if not workbench.throttle('user:' || lower(v_username), 15) then
    return workbench.fail(429, 'Too many attempts. Try again in a few minutes.');
  end if;

  if p_signup then
    insert into workbench.accounts (username, password_hash)
    values (v_username, extensions.crypt(p_password, extensions.gen_salt('bf', 10)))
    on conflict ((lower(username))) do nothing
    returning * into v_account;
    if not found then
      return workbench.fail(409, 'That username is already taken.');
    end if;
  else
    select * into v_account from workbench.accounts where lower(username) = lower(v_username);
    if not found then
      perform extensions.crypt(p_password, extensions.gen_salt('bf', 10));
      return workbench.fail(401, 'Incorrect username or password.');
    end if;
    if v_account.password_hash <> extensions.crypt(p_password, v_account.password_hash) then
      return workbench.fail(401, 'Incorrect username or password.');
    end if;
  end if;

  if p_previous is not null then
    delete from workbench.sessions where token_hash = extensions.digest(p_previous, 'sha256');
  end if;
  delete from workbench.sessions where expires <= now();
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into workbench.sessions (token_hash, account_id, expires)
  values (extensions.digest(v_token, 'sha256'), v_account.id, now() + interval '7 days');
  return json_build_object('username', v_account.username, 'token', v_token);
end $$;

-- Public API (called from the browser) --------------------------------------

create or replace function public.workbench_signup(p_username text, p_password text, p_previous text default null)
returns json language sql security definer set search_path = '' as $$
  select workbench.authenticate(p_username, p_password, true, p_previous)
$$;

create or replace function public.workbench_login(p_username text, p_password text, p_previous text default null)
returns json language sql security definer set search_path = '' as $$
  select workbench.authenticate(p_username, p_password, false, p_previous)
$$;

create or replace function public.workbench_session(p_token text)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object('username', (workbench.session_account(p_token)).username)
$$;

create or replace function public.workbench_logout(p_token text)
returns json language plpgsql security definer set search_path = '' as $$
begin
  delete from workbench.sessions where token_hash = extensions.digest(coalesce(p_token, ''), 'sha256');
  return json_build_object('username', null);
end $$;

create or replace function public.workbench_list_projects(p_token text, p_expected text default null)
returns json language plpgsql stable security definer set search_path = '' as $$
declare v_account workbench.accounts := workbench.session_account(p_token);
begin
  if v_account.id is null then return workbench.fail(401, 'Sign in to access your saved projects.'); end if;
  if p_expected is not null and p_expected <> v_account.username then
    return workbench.fail(409, 'Your signed-in account changed. Reopen My projects to continue.');
  end if;
  return json_build_object('projects', coalesce((
    select json_agg(json_build_object('id', p.id, 'name', p.name, 'updatedAt', p.updated_at, 'revision', p.revision)
                    order by p.updated_at desc, p.id)
    from workbench.projects p where p.account_id = v_account.id
  ), '[]'::json));
end $$;

create or replace function public.workbench_get_project(p_token text, p_id uuid, p_expected text default null)
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  v_account workbench.accounts := workbench.session_account(p_token);
  v_result json;
begin
  if v_account.id is null then return workbench.fail(401, 'Sign in to access your saved projects.'); end if;
  if p_expected is not null and p_expected <> v_account.username then
    return workbench.fail(409, 'Your signed-in account changed. Reopen My projects to continue.');
  end if;
  select json_build_object('id', p.id, 'name', p.name, 'updatedAt', p.updated_at, 'revision', p.revision, 'project', p.body)
  into v_result from workbench.projects p where p.id = p_id and p.account_id = v_account.id;
  return coalesce(v_result, workbench.fail(404, 'Project not found.'));
end $$;

create or replace function public.workbench_save_project(p_token text, p_project json, p_id uuid default null, p_revision integer default null, p_expected text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_account workbench.accounts := workbench.session_account(p_token);
  v_name text;
  v_bytes integer;
  v_current_revision integer;
  v_current_bytes integer := 0;
  v_count integer;
  v_used bigint;
  v_id uuid := p_id;
  v_revision integer;
  v_updated timestamptz := now();
begin
  if v_account.id is null then return workbench.fail(401, 'Sign in to access your saved projects.'); end if;
  if p_expected is not null and p_expected <> v_account.username then
    return workbench.fail(409, 'Your signed-in account changed. Reopen My projects to continue.');
  end if;
  if p_project is null or json_typeof(p_project) <> 'object'
     or (p_project->>'format') is distinct from 'optical-workbench'
     or (p_project->>'version') is distinct from '2' then
    return workbench.fail(400, 'Not a supported Optical Workbench project.');
  end if;
  v_name := left(coalesce(nullif(btrim(p_project->>'name'), ''), 'Untitled setup'), 100);
  v_bytes := octet_length(p_project::text);
  if v_bytes > 20 * 1024 * 1024 then
    return workbench.fail(413, 'Project limit is 20 MiB. Use local export for larger projects.');
  end if;

  if p_id is not null then
    select revision, bytes into v_current_revision, v_current_bytes
    from workbench.projects where id = p_id and account_id = v_account.id for update;
    if not found then return workbench.fail(404, 'Project not found.'); end if;
    if p_revision is distinct from v_current_revision then
      return workbench.fail(409, 'This project changed in another tab or device. Reopen it or save this layout as a copy.');
    end if;
  end if;

  select count(*), coalesce(sum(bytes), 0) into v_count, v_used
  from workbench.projects where account_id = v_account.id;
  if (p_id is null and v_count >= 30) or v_used - v_current_bytes + v_bytes > 100 * 1024 * 1024 then
    return workbench.fail(413, 'Account storage is full. Download and remove older projects to free space.');
  end if;

  if p_id is not null then
    v_revision := v_current_revision + 1;
    update workbench.projects
    set name = v_name, body = p_project, bytes = v_bytes, updated_at = v_updated, revision = v_revision
    where id = p_id and account_id = v_account.id;
  else
    v_revision := 1;
    insert into workbench.projects (account_id, name, body, bytes, updated_at, revision)
    values (v_account.id, v_name, p_project, v_bytes, v_updated, v_revision)
    returning id into v_id;
  end if;
  return json_build_object('id', v_id, 'name', v_name, 'updatedAt', v_updated, 'revision', v_revision);
end $$;

create or replace function public.workbench_delete_project(p_token text, p_id uuid, p_expected text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare v_account workbench.accounts := workbench.session_account(p_token);
begin
  if v_account.id is null then return workbench.fail(401, 'Sign in to access your saved projects.'); end if;
  if p_expected is not null and p_expected <> v_account.username then
    return workbench.fail(409, 'Your signed-in account changed. Reopen My projects to continue.');
  end if;
  delete from workbench.projects where id = p_id and account_id = v_account.id;
  if not found then return workbench.fail(404, 'Project not found.'); end if;
  return json_build_object('deleted', true);
end $$;

-- Only the public workbench_* functions are callable from the browser.
revoke all on all functions in schema workbench from public;
revoke all on all tables in schema workbench from public;
do $$
declare v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on schema workbench from %I', v_role);
      execute format('revoke all on all tables in schema workbench from %I', v_role);
      execute format('revoke all on all functions in schema workbench from %I', v_role);
      execute format('grant execute on function
        public.workbench_signup(text, text, text), public.workbench_login(text, text, text),
        public.workbench_session(text), public.workbench_logout(text),
        public.workbench_list_projects(text, text), public.workbench_get_project(text, uuid, text),
        public.workbench_save_project(text, json, uuid, integer, text), public.workbench_delete_project(text, uuid, text)
        to %I', v_role);
      -- Saving a layout with embedded 3D models (several MB) takes longer
      -- than Supabase's 3 s default limit for browser requests.
      execute format('alter role %I set statement_timeout = %L', v_role, '60s');
    end if;
  end loop;
end $$;
notify pgrst, 'reload config';
