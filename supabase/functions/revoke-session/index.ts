import { getAdmin, json, preflight, serviceClient } from "../_shared/util.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Revoca una sesión de cliente o todas las vigentes (botón de pánico).
 *
 * Cuerpo:
 *   { "session_id": "<uuid>" }  → una sesión
 *   { "all": true }             → todas las sesiones vigentes
 *
 * Solo admin. Revocar corta el acceso a las siguientes peticiones; lo que ya
 * está en la memoria del navegador (por ejemplo, blobs ya descargados) no se
 * puede recuperar. Es una limitación real, no un bug.
 */
Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;

  if (req.method !== "POST") {
    return json({ error: "Método no permitido" }, 405);
  }

  try {
    const admin = await getAdmin(req);
    if (admin instanceof Response) return admin;

    const body = await req.json().catch(() => null);
    const supabase = serviceClient();
    const now = new Date().toISOString();

    if (body?.all === true) {
      const { data, error } = await supabase
        .from("client_sessions")
        .update({ revoked_at: now })
        .is("revoked_at", null)
        .gt("expires_at", now)
        .select("id");

      if (error) {
        console.error("revoke all failed:", error.code);
        return json({ error: "No se pudieron revocar las sesiones" }, 500);
      }

      const count = data?.length ?? 0;

      await supabase.from("access_logs").insert({
        event: "session_revoked",
        detail: `todas (${count})`,
      });

      return json({ success: true, revoked: count });
    }

    const sessionId = body?.session_id;

    if (typeof sessionId !== "string" || !UUID_PATTERN.test(sessionId)) {
      return json({ error: "Sesión no encontrada" }, 404);
    }

    const { data, error } = await supabase
      .from("client_sessions")
      .update({ revoked_at: now })
      .eq("id", sessionId)
      .is("revoked_at", null)
      .select("id");

    if (error) {
      console.error("revoke session failed:", error.code);
      return json({ error: "No se pudo revocar la sesión" }, 500);
    }

    if (!data || data.length === 0) {
      return json({ error: "Sesión no encontrada" }, 404);
    }

    await supabase.from("access_logs").insert({
      event: "session_revoked",
      session_id: sessionId,
    });

    return json({ success: true, revoked: data.length });
  } catch (error) {
    console.error("Unexpected error:", error);
    return json({ error: "Error interno" }, 500);
  }
});
