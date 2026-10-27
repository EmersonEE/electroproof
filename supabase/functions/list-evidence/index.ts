import {
  findSession,
  json,
  preflight,
  serviceClient,
  TOKEN_PATTERN,
  touchSession,
} from "../_shared/util.ts";

/**
 * Lista las evidencias publicadas para una sesión vigente.
 * No entrega rutas del bucket: solo metadatos. Las imágenes se piden a
 * get-image, que vuelve a validar la sesión en cada solicitud.
 */
Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;

  if (req.method !== "POST") {
    return json({ error: "Método no permitido" }, 405);
  }

  try {
    const body = await req.json().catch(() => null);
    const token = body?.token;

    if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
      return json({ error: "Sesión inválida o expirada" }, 401);
    }

    const supabase = serviceClient();
    const session = await findSession(supabase, token);
    if (!session) {
      return json({ error: "Sesión inválida o expirada" }, 401);
    }

    const { data: evidences, error } = await supabase
      .from("evidence")
      .select("id, title, description, category, created_at")
      .eq("is_published", true)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("evidence query failed:", error.code);
      return json({ error: "No se pudieron cargar las evidencias" }, 500);
    }

    await touchSession(supabase, session.id);
    await supabase.from("access_logs").insert({
      event: "gallery_view",
      session_id: session.id,
    });

    return json({
      success: true,
      expires_at: session.expires_at,
      server_time: new Date().toISOString(),
      evidences: evidences ?? [],
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    return json({ error: "Error interno" }, 500);
  }
});
