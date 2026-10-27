import { api, ApiError } from "./api.js";

const el = (id) => document.getElementById(id);

const ui = {
  gate: el("gate"),
  form: el("code-form"),
  code: el("code"),
  submit: el("submit"),
  gateError: el("gate-error"),
  gallery: el("gallery"),
  timerValue: el("timer-value"),
  progressFill: el("progress-fill"),
  sessionNote: el("session-note"),
  grid: el("grid"),
  galleryEmpty: el("gallery-empty"),
  expired: el("expired"),
  again: el("again"),
  exit: el("exit"),
  lightbox: el("lightbox"),
  lightboxImg: el("lightbox-img"),
  lightboxClose: el("lightbox-close"),
};

const SESSION_MS = 5 * 60 * 1000;

// El token vive SOLO aquí, en memoria. Sin localStorage, sin sessionStorage,
// sin cookies. Al recargar, esta variable nace vacía.
const state = {
  token: null,
  expiresAt: 0,
  offset: 0,
  timerId: null,
  objectUrls: [],
  busy: false,
};

/* ---------- utilidades ---------- */

const onlyCodeChars = (value) =>
  value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 9);

function showError(message) {
  ui.gateError.textContent = message;
  ui.gateError.hidden = message === "";
}

function releaseImages() {
  for (const url of state.objectUrls) URL.revokeObjectURL(url);
  state.objectUrls = [];
}

function stopTimer() {
  if (state.timerId !== null) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
}

function showGate() {
  releaseImages();
  stopTimer();
  state.token = null;
  state.expiresAt = 0;
  ui.grid.replaceChildren();
  ui.gallery.hidden = true;
  ui.expired.hidden = true;
  ui.gate.hidden = false;
  ui.code.value = "";
  showError("");
  ui.code.focus();
}

function endSession() {
  releaseImages();
  stopTimer();
  state.token = null;
  state.expiresAt = 0;
  ui.grid.replaceChildren();
  ui.gallery.hidden = true;
  ui.gate.hidden = true;
  ui.expired.hidden = false;
  ui.again.focus();
}

/* ---------- ingreso ---------- */

ui.code.addEventListener("input", () => {
  ui.code.value = onlyCodeChars(ui.code.value);
});

ui.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.busy) return;

  const code = ui.code.value.trim();

  if (code.replace(/-/g, "").length !== 8) {
    showError("El código tiene 8 caracteres.");
    return;
  }

  state.busy = true;
  ui.submit.disabled = true;
  ui.submit.textContent = "Verificando…";
  showError("");

  try {
    const result = await api.redeem(code);
    await startSession(result);
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.status === 400 || error.status === 401)
    ) {
      showError("Código inválido o expirado.");
    } else {
      showError("No pudimos validar el código. Intenta de nuevo.");
    }
  } finally {
    state.busy = false;
    ui.submit.disabled = false;
    ui.submit.textContent = "Entrar";
  }
});

ui.again.addEventListener("click", showGate);

/* ---------- sesión ---------- */

async function startSession({ token, expires_at, server_time }) {
  state.token = token;
  state.expiresAt = new Date(expires_at).getTime();
  // Compensamos la diferencia entre el reloj del servidor y el del navegador.
  state.offset = new Date(server_time).getTime() - Date.now();

  ui.gate.hidden = true;
  ui.expired.hidden = true;
  ui.gallery.hidden = false;
  ui.grid.replaceChildren();
  ui.galleryEmpty.hidden = true;
  ui.sessionNote.hidden = true;

  startTimer();

  try {
    const { evidences } = await api.listEvidence(token);
    if (state.token !== token) return; // la sesión terminó mientras cargaba
    renderGallery(evidences);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      endSession();
      return;
    }
    ui.galleryEmpty.hidden = false;
    ui.galleryEmpty.textContent = "No se pudieron cargar las evidencias.";
  }
}

function remainingMs() {
  return state.expiresAt - (Date.now() + state.offset);
}

function startTimer() {
  stopTimer();
  tick();
  state.timerId = setInterval(tick, 1000);
}

function tick() {
  const ms = remainingMs();

  if (ms <= 0) {
    endSession();
    return;
  }

  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  ui.timerValue.textContent = `${String(minutes).padStart(2, "0")}:${
    String(seconds).padStart(2, "0")
  }`;
  ui.progressFill.style.width = `${Math.min(100, (ms / SESSION_MS) * 100)}%`;
  ui.sessionNote.hidden = totalSeconds > 60;
}

ui.exit.addEventListener("click", endSession);

/* ---------- galería ---------- */

const CATEGORY_LABELS = {
  deposito: "Depósito",
  materiales: "Materiales",
  pago_final: "Pago final",
  entrega: "Entrega",
  otro: "Otro",
};

function renderGallery(evidences) {
  ui.grid.replaceChildren();

  if (evidences.length === 0) {
    ui.galleryEmpty.hidden = false;
    return;
  }

  ui.galleryEmpty.hidden = true;

  for (const evidence of evidences) {
    const card = document.createElement("article");
    card.className = "tile";

    const image = document.createElement("img");
    image.alt = evidence.title;
    image.loading = "lazy";
    image.decoding = "async";
    card.append(image);

    const body = document.createElement("div");
    body.className = "tile-body";

    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = CATEGORY_LABELS[evidence.category] ?? "Otro";

    const title = document.createElement("h3");
    title.textContent = evidence.title;

    body.append(chip, title);

    if (evidence.description) {
      const description = document.createElement("p");
      description.textContent = evidence.description;
      body.append(description);
    }

    card.append(body);
    card.addEventListener("click", () => {
      if (image.src) openLightbox(image.src, evidence.title);
    });

    ui.grid.append(card);
    loadImage(evidence.id, image);
  }
}

async function loadImage(evidenceId, image) {
  const token = state.token;
  if (!token) return;

  try {
    const blob = await api.image(token, evidenceId);
    if (state.token !== token) return; // la sesión terminó: no mostrar nada

    const url = URL.createObjectURL(blob);
    state.objectUrls.push(url);
    image.src = url;
  } catch {
    image.alt = "Imagen no disponible";
    image.classList.add("tile-missing");
  }
}

/* ---------- lightbox ---------- */

function openLightbox(src, alt) {
  ui.lightboxImg.src = src;
  ui.lightboxImg.alt = alt;
  ui.lightbox.hidden = false;
  ui.lightboxClose.focus();
}

function closeLightbox() {
  ui.lightbox.hidden = true;
  ui.lightboxImg.removeAttribute("src");
  ui.lightboxImg.alt = "";
}

ui.lightbox.addEventListener("click", (event) => {
  if (event.target === ui.lightbox) closeLightbox();
});
ui.lightboxClose.addEventListener("click", closeLightbox);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !ui.lightbox.hidden) closeLightbox();
});

/* ---------- ciclo de vida de la página ---------- */

// Si el navegador restaura la página desde la caché de ida y vuelta (bfcache),
// el token seguiría en memoria: lo destruimos. Recargar siempre pide código.
window.addEventListener("pageshow", (event) => {
  if (event.persisted) showGate();
});

window.addEventListener("pagehide", () => {
  releaseImages();
  stopTimer();
  state.token = null;
});
