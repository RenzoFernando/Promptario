import { createFirestoreService, hasFirebaseConfig } from "./firebase.js";
import { closeCustomSelects, elements, fillForm, fillViewer, renderPrompts, resetForm, setCustomSelectValue, setDeletePromptName, setFormLoading, setFormMode, showToast, toggleComposer, toggleCustomSelect, toggleDeleteDialog, toggleViewer, updateSortDirection, updateSortField, updateViewMode } from "./ui.js";

const localStorageKey = "promptario:prompts";
const preferencesStorageKey = "promptario:preferences";
const validViewModes = ["expanded", "compact", "titles", "grid", "mosaic"];
let prompts = [];
let visiblePrompts = [];
let firestoreService = null;
let unsubscribe = null;
let sortField = "createdAt";
let sortDirection = "desc";
let viewMode = "expanded";
let searchTerm = "";
let pendingDeleteId = null;
let activeViewId = null;

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

function readPreferences() {
  try {
    const stored = window.localStorage.getItem(preferencesStorageKey);
    const parsed = stored ? JSON.parse(stored) : {};
    const nextSortField = parsed.sortField === "title" || parsed.sortField === "createdAt" ? parsed.sortField : "createdAt";
    const nextSortDirection = parsed.sortDirection === "asc" || parsed.sortDirection === "desc" ? parsed.sortDirection : "desc";
    const storedViewMode = parsed.viewMode === "gallery" ? "mosaic" : parsed.viewMode;
    const nextViewMode = validViewModes.includes(storedViewMode) ? storedViewMode : "expanded";

    return {
      sortField: nextSortField,
      sortDirection: nextSortDirection,
      viewMode: nextViewMode
    };
  } catch {
    return {
      sortField: "createdAt",
      sortDirection: "desc",
      viewMode: "expanded"
    };
  }
}

function writePreferences() {
  window.localStorage.setItem(preferencesStorageKey, JSON.stringify({
    sortField,
    sortDirection,
    viewMode
  }));
}

function applyPreferencesToControls() {
  updateSortField(sortField);
  updateSortDirection(sortDirection);
  updateViewMode(viewMode);
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

function filterPrompts(items) {
  const normalizedSearch = searchTerm.trim().toLowerCase();

  if (!normalizedSearch) {
    return items;
  }

  return items.filter((prompt) => {
    const title = prompt.title.toLowerCase();
    const content = prompt.content.toLowerCase();

    return title.includes(normalizedSearch) || content.includes(normalizedSearch);
  });
}

function refreshPrompts(nextPrompts = prompts) {
  prompts = [...nextPrompts];
  visiblePrompts = sortPrompts(filterPrompts(prompts));
  renderPrompts(visiblePrompts, {
    totalPrompts: prompts.length,
    searchTerm,
    viewMode
  });
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

function openCreateComposer() {
  resetForm();
  setFormMode("create");
  toggleComposer(true);
}

function openEditComposer(id) {
  const prompt = getPromptById(id);

  if (!prompt) {
    showToast("No se encontró el prompt.", "error");
    return;
  }

  resetForm();
  setFormMode("edit");
  fillForm(prompt);
  toggleComposer(true);
}

function openPromptViewer(id) {
  const prompt = getPromptById(id);

  if (!prompt) {
    showToast("No se encontró el prompt.", "error");
    return;
  }

  activeViewId = id;
  fillViewer(prompt);
  toggleViewer(true);
}

function closePromptViewer() {
  activeViewId = null;
  fillViewer(null);
  toggleViewer(false);
}

function openDeleteDialog(id) {
  const prompt = getPromptById(id);

  if (!prompt) {
    showToast("No se encontró el prompt.", "error");
    return;
  }

  pendingDeleteId = id;
  setDeletePromptName(prompt.title);
  toggleDeleteDialog(true);
}

function closeDeleteDialog() {
  pendingDeleteId = null;
  setDeletePromptName("");
  toggleDeleteDialog(false);
}

async function deletePrompt(id) {
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

async function confirmDeletePrompt() {
  if (!pendingDeleteId) {
    closeDeleteDialog();
    return;
  }

  const id = pendingDeleteId;
  closeDeleteDialog();
  await deletePrompt(id);
}

async function saveLocalPrompt(id, title, content) {
  const storedPrompts = readLocalPrompts();

  if (id) {
    const nextPrompts = storedPrompts.map((prompt) => {
      if (prompt.id !== id) {
        return prompt;
      }

      return {
        ...prompt,
        title,
        content,
        updatedAt: new Date().toISOString()
      };
    });

    writeLocalPrompts(nextPrompts);
    refreshPrompts(nextPrompts);
    return;
  }

  const nextPrompts = [
    ...storedPrompts,
    {
      id: createId(),
      title,
      content,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];

  writeLocalPrompts(nextPrompts);
  refreshPrompts(nextPrompts);
}

async function handleSubmit(event) {
  event.preventDefault();

  const id = elements.promptIdInput.value.trim();
  const title = elements.titleInput.value.trim();
  const content = elements.contentInput.value.trim();

  if (!title || !content) {
    showToast("Completa el título y el contenido.", "error");
    return;
  }

  setFormLoading(true);

  try {
    if (firestoreService) {
      if (id) {
        await firestoreService.updatePrompt(id, { title, content });
      } else {
        await firestoreService.createPrompt({ title, content });
      }
    } else {
      await saveLocalPrompt(id, title, content);
    }

    resetForm();
    toggleComposer(false);
    showToast(id ? "Prompt actualizado." : "Prompt guardado.");
  } catch {
    showToast(id ? "No fue posible actualizar el prompt." : "No fue posible guardar el prompt.", "error");
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

  if (action === "view") {
    openPromptViewer(id);
  }

  if (action === "edit") {
    openEditComposer(id);
  }

  if (action === "delete") {
    openDeleteDialog(id);
  }
}

function handleSearchInput(event) {
  searchTerm = event.target.value;
  refreshPrompts(prompts);
}

function handleSortFieldChange(event) {
  sortField = event.target.value;
  updateSortField(sortField);
  writePreferences();
  refreshPrompts(prompts);
}

function handleSortDirectionClick() {
  sortDirection = sortDirection === "asc" ? "desc" : "asc";
  updateSortDirection(sortDirection);
  writePreferences();
  refreshPrompts(prompts);
}

function handleViewModeChange(event) {
  viewMode = event.target.value;
  updateViewMode(viewMode);
  writePreferences();
  refreshPrompts(prompts);
}

function handleCustomSelectClick(event) {
  const menu = event.target.closest("[data-select-menu]");

  if (!menu) {
    return;
  }

  const button = event.target.closest(".select-button");
  const option = event.target.closest(".select-option");

  if (button) {
    toggleCustomSelect(menu);
    return;
  }

  if (!option) {
    return;
  }

  const input = menu.querySelector("input");

  if (!input) {
    return;
  }

  setCustomSelectValue(menu.dataset.selectMenu, option.dataset.value);
  closeCustomSelects();
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function handleDocumentClick(event) {
  if (!event.target.closest("[data-select-menu]")) {
    closeCustomSelects();
  }
}

function loadLocalMode() {
  firestoreService = null;
  refreshPrompts(readLocalPrompts());
}

async function loadFirestoreMode() {
  try {
    firestoreService = await createFirestoreService();

    if (!firestoreService) {
      loadLocalMode();
      return;
    }

    unsubscribe = firestoreService.subscribePrompts((nextPrompts) => {
      refreshPrompts(nextPrompts);
    }, () => {
      loadLocalMode();
      showToast("Firebase no respondió. Se activó el modo local.", "error");
    });
  } catch {
    loadLocalMode();
    showToast("Agrega tu configuración de Firebase para activar sincronización.", "error");
  }
}

function bindEvents() {
  elements.form.addEventListener("submit", handleSubmit);
  elements.promptList.addEventListener("click", handleListClick);
  elements.searchInput.addEventListener("input", handleSearchInput);
  elements.sortField.addEventListener("change", handleSortFieldChange);
  elements.sortDirection.addEventListener("click", handleSortDirectionClick);
  elements.viewMode.addEventListener("change", handleViewModeChange);
  elements.selectMenus.forEach((menu) => {
    menu.addEventListener("click", handleCustomSelectClick);
  });
  document.addEventListener("click", handleDocumentClick);
  elements.openComposerButton.addEventListener("click", openCreateComposer);
  elements.closeComposerButton.addEventListener("click", () => {
    resetForm();
    toggleComposer(false);
  });
  elements.composerScreen.addEventListener("click", (event) => {
    if (event.target === elements.composerScreen) {
      resetForm();
      toggleComposer(false);
    }
  });
  elements.closeViewerButton.addEventListener("click", closePromptViewer);
  elements.copyViewerButton.addEventListener("click", () => {
    copyPrompt(activeViewId);
  });
  elements.viewerScreen.addEventListener("click", (event) => {
    if (event.target === elements.viewerScreen) {
      closePromptViewer();
    }
  });
  elements.cancelDeleteButton.addEventListener("click", closeDeleteDialog);
  elements.confirmDeleteButton.addEventListener("click", confirmDeletePrompt);
  elements.deleteScreen.addEventListener("click", (event) => {
    if (event.target === elements.deleteScreen) {
      closeDeleteDialog();
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeCustomSelects();
    }

    if (event.key === "Escape" && elements.viewerScreen.classList.contains("is-open")) {
      closePromptViewer();
      return;
    }

    if (event.key === "Escape" && elements.deleteScreen.classList.contains("is-open")) {
      closeDeleteDialog();
      return;
    }

    if (event.key === "Escape" && elements.composerScreen.classList.contains("is-open")) {
      resetForm();
      toggleComposer(false);
    }
  });
  window.addEventListener("beforeunload", () => {
    if (typeof unsubscribe === "function") {
      unsubscribe();
    }
  });
}

function init() {
  const preferences = readPreferences();
  sortField = preferences.sortField;
  sortDirection = preferences.sortDirection;
  viewMode = preferences.viewMode;
  bindEvents();
  applyPreferencesToControls();

  if (hasFirebaseConfig) {
    loadFirestoreMode();
  } else {
    loadLocalMode();
  }
}

init();
