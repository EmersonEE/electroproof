import {
  corsHeaders,
  findSession,
  json,
  preflight,
  serviceClient,
  TOKEN_PATTERN,
} from "../_shared/util.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Entrega una imagen del bucket privado validando la sesión en CADA solicitud.
 * Usa POST (no GET) para que el token no termine en logs de servidores,
 * historial del navegador ni cabeceras Referer.
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
    const evidenceId = body?.evidence_id;

    if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
      return json({ error: "Sesión inválida o expirada" }, 401);
    }
    if (typeof evidenceId !== "string" || !UUID_PATTERN.test(evidenceId)) {
      return json({ error: "Evidencia no encontrada" }, 404);
    }

    const supabase = serviceClient();
    const session = await findSession(supabase, token);
    if (!session) {
      return json({ error: "Sesión inválida o expirada" }, 401);
    }

    const { data: evidence, error } = await supabase
      .from("evidence")
      .select("object_path")
      .eq("id", evidenceId)
      .eq("is_published", true)
      .maybeSingle();

    if (error || !evidence) {
      return json({ error: "Evidencia no encontrada" }, 404);
    }

    const { data: file, error: fileError } = await supabase.storage
      .from("evidence")
      .download(evidence.object_path);

    if (fileError || !file) {
      console.error("storage download failed:", fileError?.message);
      return json({ error: "No se pudo cargar la imagen" }, 500);
    }

    await supabase.from("access_logs").insert({
      event: "image_view",
      session_id: session.id,
      detail: evidenceId,
    });

    return new Response(file, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": file.type || "application/octet-stream",
        "Content-Length": String(file.size),
        "Cache-Control": "no-store, max-age=0",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    return json({ error: "Error interno" }, 500);
  }
});
