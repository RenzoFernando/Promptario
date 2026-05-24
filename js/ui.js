const elements = {
  form: document.querySelector("#prompt-form"),
  promptIdInput: document.querySelector("#prompt-id"),
  titleInput: document.querySelector("#prompt-title"),
  contentInput: document.querySelector("#prompt-content"),
  favoriteInput: document.querySelector("#prompt-favorite-value"),
  favoriteButton: document.querySelector("#prompt-favorite"),
  favoriteLabel: document.querySelector("#prompt-favorite-label"),
  openCategoryManagerButton: document.querySelector("#open-category-manager-button"),
  selectedCategoryPreview: document.querySelector("#selected-category-preview"),
  selectedCategoriesSummary: document.querySelector("#selected-categories-summary"),
  categoryScreen: document.querySelector("#category-screen"),
  closeCategoryManagerButton: document.querySelector("#close-category-manager-button"),
  categoryNameInput: document.querySelector("#category-name-input"),
  createCategoryButton: document.querySelector("#create-category-button"),
  categoryPicker: document.querySelector("#category-picker"),
  saveButton: document.querySelector("#save-button"),
  formTitle: document.querySelector("#form-title"),
  promptList: document.querySelector("#prompt-list"),
  emptyState: document.querySelector("#empty-state"),
  searchInput: document.querySelector("#search-input"),
  categoryFilter: document.querySelector("#category-filter"),
  favoriteFilter: document.querySelector("#favorite-filter"),
  sortField: document.querySelector("#sort-field"),
  sortDirection: document.querySelector("#sort-direction"),
  viewMode: document.querySelector("#view-mode"),
  selectMenus: document.querySelectorAll("[data-select-menu]"),
  openComposerButton: document.querySelector("#open-composer-button"),
  closeComposerButton: document.querySelector("#close-composer-button"),
  composerScreen: document.querySelector("#composer-screen"),
  viewerScreen: document.querySelector("#viewer-screen"),
  closeViewerButton: document.querySelector("#close-viewer-button"),
  copyViewerButton: document.querySelector("#copy-viewer-button"),
  viewerTitle: document.querySelector("#viewer-title"),
  viewerFavorite: document.querySelector("#viewer-prompt-favorite"),
  viewerCategories: document.querySelector("#viewer-prompt-categories"),
  viewerContent: document.querySelector("#viewer-prompt-content"),
  deleteScreen: document.querySelector("#delete-screen"),
  cancelDeleteButton: document.querySelector("#cancel-delete-button"),
  confirmDeleteButton: document.querySelector("#confirm-delete-button"),
  deletePromptName: document.querySelector("#delete-prompt-name"),
  toast: document.querySelector("#toast")
};

let toastTimer = null;

const icons = {
  copy: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 8.5V6.8c0-1.12 0-1.68.22-2.11.19-.37.5-.68.87-.87.43-.22.99-.22 2.11-.22h5c1.12 0 1.68 0 2.11.22.37.19.68.5.87.87.22.43.22.99.22 2.11v5c0 1.12 0 1.68-.22 2.11-.19.37-.5.68-.87.87-.43.22-.99.22-2.11.22h-1.7M6.8 20.4h5c1.12 0 1.68 0 2.11-.22.37-.19.68-.5.87-.87.22-.43.22-.99.22-2.11v-5c0-1.12 0-1.68-.22-2.11a2 2 0 0 0-.87-.87C13.48 9 12.92 9 11.8 9h-5c-1.12 0-1.68 0-2.11.22-.37.19-.68.5-.87.87-.22.43-.22.99-.22 2.11v5c0 1.12 0 1.68.22 2.11.19.37.5.68.87.87.43.22.99.22 2.11.22Z" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  view: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3.75 12s2.85-5.25 8.25-5.25S20.25 12 20.25 12s-2.85 5.25-8.25 5.25S3.75 12 3.75 12Z" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 14.75A2.75 2.75 0 1 0 12 9.25a2.75 2.75 0 0 0 0 5.5Z" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.75 19.25h3.18c.42 0 .63 0 .83-.05.18-.04.35-.11.51-.2.18-.1.33-.25.63-.55l8.85-8.85a2.12 2.12 0 0 0-3-3L6.9 15.45c-.3.3-.45.45-.55.63-.09.16-.16.33-.2.51-.05.2-.05.41-.05.83v1.83Z" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="m14.75 7.6 3.65 3.65" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  delete: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9.25 4.75h5.5M4.75 7.75h14.5M17.75 7.75l-.52 9.42c-.08 1.5-.13 2.25-.54 2.79-.2.26-.46.47-.76.6-.62.28-1.37.19-2.86.19h-2.14c-1.49 0-2.24.09-2.86-.19-.3-.13-.56-.34-.76-.6-.41-.54-.46-1.29-.54-2.79L6.25 7.75M10 11.25v5M14 11.25v5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  star: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 3.8 2.42 4.9 5.4.78-3.91 3.82.92 5.37L12 16.13l-4.83 2.54.92-5.37-3.91-3.82 5.4-.78L12 3.8Z" stroke-width="1.7" stroke-linejoin="round"/></svg>`
};

const categoryPalette = [
  { bg: "#f4ebe6", border: "#dfc5b9", text: "#6b5148" },
  { bg: "#eef5e9", border: "#ccdcbf", text: "#566b4a" },
  { bg: "#edf3f9", border: "#c4d3e4", text: "#4e6279" },
  { bg: "#f5ebef", border: "#dcc3cf", text: "#6d5060" },
  { bg: "#f1edf7", border: "#d3c7e4", text: "#615477" },
  { bg: "#eaf5f2", border: "#bfdcd3", text: "#4d6b62" },
  { bg: "#f6f0d9", border: "#ddd0a0", text: "#6b5b29" },
  { bg: "#f1ece7", border: "#d8cabf", text: "#675346" },
  { bg: "#edf5f6", border: "#c2dce0", text: "#4e6870" },
  { bg: "#f3ebe8", border: "#dcc6be", text: "#6c5148" }
];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function getCategoryPalette(category) {
  let hash = 0;

  for (let index = 0; index < category.length; index += 1) {
    hash = category.charCodeAt(index) + ((hash << 5) - hash);
  }

  return categoryPalette[Math.abs(hash) % categoryPalette.length];
}

function getCategoryStyle(category) {
  const colors = getCategoryPalette(category);

  return `--category-bg: ${colors.bg}; --category-border: ${colors.border}; --category-text: ${colors.text};`;
}

function renderCategoryBadges(categories) {
  const normalizedCategories = normalizeCategories(categories);

  if (!normalizedCategories.length) {
    return `<div class="category-badges"><span class="category-badge category-badge--empty">sin categoría</span></div>`;
  }

  return `<div class="category-badges">${normalizedCategories.map((category) => `<span class="category-badge" style="${getCategoryStyle(category)}">${escapeHtml(category)}</span>`).join("")}</div>`;
}

function getPromptSizeClass(content) {
  if (content.length > 900) {
    return "prompt-card--long";
  }

  if (content.length > 360) {
    return "prompt-card--medium";
  }

  return "prompt-card--short";
}

function renderPrompts(prompts, options = {}) {
  const hasPrompts = options.totalPrompts > 0;
  const hasSearch = Boolean(options.searchTerm);
  const hasCategoryFilter = Boolean(options.selectedCategory && options.selectedCategory !== "all");
  const hasFavoriteFilter = options.favoriteFilter === "favorites";
  const viewMode = options.viewMode || "expanded";
  const emptyTitle = elements.emptyState.querySelector("span");
  const emptyText = elements.emptyState.querySelector("p");

  if (!hasPrompts) {
    emptyTitle.textContent = "Todavía no hay prompts.";
    emptyText.textContent = "Crea el primero desde Nuevo prompt.";
  } else if (hasSearch || hasCategoryFilter || hasFavoriteFilter) {
    emptyTitle.textContent = "No se encontraron prompts.";
    emptyText.textContent = "Prueba con otra búsqueda, categoría o filtro de favoritos.";
  }

  elements.emptyState.classList.toggle("is-hidden", prompts.length > 0);
  elements.promptList.className = `prompt-list prompt-list--${viewMode}`;
  elements.promptList.innerHTML = prompts.map((prompt) => {
    const contentMarkup = viewMode === "titles" ? "" : `<p class="prompt-content">${escapeHtml(prompt.content)}</p>`;
    const sizeClass = getPromptSizeClass(prompt.content || "");
    const categoryMarkup = renderCategoryBadges(prompt.categories);
    const favoriteClass = prompt.isFavorite ? " is-active" : "";
    const favoriteLabel = prompt.isFavorite ? "Quitar de favoritos" : "Marcar como favorito";

    return `
      <article class="prompt-card ${sizeClass}" data-id="${escapeHtml(prompt.id)}">
        <button class="icon-button copy-button" type="button" data-action="copy" data-id="${escapeHtml(prompt.id)}" aria-label="Copiar prompt" title="Copiar prompt">${icons.copy}</button>
        <header class="prompt-card-header">
          <h3 class="prompt-card-title">${escapeHtml(prompt.title)}</h3>
          ${categoryMarkup}
        </header>
        ${contentMarkup}
        <div class="prompt-actions">
          <button class="icon-button favorite-button${favoriteClass}" type="button" data-action="favorite" data-id="${escapeHtml(prompt.id)}" aria-label="${favoriteLabel}" title="${favoriteLabel}" aria-pressed="${String(Boolean(prompt.isFavorite))}">${icons.star}</button>
          <button class="icon-button" type="button" data-action="view" data-id="${escapeHtml(prompt.id)}" aria-label="Ver prompt" title="Ver prompt">${icons.view}</button>
          <button class="icon-button" type="button" data-action="edit" data-id="${escapeHtml(prompt.id)}" aria-label="Editar prompt" title="Editar prompt">${icons.edit}</button>
          <button class="icon-button danger" type="button" data-action="delete" data-id="${escapeHtml(prompt.id)}" aria-label="Eliminar prompt" title="Eliminar prompt">${icons.delete}</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderCategoryFilter(categories, selectedValue = "all") {
  const menu = document.querySelector(`[data-select-menu="category-filter"]`);

  if (!menu) {
    return;
  }

  const optionsContainer = menu.querySelector(".select-menu");
  const options = [
    { value: "all", label: "Todas" },
    { value: "__none__", label: "Sin categoría" },
    ...normalizeCategories(categories).map((category) => ({ value: category, label: category }))
  ];

  if (!optionsContainer) {
    return;
  }

  optionsContainer.innerHTML = options.map((option) => {
    const isSelected = option.value === selectedValue;

    return `<button class="select-option${isSelected ? " is-selected" : ""}" type="button" role="option" data-value="${escapeHtml(option.value)}" aria-selected="${String(isSelected)}">${escapeHtml(option.label)}</button>`;
  }).join("");

  setCustomSelectValue("category-filter", selectedValue);
}

function renderCategoryPicker(categories, selectedCategories = []) {
  const normalizedCategories = normalizeCategories(categories);
  const normalizedSelected = normalizeCategories(selectedCategories);

  if (!elements.categoryPicker) {
    return;
  }

  if (!normalizedCategories.length) {
    elements.categoryPicker.innerHTML = `<span class="category-picker-empty">No hay categorías creadas.</span>`;
    renderSelectedCategoryPreview(normalizedSelected);
    return;
  }

  elements.categoryPicker.innerHTML = normalizedCategories.map((category) => {
    const isSelected = normalizedSelected.includes(category);

    return `<span class="category-item" style="${getCategoryStyle(category)}"><button class="category-choice${isSelected ? " is-selected" : ""}" type="button" data-category="${escapeHtml(category)}" aria-pressed="${String(isSelected)}">${escapeHtml(category)}</button><button class="category-delete-button" type="button" data-category-delete="${escapeHtml(category)}" aria-label="Eliminar categoría ${escapeHtml(category)}" title="Eliminar categoría">${icons.delete}</button></span>`;
  }).join("");
  renderSelectedCategoryPreview(normalizedSelected);
}

function renderSelectedCategoryPreview(categories) {
  const normalizedCategories = normalizeCategories(categories);

  if (!elements.selectedCategoryPreview || !elements.selectedCategoriesSummary) {
    return;
  }

  if (!normalizedCategories.length) {
    elements.selectedCategoriesSummary.textContent = "Sin categoría asignada";
    elements.selectedCategoryPreview.innerHTML = `<span class="category-preview-empty">Ninguna</span>`;
    return;
  }

  elements.selectedCategoriesSummary.textContent = normalizedCategories.length === 1 ? "1 categoría asignada" : `${normalizedCategories.length} categorías asignadas`;
  elements.selectedCategoryPreview.innerHTML = normalizedCategories.map((category) => `<span class="category-badge" style="${getCategoryStyle(category)}">${escapeHtml(category)}</span>`).join("");
}

function getSelectedCategories() {
  if (!elements.categoryPicker) {
    return [];
  }

  return normalizeCategories(Array.from(elements.categoryPicker.querySelectorAll(".category-choice.is-selected")).map((button) => button.dataset.category));
}

function setCustomSelectValue(controlId, value) {
  const menu = document.querySelector(`[data-select-menu="${controlId}"]`);

  if (!menu) {
    return;
  }

  const input = menu.querySelector("input");
  const current = menu.querySelector(`#${controlId}-current`);
  const options = menu.querySelectorAll(".select-option");
  const selectedOption = Array.from(options).find((option) => option.dataset.value === value);

  if (!selectedOption || !input || !current) {
    return;
  }

  input.value = value;
  current.textContent = selectedOption.textContent;
  options.forEach((option) => {
    const isSelected = option === selectedOption;
    option.classList.toggle("is-selected", isSelected);
    option.setAttribute("aria-selected", String(isSelected));
  });
}

function closeCustomSelects(exceptMenu = null) {
  elements.selectMenus.forEach((menu) => {
    if (menu === exceptMenu) {
      return;
    }

    const button = menu.querySelector(".select-button");
    menu.classList.remove("is-open");

    if (button) {
      button.setAttribute("aria-expanded", "false");
    }
  });
}

function toggleCustomSelect(menu) {
  const isOpen = menu.classList.contains("is-open");
  const button = menu.querySelector(".select-button");
  closeCustomSelects(menu);
  menu.classList.toggle("is-open", !isOpen);

  if (button) {
    button.setAttribute("aria-expanded", String(!isOpen));
  }
}

function updateSortField(field) {
  setCustomSelectValue("sort-field", field);
}

function updateCategoryFilter(category) {
  setCustomSelectValue("category-filter", category);
}

function setFavoriteFilter(filter) {
  const isActive = filter === "favorites";
  const label = elements.favoriteFilter.querySelector("span");

  elements.favoriteFilter.dataset.filter = filter;
  elements.favoriteFilter.classList.toggle("is-active", isActive);
  elements.favoriteFilter.setAttribute("aria-pressed", String(isActive));

  if (label) {
    label.textContent = isActive ? "Favoritos" : "Todos";
  }
}

function setFormFavorite(isFavorite) {
  const nextFavorite = Boolean(isFavorite);
  elements.favoriteInput.value = String(nextFavorite);
  elements.favoriteButton.dataset.favorite = String(nextFavorite);
  elements.favoriteButton.classList.toggle("is-active", nextFavorite);
  elements.favoriteButton.setAttribute("aria-pressed", String(nextFavorite));

  if (elements.favoriteLabel) {
    elements.favoriteLabel.textContent = nextFavorite ? "Marcado" : "Sin marcar";
  }
}

function setFormMode(mode) {
  const isEdit = mode === "edit";
  elements.formTitle.textContent = isEdit ? "Editar prompt" : "Nuevo prompt";
  elements.saveButton.textContent = isEdit ? "Guardar cambios" : "Guardar prompt";
}

function fillForm(prompt, availableCategories = []) {
  elements.promptIdInput.value = prompt.id;
  elements.titleInput.value = prompt.title;
  elements.contentInput.value = prompt.content;
  setFormFavorite(Boolean(prompt.isFavorite));
  renderCategoryPicker(availableCategories, normalizeCategories(prompt.categories));
}

function fillViewer(prompt) {
  if (!prompt) {
    elements.viewerTitle.textContent = "Prompt";
    elements.viewerFavorite.textContent = "";
    elements.viewerCategories.innerHTML = "";
    elements.viewerContent.textContent = "";
    elements.copyViewerButton.removeAttribute("data-id");
    return;
  }

  elements.viewerTitle.textContent = prompt.title;
  elements.viewerFavorite.textContent = prompt.isFavorite ? "★ Favorito" : "";
  elements.viewerCategories.innerHTML = renderCategoryBadges(prompt.categories);
  elements.viewerContent.textContent = prompt.content;
  elements.copyViewerButton.dataset.id = prompt.id;
}

function setFormLoading(isLoading) {
  const isEdit = Boolean(elements.promptIdInput.value);
  elements.saveButton.disabled = isLoading;
  elements.saveButton.textContent = isLoading ? "Guardando" : isEdit ? "Guardar cambios" : "Guardar prompt";
}

function setDeletePromptName(name) {
  elements.deletePromptName.textContent = name;
}

function updateSortDirection(direction) {
  elements.sortDirection.dataset.direction = direction;
  elements.sortDirection.textContent = direction === "asc" ? "Ascendente" : "Descendente";
}

function updateViewMode(mode) {
  setCustomSelectValue("view-mode", mode);
  elements.promptList.dataset.viewMode = mode;
}

function updateBodyModalState() {
  const hasOpenModal = elements.composerScreen.classList.contains("is-open") || elements.categoryScreen.classList.contains("is-open") || elements.viewerScreen.classList.contains("is-open") || elements.deleteScreen.classList.contains("is-open");
  document.body.classList.toggle("has-modal-open", hasOpenModal);
}

function toggleComposer(isOpen) {
  elements.composerScreen.classList.toggle("is-open", isOpen);
  elements.composerScreen.setAttribute("aria-hidden", String(!isOpen));
  updateBodyModalState();

  if (isOpen) {
    elements.titleInput.focus();
  } else {
    elements.openComposerButton.focus();
  }
}

function toggleCategoryManager(isOpen) {
  elements.categoryScreen.classList.toggle("is-open", isOpen);
  elements.categoryScreen.setAttribute("aria-hidden", String(!isOpen));
  updateBodyModalState();

  if (isOpen) {
    elements.categoryNameInput.focus();
  } else {
    elements.openCategoryManagerButton.focus();
  }
}

function toggleViewer(isOpen) {
  elements.viewerScreen.classList.toggle("is-open", isOpen);
  elements.viewerScreen.setAttribute("aria-hidden", String(!isOpen));
  updateBodyModalState();

  if (isOpen) {
    elements.copyViewerButton.focus();
  }
}

function toggleDeleteDialog(isOpen) {
  elements.deleteScreen.classList.toggle("is-open", isOpen);
  elements.deleteScreen.setAttribute("aria-hidden", String(!isOpen));
  updateBodyModalState();

  if (isOpen) {
    elements.confirmDeleteButton.focus();
  }
}

function showToast(message, type = "success") {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.remove("is-success", "is-error");
  elements.toast.classList.add(type === "error" ? "is-error" : "is-success", "is-visible");

  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 2600);
}

function resetForm() {
  elements.form.reset();
  elements.promptIdInput.value = "";
  elements.categoryNameInput.value = "";
  setFormFavorite(false);
  renderSelectedCategoryPreview([]);
  setFormMode("create");
}

export { closeCustomSelects, elements, fillForm, fillViewer, getSelectedCategories, renderCategoryFilter, renderCategoryPicker, renderPrompts, renderSelectedCategoryPreview, resetForm, setCustomSelectValue, setDeletePromptName, setFavoriteFilter, setFormFavorite, setFormLoading, setFormMode, showToast, toggleCategoryManager, toggleComposer, toggleCustomSelect, toggleDeleteDialog, toggleViewer, updateCategoryFilter, updateSortDirection, updateSortField, updateViewMode };
