import { createFirestoreService, hasFirebaseConfig } from "./firebase.js";
import {
  closeCustomSelects,
  elements,
  fillForm,
  fillViewer,
  getSelectedCategories,
  renderCategoryFilter,
  renderCategoryPicker,
  renderPrompts,
  renderSelectedCategoryPreview,
  resetForm,
  resetPinDialog,
  resetRecoveryDialog,
  setCustomSelectValue,
  setDeletePromptName,
  setEditingLocked,
  setFavoriteFilter,
  setFormFavorite,
  setFormPrivacy,
  setFormLoading,
  setFormMode,
  setPinError,
  setPinLoading,
  setRecoveryLoading,
  setRecoveryMessage,
  showToast,
  toggleCategoryManager,
  toggleComposer,
  toggleCustomSelect,
  toggleDeleteDialog,
  togglePinDialog,
  toggleRecoveryDialog,
  toggleViewer,
  updateCategoryFilter,
  updateCharacterCounters,
  updateMarkdownPreview,
  updateSortDirection,
  updateSortField,
  updateViewMode
} from "./ui.js";

const localStorageKey = "promptario:prompts";
const categoriesStorageKey = "promptario:categories";
const preferencesStorageKey = "promptario:preferences";
const validViewModes = ["expanded", "titles", "grid"];
const adminAccessDurationMs = 3 * 60 * 1000;
const allCategoriesValue = "all";
const noCategoryValue = "__none__";
const favoriteAllValue = "all";
const favoriteOnlyValue = "favorites";
let prompts = [];
let categories = [];
let visiblePrompts = [];
let firestoreService = null;
let unsubscribes = [];
let sortField = "isFavorite";
let sortDirection = "asc";
let viewMode = "grid";
let searchTerm = "";
let selectedCategory = allCategoriesValue;
let favoriteFilter = favoriteAllValue;
let visibilityFilter = "all";
let activeSection = "all";
let privatePrompts = [];
let vaultUnlocked = false;
let adminExpiryTimer = null;
let adminAccessExpiresAt = 0;
let vaultExpiryTimer = null;
let vaultExpiresAt = 0;
let vaultGeneration = 0;
let pendingAccessPurpose = "edit";
let activeViewerPrivateContent = null;
let pendingDeleteId = null;
let activeViewId = null;
let pendingProtectedAction = null;
let editingLocked = false;
let pinSubmitInFlight = false;

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeCategoryName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("es");
}

function normalizeCategories(value) {
  const source = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const normalized = [];
  source.forEach((category) => {
    const nextCategory = normalizeCategoryName(category);
    if (!nextCategory || normalized.includes(nextCategory)) {
      return;
    }
    normalized.push(nextCategory);
  });
  return normalized;
}

function normalizePrompt(prompt) {
  return {
    ...prompt,
    categories: normalizeCategories(prompt.categories),
    isFavorite: Boolean(prompt.isFavorite),
    isPrivate: prompt.isPrivate === true
  };
}

function getAllCategories(promptItems = prompts, categoryItems = categories) {
  const categorySet = new Set();
  normalizeCategories(categoryItems).forEach((category) => {
    categorySet.add(category);
  });
  promptItems.forEach((prompt) => {
    normalizeCategories(prompt.categories).forEach((category) => {
      categorySet.add(category);
    });
  });
  return Array.from(categorySet).sort((first, second) =>
    first.localeCompare(second, "es", { sensitivity: "base" })
  );
}

function resolveSelectedCategory(availableCategories) {
  if (selectedCategory === allCategoriesValue || selectedCategory === noCategoryValue) {
    return selectedCategory;
  }
  return availableCategories.includes(selectedCategory) ? selectedCategory : allCategoriesValue;
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

function readLocalCategories() {
  try {
    const stored = window.localStorage.getItem(categoriesStorageKey);
    const parsed = stored ? JSON.parse(stored) : [];
    return normalizeCategories(parsed);
  } catch {
    return [];
  }
}

function writeLocalCategories(nextCategories) {
  window.localStorage.setItem(
    categoriesStorageKey,
    JSON.stringify(normalizeCategories(nextCategories))
  );
}

function readPreferences() {
  try {
    const stored = window.localStorage.getItem(preferencesStorageKey);
    const parsed = stored ? JSON.parse(stored) : {};
    const validSortFields = ["title", "createdAt", "updatedAt", "category", "isFavorite"];
    const nextSortField = validSortFields.includes(parsed.sortField)
      ? parsed.sortField
      : "isFavorite";
    const nextSortDirection =
      parsed.sortDirection === "asc" || parsed.sortDirection === "desc"
        ? parsed.sortDirection
        : "asc";
    const storedViewMode = ["gallery", "mosaic"].includes(parsed.viewMode)
      ? "grid"
      : parsed.viewMode === "compact"
        ? "expanded"
        : parsed.viewMode;
    const nextViewMode = validViewModes.includes(storedViewMode) ? storedViewMode : "grid";
    const nextSelectedCategory =
      typeof parsed.selectedCategory === "string" && parsed.selectedCategory.trim()
        ? normalizeCategoryName(parsed.selectedCategory) || parsed.selectedCategory
        : allCategoriesValue;
    const nextFavoriteFilter =
      parsed.favoriteFilter === favoriteOnlyValue ? favoriteOnlyValue : favoriteAllValue;
    const nextVisibilityFilter = ["all", "public", "private"].includes(parsed.visibilityFilter)
      ? parsed.visibilityFilter
      : "all";
    return {
      sortField: nextSortField,
      sortDirection: nextSortDirection,
      viewMode: nextViewMode,
      selectedCategory: nextSelectedCategory,
      favoriteFilter: nextFavoriteFilter,
      visibilityFilter: nextVisibilityFilter
    };
  } catch {
    return {
      sortField: "isFavorite",
      sortDirection: "asc",
      viewMode: "grid",
      selectedCategory: allCategoriesValue,
      favoriteFilter: favoriteAllValue,
      visibilityFilter: "all"
    };
  }
}

function writePreferences() {
  window.localStorage.setItem(
    preferencesStorageKey,
    JSON.stringify({
      sortField,
      sortDirection,
      viewMode,
      selectedCategory,
      favoriteFilter,
      visibilityFilter
    })
  );
}

function applyPreferencesToControls() {
  updateSortField(sortField);
  updateSortDirection(sortDirection, sortField);
  updateViewMode(viewMode);
  updateCategoryFilter(selectedCategory);
  setFavoriteFilter(favoriteFilter);
  setCustomSelectValue("visibility-filter", visibilityFilter);
}

function comparePromptTitles(first, second) {
  return String(first.title || "").localeCompare(String(second.title || ""), "es", {
    sensitivity: "base",
    numeric: true
  });
}

function comparePromptDates(first, second, field) {
  const left = Date.parse(first[field] || "") || 0;
  const right = Date.parse(second[field] || "") || 0;
  return left - right;
}

function comparePromptCategories(first, second) {
  const left = normalizeCategories(first.categories)[0] || "";
  const right = normalizeCategories(second.categories)[0] || "";
  return left.localeCompare(right, "es", { sensitivity: "base", numeric: true });
}

function sortPrompts(items) {
  return [...items].sort((first, second) => {
    // Las categorías vacías permanecen al final, independientemente de la dirección.
    if (sortField === "category") {
      const firstEmpty = normalizeCategories(first.categories).length === 0;
      const secondEmpty = normalizeCategories(second.categories).length === 0;
      if (firstEmpty !== secondEmpty) return firstEmpty ? 1 : -1;
    }
    let result = 0;
    if (sortField === "createdAt" || sortField === "updatedAt") {
      result = comparePromptDates(first, second, sortField);
    } else if (sortField === "category") {
      result = comparePromptCategories(first, second);
    } else if (sortField === "isFavorite") {
      result = Number(Boolean(second.isFavorite)) - Number(Boolean(first.isFavorite));
      if (result !== 0) return result;
    } else {
      result = comparePromptTitles(first, second);
    }
    if (result !== 0) return sortDirection === "asc" ? result : -result;
    // El desempate no cambia entre recargas y conserva la ordenación natural por título.
    return (
      comparePromptTitles(first, second) ||
      String(first.id || "").localeCompare(String(second.id || ""))
    );
  });
}

function filterPrompts(items) {
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase("es");
  return items.filter((prompt) => {
    const promptCategories = normalizeCategories(prompt.categories);
    const matchesCategory =
      selectedCategory === allCategoriesValue ||
      (selectedCategory === noCategoryValue
        ? promptCategories.length === 0
        : promptCategories.includes(selectedCategory));
    const matchesFavorite = favoriteFilter === favoriteAllValue || prompt.isFavorite;
    const matchesVisibility =
      visibilityFilter === "all" ||
      (visibilityFilter === "private" ? prompt.isPrivate : !prompt.isPrivate);
    if (!matchesCategory || !matchesFavorite || !matchesVisibility) {
      return false;
    }
    if (!normalizedSearch) {
      return true;
    }
    const title = String(prompt.title || "").toLocaleLowerCase("es");
    const content =
      prompt.isPrivate && activeSection !== "private"
        ? ""
        : String(prompt.content || "").toLocaleLowerCase("es");
    const categoryText = promptCategories.join(" ").toLocaleLowerCase("es");
    return (
      title.includes(normalizedSearch) ||
      content.includes(normalizedSearch) ||
      categoryText.includes(normalizedSearch)
    );
  });
}

function refreshPrompts(nextPrompts = prompts, nextCategories = categories) {
  prompts = nextPrompts.map(normalizePrompt);
  categories = getAllCategories(prompts, nextCategories);
  const nextSelectedCategory = resolveSelectedCategory(categories);
  if (nextSelectedCategory !== selectedCategory) {
    selectedCategory = nextSelectedCategory;
    writePreferences();
  }
  renderCategoryFilter(categories, selectedCategory);
  renderCategoryPicker(categories, getSelectedCategories());
  setFavoriteFilter(favoriteFilter);
  const publicPrompts = prompts.filter((prompt) => !prompt.isPrivate);
  const available =
    activeSection === "private" ? (vaultUnlocked ? privatePrompts : []) : publicPrompts;
  visiblePrompts = sortPrompts(filterPrompts(available));
  updateSidebar(publicPrompts);
  renderPrompts(visiblePrompts, {
    totalPrompts: available.length,
    vaultLocked: activeSection === "private" && !vaultUnlocked,
    privateSection: activeSection === "private",
    searchTerm,
    selectedCategory,
    favoriteFilter,
    visibilityFilter,
    sortField,
    sortDirection,
    viewMode
  });
}

function updateSidebar(publicPrompts) {
  const titles = {
    all: ["Todos los prompts", "Encuentra, consulta y organiza tus puntos de partida."],
    favorites: ["Favoritos", "Los prompts que quieres tener siempre a mano."],
    category: [
      selectedCategory === "__none__" ? "Sin categoría" : selectedCategory,
      "Tus prompts organizados por categoría."
    ],
    private: [
      "Prompts privados",
      vaultUnlocked
        ? "Contenido disponible en esta sesión protegida."
        : "Un espacio reservado, protegido por PIN."
    ]
  };
  const selected =
    activeSection === "private"
      ? "private"
      : favoriteFilter === "favorites"
        ? "favorites"
        : selectedCategory !== "all"
          ? "category"
          : "all";
  const [heading, description] = titles[selected];
  document.querySelector("#section-title").textContent = heading;
  document.querySelector("#section-description").textContent = description;
  document.querySelector("#section-eyebrow").textContent =
    selected === "private" ? "BIBLIOTECA PERSONAL / ACCESO RESTRINGIDO" : "BIBLIOTECA PERSONAL";
  document.querySelector("#sidebar-all-count").textContent = String(publicPrompts.length);
  document.querySelector("#sidebar-favorites-count").textContent = String(
    publicPrompts.filter((item) => item.isFavorite).length
  );
  document.querySelector("#lock-vault-button").hidden = !vaultUnlocked;
  document
    .querySelector("#sidebar-private")
    .setAttribute("aria-pressed", String(activeSection === "private"));
  document.querySelector("#sidebar-all").classList.toggle("is-active", selected === "all");
  document
    .querySelector("#sidebar-favorites")
    .classList.toggle("is-active", selected === "favorites");
  document.querySelector("#sidebar-private").classList.toggle("is-active", selected === "private");
  document
    .querySelectorAll("#sidebar-all, #sidebar-favorites")
    .forEach((node) =>
      node.setAttribute("aria-pressed", String(node.classList.contains("is-active")))
    );
  const nav = document.querySelector("#sidebar-categories");
  nav.replaceChildren();
  const total = document.createElement("button");
  total.type = "button";
  total.className = "sidebar-category" + (selected === "all" ? " is-active" : "");
  total.dataset.category = "all";
  total.innerHTML = `<span>Todas las categorías</span><span class="sidebar-count">${publicPrompts.length}</span>`;
  nav.append(total);
  getAllCategories(publicPrompts, categories).forEach((category) => {
    const count = publicPrompts.filter((prompt) => prompt.categories.includes(category)).length;
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "sidebar-category" +
      (selected === "category" && selectedCategory === category ? " is-active" : "");
    button.dataset.category = category;
    const title = document.createElement("span");
    title.textContent = category;
    const number = document.createElement("span");
    number.className = "sidebar-count";
    number.textContent = String(count);
    button.append(title, number);
    nav.append(button);
  });
}

async function loadPrivatePrompts() {
  const generation = vaultGeneration;
  try {
    const details = (await firestoreService.listPrivatePrompts()).map(normalizePrompt);
    // Las vistas previas se obtienen exclusivamente tras validar el PIN en el Worker.
    let nextIndex = 0;
    const loaded = new Array(details.length);
    await Promise.all(
      Array.from({ length: Math.min(4, details.length) }, async () => {
        while (nextIndex < details.length) {
          const index = nextIndex++;
          const item = details[index];
          const content = await firestoreService.readPrivatePrompt(item.id);
          loaded[index] = { ...item, content };
        }
      })
    );
    if (generation !== vaultGeneration || activeSection !== "private" || !hasVaultAccess())
      return false;
    privatePrompts = loaded;
    vaultUnlocked = true;
    refreshPrompts(prompts, categories);
    return true;
  } catch (error) {
    if (generation !== vaultGeneration) return false;
    showToast(
      error?.code === "invalid-session"
        ? "La sesión privada venció. Introduce el PIN nuevamente."
        : "No se pudo cargar la biblioteca privada.",
      "error"
    );
    await lockPrivateVault(false);
    return false;
  }
}

async function lockPrivateVault(shouldRefresh = true, clearAuthorization = false) {
  vaultGeneration += 1;
  if (vaultExpiryTimer !== null) window.clearTimeout(vaultExpiryTimer);
  vaultExpiryTimer = null;
  vaultExpiresAt = 0;
  if (activeSection === "private" && elements.viewerScreen.classList.contains("is-open"))
    closePromptViewer();
  if (activeSection === "private" && elements.composerScreen.classList.contains("is-open"))
    closeComposer();
  vaultUnlocked = false;
  privatePrompts = [];
  activeViewerPrivateContent = null;
  // Abandonar Privados descarta sus datos, pero no invalida el PIN de edición aún vigente.
  if (clearAuthorization || !hasAdminAccess()) await releaseAdminAccess(true);
  if (shouldRefresh) refreshPrompts(prompts, categories);
}

async function changeSection(section, category = "all") {
  if (activeSection === "private" && section !== "private") await lockPrivateVault(false);
  activeSection = section;
  if (section !== "private") {
    selectedCategory = category;
    favoriteFilter = section === "favorites" ? "favorites" : "all";
    setFavoriteFilter(favoriteFilter);
    updateCategoryFilter(selectedCategory);
    writePreferences();
  } else {
    selectedCategory = "all";
    favoriteFilter = "all";
    setFavoriteFilter(favoriteFilter);
    updateCategoryFilter("all");
  }
  elements.searchInput.value = "";
  searchTerm = "";
  refreshPrompts(prompts, categories);
  if (section === "private" && !vaultUnlocked) {
    requestAdminAccess(async () => {
      await loadPrivatePrompts();
    }, "vault");
  }
}

async function toggleCardFavorite(id) {
  const prompt = getPromptById(id);
  if (!prompt) return;
  try {
    const content = prompt.content;
    const data = {
      title: prompt.title,
      content,
      categories: prompt.categories,
      isFavorite: !prompt.isFavorite,
      isPrivate: prompt.isPrivate
    };
    if (firestoreService) {
      await firestoreService.updatePrompt(id, data);
      if (vaultUnlocked) await loadPrivatePrompts();
      if (!prompt.isPrivate && !vaultUnlocked) await releaseAdminAccess();
    } else {
      await saveLocalPrompt(id, data.title, data.content, data.categories, data.isFavorite);
    }
    showToast(data.isFavorite ? "Añadido a favoritos." : "Eliminado de favoritos.");
  } catch {
    showToast("No fue posible actualizar el favorito.", "error");
  }
}

function getPromptById(id) {
  return (
    (vaultUnlocked && hasVaultAccess()
      ? privatePrompts.find((prompt) => prompt.id === id)
      : null) || prompts.find((prompt) => prompt.id === id)
  );
}

function markCopyButtonSuccess(button) {
  if (!button) {
    return;
  }
  button.classList.add("is-copied");
  window.setTimeout(() => {
    button.classList.remove("is-copied");
  }, 850);
}

async function copyPrompt(id, triggerButton = null, authorizedContent = null) {
  const prompt = getPromptById(id);
  if (!prompt) {
    showToast("No se encontró el prompt.", "error");
    return;
  }
  if (prompt.isPrivate && authorizedContent === null && vaultUnlocked && hasVaultAccess()) {
    try {
      const content = await firestoreService.readPrivatePrompt(id);
      await copyPrompt(id, triggerButton, content);
    } catch {
      showToast("No se pudo copiar el contenido privado.", "error");
    }
    return;
  }
  if (prompt.isPrivate && authorizedContent === null) {
    requestAdminAccess(async () => {
      try {
        const content = await firestoreService.readPrivatePrompt(id);
        await copyPrompt(id, triggerButton, content);
      } catch {
        showToast("No fue posible acceder al contenido privado.", "error");
      } finally {
        await releaseAdminAccess();
      }
    }, "read");
    return;
  }
  try {
    await navigator.clipboard.writeText(
      authorizedContent === null ? prompt.content : authorizedContent
    );
    markCopyButtonSuccess(triggerButton);
    showToast("Prompt copiado al portapapeles.");
  } catch {
    showToast("No fue posible copiar el contenido.", "error");
  }
}

function hasAdminAccess() {
  return Boolean(firestoreService && !editingLocked && adminAccessExpiresAt > Date.now());
}

function hasVaultAccess() {
  return Boolean(vaultExpiresAt > Date.now());
}

function startAdminAccessWindow(serverExpiresIn, purpose = "edit") {
  const serverDuration =
    Number.isFinite(serverExpiresIn) && serverExpiresIn > 0
      ? serverExpiresIn * 1000
      : adminAccessDurationMs;
  const duration = Math.min(adminAccessDurationMs, serverDuration);
  if (adminExpiryTimer !== null) window.clearTimeout(adminExpiryTimer);
  adminAccessExpiresAt = Date.now() + duration;
  adminExpiryTimer = window.setTimeout(() => {
    adminExpiryTimer = null;
    adminAccessExpiresAt = 0;
    // Un acceso privado abierto tiene su propio vencimiento y conserva la sesión del Worker.
    if (!hasVaultAccess()) void releaseAdminAccess(true);
  }, duration);
  if (purpose === "vault") {
    if (vaultExpiryTimer !== null) window.clearTimeout(vaultExpiryTimer);
    vaultExpiresAt = Date.now() + Math.min(10 * 60 * 1000, serverDuration);
    vaultExpiryTimer = window.setTimeout(
      () => {
        void lockPrivateVault();
      },
      Math.min(10 * 60 * 1000, serverDuration)
    );
  }
}

async function releaseAdminAccess(force = false) {
  if (!force && (hasAdminAccess() || hasVaultAccess())) return;
  if (adminExpiryTimer !== null) window.clearTimeout(adminExpiryTimer);
  adminExpiryTimer = null;
  adminAccessExpiresAt = 0;
  if (firestoreService && typeof firestoreService.signOutAdmin === "function") {
    await firestoreService.signOutAdmin();
  }
}

function cancelPinDialog() {
  pendingProtectedAction = null;
  pendingAccessPurpose = "edit";
  resetPinDialog();
  togglePinDialog(false);
}

function setApplicationLockState(isLocked) {
  editingLocked = Boolean(isLocked);
  setEditingLocked(editingLocked);
  if (editingLocked) {
    if (vaultUnlocked || hasVaultAccess()) void lockPrivateVault(true, true);
    else void releaseAdminAccess(true);
  }
}

function openRecoveryDialog() {
  resetRecoveryDialog();
  toggleRecoveryDialog(true);
}

function closeRecoveryDialog() {
  resetRecoveryDialog();
  toggleRecoveryDialog(false);
}

function requestAdminAccess(action, purpose = "edit") {
  if (!firestoreService || typeof firestoreService.authenticatePin !== "function") {
    if (purpose !== "vault") {
      action();
      return;
    }
    showToast("Los prompts privados requieren el servidor seguro.", "error");
    return;
  }
  if (editingLocked) {
    pendingProtectedAction = null;
    openRecoveryDialog();
    return;
  }
  // La biblioteca privada exige un PIN nuevo al entrar; el resto reutiliza la autorización breve.
  if (purpose !== "vault" && hasAdminAccess()) {
    void Promise.resolve()
      .then(action)
      .catch(() => showToast("No se pudo completar la operación.", "error"));
    return;
  }
  pendingProtectedAction = action;
  pendingAccessPurpose = purpose;
  elements.pinDialogTitle.textContent =
    purpose === "vault"
      ? "Desbloquear biblioteca privada"
      : purpose === "read"
        ? "Acceso a contenido privado"
        : "Acceso de edición";
  resetPinDialog();
  togglePinDialog(true);
}

function handlePinInput() {
  const normalizedPin = elements.pinInput.value.replace(/\D/g, "").slice(0, 4);
  if (elements.pinInput.value !== normalizedPin) {
    elements.pinInput.value = normalizedPin;
  }
  if (normalizedPin.length === 4 && !pinSubmitInFlight) {
    handlePinSubmit();
  }
}

async function handlePinSubmit(event) {
  if (event) {
    event.preventDefault();
  }
  if (pinSubmitInFlight) {
    return;
  }
  const pin = elements.pinInput.value.trim();
  if (!/^\d{4}$/.test(pin)) {
    return;
  }
  pinSubmitInFlight = true;
  setPinLoading(true);
  setPinError("");
  let result;
  try {
    result = await firestoreService.authenticatePin(pin);
  } catch (error) {
    pinSubmitInFlight = false;
    setPinLoading(false);
    const messages = {
      "pin-not-configured":
        "El PIN no está configurado en el servidor. Configúralo desde PowerShell.",
      "security-api-not-configured": "Falta la dirección del Worker en Firebase.",
      "security-api-invalid": "La dirección del Worker no es válida.",
      "origin-not-allowed": "El servidor no permite el origen de esta página.",
      "client-blocked": "El servidor ha bloqueado este dispositivo o red.",
      "invalid-pin-format": "Introduce cuatro dígitos numéricos."
    };
    const message =
      messages[error?.code || error?.message] ||
      (error?.status === 500
        ? "Error interno del Worker (HTTP 500). Revisa sus secretos y registros."
        : null) ||
      (error?.status === 503
        ? "El servidor de validación no está configurado o disponible (HTTP 503)."
        : null) ||
      (error?.status
        ? `Error del servidor al validar (HTTP ${error.status}).`
        : ["localhost", "127.0.0.1"].includes(window.location.hostname)
          ? "No fue posible contactar al Worker desde localhost. Comprueba la URL y despliega la configuración ALLOW_LOCALHOST del Worker."
          : "No hay conexión con el Worker. Comprueba tu red y la URL configurada.");
    setPinError(message);
    elements.pinInput.value = "";
    elements.pinInput.focus();
    return;
  }
  pinSubmitInFlight = false;
  if (!result || result.ok !== true) {
    setPinLoading(false);
    if (result && result.status === "locked") {
      pendingProtectedAction = null;
      setApplicationLockState(true);
      resetPinDialog();
      togglePinDialog(false);
      openRecoveryDialog();
      return;
    }
    setPinError("PIN incorrecto.");
    elements.pinInput.value = "";
    elements.pinInput.focus();
    return;
  }
  setApplicationLockState(false);
  startAdminAccessWindow(result.expiresIn, pendingAccessPurpose);
  const action = pendingProtectedAction;
  pendingProtectedAction = null;
  resetPinDialog();
  togglePinDialog(false);
  if (typeof action === "function") {
    await action();
  }
}

async function handleRecoveryRequest() {
  if (!firestoreService || typeof firestoreService.requestRecovery !== "function") {
    setRecoveryMessage("No se pudo enviar el enlace.");
    return;
  }
  setRecoveryLoading(true);
  try {
    await firestoreService.requestRecovery();
    setRecoveryLoading(false);
    setRecoveryMessage("Enlace enviado.");
    elements.sendRecoveryButton.disabled = true;
    elements.sendRecoveryButton.textContent = "Enviado";
  } catch {
    setRecoveryLoading(false);
    setRecoveryMessage("No se pudo enviar el enlace.");
  }
}

async function refreshSecurityState() {
  if (!firestoreService || typeof firestoreService.getSecurityStatus !== "function") {
    setApplicationLockState(false);
    return;
  }
  try {
    const result = await firestoreService.getSecurityStatus();
    setApplicationLockState(Boolean(result && result.locked));
  } catch {
    setApplicationLockState(false);
  }
}

function closeComposer() {
  resetForm();
  renderCategoryPicker(categories, []);
  toggleCategoryManager(false);
  toggleComposer(false);
  if (!vaultUnlocked) releaseAdminAccess();
}

function openCreateComposer() {
  resetForm();
  renderCategoryPicker(categories, []);
  setFormMode("create");
  if (activeSection === "private") setFormPrivacy(true);
  toggleComposer(true);
}

async function openEditComposer(id) {
  const prompt = getPromptById(id);
  if (!prompt) {
    showToast("No se encontró el prompt.", "error");
    return;
  }
  let editablePrompt = prompt;
  if (prompt.isPrivate) {
    try {
      const content = await firestoreService.readPrivatePrompt(id);
      editablePrompt = { ...prompt, content };
    } catch {
      showToast("No fue posible abrir el contenido privado.", "error");
      await releaseAdminAccess();
      return;
    }
  }
  resetForm();
  setFormMode("edit");
  fillForm(editablePrompt, categories);
  toggleComposer(true);
}

function openCategoryManager() {
  renderCategoryPicker(categories, getSelectedCategories());
  toggleCategoryManager(true);
}

function closeCategoryManager() {
  elements.categoryNameInput.value = "";
  toggleCategoryManager(false);
}

async function openPromptViewer(id) {
  const prompt = getPromptById(id);
  if (!prompt) {
    showToast("No se encontró el prompt.", "error");
    return;
  }
  let viewPrompt = prompt;
  if (prompt.isPrivate) {
    try {
      const content = await firestoreService.readPrivatePrompt(id);
      activeViewerPrivateContent = content;
      viewPrompt = { ...prompt, content };
    } catch {
      showToast("No fue posible abrir el contenido privado.", "error");
      return;
    } finally {
      if (!vaultUnlocked) await releaseAdminAccess();
    }
  } else {
    activeViewerPrivateContent = null;
  }
  activeViewId = id;
  fillViewer(viewPrompt);
  toggleViewer(true);
}

function closePromptViewer() {
  activeViewId = null;
  activeViewerPrivateContent = null;
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

function closeDeleteDialog(shouldReleaseAdmin = true) {
  pendingDeleteId = null;
  setDeletePromptName("");
  toggleDeleteDialog(false);
  if (shouldReleaseAdmin) {
    releaseAdminAccess();
  }
}

async function deletePrompt(id) {
  try {
    if (firestoreService) {
      await firestoreService.deletePrompt(id);
    } else {
      const nextPrompts = readLocalPrompts().filter((item) => item.id !== id);
      writeLocalPrompts(nextPrompts);
      refreshPrompts(nextPrompts, categories);
    }
    if (vaultUnlocked) await loadPrivatePrompts();
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
  closeDeleteDialog(false);
  try {
    await deletePrompt(id);
  } finally {
    if (!vaultUnlocked) await releaseAdminAccess();
  }
}

async function saveLocalPrompt(id, title, content, promptCategories, isFavorite) {
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
        categories: promptCategories,
        isFavorite,
        isPrivate: false,
        updatedAt: new Date().toISOString()
      };
    });
    writeLocalPrompts(nextPrompts);
    refreshPrompts(nextPrompts, categories);
    return;
  }
  const nextPrompts = [
    ...storedPrompts,
    {
      id: createId(),
      title,
      content,
      categories: promptCategories,
      isFavorite,
      isPrivate: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];
  writeLocalPrompts(nextPrompts);
  refreshPrompts(nextPrompts, categories);
}

async function saveLocalCategory(name) {
  const nextCategories = normalizeCategories([...readLocalCategories(), name]);
  writeLocalCategories(nextCategories);
  refreshPrompts(prompts, nextCategories);
}

async function saveCategory(name) {
  if (firestoreService) {
    await firestoreService.createCategory({ name });
    refreshPrompts(prompts, [...categories, name]);
    return "firebase";
  }
  await saveLocalCategory(name);
  return "local";
}

async function deleteLocalCategory(name) {
  const category = normalizeCategoryName(name);
  const nextCategories = normalizeCategories(
    readLocalCategories().filter((item) => item !== category)
  );
  const nextPrompts = readLocalPrompts().map((prompt) => ({
    ...prompt,
    categories: normalizeCategories(prompt.categories).filter((item) => item !== category)
  }));
  writeLocalCategories(nextCategories);
  writeLocalPrompts(nextPrompts);
  refreshPrompts(nextPrompts, nextCategories);
}

async function deleteCategory(name) {
  if (firestoreService && !hasAdminAccess()) {
    requestAdminAccess(() => deleteCategory(name));
    return;
  }
  const category = normalizeCategoryName(name);
  if (!category) {
    return;
  }
  const selectedCategories = getSelectedCategories().filter((item) => item !== category);
  try {
    if (firestoreService) {
      await firestoreService.deleteCategory(category);
      refreshPrompts(
        prompts.map((prompt) => ({
          ...prompt,
          categories: normalizeCategories(prompt.categories).filter((item) => item !== category)
        })),
        categories.filter((item) => item !== category)
      );
    } else {
      await deleteLocalCategory(category);
    }
    renderCategoryPicker(
      categories.filter((item) => item !== category),
      selectedCategories
    );
    renderSelectedCategoryPreview(selectedCategories);
    showToast("Categoría eliminada.");
  } catch {
    showToast("No fue posible eliminar la categoría.", "error");
  }
}

async function createCategoryFromForm() {
  if (firestoreService && !hasAdminAccess()) {
    requestAdminAccess(() => createCategoryFromForm());
    return;
  }
  const name = normalizeCategoryName(elements.categoryNameInput.value);
  if (!name) {
    showToast("Escribe el nombre de la categoría.", "error");
    return;
  }
  const exists = categories.includes(name);
  const selectedCategories = getSelectedCategories();
  try {
    if (!exists) {
      const categoryStorage = await saveCategory(name);
      showToast(
        categoryStorage === "firebase" ? "Categoría creada." : "Categoría creada en modo local."
      );
    } else {
      showToast("La categoría ya existe.");
    }
    elements.categoryNameInput.value = "";
    renderCategoryPicker(getAllCategories(prompts, [...categories, name]), selectedCategories);
    renderSelectedCategoryPreview(selectedCategories);
  } catch {
    showToast("No fue posible crear la categoría.", "error");
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  if (firestoreService && !hasAdminAccess()) {
    requestAdminAccess(() => elements.form.requestSubmit());
    return;
  }
  const id = elements.promptIdInput.value.trim();
  const rawTitle = elements.titleInput.value;
  const rawContent = elements.contentInput.value;
  const title = rawTitle.trim();
  const content = rawContent.trim();
  const promptCategories = getSelectedCategories();
  const isFavorite = elements.favoriteInput.value === "true";
  const isPrivate = elements.privacyInput.value === "true";
  if (isPrivate && !firestoreService) {
    showToast("Los prompts privados requieren el servidor seguro.", "error");
    return;
  }
  if (!title || !content) {
    showToast("Completa el título y el contenido.", "error");
    return;
  }
  if (elements.titleInput.maxLength > 0 && rawTitle.length > elements.titleInput.maxLength) {
    showToast(
      `El título no puede superar los ${elements.titleInput.maxLength.toLocaleString("es-CO")} caracteres.`,
      "error"
    );
    return;
  }
  if (elements.contentInput.maxLength > 0 && rawContent.length > elements.contentInput.maxLength) {
    showToast(
      `El contenido no puede superar los ${elements.contentInput.maxLength.toLocaleString("es-CO")} caracteres.`,
      "error"
    );
    return;
  }
  setFormLoading(true);
  try {
    if (firestoreService) {
      if (id) {
        await firestoreService.updatePrompt(id, {
          title,
          content,
          categories: promptCategories,
          isFavorite,
          isPrivate
        });
      } else {
        await firestoreService.createPrompt({
          title,
          content,
          categories: promptCategories,
          isFavorite,
          isPrivate
        });
      }
    } else {
      await saveLocalPrompt(id, title, content, promptCategories, isFavorite);
    }
    closeComposer();
    showToast(id ? "Prompt actualizado." : "Prompt guardado.");
  } catch {
    showToast(
      id ? "No fue posible actualizar el prompt." : "No fue posible guardar el prompt.",
      "error"
    );
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
  if (action === "favorite") {
    if (!firestoreService) toggleCardFavorite(id);
    else requestAdminAccess(() => toggleCardFavorite(id));
    return;
  }
  if (action === "copy") {
    copyPrompt(id, actionButton);
    return;
  }
  if (action === "view") {
    const prompt = getPromptById(id);
    if (prompt?.isPrivate && !vaultUnlocked) {
      requestAdminAccess(() => openPromptViewer(id), "read");
    } else {
      openPromptViewer(id);
    }
    return;
  }
  if (action === "edit") {
    requestAdminAccess(() => openEditComposer(id));
    return;
  }
  if (action === "delete") {
    requestAdminAccess(() => openDeleteDialog(id));
  }
}

function handleSearchInput(event) {
  searchTerm = event.target.value;
  refreshPrompts(prompts, categories);
}

function handleCategoryFilterChange(event) {
  selectedCategory = event.target.value || allCategoriesValue;
  if (activeSection !== "private") activeSection = "all";
  updateCategoryFilter(selectedCategory);
  writePreferences();
  refreshPrompts(prompts, categories);
}

function handleFavoriteFilterClick() {
  favoriteFilter = favoriteFilter === favoriteOnlyValue ? favoriteAllValue : favoriteOnlyValue;
  if (activeSection !== "private")
    activeSection = favoriteFilter === "favorites" ? "favorites" : "all";
  setFavoriteFilter(favoriteFilter);
  writePreferences();
  refreshPrompts(prompts, categories);
}

function handleSortFieldChange(event) {
  sortField = event.target.value;
  sortDirection = ["createdAt", "updatedAt"].includes(sortField) ? "desc" : "asc";
  updateSortDirection(sortDirection, sortField);
  updateSortField(sortField);
  writePreferences();
  refreshPrompts(prompts, categories);
}

function handleSortDirectionClick() {
  sortDirection = sortDirection === "asc" ? "desc" : "asc";
  updateSortDirection(sortDirection, sortField);
  writePreferences();
  refreshPrompts(prompts, categories);
}

function resetLibraryFilters() {
  elements.searchInput.value = "";
  searchTerm = "";
  selectedCategory = "all";
  favoriteFilter = "all";
  visibilityFilter = "all";
  if (activeSection !== "private") activeSection = "all";
  sortField = "isFavorite";
  sortDirection = "asc";
  applyPreferencesToControls();
  writePreferences();
  refreshPrompts(prompts, categories);
}

function handlePrivacyFormClick() {
  if (!firestoreService) {
    showToast("La privacidad requiere sincronización con el servidor seguro.", "error");
    return;
  }
  setFormPrivacy(elements.privacyInput.value !== "true");
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

function handleCategoryPickerClick(event) {
  const deleteButton = event.target.closest("button[data-category-delete]");
  if (deleteButton) {
    deleteCategory(deleteButton.dataset.categoryDelete);
    return;
  }
  const categoryButton = event.target.closest("button[data-category]");
  if (!categoryButton) {
    return;
  }
  const selectedCategories = getSelectedCategories();
  const category = categoryButton.dataset.category;
  const nextCategories = selectedCategories.includes(category)
    ? selectedCategories.filter((item) => item !== category)
    : [...selectedCategories, category];
  renderCategoryPicker(categories, nextCategories);
  renderSelectedCategoryPreview(nextCategories);
}

function handleFavoriteFormClick() {
  setFormFavorite(elements.favoriteInput.value !== "true");
}

function handleCategoryNameInput(event) {
  const normalized = normalizeCategoryName(event.target.value);
  if (event.target.value !== normalized) {
    event.target.value = normalized;
  }
}

function handleCategoryNameKeydown(event) {
  if (event.key !== "Enter") {
    return;
  }
  event.preventDefault();
  createCategoryFromForm();
}

function handleDocumentClick(event) {
  if (!event.target.closest("[data-select-menu]")) {
    closeCustomSelects();
  }
}

function loadLocalMode() {
  firestoreService = null;
  elements.privacyButton.disabled = true;
  refreshPrompts(readLocalPrompts(), readLocalCategories());
}

async function loadFirestoreMode() {
  try {
    firestoreService = await createFirestoreService();
    if (!firestoreService) {
      loadLocalMode();
      return;
    }
    elements.privacyButton.disabled = false;
    await refreshSecurityState();
    const unsubscribePrompts = firestoreService.subscribePrompts(
      (nextPrompts) => {
        refreshPrompts(nextPrompts, categories);
      },
      () => {
        loadLocalMode();
        showToast("Firebase no respondió. Se activó el modo local.", "error");
      }
    );
    const unsubscribeCategories = firestoreService.subscribeCategories(
      (nextCategories) => {
        refreshPrompts(prompts, nextCategories);
      },
      () => {
        refreshPrompts(prompts, readLocalCategories());
      }
    );
    unsubscribes = [unsubscribePrompts, unsubscribeCategories];
  } catch {
    loadLocalMode();
    showToast("Agrega tu configuración de Firebase para activar sincronización.", "error");
  }
}

function bindEvents() {
  elements.form.addEventListener("submit", handleSubmit);
  elements.pinForm.addEventListener("submit", handlePinSubmit);
  elements.pinInput.addEventListener("input", handlePinInput);
  elements.cancelPinButton.addEventListener("click", cancelPinDialog);
  elements.unlockButton.addEventListener("click", openRecoveryDialog);
  elements.sendRecoveryButton.addEventListener("click", handleRecoveryRequest);
  elements.cancelRecoveryButton.addEventListener("click", closeRecoveryDialog);
  elements.promptList.addEventListener("click", handleListClick);
  const sidebar = document.querySelector("#library-sidebar");
  const sidebarToggle = document.querySelector("#sidebar-toggle");
  const mobileSidebarToggle = document.querySelector("#mobile-sidebar-toggle");
  function setSidebarCollapsed(collapsed) {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
    sidebarToggle.setAttribute(
      "aria-label",
      collapsed ? "Expandir barra lateral" : "Contraer barra lateral"
    );
    sidebarToggle.title = collapsed ? "Expandir barra lateral" : "Contraer barra lateral";
    sidebarToggle
      .querySelector("use")
      .setAttribute(
        "href",
        `assets/icons/icons.svg#${collapsed ? "chevron-right" : "chevron-left"}`
      );
  }
  try {
    setSidebarCollapsed(window.localStorage.getItem("promptario:sidebar-collapsed") === "true");
  } catch {
    setSidebarCollapsed(false);
  }
  sidebarToggle.addEventListener("click", () => {
    const collapsed = !document.body.classList.contains("sidebar-collapsed");
    setSidebarCollapsed(collapsed);
    try {
      window.localStorage.setItem("promptario:sidebar-collapsed", String(collapsed));
    } catch {
      // La barra lateral sigue funcionando aunque no se puedan guardar preferencias.
    }
  });
  mobileSidebarToggle.addEventListener("click", () => {
    const hidden = sidebar.classList.toggle("is-mobile-hidden");
    mobileSidebarToggle.setAttribute("aria-expanded", String(!hidden));
  });
  document.querySelector("#sidebar-all").addEventListener("click", () => changeSection("all"));
  document
    .querySelector("#sidebar-favorites")
    .addEventListener("click", () => changeSection("favorites"));
  document
    .querySelector("#sidebar-private")
    .addEventListener("click", () => changeSection("private"));
  document
    .querySelector("#unlock-vault-button")
    .addEventListener("click", () => changeSection("private"));
  document.querySelector("#sidebar-categories").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-category]");
    if (button) changeSection("all", button.dataset.category);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (vaultExpiresAt && !hasVaultAccess()) void lockPrivateVault();
    else if (adminAccessExpiresAt && !hasAdminAccess() && !hasVaultAccess())
      void releaseAdminAccess(true);
  });
  document.querySelector("#lock-vault-button").addEventListener("click", async () => {
    await lockPrivateVault(true, true);
    showToast("Biblioteca privada bloqueada.");
  });
  document.querySelectorAll("[data-view-switch]").forEach((button) =>
    button.addEventListener("click", () => {
      viewMode = button.dataset.viewSwitch;
      updateViewMode(viewMode);
      writePreferences();
      refreshPrompts(prompts, categories);
    })
  );
  elements.searchInput.addEventListener("input", handleSearchInput);
  elements.titleInput.addEventListener("input", updateCharacterCounters);
  elements.contentInput.addEventListener("input", () => {
    updateMarkdownPreview();
    updateCharacterCounters();
  });
  elements.categoryFilter.addEventListener("change", handleCategoryFilterChange);
  elements.favoriteFilter.addEventListener("click", handleFavoriteFilterClick);
  elements.sortField.addEventListener("change", handleSortFieldChange);
  elements.sortDirection.addEventListener("click", handleSortDirectionClick);
  elements.openCategoryManagerButton.addEventListener("click", openCategoryManager);
  elements.closeCategoryManagerButton.addEventListener("click", closeCategoryManager);
  elements.createCategoryButton.addEventListener("click", createCategoryFromForm);
  elements.categoryPicker.addEventListener("click", handleCategoryPickerClick);
  elements.favoriteButton.addEventListener("click", handleFavoriteFormClick);
  elements.privacyButton.addEventListener("click", handlePrivacyFormClick);
  elements.clearFilters.addEventListener("click", resetLibraryFilters);
  elements.categoryNameInput.addEventListener("input", handleCategoryNameInput);
  elements.categoryNameInput.addEventListener("keydown", handleCategoryNameKeydown);
  elements.selectMenus.forEach((menu) => {
    menu.addEventListener("click", handleCustomSelectClick);
  });
  document.addEventListener("click", handleDocumentClick);
  elements.openComposerButton.addEventListener("click", () => {
    requestAdminAccess(openCreateComposer);
  });
  elements.closeComposerButton.addEventListener("click", closeComposer);
  elements.composerScreen.addEventListener("click", (event) => {
    if (event.target === elements.composerScreen) {
      closeComposer();
    }
  });
  elements.pinScreen.addEventListener("click", (event) => {
    if (event.target === elements.pinScreen) {
      cancelPinDialog();
    }
  });
  elements.recoveryScreen.addEventListener("click", (event) => {
    if (event.target === elements.recoveryScreen) {
      closeRecoveryDialog();
    }
  });
  elements.categoryScreen.addEventListener("click", (event) => {
    if (event.target === elements.categoryScreen) {
      closeCategoryManager();
    }
  });
  elements.closeViewerButton.addEventListener("click", closePromptViewer);
  elements.copyViewerButton.addEventListener("click", () => {
    copyPrompt(activeViewId, elements.copyViewerButton, activeViewerPrivateContent);
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
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      elements.searchInput.focus();
      elements.searchInput.select();
      return;
    }
    if (event.key === "Escape") {
      closeCustomSelects();
    }
    if (event.key === "Escape" && elements.pinScreen.classList.contains("is-open")) {
      cancelPinDialog();
      return;
    }
    if (event.key === "Escape" && elements.recoveryScreen.classList.contains("is-open")) {
      closeRecoveryDialog();
      return;
    }
    if (event.key === "Escape" && elements.categoryScreen.classList.contains("is-open")) {
      closeCategoryManager();
      return;
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
      closeComposer();
    }
  });
  window.addEventListener("beforeunload", () => {
    unsubscribes.forEach((unsubscribe) => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    });
  });
}

function init() {
  const preferences = readPreferences();
  sortField = preferences.sortField;
  sortDirection = preferences.sortDirection;
  viewMode = preferences.viewMode;
  selectedCategory = preferences.selectedCategory;
  favoriteFilter = preferences.favoriteFilter;
  visibilityFilter = "all";
  // El apartado privado no se restaura tras recargar: siempre exige un PIN nuevo.
  activeSection = "all";
  bindEvents();
  applyPreferencesToControls();
  updateCharacterCounters();
  if (hasFirebaseConfig) {
    loadFirestoreMode();
  } else {
    loadLocalMode();
  }
}
init();
