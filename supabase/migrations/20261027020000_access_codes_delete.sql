-- ============================================================================
-- Permitir al admin eliminar códigos de acceso
-- ----------------------------------------------------------------------------
-- RLS no otorga privilegios: hace falta el GRANT explícito.
-- Al borrar un código:
--   * client_sessions.access_code_id → NULL (la sesión sigue viva hasta vencer)
--   * access_logs.access_code_id     → NULL (el evento se conserva sin vínculo)
-- Para cortar una vista en curso hay que revocar la sesión, no el código.
-- ============================================================================

grant delete on public.access_codes to authenticated;

drop policy if exists access_codes_delete_admin on public.access_codes;
create policy access_codes_delete_admin on public.access_codes
  for delete to authenticated
  using (public.is_admin());
