

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateRandomCode(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));

  return Array.from(
    bytes,
    (byte) => alphabet[byte % alphabet.length],
  ).join("");
}

async function sha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return response({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Cliente asociado a la sesión del administrador.
    const authHeader = req.headers.get("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return response({ error: "Authentication required" }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: { Authorization: authHeader },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return response({ error: "Invalid session" }, 401);
    }

    // Comprobar que el usuario sea administrador.
    const { data: admin, error: adminError } = await userClient
      .from("admin_users")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (adminError || !admin) {
      return response({ error: "Administrator access required" }, 403);
    }

    // El cliente privilegiado solo se utiliza en el servidor.
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // Generar un código de un solo uso.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateRandomCode();
      const codeHash = await sha256(code);

      const expiresAt = new Date(
        Date.now() + 24 * 60 * 60 * 1000,
      ).toISOString();

      const { error: insertError } = await adminClient
        .from("access_codes")
        .insert({
          code_hash: codeHash,
          created_by: user.id,
          expires_at: expiresAt,
        });

      if (!insertError) {
        // El código original se entrega una sola vez.
        return response({
          success: true,
          code,
          expires_at: expiresAt,
          usage: "single_use",
        });
      }

      if (insertError.code !== "23505") {
        console.error("Database error:", insertError.code);
        return response({ error: "Could not create access code" }, 500);
      }
    }

    return response({ error: "Could not generate a unique code" }, 500);
  } catch (error) {
    console.error("Unexpected error:", error);
    return response({ error: "Internal server error" }, 500);
  }
});

