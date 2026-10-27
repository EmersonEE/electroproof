-- ============================================================================
-- Fix: ambigüedad de nombre en redeem_access_code
-- ----------------------------------------------------------------------------
-- El parámetro de salida `expires_at` choca con la columna
-- `client_sessions.expires_at` dentro del RETURNING. PL/pgSQL no sabe a cuál
-- se refiere y aborta en tiempo de ejecución:
--   ERROR: column reference "expires_at" is ambiguous
--
-- Se califica con el alias `cs` para que sea inequívocamente la columna.
-- ============================================================================

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

  insert into public.client_sessions as cs
    (token_hash, access_code_id, expires_at, ip_hash)
  values
    (p_token_hash, v_code_id, now() + interval '5 minutes', p_ip_hash)
  returning cs.id, cs.expires_at into v_session_id, v_expires_at;

  insert into public.access_logs (event, access_code_id, session_id, ip_hash)
  values ('redeem_success', v_code_id, v_session_id, p_ip_hash);

  return query select v_session_id, v_expires_at;
end;
$$;

-- CREATE OR REPLACE conserva los privilegios, pero los repetimos por claridad.
revoke all on function public.redeem_access_code(text, text, text) from public, anon, authenticated;
grant execute on function public.redeem_access_code(text, text, text) to service_role;
