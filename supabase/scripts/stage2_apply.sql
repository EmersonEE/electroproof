-- ============================================================================
-- ElectroProof · Etapa 2 — SCRIPT ÚNICO v2 (conserva admin_users)
-- ----------------------------------------------------------------------------
-- Pega TODO este archivo en el SQL Editor y ejecútalo UNA sola vez.
--
-- Qué hace:
--   1. Aborta si las 4 tablas a reconstruir tienen datos.
--   2. Borra access_logs, client_sessions, evidence y access_codes (vacías).
--   3. CONSERVA public.admin_users y tu fila de administrador.
--   4. Normaliza admin_users (columnas faltantes + políticas viejas).
--   5. Crea el esquema definitivo, RLS, grants, RPC y bucket privado.
--
-- La última línea es: -- FIN DEL SCRIPT
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Protección: no borrar nada si hay datos en las tablas a reconstruir
-- ----------------------------------------------------------------------------
do $$
declare
  t     text;
  n     bigint;
  total bigint := 0;
begin
  for t in
    select unnest(array['evidence', 'access_codes', 'client_sessions', 'access_logs'])
  loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into n;
      total := total + n;
    end if;
  end loop;

  if total > 0 then
    raise exception 'ABORTADO: hay % filas en las tablas a reconstruir. No se borró nada.', total;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1. Reconstruir las 4 tablas vacías y las funciones viejas
-- ----------------------------------------------------------------------------
drop table if exists public.access_logs    cascade;
drop table if exists public.client_sessions cascade;
drop table if exists public.evidence       cascade;
drop table if exists public.access_codes   cascade;

drop function if exists public.redeem_access_code(text, text) cascade;
drop function if exists public.redeem_access_code(text, text, text) cascade;
drop function if exists public.is_admin() cascade;

-- ----------------------------------------------------------------------------
-- 2. admin_users: se conserva la tabla y la fila, se normaliza
-- ----------------------------------------------------------------------------
do $$
declare
  p record;
begin
  -- Si no existe, la crea el bloque de esquema de abajo.
  if to_regclass('public.admin_users') is not null then
    -- Completa columnas si la versión vieja tenía menos.
    execute 'alter table public.admin_users add column if not exists email text';
    execute 'alter table public.admin_users add column if not exists created_at timestamptz not null default now()';

    -- Elimina políticas viejas de admin_users (se recrea la correcta abajo).
    for p in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = 'admin_users'
    loop
      execute format('drop policy %I on public.admin_users', p.policyname);
    end loop;
  end if;
end;
$$;

-- Políticas viejas del bucket evidence que hayan sobrevivido al cascade.
do $$
declare
  p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (coalesce(qual, '') like '%evidence%' or coalesce(with_check, '') like '%evidence%')
  loop
    begin
      execute format('drop policy %I on storage.objects', p.policyname);
    exception when insufficient_privilege then
      raise notice 'No se pudo borrar la política de Storage %: revísala a mano', p.policyname;
    end;
  end loop;
end;
$$;

-- ============================================================================
-- 3. Esquema definitivo (idéntico a la migración)
-- ============================================================================
-- ============================================================================
-- ElectroProof · Esquema inicial (etapa 2)
-- ----------------------------------------------------------------------------
-- Aplicar en: Supabase Dashboard → SQL Editor (o `supabase db push`).
-- Es idempotente: se puede volver a ejecutar sin borrar datos.
--
-- Regla de oro de este esquema:
--   * `anon`      → CERO privilegios sobre `public`.
--   * `authenticated` → solo lo que necesita el panel admin (RLS + is_admin()).
--   * `service_role`  → único que escribe sesiones y logs (vive en el servidor).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tablas
-- ----------------------------------------------------------------------------

create table if not exists public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

create table if not exists public.access_codes (
  id         uuid primary key default gen_random_uuid(),
  -- Solo el hash SHA-256 (hex). El código en claro nunca se guarda.
  code_hash  text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  -- Etiqueta libre para que el admin identifique el código ("Cliente Juan").
  label      text check (label is null or char_length(label) <= 80),
  created_by uuid references public.admin_users (user_id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  used_at    timestamptz,
  revoked_at timestamptz,
  constraint access_codes_expira_despues check (expires_at > created_at)
);

-- Acelera la búsqueda de códigos aún utilizables.
create index if not exists access_codes_pendientes_idx
  on public.access_codes (expires_at)
  where used_at is null and revoked_at is null;

create table if not exists public.client_sessions (
  id             uuid primary key default gen_random_uuid(),
  -- Hash SHA-256 del token. El token en claro solo existe en el navegador.
  token_hash     text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  access_code_id uuid references public.access_codes (id) on delete set null,
  created_at     timestamptz not null default now(),
  -- Red de seguridad: el RPC siempre fija now() + 5 minutos explícitamente.
  expires_at     timestamptz not null default now() + interval '5 minutes',
  revoked_at     timestamptz,
  last_seen_at   timestamptz,
  ip_hash        text,
  constraint client_sessions_expira_despues check (expires_at > created_at)
);

create index if not exists client_sessions_vigentes_idx
  on public.client_sessions (expires_at)
  where revoked_at is null;

create table if not exists public.evidence (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(title) between 3 and 120),
  description  text check (description is null or char_length(description) <= 600),
  category     text not null default 'deposito'
               check (category in ('deposito', 'materiales', 'pago_final', 'entrega', 'otro')),
  -- Ruta dentro del bucket privado "evidence".
  object_path  text not null unique,
  is_published boolean not null default false,
  created_by   uuid references public.admin_users (user_id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Solo se publica lo que el admin decide publicar.
create index if not exists evidence_publicadas_idx
  on public.evidence (created_at desc)
  where is_published = true;

create table if not exists public.access_logs (
  id             bigint generated always as identity primary key,
  event          text not null check (event in (
                   'code_generated', 'code_revoked',
                   'redeem_success', 'redeem_failed', 'redeem_rate_limited',
                   'gallery_view', 'image_view', 'session_revoked'
                 )),
  access_code_id uuid references public.access_codes (id) on delete set null,
  session_id     uuid references public.client_sessions (id) on delete set null,
  -- IP hasheada (nunca la IP en claro).
  ip_hash        text,
  detail         text,
  created_at     timestamptz not null default now()
);

create index if not exists access_logs_fecha_idx on public.access_logs (created_at desc);
create index if not exists access_logs_ip_intentos_idx
  on public.access_logs (ip_hash, created_at desc)
  where event = 'redeem_failed';

-- ----------------------------------------------------------------------------
-- 2. is_admin()
--    SECURITY DEFINER para poder leer admin_users sin recursión de RLS.
--    search_path vacío + nombres calificados para evitar secuestro de esquema.
-- ----------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users a
    where a.user_id = (select auth.uid())
  );
$$;

-- ----------------------------------------------------------------------------
-- 3. RLS
-- ----------------------------------------------------------------------------

alter table public.admin_users     enable row level security;
alter table public.access_codes    enable row level security;
alter table public.client_sessions enable row level security;
alter table public.evidence        enable row level security;
alter table public.access_logs     enable row level security;

-- admin_users: cada admin solo ve su propia fila. Sin escritura desde el cliente.
drop policy if exists admin_users_select_self on public.admin_users;
create policy admin_users_select_self on public.admin_users
  for select to authenticated
  using (user_id = (select auth.uid()));

-- access_codes: el admin ve y revoca (el insert lo hace la Edge Function).
drop policy if exists access_codes_select_admin on public.access_codes;
create policy access_codes_select_admin on public.access_codes
  for select to authenticated
  using (public.is_admin());

drop policy if exists access_codes_update_admin on public.access_codes;
create policy access_codes_update_admin on public.access_codes
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- client_sessions: el admin ve y revoca. NUNCA crea sesiones desde el navegador.
drop policy if exists client_sessions_select_admin on public.client_sessions;
create policy client_sessions_select_admin on public.client_sessions
  for select to authenticated
  using (public.is_admin());

drop policy if exists client_sessions_update_admin on public.client_sessions;
create policy client_sessions_update_admin on public.client_sessions
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- evidence: CRUD completo solo para admin.
drop policy if exists evidence_select_admin on public.evidence;
create policy evidence_select_admin on public.evidence
  for select to authenticated
  using (public.is_admin());

drop policy if exists evidence_insert_admin on public.evidence;
create policy evidence_insert_admin on public.evidence
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists evidence_update_admin on public.evidence;
create policy evidence_update_admin on public.evidence
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists evidence_delete_admin on public.evidence;
create policy evidence_delete_admin on public.evidence
  for delete to authenticated
  using (public.is_admin());

-- access_logs: solo lectura para admin. Append-only desde el servidor.
drop policy if exists access_logs_select_admin on public.access_logs;
create policy access_logs_select_admin on public.access_logs
  for select to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 4. GRANTs
--    Partimos de cero para anon y authenticated, y otorgamos lo mínimo.
-- ----------------------------------------------------------------------------

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;

-- `authenticated` solo recibe las columnas necesarias: nunca el hash del
-- código ni el hash del token llegan al navegador del admin.
revoke all on all tables in schema public from authenticated;

grant select (user_id, email, created_at)
  on public.admin_users to authenticated;

grant select (id, label, created_by, created_at, expires_at, used_at, revoked_at)
  on public.access_codes to authenticated;
grant update (revoked_at)
  on public.access_codes to authenticated;

grant select (id, access_code_id, created_at, expires_at, revoked_at, last_seen_at, ip_hash)
  on public.client_sessions to authenticated;
grant update (revoked_at)
  on public.client_sessions to authenticated;

grant select, insert, update, delete
  on public.evidence to authenticated;

grant select
  on public.access_logs to authenticated;

-- El servidor (service role) necesita acceso explícito: en este proyecto la
-- exposición automática está desactivada, así que no asumimos grants por defecto.
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Endurecimiento a futuro: las tablas nuevas no nacerán visibles para anon.
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- ----------------------------------------------------------------------------
-- 5. RPC de canje (usado por la Edge Function redeem-code)
--    - Atómico: el UPDATE ... WHERE used_at IS NULL es lo que impide que dos
--      peticiones simultáneas usen el mismo código.
--    - Rate limiting: 10 fallos por IP en 10 minutos.
--    - p_ip_hash es opcional para no romper el redeem-code ya desplegado.
-- ----------------------------------------------------------------------------

create or replace function public.redeem_access_code(
  p_code_hash  text,
  p_token_hash text,
  p_ip_hash    text default null
)
returns table (session_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code_id    uuid;
  v_session_id uuid;
  v_expires_at timestamptz;
  v_fallos     int;
begin
  if p_code_hash !~ '^[0-9a-f]{64}$' or p_token_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  if p_ip_hash is not null then
    select count(*) into v_fallos
    from public.access_logs l
    where l.ip_hash = p_ip_hash
      and l.event = 'redeem_failed'
      and l.created_at > now() - interval '10 minutes';

    if v_fallos >= 10 then
      insert into public.access_logs (event, ip_hash, detail)
      values ('redeem_rate_limited', p_ip_hash, '10 fallos en 10 minutos');
      return;
    end if;
  end if;

  update public.access_codes c
     set used_at = now()
   where c.code_hash = p_code_hash
     and c.used_at is null
     and c.revoked_at is null
     and c.expires_at > now()
  returning c.id into v_code_id;

  if v_code_id is null then
    insert into public.access_logs (event, ip_hash, detail)
    values ('redeem_failed', p_ip_hash, 'código inválido, usado, revocado o vencido');
    return;
  end if;

  insert into public.client_sessions (token_hash, access_code_id, expires_at, ip_hash)
  values (p_token_hash, v_code_id, now() + interval '5 minutes', p_ip_hash)
  returning id, expires_at into v_session_id, v_expires_at;

  insert into public.access_logs (event, access_code_id, session_id, ip_hash)
  values ('redeem_success', v_code_id, v_session_id, p_ip_hash);

  return query select v_session_id, v_expires_at;
end;
$$;

-- Nadie salvo el servidor puede ejecutar el canje.
revoke all on function public.redeem_access_code(text, text, text) from public, anon, authenticated;
grant execute on function public.redeem_access_code(text, text, text) to service_role;

-- is_admin() sí lo necesita `authenticated` (las políticas lo invocan).
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. Bucket privado "evidence" + políticas de Storage (solo admin)
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'evidence',
  'evidence',
  false,
  10485760, -- 10 MiB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Sin políticas para `anon`: el bucket no se puede leer ni escribir sin sesión.
drop policy if exists evidence_storage_select_admin on storage.objects;
create policy evidence_storage_select_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'evidence' and public.is_admin());

drop policy if exists evidence_storage_insert_admin on storage.objects;
create policy evidence_storage_insert_admin on storage.objects
  for insert to authenticated
  with check (bucket_id = 'evidence' and public.is_admin());

drop policy if exists evidence_storage_update_admin on storage.objects;
create policy evidence_storage_update_admin on storage.objects
  for update to authenticated
  using (bucket_id = 'evidence' and public.is_admin())
  with check (bucket_id = 'evidence' and public.is_admin());

drop policy if exists evidence_storage_delete_admin on storage.objects;
create policy evidence_storage_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'evidence' and public.is_admin());

-- `service_role` salta RLS, así que get-evidence puede descargar el archivo.

-- ----------------------------------------------------------------------------
-- 4. Completar el email del admin desde auth.users (si faltaba)
-- ----------------------------------------------------------------------------
update public.admin_users a
   set email = u.email
  from auth.users u
 where u.id = a.user_id
   and a.email is null;

-- FIN DEL SCRIPT
