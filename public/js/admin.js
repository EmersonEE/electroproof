import { config } from "./config.js";

const el = (id) => document.getElementById(id);

const ui = {
  login: el("login"),
  loginForm: el("login-form"),
  email: el("email"),
  password: el("password"),
  loginSubmit: el("login-submit"),
  loginError: el("login-error"),
  panel: el("panel"),
  logout: el("logout"),
  uploadForm: el("upload-form"),
  file: el("file"),
  title: el("title"),
  description: el("description"),
  category: el("category"),
  publish: el("publish"),
  uploadSubmit: el("upload-submit"),
  uploadStatus: el("upload-status"),
  refresh: el("refresh"),
  evidenceList: el("evidence-list"),
  evidenceEmpty: el("evidence-empty"),
  codeForm: el("code-form"),
  codeLabel: el("code-label"),
  codeMinutes: el("code-minutes"),
  codeSubmit: el("code-submit"),
  codeStatus: el("code-status"),
  codeResult: el("code-result"),
  codeValue: el("code-value"),
  codeCopy: el("code-copy"),
  codeCopyStatus: el("code-copy-status"),
  codeExpiry: el("code-expiry"),
  codeList: el("code-list"),
  codeEmpty: el("code-empty"),
  codesRefresh: el("codes-refresh"),
  codesCleanup: el("codes-cleanup"),
  sessionList: el("session-list"),
  sessionEmpty: el("session-empty"),
  sessionStatus: el("session-status"),
  sessionsRefresh: el("sessions-refresh"),
  sessionsRevokeAll: el("sessions-revoke-all"),
  logList: el("log-list"),
  logEmpty: el("log-empty"),
  logsRefresh: el("logs-refresh"),
};

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

const MAX_BYTES = 10 * 1024 * 1024;

const CATEGORY_LABELS = {
  deposito: "Depósito",
  materiales: "Materiales",
  pago_final: "Pago final",
  entrega: "Entrega",
  otro: "Otro",
};

let db = null;
let thumbUrls = [];

/* ---------- helpers ---------- */

function setMessage(element, message, kind) {
  element.textContent = message;
  element.hidden = message === "";
  element.classList.toggle("ok", kind === "ok");
  element.classList.toggle("bad", kind === "bad");
}

function revokeThumbs() {
  for (const url of thumbUrls) URL.revokeObjectURL(url);
  thumbUrls = [];
}

function formatDate(iso) {
  return new Date(iso).toLocaleString("es-GT", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/* ---------- cliente ---------- */

function initClient() {
  if (!config.publishableKey) {
    setMessage(
      ui.loginError,
      "Falta la publishable key en public/js/config.js.",
      "bad",
    );
    ui.loginSubmit.disabled = true;
    return false;
  }

  db = window.supabase.createClient(config.supabaseUrl, config.publishableKey, {
    // Sin persistencia: recargar el panel obliga a iniciar sesión otra vez.
    auth: {
      persistSession: false,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });

  return true;
}

/* ---------- login ---------- */

ui.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!db) return;

  const email = ui.email.value.trim();
  const password = ui.password.value;

  if (!email || !password) {
    setMessage(ui.loginError, "Escribe tu correo y contraseña.", "bad");
    return;
  }

  ui.loginSubmit.disabled = true;
  ui.loginSubmit.textContent = "Entrando…";
  setMessage(ui.loginError, "", null);

  try {
    const { data, error } = await db.auth.signInWithPassword({ email, password });

    if (error) {
      setMessage(
        ui.loginError,
        "Correo o contraseña incorrectos.",
        "bad",
      );
      return;
    }

    const { data: admin, error: adminError } = await db
      .from("admin_users")
      .select("user_id")
      .eq("user_id", data.user.id)
      .maybeSingle();

    if (adminError || !admin) {
      await db.auth.signOut();
      setMessage(
        ui.loginError,
        "Esta cuenta no tiene permisos de administración.",
        "bad",
      );
      return;
    }

    ui.password.value = "";
    enterPanel();
  } catch {
    setMessage(
      ui.loginError,
      "No se pudo conectar. Revisa tu conexión e intenta de nuevo.",
      "bad",
    );
  } finally {
    ui.loginSubmit.disabled = false;
    ui.loginSubmit.textContent = "Entrar";
  }
});

ui.logout.addEventListener("click", async () => {
  revokeThumbs();
  if (db) await db.auth.signOut();
  location.reload();
});

function enterPanel() {
  ui.login.hidden = true;
  ui.panel.hidden = false;
  ui.logout.hidden = false;
  selectTab("tab-evidence");
}

/* ---------- pestañas ---------- */

const tabs = Array.from(document.querySelectorAll(".tab"));

const tabPanels = {
  "tab-evidence": el("tab-evidence"),
  "tab-codes": el("tab-codes"),
  "tab-sessions": el("tab-sessions"),
  "tab-logs": el("tab-logs"),
};

const tabLoaders = {
  "tab-evidence": loadEvidence,
  "tab-codes": loadCodes,
  "tab-sessions": loadSessions,
  "tab-logs": loadLogs,
};

function selectTab(name) {
  for (const tab of tabs) {
    tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
  }
  for (const [key, panel] of Object.entries(tabPanels)) {
    panel.hidden = key !== name;
  }
  tabLoaders[name]?.();
}

for (const tab of tabs) {
  tab.addEventListener("click", () => selectTab(tab.dataset.tab));
}

/* ---------- evidencias ---------- */

async function loadEvidence() {
  if (!db) return;

  revokeThumbs();
  ui.evidenceList.replaceChildren();
  ui.evidenceEmpty.hidden = true;

  const { data, error } = await db
    .from("evidence")
    .select("id, title, description, category, object_path, is_published, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    ui.evidenceEmpty.hidden = false;
    ui.evidenceEmpty.textContent = "No se pudieron cargar las evidencias.";
    return;
  }

  ui.evidenceEmpty.hidden = data.length > 0;

  for (const evidence of data) {
    ui.evidenceList.append(buildEvidenceItem(evidence));
  }
}

function buildEvidenceItem(evidence) {
  const item = document.createElement("article");
  item.className = "admin-item";

  const image = document.createElement("img");
  image.className = "admin-thumb";
  image.alt = evidence.title;
  image.loading = "lazy";
  loadThumbnail(evidence.object_path, image);

  const info = document.createElement("div");

  const title = document.createElement("h3");
  title.textContent = evidence.title;

  const description = document.createElement("p");
  description.textContent = evidence.description || "Sin descripción";

  const meta = document.createElement("div");
  meta.className = "admin-meta";

  const badge = document.createElement("span");
  badge.className = `badge ${evidence.is_published ? "published" : "draft"}`;
  badge.textContent = evidence.is_published ? "Publicada" : "Borrador";

  const category = document.createElement("span");
  category.textContent = CATEGORY_LABELS[evidence.category] ?? "Otro";

  const date = document.createElement("span");
  date.textContent = formatDate(evidence.created_at);

  meta.append(badge, category, date);
  info.append(title, description, meta);

  const actions = document.createElement("div");
  actions.className = "admin-actions";

  const toggle = document.createElement("button");
  toggle.className = "btn btn-ghost";
  toggle.type = "button";
  toggle.textContent = evidence.is_published ? "Ocultar" : "Publicar";
  toggle.addEventListener("click", () => togglePublished(evidence, toggle));

  const remove = document.createElement("button");
  remove.className = "btn btn-danger";
  remove.type = "button";
  remove.textContent = "Eliminar";
  remove.addEventListener("click", () => deleteEvidence(evidence));

  actions.append(toggle, remove);
  item.append(image, info, actions);

  return item;
}

async function loadThumbnail(path, image) {
  const { data, error } = await db.storage.from("evidence").download(path);

  if (error || !data) {
    image.classList.add("tile-missing");
    return;
  }

  const url = URL.createObjectURL(data);
  thumbUrls.push(url);
  image.src = url;
}

async function togglePublished(evidence, button) {
  button.disabled = true;

  const { error } = await db
    .from("evidence")
    .update({ is_published: !evidence.is_published })
    .eq("id", evidence.id);

  if (error) {
    button.disabled = false;
    setMessage(ui.uploadStatus, "No se pudo cambiar la visibilidad.", "bad");
    return;
  }

  loadEvidence();
}

async function deleteEvidence(evidence) {
  const confirmed = confirm(
    `¿Eliminar "${evidence.title}"? Esta acción no se puede deshacer.`,
  );
  if (!confirmed) return;

  const { error: storageError } = await db.storage
    .from("evidence")
    .remove([evidence.object_path]);

  if (storageError) {
    setMessage(ui.uploadStatus, "No se pudo borrar el archivo del Storage.", "bad");
    return;
  }

  const { error } = await db.from("evidence").delete().eq("id", evidence.id);

  if (error) {
    setMessage(ui.uploadStatus, "No se pudo borrar el registro.", "bad");
    return;
  }

  loadEvidence();
}

ui.refresh.addEventListener("click", loadEvidence);

/* ---------- subida ---------- */

ui.uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!db) return;

  const file = ui.file.files[0];
  const title = ui.title.value.trim();
  const description = ui.description.value.trim();

  if (!file) {
    setMessage(ui.uploadStatus, "Selecciona una imagen.", "bad");
    return;
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    setMessage(ui.uploadStatus, "Formato no permitido. Usa JPG, PNG o WebP.", "bad");
    return;
  }
  if (file.size > MAX_BYTES) {
    setMessage(ui.uploadStatus, "La imagen supera los 10 MB.", "bad");
    return;
  }
  if (title.length < 3) {
    setMessage(ui.uploadStatus, "El título debe tener al menos 3 caracteres.", "bad");
    return;
  }

  const extension = (file.name.split(".").pop() || "jpg")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 5);

  const now = new Date();
  const path = `${now.getFullYear()}/${
    String(now.getMonth() + 1).padStart(2, "0")
  }/${crypto.randomUUID()}.${extension}`;

  ui.uploadSubmit.disabled = true;
  ui.uploadSubmit.textContent = "Subiendo…";
  setMessage(ui.uploadStatus, "", null);

  try {
    const { error: uploadError } = await db.storage
      .from("evidence")
      .upload(path, file, { contentType: file.type, upsert: false });

    if (uploadError) {
      setMessage(ui.uploadStatus, "No se pudo subir la imagen.", "bad");
      return;
    }

    const { data: auth } = await db.auth.getUser();

    const { error: insertError } = await db.from("evidence").insert({
      title,
      description: description || null,
      category: ui.category.value,
      object_path: path,
      is_published: ui.publish.checked,
      created_by: auth?.user?.id ?? null,
    });

    if (insertError) {
      // Si falla el registro, no dejamos el archivo huérfano en el bucket.
      await db.storage.from("evidence").remove([path]);
      setMessage(ui.uploadStatus, "No se pudo guardar la evidencia.", "bad");
      return;
    }

    ui.uploadForm.reset();
    ui.publish.checked = true;
    setMessage(ui.uploadStatus, "Evidencia subida correctamente.", "ok");
    loadEvidence();
  } catch {
    setMessage(ui.uploadStatus, "Error inesperado al subir.", "bad");
  } finally {
    ui.uploadSubmit.disabled = false;
    ui.uploadSubmit.textContent = "Subir";
  }
});

/* ---------- códigos ---------- */

function codeStatus(code) {
  if (code.revoked_at) return { key: "revoked", label: "Revocado" };
  if (code.used_at) return { key: "used", label: "Usado" };
  if (new Date(code.expires_at).getTime() <= Date.now()) {
    return { key: "expired", label: "Vencido" };
  }
  return { key: "available", label: "Disponible" };
}

async function loadCodes() {
  if (!db) return;

  // Columnas explícitas: el panel no tiene permiso para leer code_hash.
  const { data, error } = await db
    .from("access_codes")
    .select("id, label, created_at, expires_at, used_at, revoked_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    ui.codeEmpty.hidden = false;
    ui.codeEmpty.textContent = "No se pudieron cargar los códigos.";
    return;
  }

  ui.codeList.replaceChildren();
  ui.codeEmpty.hidden = data.length > 0;

  for (const code of data) {
    ui.codeList.append(buildCodeItem(code));
  }
}

function buildCodeItem(code) {
  const status = codeStatus(code);

  const item = document.createElement("article");
  item.className = "admin-item code-item";

  const info = document.createElement("div");

  const title = document.createElement("h3");
  title.textContent = code.label || "Sin etiqueta";

  const meta = document.createElement("div");
  meta.className = "admin-meta";

  const badge = document.createElement("span");
  badge.className = `badge ${status.key}`;
  badge.textContent = status.label;

  const created = document.createElement("span");
  created.textContent = `Creado: ${formatDate(code.created_at)}`;

  const expires = document.createElement("span");
  expires.textContent = `Vence: ${formatDate(code.expires_at)}`;

  meta.append(badge, created, expires);
  info.append(title, meta);

  const actions = document.createElement("div");
  actions.className = "admin-actions";

  if (status.key === "available") {
    const revoke = document.createElement("button");
    revoke.className = "btn btn-ghost";
    revoke.type = "button";
    revoke.textContent = "Revocar";
    revoke.addEventListener("click", () => revokeCode(code));
    actions.append(revoke);
  }

  const remove = document.createElement("button");
  remove.className = "btn btn-danger";
  remove.type = "button";
  remove.textContent = "Eliminar";
  remove.addEventListener("click", () => deleteCode(code));
  actions.append(remove);

  item.append(info, actions);
  return item;
}

async function revokeCode(code) {
  const confirmed = confirm(
    `¿Revocar el código de "${code.label || "sin etiqueta"}"? Nadie podrá usarlo.`,
  );
  if (!confirmed) return;

  const { error } = await db
    .from("access_codes")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", code.id);

  if (error) {
    setMessage(ui.codeStatus, "No se pudo revocar el código.", "bad");
    return;
  }

  setMessage(ui.codeStatus, "Código revocado.", "ok");
  loadCodes();
}

async function deleteCode(code) {
  const confirmed = confirm(
    `¿Eliminar el código de "${code.label || "sin etiqueta"}"?\n\n` +
      "Se borra el registro. El historial conserva el evento, pero pierde el vínculo con este código.",
  );
  if (!confirmed) return;

  const { error } = await db.from("access_codes").delete().eq("id", code.id);

  if (error) {
    setMessage(ui.codeStatus, "No se pudo eliminar el código.", "bad");
    return;
  }

  setMessage(ui.codeStatus, "Código eliminado.", "ok");
  loadCodes();
}

async function cleanupCodes() {
  const confirmed = confirm(
    "¿Eliminar TODOS los códigos usados, vencidos o revocados?\n\n" +
      "No toca los que todavía están disponibles. Los eventos quedan en el historial sin vínculo.",
  );
  if (!confirmed) return;

  const nowIso = new Date().toISOString();

  // El filtro se aplica en la base, no sobre lo que está en pantalla.
  const { data, error } = await db
    .from("access_codes")
    .delete()
    .or(
      `revoked_at.not.is.null,used_at.not.is.null,expires_at.lt.${nowIso}`,
    )
    .select("id");

  if (error) {
    setMessage(ui.codeStatus, "No se pudieron eliminar los códigos.", "bad");
    return;
  }

  const count = data?.length ?? 0;
  setMessage(
    ui.codeStatus,
    count > 0
      ? `${count} código(s) eliminados.`
      : "No había códigos para limpiar.",
    "ok",
  );
  loadCodes();
}

ui.codesRefresh.addEventListener("click", loadCodes);
ui.codesCleanup.addEventListener("click", cleanupCodes);

ui.codeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!db) return;

  const label = ui.codeLabel.value.trim();
  const minutes = Number(ui.codeMinutes.value) || 10;

  ui.codeSubmit.disabled = true;
  ui.codeSubmit.textContent = "Generando…";
  setMessage(ui.codeStatus, "", null);
  ui.codeResult.hidden = true;

  try {
    const { data, error } = await db.functions.invoke("generate-code", {
      body: { label: label || null, expires_in_minutes: minutes },
    });

    if (error) {
      let message = "No se pudo generar el código.";
      try {
        const payload = await error.context.json();
        if (payload?.error) message = payload.error;
      } catch {
        // respuesta sin JSON: dejamos el mensaje genérico
      }
      setMessage(ui.codeStatus, message, "bad");
      return;
    }

    ui.codeValue.textContent = data.code;
    ui.codeExpiry.textContent =
      `Vence el ${formatDate(data.expires_at)} · se puede usar una sola vez.`;
    ui.codeCopyStatus.textContent = "";
    ui.codeResult.hidden = false;
    setMessage(
      ui.codeStatus,
      "Código creado. Cópialo ahora: no se puede recuperar después.",
      "ok",
    );

    ui.codeLabel.value = "";
    loadCodes();
  } catch {
    setMessage(ui.codeStatus, "Error inesperado al generar el código.", "bad");
  } finally {
    ui.codeSubmit.disabled = false;
    ui.codeSubmit.textContent = "Generar";
  }
});

ui.codeCopy.addEventListener("click", async () => {
  const code = ui.codeValue.textContent;

  try {
    await navigator.clipboard.writeText(code);
    ui.codeCopyStatus.textContent = "Copiado";
    setTimeout(() => {
      ui.codeCopyStatus.textContent = "";
    }, 2000);
  } catch {
    ui.codeCopyStatus.textContent = "Selecciónalo y cópialo a mano";
  }
});

/* ---------- sesiones ---------- */

function remainingLabel(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Vencida";

  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function loadSessions() {
  if (!db) return;

  const nowIso = new Date().toISOString();

  const { data, error } = await db
    .from("client_sessions")
    .select(
      "id, created_at, expires_at, last_seen_at, ip_hash, access_codes(label)",
    )
    .is("revoked_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    ui.sessionEmpty.hidden = false;
    ui.sessionEmpty.textContent = "No se pudieron cargar las sesiones.";
    return;
  }

  ui.sessionList.replaceChildren();
  ui.sessionEmpty.hidden = data.length > 0;

  for (const session of data) {
    ui.sessionList.append(buildSessionItem(session));
  }
}

function buildSessionItem(session) {
  const item = document.createElement("article");
  item.className = "admin-item session-item";

  const info = document.createElement("div");

  const title = document.createElement("h3");
  const label = session.access_codes?.label;
  title.textContent = label ? `Cliente: ${label}` : "Sesión sin etiqueta";

  const meta = document.createElement("div");
  meta.className = "admin-meta";

  const time = document.createElement("span");
  time.className = "session-time";
  time.dataset.expiresAt = session.expires_at;
  time.textContent = remainingLabel(session.expires_at);

  const created = document.createElement("span");
  created.textContent = `Inicio: ${formatDate(session.created_at)}`;

  const ip = document.createElement("span");
  ip.textContent = session.ip_hash
    ? `IP: ${session.ip_hash.slice(0, 12)}…`
    : "IP: —";

  const seen = document.createElement("span");
  seen.textContent = session.last_seen_at
    ? `Última actividad: ${formatDate(session.last_seen_at)}`
    : "Sin actividad";

  meta.append(time, created, ip, seen);
  info.append(title, meta);

  const actions = document.createElement("div");
  actions.className = "admin-actions";

  const revoke = document.createElement("button");
  revoke.className = "btn btn-danger";
  revoke.type = "button";
  revoke.textContent = "Cortar acceso";
  revoke.addEventListener("click", () => revokeSession(session));
  actions.append(revoke);

  item.append(info, actions);
  return item;
}

async function revokeSession(session) {
  const confirmed = confirm(
    "¿Cortar esta sesión? El cliente perderá el acceso en su siguiente petición.",
  );
  if (!confirmed) return;

  const { error } = await db.functions.invoke("revoke-session", {
    body: { session_id: session.id },
  });

  if (error) {
    setMessage(ui.sessionStatus, "No se pudo revocar la sesión.", "bad");
    return;
  }

  setMessage(ui.sessionStatus, "Sesión revocada.", "ok");
  loadSessions();
}

async function revokeAllSessions() {
  const confirmed = confirm("¿Cortar TODAS las sesiones activas?");
  if (!confirmed) return;

  const { data, error } = await db.functions.invoke("revoke-session", {
    body: { all: true },
  });

  if (error) {
    setMessage(ui.sessionStatus, "No se pudieron revocar las sesiones.", "bad");
    return;
  }

  setMessage(
    ui.sessionStatus,
    `${data?.revoked ?? 0} sesión(es) revocadas.`,
    "ok",
  );
  loadSessions();
}

ui.sessionsRefresh.addEventListener("click", loadSessions);
ui.sessionsRevokeAll.addEventListener("click", revokeAllSessions);

// Mantiene los contadores de las sesiones sin recargar la lista.
setInterval(() => {
  for (const node of document.querySelectorAll("[data-expires-at]")) {
    node.textContent = remainingLabel(node.dataset.expiresAt);
  }
}, 1000);

/* ---------- historial ---------- */

const EVENT_LABELS = {
  code_generated: "Código generado",
  code_revoked: "Código revocado",
  redeem_success: "Acceso concedido",
  redeem_failed: "Intento fallido",
  redeem_rate_limited: "Bloqueo por intentos",
  gallery_view: "Galería abierta",
  image_view: "Imagen vista",
  session_revoked: "Sesión revocada",
};

const EVENT_KIND = {
  redeem_success: "ok",
  code_generated: "ok",
  redeem_failed: "bad",
  redeem_rate_limited: "bad",
  session_revoked: "bad",
  code_revoked: "bad",
};

async function loadLogs() {
  if (!db) return;

  const { data, error } = await db
    .from("access_logs")
    .select("id, event, access_code_id, session_id, ip_hash, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    ui.logEmpty.hidden = false;
    ui.logEmpty.textContent = "No se pudo cargar el historial.";
    return;
  }

  ui.logList.replaceChildren();
  ui.logEmpty.hidden = data.length > 0;

  for (const log of data) {
    ui.logList.append(buildLogItem(log));
  }
}

function buildLogItem(log) {
  const item = document.createElement("article");
  item.className = "admin-item log-item";

  const event = document.createElement("span");
  event.className = `log-event ${EVENT_KIND[log.event] ?? ""}`;
  event.textContent = EVENT_LABELS[log.event] ?? log.event;

  const meta = document.createElement("div");
  meta.className = "log-meta";

  const parts = [formatDate(log.created_at)];
  if (log.detail) parts.push(log.detail);
  if (log.ip_hash) parts.push(`IP ${log.ip_hash.slice(0, 10)}…`);

  meta.textContent = parts.join(" · ");

  item.append(event, meta);
  return item;
}

ui.logsRefresh.addEventListener("click", loadLogs);

/* ---------- arranque ---------- */

initClient();
