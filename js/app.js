import { createFirestoreService, hasFirebaseConfig } from "./firebase.js";
import { closeCustomSelects, elements, fillForm, fillViewer, getSelectedCategories, renderCategoryFilter, renderCategoryPicker, renderPrompts, renderSelectedCategoryPreview, resetForm, setCustomSelectValue, setDeletePromptName, setFavoriteFilter, setFormFavorite, setFormLoading, setFormMode, showToast, toggleCategoryManager, toggleComposer, toggleCustomSelect, toggleDeleteDialog, toggleViewer, updateCategoryFilter, updateSortDirection, updateSortField, updateViewMode } from "./ui.js";

const localStorageKey = "promptario:prompts";
const categoriesStorageKey = "promptario:categories";
const preferencesStorageKey = "promptario:preferences";
const validViewModes = ["expanded", "compact", "titles", "grid", "mosaic"];
const allCategoriesValue = "all";
const noCategoryValue = "__none__";
const favoriteAllValue = "all";
const favoriteOnlyValue = "favorites";
let prompts = [];
let categories = [];
let visiblePrompts = [];
let firestoreService = null;
let unsubscribes = [];
let sortField = "title";
let sortDirection = "asc";
let viewMode = "expanded";
let searchTerm = "";
let selectedCategory = allCategoriesValue;
let favoriteFilter = favoriteAllValue;
let pendingDeleteId = null;
let activeViewId = null;

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeCategoryName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
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
    isFavorite: Boolean(prompt.isFavorite)
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

  return Array.from(categorySet).sort((first, second) => first.localeCompare(second, "es", { sensitivity: "base" }));
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
  window.localStorage.setItem(categoriesStorageKey, JSON.stringify(normalizeCategories(nextCategories)));
}

function readPreferences() {
  try {
    const stored = window.localStorage.getItem(preferencesStorageKey);
    const parsed = stored ? JSON.parse(stored) : {};
    const validSortFields = ["title", "createdAt", "category", "isFavorite"];
    const nextSortField = validSortFields.includes(parsed.sortField) ? parsed.sortField : "title";
    const nextSortDirection = parsed.sortDirection === "asc" || parsed.sortDirection === "desc" ? parsed.sortDirection : "asc";
    const storedViewMode = parsed.viewMode === "gallery" ? "mosaic" : parsed.viewMode;
    const nextViewMode = validViewModes.includes(storedViewMode) ? storedViewMode : "expanded";
    const nextSelectedCategory = typeof parsed.selectedCategory === "string" && parsed.selectedCategory.trim() ? normalizeCategoryName(parsed.selectedCategory) || parsed.selectedCategory : allCategoriesValue;
    const nextFavoriteFilter = parsed.favoriteFilter === favoriteOnlyValue ? favoriteOnlyValue : favoriteAllValue;

    return {
      sortField: nextSortField,
      sortDirection: nextSortDirection,
      viewMode: nextViewMode,
      selectedCategory: nextSelectedCategory,
      favoriteFilter: nextFavoriteFilter
    };
  } catch {
    return {
      sortField: "title",
      sortDirection: "asc",
      viewMode: "expanded",
      selectedCategory: allCategoriesValue,
      favoriteFilter: favoriteAllValue
    };
  }
}

function writePreferences() {
  window.localStorage.setItem(preferencesStorageKey, JSON.stringify({
    sortField,
    sortDirection,
    viewMode,
    selectedCategory,
    favoriteFilter
  }));
}

function applyPreferencesToControls() {
  updateSortField(sortField);
  updateSortDirection(sortDirection);
  updateViewMode(viewMode);
  updateCategoryFilter(selectedCategory);
  setFavoriteFilter(favoriteFilter);
}

function comparePromptTitles(first, second) {
  return String(first.title || "").localeCompare(String(second.title || ""), "es", { sensitivity: "base" });
}

function comparePromptDates(first, second) {
  return new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime();
}

function comparePromptCategories(first, second) {
  const firstCategories = normalizeCategories(first.categories);
  const secondCategories = normalizeCategories(second.categories);
  const firstCategory = firstCategories[0] || "";
  const secondCategory = secondCategories[0] || "";

  if (!firstCategory && secondCategory) {
    return 1;
  }

  if (firstCategory && !secondCategory) {
    return -1;
  }

  const categoryResult = firstCategory.localeCompare(secondCategory, "es", { sensitivity: "base" });

  return categoryResult || comparePromptTitles(first, second);
}

function comparePromptFavorites(first, second) {
  const favoriteResult = Number(Boolean(second.isFavorite)) - Number(Boolean(first.isFavorite));

  if (favoriteResult !== 0) {
    return favoriteResult;
  }

  const titleResult = comparePromptTitles(first, second);

  return sortDirection === "asc" ? titleResult : titleResult * -1;
}

function sortPrompts(items) {
  return [...items].sort((first, second) => {
    if (sortField === "isFavorite") {
      return comparePromptFavorites(first, second);
    }

    let result = 0;

    if (sortField === "createdAt") {
      result = comparePromptDates(first, second);
    } else if (sortField === "category") {
      result = comparePromptCategories(first, second);
    } else {
      result = comparePromptTitles(first, second);
    }

    return sortDirection === "asc" ? result : result * -1;
  });
}

function filterPrompts(items) {
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase("es");

  return items.filter((prompt) => {
    const promptCategories = normalizeCategories(prompt.categories);
    const matchesCategory = selectedCategory === allCategoriesValue || (selectedCategory === noCategoryValue ? promptCategories.length === 0 : promptCategories.includes(selectedCategory));
    const matchesFavorite = favoriteFilter === favoriteAllValue || prompt.isFavorite;

    if (!matchesCategory || !matchesFavorite) {
      return false;
    }

    if (!normalizedSearch) {
      return true;
    }

    const title = String(prompt.title || "").toLocaleLowerCase("es");
    const content = String(prompt.content || "").toLocaleLowerCase("es");
    const categoryText = promptCategories.join(" ").toLocaleLowerCase("es");

    return title.includes(normalizedSearch) || content.includes(normalizedSearch) || categoryText.includes(normalizedSearch);
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
  visiblePrompts = sortPrompts(filterPrompts(prompts));
  renderPrompts(visiblePrompts, {
    totalPrompts: prompts.length,
    searchTerm,
    selectedCategory,
    favoriteFilter,
    viewMode
  });
}

function getPromptById(id) {
  return prompts.find((prompt) => prompt.id === id);
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

async function copyPrompt(id, triggerButton = null) {
  const prompt = getPromptById(id);

  if (!prompt) {
    showToast("No se encontró el prompt.", "error");
    return;
  }

  try {
    await navigator.clipboard.writeText(prompt.content);
    markCopyButtonSuccess(triggerButton);
    showToast("Prompt copiado al portapapeles.");
  } catch {
    showToast("No fue posible copiar el contenido.", "error");
  }
}

function openCreateComposer() {
  resetForm();
  renderCategoryPicker(categories, []);
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
  fillForm(prompt, categories);
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
      refreshPrompts(nextPrompts, categories);
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
    try {
      await firestoreService.createCategory({ name });
      refreshPrompts(prompts, [...categories, name]);
      return "firebase";
    } catch {
      await saveLocalCategory(name);
      return "local";
    }
  }

  await saveLocalCategory(name);
  return "local";
}

async function deleteLocalCategory(name) {
  const category = normalizeCategoryName(name);
  const nextCategories = normalizeCategories(readLocalCategories().filter((item) => item !== category));
  const nextPrompts = readLocalPrompts().map((prompt) => ({
    ...prompt,
    categories: normalizeCategories(prompt.categories).filter((item) => item !== category)
  }));

  writeLocalCategories(nextCategories);
  writeLocalPrompts(nextPrompts);
  refreshPrompts(nextPrompts, nextCategories);
}

async function deleteCategory(name) {
  const category = normalizeCategoryName(name);

  if (!category) {
    return;
  }

  const selectedCategories = getSelectedCategories().filter((item) => item !== category);

  try {
    if (firestoreService) {
      await firestoreService.deleteCategory(category);
      refreshPrompts(prompts.map((prompt) => ({
        ...prompt,
        categories: normalizeCategories(prompt.categories).filter((item) => item !== category)
      })), categories.filter((item) => item !== category));
    } else {
      await deleteLocalCategory(category);
    }

    renderCategoryPicker(categories.filter((item) => item !== category), selectedCategories);
    renderSelectedCategoryPreview(selectedCategories);
    showToast("Categoría eliminada.");
  } catch {
    showToast("No fue posible eliminar la categoría.", "error");
  }
}

async function createCategoryFromForm() {
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
      showToast(categoryStorage === "firebase" ? "Categoría creada." : "Categoría creada en modo local.");
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

  const id = elements.promptIdInput.value.trim();
  const title = elements.titleInput.value.trim();
  const content = elements.contentInput.value.trim();
  const promptCategories = getSelectedCategories();
  const isFavorite = elements.favoriteInput.value === "true";

  if (!title || !content) {
    showToast("Completa el título y el contenido.", "error");
    return;
  }

  setFormLoading(true);

  try {
    if (firestoreService) {
      if (id) {
        await firestoreService.updatePrompt(id, { title, content, categories: promptCategories, isFavorite });
      } else {
        await firestoreService.createPrompt({ title, content, categories: promptCategories, isFavorite });
      }
    } else {
      await saveLocalPrompt(id, title, content, promptCategories, isFavorite);
    }

    resetForm();
    renderCategoryPicker(categories, []);
    toggleComposer(false);
    showToast(id ? "Prompt actualizado." : "Prompt guardado.");
  } catch {
    showToast(id ? "No fue posible actualizar el prompt." : "No fue posible guardar el prompt.", "error");
  } finally {
    setFormLoading(false);
  }
}

async function togglePromptFavorite(id) {
  const prompt = getPromptById(id);

  if (!prompt) {
    showToast("No se encontró el prompt.", "error");
    return;
  }

  const nextFavorite = !prompt.isFavorite;

  try {
    if (firestoreService) {
      await firestoreService.updatePrompt(id, {
        title: prompt.title,
        content: prompt.content,
        categories: prompt.categories,
        isFavorite: nextFavorite
      });
    } else {
      const nextPrompts = readLocalPrompts().map((item) => {
        if (item.id !== id) {
          return item;
        }

        return {
          ...item,
          isFavorite: nextFavorite,
          updatedAt: new Date().toISOString()
        };
      });

      writeLocalPrompts(nextPrompts);
      refreshPrompts(nextPrompts, categories);
    }

    showToast(nextFavorite ? "Prompt marcado como favorito." : "Prompt quitado de favoritos.");
  } catch {
    showToast("No fue posible actualizar el favorito.", "error");
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
    togglePromptFavorite(id);
  }

  if (action === "copy") {
    copyPrompt(id, actionButton);
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
  refreshPrompts(prompts, categories);
}

function handleCategoryFilterChange(event) {
  selectedCategory = event.target.value || allCategoriesValue;
  updateCategoryFilter(selectedCategory);
  writePreferences();
  refreshPrompts(prompts, categories);
}

function handleFavoriteFilterClick() {
  favoriteFilter = favoriteFilter === favoriteOnlyValue ? favoriteAllValue : favoriteOnlyValue;
  setFavoriteFilter(favoriteFilter);
  writePreferences();
  refreshPrompts(prompts, categories);
}

function handleSortFieldChange(event) {
  sortField = event.target.value;
  updateSortField(sortField);
  writePreferences();
  refreshPrompts(prompts, categories);
}

function handleSortDirectionClick() {
  sortDirection = sortDirection === "asc" ? "desc" : "asc";
  updateSortDirection(sortDirection);
  writePreferences();
  refreshPrompts(prompts, categories);
}

function handleViewModeChange(event) {
  viewMode = event.target.value;
  updateViewMode(viewMode);
  writePreferences();
  refreshPrompts(prompts, categories);
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
  const nextCategories = selectedCategories.includes(category) ? selectedCategories.filter((item) => item !== category) : [...selectedCategories, category];

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
  refreshPrompts(readLocalPrompts(), readLocalCategories());
}

async function loadFirestoreMode() {
  try {
    firestoreService = await createFirestoreService();

    if (!firestoreService) {
      loadLocalMode();
      return;
    }

    const unsubscribePrompts = firestoreService.subscribePrompts((nextPrompts) => {
      refreshPrompts(nextPrompts, categories);
    }, () => {
      loadLocalMode();
      showToast("Firebase no respondió. Se activó el modo local.", "error");
    });

    const unsubscribeCategories = firestoreService.subscribeCategories((nextCategories) => {
      refreshPrompts(prompts, nextCategories);
    }, () => {
      refreshPrompts(prompts, readLocalCategories());
    });

    unsubscribes = [unsubscribePrompts, unsubscribeCategories];
  } catch {
    loadLocalMode();
    showToast("Agrega tu configuración de Firebase para activar sincronización.", "error");
  }
}

function bindEvents() {
  elements.form.addEventListener("submit", handleSubmit);
  elements.promptList.addEventListener("click", handleListClick);
  elements.searchInput.addEventListener("input", handleSearchInput);
  elements.categoryFilter.addEventListener("change", handleCategoryFilterChange);
  elements.favoriteFilter.addEventListener("click", handleFavoriteFilterClick);
  elements.sortField.addEventListener("change", handleSortFieldChange);
  elements.sortDirection.addEventListener("click", handleSortDirectionClick);
  elements.viewMode.addEventListener("change", handleViewModeChange);
  elements.openCategoryManagerButton.addEventListener("click", openCategoryManager);
  elements.closeCategoryManagerButton.addEventListener("click", closeCategoryManager);
  elements.createCategoryButton.addEventListener("click", createCategoryFromForm);
  elements.categoryPicker.addEventListener("click", handleCategoryPickerClick);
  elements.favoriteButton.addEventListener("click", handleFavoriteFormClick);
  elements.categoryNameInput.addEventListener("input", handleCategoryNameInput);
  elements.categoryNameInput.addEventListener("keydown", handleCategoryNameKeydown);
  elements.selectMenus.forEach((menu) => {
    menu.addEventListener("click", handleCustomSelectClick);
  });
  document.addEventListener("click", handleDocumentClick);
  elements.openComposerButton.addEventListener("click", openCreateComposer);
  elements.closeComposerButton.addEventListener("click", () => {
    resetForm();
    renderCategoryPicker(categories, []);
    toggleCategoryManager(false);
    toggleComposer(false);
  });
  elements.composerScreen.addEventListener("click", (event) => {
    if (event.target === elements.composerScreen) {
      resetForm();
      renderCategoryPicker(categories, []);
      toggleCategoryManager(false);
      toggleComposer(false);
    }
  });
  elements.categoryScreen.addEventListener("click", (event) => {
    if (event.target === elements.categoryScreen) {
      closeCategoryManager();
    }
  });
  elements.closeViewerButton.addEventListener("click", closePromptViewer);
  elements.copyViewerButton.addEventListener("click", () => {
    copyPrompt(activeViewId, elements.copyViewerButton);
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
      resetForm();
      renderCategoryPicker(categories, []);
      toggleCategoryManager(false);
      toggleComposer(false);
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
  bindEvents();
  applyPreferencesToControls();

  if (hasFirebaseConfig) {
    loadFirestoreMode();
  } else {
    loadLocalMode();
  }
}

init();
