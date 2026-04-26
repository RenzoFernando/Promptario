const elements = {
  form: document.querySelector("#prompt-form"),
  titleInput: document.querySelector("#prompt-title"),
  contentInput: document.querySelector("#prompt-content"),
  saveButton: document.querySelector("#save-button"),
  promptList: document.querySelector("#prompt-list"),
  emptyState: document.querySelector("#empty-state"),
  promptCount: document.querySelector("#prompt-count"),
  storageStatus: document.querySelector("#storage-status"),
  sortField: document.querySelector("#sort-field"),
  sortDirection: document.querySelector("#sort-direction"),
  toast: document.querySelector("#toast")
};

let toastTimer = null;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Fecha no disponible";
  }

  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function renderPrompts(prompts) {
  elements.promptCount.textContent = String(prompts.length);
  elements.emptyState.classList.toggle("is-hidden", prompts.length > 0);
  elements.promptList.innerHTML = prompts.map((prompt) => `
    <article class="prompt-card" data-id="${escapeHtml(prompt.id)}">
      <header class="prompt-card-header">
        <h3 class="prompt-card-title">${escapeHtml(prompt.title)}</h3>
        <span class="prompt-card-date">${escapeHtml(formatDate(prompt.createdAt))}</span>
      </header>
      <p class="prompt-content">${escapeHtml(prompt.content)}</p>
      <div class="prompt-actions">
        <button class="card-button" type="button" data-action="copy" data-id="${escapeHtml(prompt.id)}">Copiar</button>
        <button class="card-button danger" type="button" data-action="delete" data-id="${escapeHtml(prompt.id)}">Eliminar</button>
      </div>
    </article>
  `).join("");
}

function setStatus(message) {
  elements.storageStatus.textContent = message;
}

function setFormLoading(isLoading) {
  elements.saveButton.disabled = isLoading;
  elements.saveButton.textContent = isLoading ? "Guardando" : "Guardar prompt";
}

function updateSortDirection(direction) {
  elements.sortDirection.dataset.direction = direction;
  elements.sortDirection.textContent = direction === "asc" ? "Ascendente" : "Descendente";
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
  elements.titleInput.focus();
}

export { elements, renderPrompts, resetForm, setFormLoading, setStatus, showToast, updateSortDirection };
