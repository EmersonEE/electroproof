import {
  getAdmin,
  json,
  preflight,
  randomCode,
  serviceClient,
  sha256,
} from "../_shared/util.ts";

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;

  if (req.method !== "POST") {
    return json({ error: "Método no permitido" }, 405);
  }

  try {
    const admin = await getAdmin(req);
    if (admin instanceof Response) return admin;

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const rawLabel = typeof body.label === "string" ? body.label.trim() : "";
    const label = rawLabel.length > 0 ? rawLabel.slice(0, 80) : null;

    const rawHours = Number(body.expires_in_hours);
    const hours = Number.isFinite(rawHours)
      ? Math.min(Math.max(Math.trunc(rawHours), 1), 168)
      : 24;

    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000)
      .toISOString();

    const supabase = serviceClient();

    // Reintenta si el hash colisiona (probabilidad ínfima, pero es barato).
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode(8);
      const codeHash = await sha256(code);

      const { data, error } = await supabase
        .from("access_codes")
        .insert({
          code_hash: codeHash,
          label,
          created_by: admin.userId,
          expires_at: expiresAt,
        })
        .select("id")
        .single();

      if (!error && data) {
        // El log no debe tumbar la respuesta si falla.
        await supabase.from("access_logs").insert({
          event: "code_generated",
          access_code_id: data.id,
          detail: label,
        });

        return json({
          success: true,
          code,
          expires_at: expiresAt,
          expires_in_hours: hours,
        });
      }

      if (error?.code !== "23505") {
        console.error("access_codes insert failed:", error?.code);
        return json({ error: "No se pudo crear el código" }, 500);
      }
    }

    return json({ error: "No se pudo generar un código único" }, 500);
  } catch (error) {
    console.error("Unexpected error:", error);
    return json({ error: "Error interno" }, 500);
  }
});
