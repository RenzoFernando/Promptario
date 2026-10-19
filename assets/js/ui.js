import { renderMarkdown } from "./markdown.js";

const elements = {
  form: document.querySelector("#prompt-form"),
  promptIdInput: document.querySelector("#prompt-id"),
  titleInput: document.querySelector("#prompt-title"),
  contentInput: document.querySelector("#prompt-content"),
  titleCounter: document.querySelector("#prompt-title-count"),
  contentCounter: document.querySelector("#prompt-content-count"),
  markdownPreview: document.querySelector("#prompt-markdown-preview"),
  favoriteInput: document.querySelector("#prompt-favorite-value"),
  favoriteButton: document.querySelector("#prompt-favorite"),
  favoriteLabel: document.querySelector("#prompt-favorite-label"),
  privacyInput: document.querySelector("#prompt-privacy-value"),
  privacyButton: document.querySelector("#prompt-privacy"),
  privacyLabel: document.querySelector("#prompt-privacy-label"),
  visibilityFilter: document.querySelector("#visibility-filter"),
  resultCount: document.querySelector("#result-count"),
  clearFilters: document.querySelector("#clear-filters"),
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
  libraryBody: document.querySelector(".library-body"),
  emptyState: document.querySelector("#empty-state"),
  searchInput: document.querySelector("#search-input"),
  categoryFilter: document.querySelector("#category-filter"),
  favoriteFilter: document.querySelector("#favorite-filter"),
  sortField: document.querySelector("#sort-field"),
  sortDirection: document.querySelector("#sort-direction"),
  viewMode: document.querySelector("#view-mode"),
  selectMenus: document.querySelectorAll("[data-select-menu]"),
  openComposerButton: document.querySelector("#open-composer-button"),
  unlockButton: document.querySelector("#unlock-button"),
  closeComposerButton: document.querySelector("#close-composer-button"),
  composerScreen: document.querySelector("#composer-screen"),
  pinScreen: document.querySelector("#pin-screen"),
  pinForm: document.querySelector("#pin-form"),
  pinDialogTitle: document.querySelector("#pin-dialog-title"),
  pinInput: document.querySelector("#pin-input"),
  pinError: document.querySelector("#pin-error"),
  cancelPinButton: document.querySelector("#cancel-pin-button"),
  recoveryScreen: document.querySelector("#recovery-screen"),
  recoveryMessage: document.querySelector("#recovery-message"),
  sendRecoveryButton: document.querySelector("#send-recovery-button"),
  cancelRecoveryButton: document.querySelector("#cancel-recovery-button"),
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
let overflowFrame = null;
const icons = {
  copy: `<svg class="app-icon" aria-hidden="true"><use href="assets/icons/icons.svg#copy"></use></svg>`,
  view: `<svg class="app-icon" aria-hidden="true"><use href="assets/icons/icons.svg#eye"></use></svg>`,
  edit: `<svg class="app-icon" aria-hidden="true"><use href="assets/icons/icons.svg#edit"></use></svg>`,
  delete: `<svg class="app-icon" aria-hidden="true"><use href="assets/icons/icons.svg#trash"></use></svg>`,
  star: `<svg class="app-icon" aria-hidden="true"><use href="assets/icons/icons.svg#star"></use></svg>`,
  starFilled: `<svg class="app-icon" aria-hidden="true"><use href="assets/icons/icons.svg#star-filled"></use></svg>`
};
const categoryPalette = [
  { bg: "#eee6dc", border: "#d9c8b7", text: "#624b3d" },
  { bg: "#e8eddd", border: "#cbd5bd", text: "#4c6041" },
  { bg: "#e7ebeb", border: "#c4cece", text: "#445e63" },
  { bg: "#eee9db", border: "#d6ccb3", text: "#665833" },
  { bg: "#e9e7e0", border: "#cac7bb", text: "#53554d" },
  { bg: "#e5ebe3", border: "#c0d0be", text: "#45634e" },
  { bg: "#f0e9d9", border: "#dac9a8", text: "#6e5932" },
  { bg: "#ede5dc", border: "#d7c5b3", text: "#66513f" },
  { bg: "#e5ecea", border: "#bfd1cb", text: "#49645d" },
  { bg: "#ece4dd", border: "#d3beb0", text: "#684f44" }
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

function updateLibraryOverflowIndicator() {
  if (!elements.libraryBody) {
    return;
  }
  const remainingScroll =
    elements.libraryBody.scrollHeight -
    elements.libraryBody.scrollTop -
    elements.libraryBody.clientHeight;
  elements.libraryBody.classList.toggle("has-more-below", remainingScroll > 2);
}

function updatePromptOverflowIndicators() {
  elements.promptList.querySelectorAll(".prompt-content").forEach((content) => {
    content.classList.toggle("is-truncated", content.scrollHeight > content.clientHeight + 1);
  });
  updateLibraryOverflowIndicator();
}

function scheduleOverflowIndicators() {
  if (overflowFrame !== null) {
    window.cancelAnimationFrame(overflowFrame);
  }
  overflowFrame = window.requestAnimationFrame(() => {
    overflowFrame = null;
    updatePromptOverflowIndicators();
  });
}

function renderPrompts(prompts, options = {}) {
  const total = options.totalPrompts || 0;
  const count = prompts.length;
  const hasSearch = Boolean(options.searchTerm);
  const hasCategoryFilter = Boolean(options.selectedCategory && options.selectedCategory !== "all");
  const hasFavoriteFilter = options.favoriteFilter === "favorites";
  const hasPrivacyFilter = options.visibilityFilter !== "all";
  const customOrder = options.sortField !== "isFavorite" || options.sortDirection === "desc";
  const activeCount =
    Number(hasCategoryFilter) +
    Number(hasFavoriteFilter) +
    Number(hasPrivacyFilter) +
    Number(customOrder);
  const viewMode = options.viewMode || "grid";
  const isPrivateSection = options.privateSection === true;
  const emptyTitle = elements.emptyState.querySelector("span");
  const emptyText = elements.emptyState.querySelector("p");
  const displayedCategory = hasCategoryFilter
    ? options.selectedCategory === "__none__"
      ? "Sin categoría"
      : options.selectedCategory
    : "Todas las categorías";
  elements.resultCount.textContent = isPrivateSection
    ? "Biblioteca privada"
    : `${count} ${count === 1 ? "prompt" : "prompts"} · ${displayedCategory}`;
  const sectionCounter = document.querySelector("#section-counter");
  sectionCounter.hidden = isPrivateSection;
  if (!isPrivateSection) sectionCounter.textContent = ` / ${String(total).padStart(2, "0")}`;
  const end = document.querySelector("#collection-end");
  if (end)
    end.textContent = isPrivateSection
      ? ""
      : total > 0
        ? `${String(count === 0 ? 0 : 1).padStart(2, "0")}–${String(count).padStart(2, "0")} / ${String(total).padStart(2, "0")}`
        : "00 / 00";
  document.querySelector("#current-order-label").textContent =
    options.sortField === "isFavorite"
      ? ""
      : `Orden: ${options.sortField === "title" ? "Título" : options.sortField === "category" ? "Categoría" : "Fecha"}`;
  elements.clearFilters.disabled = !hasSearch && activeCount === 0;
  const filterCount = document.querySelector("#filters-active-count");
  if (filterCount) {
    filterCount.hidden = activeCount === 0;
    filterCount.textContent = String(activeCount);
  }
  const vaultButton = document.querySelector("#unlock-vault-button");
  vaultButton.hidden = !options.vaultLocked;
  if (options.vaultLocked) {
    emptyTitle.textContent = "Tu biblioteca privada está bloqueada.";
    emptyText.textContent =
      "Introduce el PIN para consultar títulos, categorías y contenido protegido.";
  } else if (!total) {
    emptyTitle.textContent = "Todavía no hay prompts aquí.";
    emptyText.textContent = "Puedes guardar tu primer prompt con el botón Nuevo prompt.";
  } else if (!count) {
    emptyTitle.textContent = "No se encontraron prompts.";
    emptyText.textContent = "Prueba otra búsqueda o restablece los filtros.";
  }
  elements.emptyState.classList.toggle("is-hidden", count > 0);
  elements.promptList.className = `prompt-list prompt-list--${viewMode}`;
  elements.promptList.innerHTML = prompts
    .map((prompt) => {
      const isPrivate = Boolean(prompt.isPrivate);
      const id = escapeHtml(prompt.id);
      const contentMarkup =
        viewMode === "titles"
          ? ""
          : `<div class="prompt-content markdown-body markdown-body--card">${renderMarkdown(prompt.content || "")}</div>`;
      const categoryMarkup = renderCategoryBadges(prompt.categories);
      return `
      <article class="prompt-card ${getPromptSizeClass(prompt.content || "")}${isPrivate ? " prompt-card--private" : ""}" data-id="${id}">
        <header class="prompt-card-header">
          <h3 class="prompt-card-title">${escapeHtml(prompt.title)}</h3>
          <button class="icon-button copy-button" type="button" data-action="copy" data-id="${id}" aria-label="Copiar ${escapeHtml(prompt.title)}" title="Copiar prompt">${icons.copy}</button>
        </header>
        <div class="prompt-card-categories">${categoryMarkup}</div>
        ${contentMarkup}
        <div class="prompt-card-footer">
          <button class="icon-button favorite-button${prompt.isFavorite ? " is-favorite" : ""}" type="button" data-action="favorite" data-id="${id}" aria-pressed="${String(prompt.isFavorite)}" aria-label="${prompt.isFavorite ? "Quitar de favoritos" : "Añadir a favoritos"}" title="${prompt.isFavorite ? "Quitar de favoritos" : "Añadir a favoritos"}">${prompt.isFavorite ? icons.starFilled : icons.star}</button>
          <div class="prompt-actions">
            <button class="icon-button" type="button" data-action="view" data-id="${id}" aria-label="Ver prompt" title="Ver prompt">${icons.view}</button>
            <button class="icon-button" type="button" data-action="edit" data-id="${id}" aria-label="Editar prompt" title="Editar prompt">${icons.edit}</button>
            <button class="icon-button" type="button" data-action="delete" data-id="${id}" aria-label="Eliminar prompt" title="Eliminar prompt">${icons.delete}</button>
          </div>
        </div>
      </article>
    `;
    })
    .join("");
  scheduleOverflowIndicators();
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
  optionsContainer.innerHTML = options
    .map((option) => {
      const isSelected = option.value === selectedValue;
      return `<button class="select-option${isSelected ? " is-selected" : ""}" type="button" role="option" data-value="${escapeHtml(option.value)}" aria-selected="${String(isSelected)}">${escapeHtml(option.label)}</button>`;
    })
    .join("");
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
  elements.categoryPicker.innerHTML = normalizedCategories
    .map((category) => {
      const isSelected = normalizedSelected.includes(category);
      return `<span class="category-item" style="${getCategoryStyle(category)}"><button class="category-choice${isSelected ? " is-selected" : ""}" type="button" data-category="${escapeHtml(category)}" aria-pressed="${String(isSelected)}">${escapeHtml(category)}</button><button class="category-delete-button" type="button" data-category-delete="${escapeHtml(category)}" aria-label="Eliminar categoría ${escapeHtml(category)}" title="Eliminar categoría">${icons.delete}</button></span>`;
    })
    .join("");
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
  elements.selectedCategoriesSummary.textContent =
    normalizedCategories.length === 1
      ? "1 categoría asignada"
      : `${normalizedCategories.length} categorías asignadas`;
  elements.selectedCategoryPreview.innerHTML = normalizedCategories
    .map(
      (category) =>
        `<span class="category-badge" style="${getCategoryStyle(category)}">${escapeHtml(category)}</span>`
    )
    .join("");
}

function getSelectedCategories() {
  if (!elements.categoryPicker) {
    return [];
  }
  return normalizeCategories(
    Array.from(elements.categoryPicker.querySelectorAll(".category-choice.is-selected")).map(
      (button) => button.dataset.category
    )
  );
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
  const label =
    elements.favoriteFilter.querySelectorAll("span")[1] ||
    elements.favoriteFilter.querySelector("span");
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
  elements.favoriteButton
    .querySelector(".favorite-form-icon use")
    ?.setAttribute("href", `assets/icons/icons.svg#${nextFavorite ? "star-filled" : "star"}`);
  if (elements.favoriteLabel) {
    elements.favoriteLabel.textContent = nextFavorite ? "Marcado" : "Sin marcar";
  }
}

function setFormPrivacy(isPrivate) {
  const nextPrivate = Boolean(isPrivate);
  elements.privacyInput.value = String(nextPrivate);
  elements.privacyButton.classList.toggle("is-active", nextPrivate);
  elements.privacyButton.setAttribute("aria-pressed", String(nextPrivate));
  elements.privacyLabel.textContent = nextPrivate ? "Privado" : "Público";
  elements.privacyButton
    .querySelector(".privacy-form-icon use")
    ?.setAttribute("href", `assets/icons/icons.svg#${nextPrivate ? "lock" : "lock-open"}`);
}

function setFormMode(mode) {
  const isEdit = mode === "edit";
  elements.formTitle.textContent = isEdit ? "Editar prompt" : "Nuevo prompt";
  elements.saveButton.textContent = isEdit ? "Guardar cambios" : "Guardar prompt";
}

function updateFieldCounter(input, counter) {
  if (!input || !counter) {
    return;
  }
  const limit = input.maxLength;
  const length = input.value.length;
  counter.textContent = `${length.toLocaleString("es-CO")} / ${limit.toLocaleString("es-CO")} caracteres`;
  counter.classList.toggle("is-near-limit", limit > 0 && length >= Math.floor(limit * 0.9));
  counter.classList.toggle("is-at-limit", limit > 0 && length >= limit);
}

function updateCharacterCounters() {
  updateFieldCounter(elements.titleInput, elements.titleCounter);
  updateFieldCounter(elements.contentInput, elements.contentCounter);
}

function updateMarkdownPreview() {
  if (!elements.markdownPreview) {
    return;
  }
  const content = elements.contentInput.value;
  elements.markdownPreview.innerHTML = content.trim()
    ? renderMarkdown(content)
    : `<p class="markdown-preview-empty">La vista previa aparecerá aquí.</p>`;
}

function fillForm(prompt, availableCategories = []) {
  elements.promptIdInput.value = prompt.id;
  elements.titleInput.value = prompt.title;
  elements.contentInput.value = prompt.content;
  updateMarkdownPreview();
  updateCharacterCounters();
  setFormFavorite(Boolean(prompt.isFavorite));
  setFormPrivacy(Boolean(prompt.isPrivate));
  renderCategoryPicker(availableCategories, normalizeCategories(prompt.categories));
}

function fillViewer(prompt) {
  if (!prompt) {
    elements.viewerTitle.textContent = "Prompt";
    elements.viewerFavorite.textContent = "";
    elements.viewerCategories.innerHTML = "";
    elements.viewerContent.innerHTML = "";
    elements.copyViewerButton.removeAttribute("data-id");
    return;
  }
  elements.viewerTitle.textContent = prompt.title;
  elements.viewerFavorite.textContent = [
    prompt.isFavorite ? "★ Favorito" : "",
    prompt.isPrivate ? "Privado" : ""
  ]
    .filter(Boolean)
    .join(" · ");
  elements.viewerCategories.innerHTML = renderCategoryBadges(prompt.categories);
  elements.viewerContent.innerHTML = renderMarkdown(prompt.content);
  elements.copyViewerButton.dataset.id = prompt.id;
}

function setFormLoading(isLoading) {
  const isEdit = Boolean(elements.promptIdInput.value);
  elements.saveButton.disabled = isLoading;
  elements.saveButton.textContent = isLoading
    ? "Guardando"
    : isEdit
      ? "Guardar cambios"
      : "Guardar prompt";
}

function setDeletePromptName(name) {
  elements.deletePromptName.textContent = name;
}

function updateSortDirection(direction) {
  elements.sortDirection.dataset.direction = direction;
  const label = elements.sortDirection.querySelector(".direction-value");
  if (label) label.textContent = direction === "asc" ? "Ascendente" : "Descendente";
}

function updateViewMode(mode) {
  elements.promptList.dataset.viewMode = mode;
  document.querySelectorAll("[data-view-switch]").forEach((button) => {
    const active = button.dataset.viewSwitch === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function updateBodyModalState() {
  const hasOpenModal =
    elements.pinScreen.classList.contains("is-open") ||
    elements.recoveryScreen.classList.contains("is-open") ||
    elements.composerScreen.classList.contains("is-open") ||
    elements.categoryScreen.classList.contains("is-open") ||
    elements.viewerScreen.classList.contains("is-open") ||
    elements.deleteScreen.classList.contains("is-open");
  document.body.classList.toggle("has-modal-open", hasOpenModal);
}

function setPinLoading(isLoading) {
  elements.pinInput.disabled = isLoading;
  elements.cancelPinButton.disabled = isLoading;
}

function setPinError(message = "") {
  elements.pinError.textContent = message;
}

function setPinLocked(isLocked) {
  elements.pinScreen.classList.toggle("is-locked", isLocked);
  elements.pinInput.disabled = isLocked;
  elements.cancelPinButton.disabled = false;
}

function resetPinDialog() {
  elements.pinForm.reset();
  setPinError("");
  setPinLocked(false);
  setPinLoading(false);
}

function togglePinDialog(isOpen) {
  elements.pinScreen.classList.toggle("is-open", isOpen);
  elements.pinScreen.setAttribute("aria-hidden", String(!isOpen));
  updateBodyModalState();
  if (isOpen) {
    elements.pinInput.focus();
  }
}

function setEditingLocked(isLocked) {
  elements.unlockButton.hidden = !isLocked;
  document.body.classList.toggle("is-editing-locked", isLocked);
}

function setRecoveryMessage(message = "Enviaremos un enlace al correo del administrador.") {
  elements.recoveryMessage.textContent = message;
}

function setRecoveryLoading(isLoading) {
  elements.sendRecoveryButton.disabled = isLoading;
  elements.cancelRecoveryButton.disabled = isLoading;
  elements.sendRecoveryButton.textContent = isLoading ? "Enviando" : "Enviar enlace";
}

function resetRecoveryDialog() {
  setRecoveryMessage();
  setRecoveryLoading(false);
}

function toggleRecoveryDialog(isOpen) {
  elements.recoveryScreen.classList.toggle("is-open", isOpen);
  elements.recoveryScreen.setAttribute("aria-hidden", String(!isOpen));
  updateBodyModalState();
  if (isOpen) {
    elements.sendRecoveryButton.focus();
  }
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
if (elements.libraryBody) {
  elements.libraryBody.addEventListener("scroll", updateLibraryOverflowIndicator, {
    passive: true
  });
}
window.addEventListener("resize", scheduleOverflowIndicators);

function resetForm() {
  elements.form.reset();
  elements.promptIdInput.value = "";
  elements.categoryNameInput.value = "";
  setFormFavorite(false);
  setFormPrivacy(false);
  updateMarkdownPreview();
  updateCharacterCounters();
  renderSelectedCategoryPreview([]);
  setFormMode("create");
}

export {
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
  setFavoriteFilter,
  setFormFavorite,
  setFormPrivacy,
  setFormLoading,
  setFormMode,
  setEditingLocked,
  setPinError,
  setPinLoading,
  setPinLocked,
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
};
