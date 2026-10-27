import {
  CODE_PATTERN,
  clientIpHash,
  json,
  normalizeCode,
  preflight,
  randomToken,
  serviceClient,
  sha256,
} from "../_shared/util.ts";

/**
 * Canjea un código de un solo uso y crea una sesión de 5 minutos.
 *
 * - No revela si el código no existe, ya se usó, venció o fue revocado:
 *   todos los casos devuelven el mismo 401.
 * - La atomicidad y el rate limiting viven en la función SQL
 *   `redeem_access_code`, no aquí.
 * - El token en claro se devuelve una sola vez; en la base solo queda el hash.
 */
Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;

  if (req.method !== "POST") {
    return json({ error: "Método no permitido" }, 405);
  }

  try {
    const body = await req.json().catch(() => null);
    const raw = body?.code;

    if (typeof raw !== "string") {
      return json({ error: "Código inválido o expirado" }, 400);
    }

    const code = normalizeCode(raw);

    // Formato inválido: no tocamos la base. No puede coincidir con un código real.
    if (!CODE_PATTERN.test(code)) {
      return json({ error: "Código inválido o expirado" }, 400);
    }

    const supabase = serviceClient();
    const codeHash = await sha256(code);
    const token = randomToken();
    const tokenHash = await sha256(token);
    const ipHash = await clientIpHash(req);

    const { data, error } = await supabase.rpc("redeem_access_code", {
      p_code_hash: codeHash,
      p_token_hash: tokenHash,
      p_ip_hash: ipHash,
    });

    if (error) {
      console.error("redeem_access_code failed:", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      return json({ error: "Error interno" }, 500);
    }

    const session = Array.isArray(data) ? data[0] : null;
    if (!session) {
      return json({ error: "Código inválido o expirado" }, 401);
    }

    return json({
      success: true,
      token,
      expires_at: session.expires_at,
      expires_in: 300,
      // Permite al navegador calcular el temporizador sin confiar en su reloj.
      server_time: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    return json({ error: "Error interno" }, 500);
  }
});
