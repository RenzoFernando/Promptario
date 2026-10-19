// El año del pie de página se obtiene del calendario local al cargar cada documento.
document.querySelectorAll("[data-current-year]").forEach((element) => {
  element.textContent = String(new Date().getFullYear());
});
