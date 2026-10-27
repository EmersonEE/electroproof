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
  loadEvidence();
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

/* ---------- arranque ---------- */

initClient();
