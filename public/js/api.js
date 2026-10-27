import { config } from "./config.js";

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function postJson(path, body) {
  const res = await fetch(`${config.functionsUrl}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "omit",
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data?.error || "Error de red", res.status);
  }
  return data;
}

export const api = {
  /** Canjea un código y devuelve { token, expires_at, server_time }. */
  redeem: (code) => postJson("redeem-code", { code }),

  /** Lista las evidencias publicadas. */
  listEvidence: (token) => postJson("list-evidence", { token }),

  /** Descarga una imagen como Blob (la sesión se valida en el servidor). */
  async image(token, evidenceId) {
    const res = await fetch(`${config.functionsUrl}/get-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, evidence_id: evidenceId }),
      cache: "no-store",
      credentials: "omit",
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(data?.error || "No se pudo cargar la imagen", res.status);
    }
    return res.blob();
  },
};
