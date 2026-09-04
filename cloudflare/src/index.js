const MAX_FAILED_ATTEMPTS = 5;
const SESSION_TTL_SECONDS = 10 * 60;
const CATEGORIES_DOCUMENT_ID = "promptario_categories";
const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

let accessTokenCache = {
  projectId: "",
  token: "",
  expiresAt: 0
};

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function jsonResponse(body, status = 200, origin = "") {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  };

  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Vary"] = "Origin";
  }

  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

function resolveCorsOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";

  if (!origin) {
    return "";
  }

  if (origin === env.ALLOWED_ORIGIN) {
    return origin;
  }

  if (/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)) {
    return origin;
  }

  throw new HttpError(403, "origin-not-allowed", "Origen no permitido.");
}

async function readJson(request) {
  const contentType = request.headers.get("Content-Type") || "";

  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "invalid-content-type", "La solicitud debe usar application/json.");
  }

  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "invalid-json", "El cuerpo JSON no es válido.");
  }
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeCategoryName(value) {
  return normalizeText(value).replace(/\s+/g, " ").toLocaleLowerCase("es");
}

function normalizeCategories(value) {
  const source = Array.isArray(value) ? value : [];
  const normalized = [];

  for (const item of source) {
    const category = normalizeCategoryName(item);

    if (!category || category.length > 60 || normalized.includes(category)) {
      continue;
    }

    normalized.push(category);
  }

  return normalized.slice(0, 30);
}

function validatePromptPayload(payload) {
  const title = normalizeText(payload?.title);
  const content = normalizeText(payload?.content);
  const categories = normalizeCategories(payload?.categories);
  const isFavorite = Boolean(payload?.isFavorite);

  if (!title || title.length > 120) {
    throw new HttpError(400, "invalid-title", "El título debe tener entre 1 y 120 caracteres.");
  }

  if (!content || content.length > 50000) {
    throw new HttpError(400, "invalid-content", "El contenido debe tener entre 1 y 50.000 caracteres.");
  }

  return { title, content, categories, isFavorite };
}

function validateDocumentId(value) {
  const id = normalizeText(value);

  if (!id || id.length > 200 || id.includes("/")) {
    throw new HttpError(400, "invalid-document-id", "El identificador del prompt no es válido.");
  }

  return id;
}

function validateCategory(value) {
  const category = normalizeCategoryName(value);

  if (!category || category.length > 60) {
    throw new HttpError(400, "invalid-category", "La categoría no es válida.");
  }

  return category;
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function base64UrlEncodeText(value) {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlDecodeBytes(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function pinsMatch(candidate, configuredPin) {
  const [candidateHash, configuredHash] = await Promise.all([
    sha256(candidate),
    sha256(configuredPin)
  ]);

  let difference = candidateHash.length ^ configuredHash.length;
  const length = Math.min(candidateHash.length, configuredHash.length);

  for (let index = 0; index < length; index += 1) {
    difference |= candidateHash[index] ^ configuredHash[index];
  }

  return difference === 0;
}

async function importHmacKey(secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("SESSION_SECRET debe tener al menos 32 caracteres.");
  }

  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function createSessionToken(secret) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    scope: "promptario-editor",
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    nonce: crypto.randomUUID()
  };
  const payloadPart = base64UrlEncodeText(JSON.stringify(payload));
  const key = await importHmacKey(secret);
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadPart))
  );

  return `${payloadPart}.${base64UrlEncodeBytes(signature)}`;
}

async function verifySessionToken(token, secret) {
  if (typeof token !== "string" || !token.includes(".")) {
    return false;
  }

  const [payloadPart, signaturePart, extra] = token.split(".");

  if (!payloadPart || !signaturePart || extra) {
    return false;
  }

  let payload;

  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecodeBytes(payloadPart)));
  } catch {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);

  if (
    payload?.scope !== "promptario-editor"
    || !Number.isInteger(payload?.iat)
    || !Number.isInteger(payload?.exp)
    || payload.exp <= now
    || payload.exp - payload.iat > SESSION_TTL_SECONDS
  ) {
    return false;
  }

  try {
    const key = await importHmacKey(secret);
    return await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecodeBytes(signaturePart),
      new TextEncoder().encode(payloadPart)
    );
  } catch {
    return false;
  }
}

async function getSecurityState(db) {
  const row = await db.prepare(`
    SELECT
      failed_attempts AS failedAttempts,
      locked,
      locked_at AS lockedAt,
      last_failed_at AS lastFailedAt,
      last_success_at AS lastSuccessAt
    FROM security_state
    WHERE id = 1
  `).first();

  if (!row) {
    throw new Error("La base D1 no está inicializada. Ejecuta la migración incluida.");
  }

  return {
    failedAttempts: Number(row.failedAttempts) || 0,
    locked: Number(row.locked) === 1,
    lockedAt: row.lockedAt || null,
    lastFailedAt: row.lastFailedAt || null,
    lastSuccessAt: row.lastSuccessAt || null
  };
}

async function registerFailedAttempt(db) {
  const now = new Date().toISOString();

  const results = await db.batch([
    db.prepare(`
      UPDATE security_state
      SET
        failed_attempts = CASE
          WHEN failed_attempts < ?1 THEN failed_attempts + 1
          ELSE failed_attempts
        END,
        locked = CASE
          WHEN failed_attempts + 1 >= ?1 THEN 1
          ELSE locked
        END,
        last_failed_at = ?2,
        locked_at = CASE
          WHEN locked = 0 AND failed_attempts + 1 >= ?1 THEN ?2
          ELSE locked_at
        END,
        updated_at = ?2
      WHERE id = 1 AND locked = 0
    `).bind(MAX_FAILED_ATTEMPTS, now),
    db.prepare(`
      INSERT INTO security_events (type, created_at, details)
      SELECT
        'pin-lockout',
        ?1,
        '{"failedAttempts":5}'
      FROM security_state
      WHERE id = 1 AND locked = 1 AND lock_event_recorded = 0
    `).bind(now),
    db.prepare(`
      UPDATE security_state
      SET lock_event_recorded = 1
      WHERE id = 1 AND locked = 1 AND lock_event_recorded = 0
    `),
    db.prepare(`
      SELECT
        failed_attempts AS failedAttempts,
        locked,
        locked_at AS lockedAt
      FROM security_state
      WHERE id = 1
    `)
  ]);

  const row = results[3]?.results?.[0];

  if (!row) {
    throw new Error("No fue posible leer el estado de seguridad.");
  }

  const failedAttempts = Number(row.failedAttempts) || 0;
  const locked = Number(row.locked) === 1;

  return {
    failedAttempts,
    locked,
    remainingAttempts: Math.max(MAX_FAILED_ATTEMPTS - failedAttempts, 0),
    lockedAt: row.lockedAt || null
  };
}

async function registerSuccessfulPin(db) {
  const now = new Date().toISOString();

  const results = await db.batch([
    db.prepare(`
      UPDATE security_state
      SET
        failed_attempts = 0,
        last_success_at = ?1,
        updated_at = ?1
      WHERE id = 1 AND locked = 0
    `).bind(now),
    db.prepare(`
      SELECT
        failed_attempts AS failedAttempts,
        locked,
        locked_at AS lockedAt
      FROM security_state
      WHERE id = 1
    `)
  ]);

  const row = results[1]?.results?.[0];

  if (!row) {
    throw new Error("No fue posible leer el estado de seguridad.");
  }

  return {
    failedAttempts: Number(row.failedAttempts) || 0,
    locked: Number(row.locked) === 1,
    lockedAt: row.lockedAt || null
  };
}

function parseServiceAccount(env) {
  let serviceAccount;

  try {
    serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON no contiene un JSON válido.");
  }

  if (
    !serviceAccount
    || typeof serviceAccount.client_email !== "string"
    || typeof serviceAccount.private_key !== "string"
    || typeof serviceAccount.project_id !== "string"
  ) {
    throw new Error("La cuenta de servicio de Firebase está incompleta.");
  }

  if (serviceAccount.project_id !== env.FIREBASE_PROJECT_ID) {
    throw new Error("La cuenta de servicio no pertenece al proyecto Firebase configurado.");
  }

  return serviceAccount;
}

function pemToArrayBuffer(pem) {
  const base64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

async function importServiceAccountKey(privateKey) {
  return crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function createGoogleAssertion(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncodeText(JSON.stringify({
    alg: "RS256",
    typ: "JWT",
    ...(serviceAccount.private_key_id ? { kid: serviceAccount.private_key_id } : {})
  }));
  const claims = base64UrlEncodeText(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: FIRESTORE_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600
  }));
  const unsignedToken = `${header}.${claims}`;
  const key = await importServiceAccountKey(serviceAccount.private_key);
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      new TextEncoder().encode(unsignedToken)
    )
  );

  return `${unsignedToken}.${base64UrlEncodeBytes(signature)}`;
}

async function getGoogleAccessToken(env, forceRefresh = false) {
  const now = Math.floor(Date.now() / 1000);

  if (
    !forceRefresh
    && accessTokenCache.projectId === env.FIREBASE_PROJECT_ID
    && accessTokenCache.token
    && accessTokenCache.expiresAt > now + 60
  ) {
    return accessTokenCache.token;
  }

  const serviceAccount = parseServiceAccount(env);
  const assertion = await createGoogleAssertion(serviceAccount);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!response.ok) {
    throw new Error(`Google OAuth rechazó la cuenta de servicio (${response.status}).`);
  }

  const result = await response.json();

  if (!result?.access_token) {
    throw new Error("Google OAuth no devolvió un token de acceso.");
  }

  accessTokenCache = {
    projectId: env.FIREBASE_PROJECT_ID,
    token: result.access_token,
    expiresAt: now + Number(result.expires_in || 3600)
  };

  return result.access_token;
}

function firestoreRoot(env) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents`;
}

async function firestoreRequest(env, path, options = {}, retry = true) {
  const token = await getGoogleAccessToken(env);
  const response = await fetch(`${firestoreRoot(env)}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  });

  if (response.status === 401 && retry) {
    await getGoogleAccessToken(env, true);
    return firestoreRequest(env, path, options, false);
  }

  return response;
}

function firestoreString(value) {
  return { stringValue: String(value) };
}

function firestoreBoolean(value) {
  return { booleanValue: Boolean(value) };
}

function firestoreTimestamp(value = new Date().toISOString()) {
  return { timestampValue: value };
}

function firestoreStringArray(values) {
  return {
    arrayValue: {
      values: values.map((value) => firestoreString(value))
    }
  };
}

function promptFields(prompt, { includeCreatedAt = false } = {}) {
  const now = new Date().toISOString();
  const fields = {
    title: firestoreString(prompt.title),
    content: firestoreString(prompt.content),
    categories: firestoreStringArray(prompt.categories),
    isFavorite: firestoreBoolean(prompt.isFavorite),
    updatedAt: firestoreTimestamp(now)
  };

  if (includeCreatedAt) {
    fields.createdAt = firestoreTimestamp(now);
  }

  return fields;
}

function categoryFields(categories) {
  return {
    internalType: firestoreString("promptarioCategories"),
    categories: firestoreStringArray(categories),
    updatedAt: firestoreTimestamp()
  };
}

function parseFirestoreStringArray(value) {
  const values = value?.arrayValue?.values;

  if (!Array.isArray(values)) {
    return [];
  }

  return normalizeCategories(values.map((item) => item?.stringValue || ""));
}

async function requireFirestoreOk(response, message) {
  if (response.ok) {
    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  let details = "";

  try {
    const payload = await response.json();
    details = payload?.error?.message || "";
  } catch {
    details = await response.text();
  }

  console.error(message, response.status, details);
  throw new HttpError(502, "firestore-error", message);
}

async function createPrompt(env, payload) {
  const prompt = validatePromptPayload(payload);
  const response = await firestoreRequest(env, "/prompts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: promptFields(prompt, { includeCreatedAt: true }) })
  });

  await requireFirestoreOk(response, "Firestore no pudo crear el prompt.");
}

async function updatePrompt(env, payload) {
  const id = validateDocumentId(payload?.id);
  const prompt = validatePromptPayload(payload);
  const updateMask = ["title", "content", "categories", "isFavorite", "updatedAt"]
    .map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`)
    .join("&");
  const response = await firestoreRequest(
    env,
    `/prompts/${encodeURIComponent(id)}?${updateMask}&currentDocument.exists=true`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: promptFields(prompt) })
    }
  );

  await requireFirestoreOk(response, "Firestore no pudo actualizar el prompt.");
}

async function deletePrompt(env, payload) {
  const id = validateDocumentId(payload?.id);
  const response = await firestoreRequest(
    env,
    `/prompts/${encodeURIComponent(id)}?currentDocument.exists=true`,
    { method: "DELETE" }
  );

  await requireFirestoreOk(response, "Firestore no pudo eliminar el prompt.");
}

async function getCategoriesDocument(env) {
  const response = await firestoreRequest(
    env,
    `/prompts/${encodeURIComponent(CATEGORIES_DOCUMENT_ID)}`,
    { method: "GET" }
  );

  if (response.status === 404) {
    return [];
  }

  const document = await requireFirestoreOk(response, "Firestore no pudo leer las categorías.");
  return parseFirestoreStringArray(document?.fields?.categories);
}

async function writeCategoriesDocument(env, categories) {
  const updateMask = ["internalType", "categories", "updatedAt"]
    .map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`)
    .join("&");
  const response = await firestoreRequest(
    env,
    `/prompts/${encodeURIComponent(CATEGORIES_DOCUMENT_ID)}?${updateMask}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: categoryFields(categories) })
    }
  );

  await requireFirestoreOk(response, "Firestore no pudo guardar las categorías.");
}

async function createCategory(env, payload) {
  const category = validateCategory(payload?.name);
  const categories = await getCategoriesDocument(env);

  if (!categories.includes(category)) {
    categories.push(category);
  }

  await writeCategoriesDocument(env, normalizeCategories(categories));
}

async function queryPromptsByCategory(env, category) {
  const databaseRoot = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents:runQuery`;
  const token = await getGoogleAccessToken(env);
  const response = await fetch(databaseRoot, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "prompts" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "categories" },
            op: "ARRAY_CONTAINS",
            value: firestoreString(category)
          }
        }
      }
    })
  });

  const results = await requireFirestoreOk(response, "Firestore no pudo buscar los prompts de la categoría.");

  return Array.isArray(results)
    ? results.map((item) => item?.document).filter(Boolean)
    : [];
}

function firestoreDocumentId(document) {
  const name = String(document?.name || "");
  return name.split("/").pop() || "";
}

async function deleteCategory(env, payload) {
  const category = validateCategory(payload?.name);
  const [categories, documents] = await Promise.all([
    getCategoriesDocument(env),
    queryPromptsByCategory(env, category)
  ]);
  const nextCategories = categories.filter((item) => item !== category);
  const writes = [];

  writes.push({
    update: {
      name: `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/prompts/${CATEGORIES_DOCUMENT_ID}`,
      fields: categoryFields(nextCategories)
    },
    updateMask: {
      fieldPaths: ["internalType", "categories", "updatedAt"]
    }
  });

  for (const document of documents) {
    const id = firestoreDocumentId(document);

    if (!id || id === CATEGORIES_DOCUMENT_ID || document?.fields?.internalType?.stringValue === "promptarioCategories") {
      continue;
    }

    const promptCategories = parseFirestoreStringArray(document?.fields?.categories)
      .filter((item) => item !== category);

    writes.push({
      update: {
        name: document.name,
        fields: {
          categories: firestoreStringArray(promptCategories),
          updatedAt: firestoreTimestamp()
        }
      },
      updateMask: {
        fieldPaths: ["categories", "updatedAt"]
      }
    });
  }

  if (writes.length > 500) {
    throw new HttpError(409, "too-many-category-updates", "La categoría está asignada a demasiados prompts para eliminarla en una sola operación.");
  }

  const token = await getGoogleAccessToken(env);
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents:commit`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ writes })
    }
  );

  await requireFirestoreOk(response, "Firestore no pudo eliminar la categoría.");
}

async function executeMutation(env, action, payload) {
  switch (action) {
    case "createPrompt":
      await createPrompt(env, payload);
      break;
    case "updatePrompt":
      await updatePrompt(env, payload);
      break;
    case "deletePrompt":
      await deletePrompt(env, payload);
      break;
    case "createCategory":
      await createCategory(env, payload);
      break;
    case "deleteCategory":
      await deleteCategory(env, payload);
      break;
    default:
      throw new HttpError(400, "invalid-action", "La operación solicitada no existe.");
  }
}

async function handleAuth(request, env, origin) {
  const body = await readJson(request);
  const pin = normalizeText(body?.pin);

  if (!/^\d{4}$/.test(pin)) {
    throw new HttpError(400, "invalid-pin-format", "El PIN debe tener exactamente 4 dígitos numéricos.");
  }

  const configuredPin = normalizeText(env.PROMPTARIO_PIN);

  if (!/^\d{4}$/.test(configuredPin)) {
    console.error("PROMPTARIO_PIN no está configurado como un PIN de cuatro dígitos.");
    throw new HttpError(503, "pin-not-configured", "El acceso de edición aún no está configurado.");
  }

  const initialState = await getSecurityState(env.DB);

  if (initialState.locked) {
    return jsonResponse({
      ok: false,
      status: "locked",
      remainingAttempts: 0
    }, 200, origin);
  }

  if (!(await pinsMatch(pin, configuredPin))) {
    const state = await registerFailedAttempt(env.DB);

    if (state.locked) {
      console.error("Promptario bloqueó el acceso de edición después de cinco intentos fallidos.", {
        securityEvent: "promptario-pin-lockout",
        failedAttempts: state.failedAttempts,
        lockedAt: state.lockedAt
      });
    }

    return jsonResponse({
      ok: false,
      status: state.locked ? "locked" : "invalid-pin",
      remainingAttempts: state.remainingAttempts
    }, 200, origin);
  }

  const state = await registerSuccessfulPin(env.DB);

  if (state.locked) {
    return jsonResponse({
      ok: false,
      status: "locked",
      remainingAttempts: 0
    }, 200, origin);
  }

  const token = await createSessionToken(env.SESSION_SECRET);

  return jsonResponse({
    ok: true,
    status: "authorized",
    remainingAttempts: MAX_FAILED_ATTEMPTS,
    token,
    expiresIn: SESSION_TTL_SECONDS
  }, 200, origin);
}

async function handleMutation(request, env, origin) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";

  if (!(await verifySessionToken(token, env.SESSION_SECRET))) {
    throw new HttpError(401, "invalid-session", "La autorización de edición venció o no es válida.");
  }

  const state = await getSecurityState(env.DB);

  if (state.locked) {
    throw new HttpError(423, "locked", "El acceso de edición está bloqueado.");
  }

  const body = await readJson(request);
  const action = normalizeText(body?.action);
  const payload = body?.payload && typeof body.payload === "object"
    ? body.payload
    : {};

  await executeMutation(env, action, payload);

  await env.DB.prepare(`
    INSERT INTO security_events (type, created_at, details)
    VALUES ('mutation-success', ?1, ?2)
  `).bind(
    new Date().toISOString(),
    JSON.stringify({ action })
  ).run();

  return jsonResponse({ ok: true, status: "saved" }, 200, origin);
}

export default {
  async fetch(request, env) {
    let origin = "";

    try {
      origin = resolveCorsOrigin(request, env);

      if (request.method === "OPTIONS") {
        return jsonResponse({ ok: true }, 204, origin);
      }

      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse({
          ok: true,
          service: "promptario-security",
          firebaseProject: env.FIREBASE_PROJECT_ID
        }, 200, origin);
      }

      if (request.method === "POST" && url.pathname === "/auth") {
        return await handleAuth(request, env, origin);
      }

      if (request.method === "POST" && url.pathname === "/mutate") {
        return await handleMutation(request, env, origin);
      }

      return jsonResponse({
        ok: false,
        code: "not-found",
        message: "Ruta no encontrada."
      }, 404, origin);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonResponse({
          ok: false,
          code: error.code,
          message: error.message
        }, error.status, origin);
      }

      console.error("Error no controlado en Promptario Security Worker.", error);

      return jsonResponse({
        ok: false,
        code: "internal-error",
        message: "El servicio de edición no pudo completar la solicitud."
      }, 500, origin);
    }
  }
};
