import { createFirestoreService, hasFirebaseConfig } from "./firebase.js";

const elements = {
  form: document.querySelector("#recovery-pin-form"),
  newPin: document.querySelector("#new-pin"),
  confirmPin: document.querySelector("#confirm-pin"),
  error: document.querySelector("#recovery-pin-error"),
  status: document.querySelector("#recovery-page-status"),
  submit: document.querySelector("#change-pin-button"),
  backLink: document.querySelector("#recovery-back-link")
};

let securityService = null;
let recoveryToken = "";

function readRecoveryToken() {
  const fragment = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const params = new URLSearchParams(fragment);
  return String(params.get("token") || "").trim();
}

function normalizePinInput(input) {
  const value = input.value.replace(/\D/g, "").slice(0, 4);

  if (input.value !== value) {
    input.value = value;
  }
}

function setStatus(message) {
  elements.status.textContent = message;
}

function setError(message = "") {
  elements.error.textContent = message;
}

function showFinalState(message) {
  elements.form.hidden = true;
  elements.backLink.hidden = false;
  setStatus(message);
}

function applyTokenState(status) {
  if (status === "valid") {
    elements.form.hidden = false;
    elements.backLink.hidden = true;
    setStatus("");
    elements.newPin.focus();
    return;
  }

  if (status === "expired") {
    showFinalState("Este enlace de recuperación expiró.");
    return;
  }

  if (status === "used") {
    showFinalState("Este enlace ya fue utilizado.");
    return;
  }

  showFinalState("Este enlace de recuperación no es válido.");
}

async function validateToken() {
  recoveryToken = readRecoveryToken();

  if (!recoveryToken || !hasFirebaseConfig) {
    applyTokenState("invalid");
    return;
  }

  try {
    securityService = await createFirestoreService();

    if (!securityService) {
      applyTokenState("invalid");
      return;
    }

    const result = await securityService.verifyRecoveryToken(recoveryToken);
    applyTokenState(result?.status || "invalid");
  } catch {
    showFinalState("No fue posible validar el enlace.");
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  normalizePinInput(elements.newPin);
  normalizePinInput(elements.confirmPin);

  const pin = elements.newPin.value;
  const confirmation = elements.confirmPin.value;

  if (!/^\d{4}$/.test(pin) || !/^\d{4}$/.test(confirmation)) {
    setError("Usa 4 dígitos.");
    return;
  }

  if (pin !== confirmation) {
    setError("Los PIN no coinciden.");
    elements.confirmPin.value = "";
    elements.confirmPin.focus();
    return;
  }

  elements.submit.disabled = true;
  elements.submit.textContent = "Actualizando";
  setError("");

  try {
    const result = await securityService.resetPin(recoveryToken, pin, confirmation);

    if (result?.ok === true && result?.status === "updated") {
      showFinalState("PIN actualizado. Promptario ha sido desbloqueado.");
      return;
    }

    applyTokenState(result?.status || "invalid");
  } catch {
    setError("No fue posible actualizar el PIN.");
  } finally {
    elements.submit.disabled = false;
    elements.submit.textContent = "Cambiar PIN";
  }
}

elements.newPin.addEventListener("input", () => normalizePinInput(elements.newPin));
elements.confirmPin.addEventListener("input", () => normalizePinInput(elements.confirmPin));
elements.form.addEventListener("submit", handleSubmit);

validateToken();
