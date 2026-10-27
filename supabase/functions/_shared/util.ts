import { createClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** 32 bytes aleatorios en base64url = 43 caracteres. */
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Sin I, O, 1 ni 0: evita confusiones al dictar o copiar un código. */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomCode(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const byte of bytes) out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return out;
}

export function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/[\s-]/g, "");
}

export const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;

export function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** IP hasheada: nunca guardamos la IP en claro. */
export async function clientIpHash(req: Request): Promise<string> {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0].trim() ||
    req.headers.get("cf-connecting-ip") ||
    "unknown";
  const salt = Deno.env.get("IP_HASH_SALT") ?? "electroproof-v1";
  return await sha256(`${salt}:${ip}`);
}

/** Token de sesión: 32 bytes en base64url. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type ClientSession = { id: string; expires_at: string };

/** Busca una sesión vigente por el hash del token. No revela el token. */
export async function findSession(
  supabase: ReturnType<typeof serviceClient>,
  token: string,
): Promise<ClientSession | null> {
  const tokenHash = await sha256(token);

  const { data, error } = await supabase
    .from("client_sessions")
    .select("id, expires_at")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error || !data) return null;
  return data as ClientSession;
}

/** Marca actividad. Si falla, no debe romper la petición. */
export async function touchSession(
  supabase: ReturnType<typeof serviceClient>,
  sessionId: string,
): Promise<void> {
  await supabase
    .from("client_sessions")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", sessionId);
}

/** Devuelve el admin autenticado o una Response de error lista para enviar. */
export async function getAdmin(
  req: Request,
): Promise<{ userId: string } | Response> {
  const header = req.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) {
    return json({ error: "No autorizado" }, 401);
  }

  const jwt = header.slice(7).trim();
  if (!jwt) return json({ error: "No autorizado" }, 401);

  const supabase = serviceClient();
  const { data: auth, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !auth.user) {
    return json({ error: "No autorizado" }, 401);
  }

  const { data: admin, error: adminError } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (adminError) {
    console.error("admin_users query failed:", adminError.code);
    return json({ error: "Error interno" }, 500);
  }
  if (!admin) return json({ error: "No autorizado" }, 403);

  return { userId: auth.user.id };
}
