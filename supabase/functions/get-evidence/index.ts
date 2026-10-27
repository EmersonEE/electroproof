

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

async function sha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json();
    const token = body?.token;
    const evidenceId = body?.evidence_id;

    if (
      typeof token !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(token)
    ) {
      return jsonResponse({ error: "Sesión inválida o expirada" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // Validar la sesión del cliente.
    const tokenHash = await sha256(token);

    const { data: session, error: sessionError } = await supabase
      .from("client_sessions")
      .select("id, expires_at")
      .eq("token_hash", tokenHash)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (sessionError || !session) {
      return jsonResponse({ error: "Sesión inválida o expirada" }, 401);
    }

    // Si se solicita una imagen específica.
    if (typeof evidenceId === "string") {
      const { data: evidence, error: evidenceError } = await supabase
        .from("evidence")
        .select("object_path")
        .eq("id", evidenceId)
        .eq("is_published", true)
        .maybeSingle();

      if (evidenceError || !evidence) {
        return jsonResponse({ error: "Evidencia no encontrada" }, 404);
      }

      const { data: file, error: fileError } = await supabase.storage
        .from("evidence")
        .download(evidence.object_path);

      if (fileError || !file) {
        return jsonResponse({ error: "No se pudo cargar la imagen" }, 500);
      }

      return new Response(file, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": file.type || "application/octet-stream",
          "Cache-Control": "no-store, max-age=0",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    // Si no se solicita una imagen, devolver la galería.
    const { data: evidences, error: evidenceError } = await supabase
      .from("evidence")
      .select("id, title, description, category, created_at")
      .eq("is_published", true)
      .order("created_at", { ascending: false })
      .limit(100);

    if (evidenceError) {
      console.error("Evidence query failed:", evidenceError.code);
      return jsonResponse({ error: "No se pudieron cargar las evidencias" }, 500);
    }

    return jsonResponse({
      success: true,
      expires_at: session.expires_at,
      evidences,
    });

  } catch (error) {
    console.error("Unexpected error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});

