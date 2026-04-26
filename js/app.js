import { createFirestoreService, hasFirebaseConfig } from "./firebase.js";
import { elements, renderPrompts, resetForm, setFormLoading, setStatus, showToast, updateSortDirection } from "./ui.js";

const localStorageKey = "promptario:prompts";
let prompts = [];
let firestoreService = null;
let unsubscribe = null;
let sortField = "createdAt";
let sortDirection = "desc";

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readLocalPrompts() {
  try {
    const stored = window.localStorage.getItem(localStorageKey);
    const parsed = stored ? JSON.parse(stored) : [];

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalPrompts(nextPrompts) {
  window.localStorage.setItem(localStorageKey, JSON.stringify(nextPrompts));
}

function sortPrompts(items) {
  return [...items].sort((first, second) => {
    let result = 0;

    if (sortField === "title") {
      result = first.title.localeCompare(second.title, "es", { sensitivity: "base" });
    } else {
      result = new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime();
    }

    return sortDirection === "asc" ? result : result * -1;
  });
}

function refreshPrompts(nextPrompts) {
  prompts = sortPrompts(nextPrompts);
  renderPrompts(prompts);
}

function getPromptById(id) {
  return prompts.find((prompt) => prompt.id === id);
}

async function copyPrompt(id) {
  const prompt = getPromptById(id);

  if (!prompt) {
    showToast("No se encontró el prompt.", "error");
    return;
  }

  try {
    await navigator.clipboard.writeText(prompt.content);
    showToast("Prompt copiado al portapapeles.");
  } catch {
    showToast("No fue posible copiar el contenido.", "error");
  }
}

async function deletePrompt(id) {
  const prompt = getPromptById(id);

  if (!prompt) {
    showToast("No se encontró el prompt.", "error");
    return;
  }

  const accepted = window.confirm(`¿Eliminar "${prompt.title}"?`);

  if (!accepted) {
    return;
  }

  try {
    if (firestoreService) {
      await firestoreService.deletePrompt(id);
    } else {
      const nextPrompts = readLocalPrompts().filter((item) => item.id !== id);
      writeLocalPrompts(nextPrompts);
      refreshPrompts(nextPrompts);
    }

    showToast("Prompt eliminado.");
  } catch {
    showToast("No fue posible eliminar el prompt.", "error");
  }
}

async function handleSubmit(event) {
  event.preventDefault();

  const title = elements.titleInput.value.trim();
  const content = elements.contentInput.value.trim();

  if (!title || !content) {
    showToast("Completa el título y el contenido.", "error");
    return;
  }

  setFormLoading(true);

  try {
    if (firestoreService) {
      await firestoreService.createPrompt({ title, content });
    } else {
      const nextPrompts = [
        ...readLocalPrompts(),
        {
          id: createId(),
          title,
          content,
          createdAt: new Date().toISOString()
        }
      ];

      writeLocalPrompts(nextPrompts);
      refreshPrompts(nextPrompts);
    }

    resetForm();
    showToast("Prompt guardado.");
  } catch {
    showToast("No fue posible guardar el prompt.", "error");
  } finally {
    setFormLoading(false);
  }
}

function handleListClick(event) {
  const actionButton = event.target.closest("button[data-action]");

  if (!actionButton) {
    return;
  }

  const id = actionButton.dataset.id;
  const action = actionButton.dataset.action;

  if (action === "copy") {
    copyPrompt(id);
  }

  if (action === "delete") {
    deletePrompt(id);
  }
}

function handleSortFieldChange(event) {
  sortField = event.target.value;
  refreshPrompts(prompts);
}

function handleSortDirectionClick() {
  sortDirection = sortDirection === "asc" ? "desc" : "asc";
  updateSortDirection(sortDirection);
  refreshPrompts(prompts);
}

function loadLocalMode(message) {
  firestoreService = null;
  setStatus(message);
  refreshPrompts(readLocalPrompts());
}

async function loadFirestoreMode() {
  try {
    firestoreService = await createFirestoreService();

    if (!firestoreService) {
      loadLocalMode("Modo local activo");
      return;
    }

    setStatus("Conectando con Firestore");
    unsubscribe = firestoreService.subscribePrompts((nextPrompts) => {
      setStatus("Firestore activo");
      refreshPrompts(nextPrompts);
    }, () => {
      loadLocalMode("Modo local por error de Firebase");
      showToast("Firebase no respondió. Se activó el modo local.", "error");
    });
  } catch {
    loadLocalMode("Modo local por configuración pendiente");
    showToast("Agrega tu configuración de Firebase para activar sincronización.", "error");
  }
}

function bindEvents() {
  elements.form.addEventListener("submit", handleSubmit);
  elements.promptList.addEventListener("click", handleListClick);
  elements.sortField.addEventListener("change", handleSortFieldChange);
  elements.sortDirection.addEventListener("click", handleSortDirectionClick);
  window.addEventListener("beforeunload", () => {
    if (typeof unsubscribe === "function") {
      unsubscribe();
    }
  });
}

function init() {
  bindEvents();
  updateSortDirection(sortDirection);

  if (hasFirebaseConfig) {
    loadFirestoreMode();
  } else {
    loadLocalMode("Modo local activo");
  }
}

init();
