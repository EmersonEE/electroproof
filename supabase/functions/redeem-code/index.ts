

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(data: unknown, status = 200) {
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

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));

  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return response({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json();
    const code = body?.code;

    if (
      typeof code !== "string" ||
      !/^[A-HJ-NP-Z2-9]{8}$/i.test(code.trim())
    ) {
      return response({ error: "Código inválido o expirado" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const codeHash = await sha256(code.trim().toUpperCase());
    const token = generateToken();
    const tokenHash = await sha256(token);

    const rpcResponse = await fetch(
      `${supabaseUrl}/rest/v1/rpc/redeem_access_code`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": serviceKey,
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          p_code_hash: codeHash,
          p_token_hash: tokenHash,
        }),
      },
    );

    if (!rpcResponse.ok) {
      console.error("Redemption RPC failed:", rpcResponse.status);
      return response({ error: "No fue posible procesar el acceso" }, 500);
    }

    const sessions = await rpcResponse.json();

    if (!Array.isArray(sessions) || sessions.length !== 1) {
      return response({ error: "Código inválido o expirado" }, 401);
    }

    return response({
      success: true,
      token,
      expires_at: sessions[0].expires_at,
      expires_in: 300,
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    return response({ error: "Internal server error" }, 500);
  }
});

