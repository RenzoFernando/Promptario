const MAX_FAILED_ATTEMPTS = 5;
const SESSION_TTL_SECONDS = 10 * 60;
const RECOVERY_TTL_SECONDS = 15 * 60;
const RECOVERY_COOLDOWN_SECONDS = 15 * 60;
const DEFAULT_PUBLIC_APP_URL = "https://renzofernando.github.io/Promptario/";
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

  if (env.ALLOW_LOCALHOST === "true" && /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)) {
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

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function timingSafeEqualBytes(first, second) {
  let difference = first.length ^ second.length;
  const length = Math.min(first.length, second.length);

  for (let index = 0; index < length; index += 1) {
    difference |= first[index] ^ second[index];
  }

  return difference === 0;
}

async function importPinHashKey(secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("SESSION_SECRET debe tener al menos 32 caracteres.");
  }

  const keyBytes = await sha256(`promptario-pin-key-v1:${secret}`);
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function derivePinHash(pin, salt, secret) {
  const key = await importPinHashKey(secret);
  const payload = new TextEncoder().encode(`promptario-pin-v1:${salt}:${pin}`);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, payload));
}

async function createPinCredentialValues(pin, env) {
  const salt = base64UrlEncodeBytes(randomBytes(16));
  const pinHash = await derivePinHash(pin, salt, env.SESSION_SECRET);

  return {
    salt,
    pinHash: base64UrlEncodeBytes(pinHash),
    algorithm: "hmac-sha256-v1"
  };
}

async function getPinCredentials(env) {
  let row = await env.DB.prepare(`
    SELECT
      salt,
      pin_hash AS pinHash,
      algorithm
    FROM pin_credentials
    WHERE id = 1
  `).first();

  if (row) {
    return row;
  }

  const bootstrapPin = normalizeText(env.PROMPTARIO_PIN);

  if (!/^\d{4}$/.test(bootstrapPin)) {
    throw new HttpError(503, "pin-not-configured", "El acceso de edición aún no está configurado.");
  }

  const credentials = await createPinCredentialValues(bootstrapPin, env);
  const now = new Date().toISOString();

  await env.DB.prepare(`
    INSERT OR IGNORE INTO pin_credentials (
      id,
      salt,
      pin_hash,
      algorithm,
      updated_at
    ) VALUES (1, ?1, ?2, ?3, ?4)
  `).bind(
    credentials.salt,
    credentials.pinHash,
    credentials.algorithm,
    now
  ).run();

  row = await env.DB.prepare(`
    SELECT
      salt,
      pin_hash AS pinHash,
      algorithm
    FROM pin_credentials
    WHERE id = 1
  `).first();

  if (!row) {
    throw new Error("No fue posible inicializar las credenciales del PIN.");
  }

  return row;
}

async function verifyConfiguredPin(env, candidate) {
  const credentials = await getPinCredentials(env);

  if (credentials.algorithm !== "hmac-sha256-v1") {
    throw new Error("La configuración del PIN no es válida.");
  }

  let expectedHash;

  try {
    expectedHash = base64UrlDecodeBytes(String(credentials.pinHash || ""));
  } catch {
    throw new Error("La configuración del PIN no es válida.");
  }

  const candidateHash = await derivePinHash(
    candidate,
    String(credentials.salt || ""),
    env.SESSION_SECRET
  );
  return timingSafeEqualBytes(candidateHash, expectedHash);
}

async function writePinCredentials(db, pin, env) {
  const credentials = await createPinCredentialValues(pin, env);
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT INTO pin_credentials (
      id,
      salt,
      pin_hash,
      algorithm,
      updated_at
    ) VALUES (1, ?1, ?2, ?3, ?4)
    ON CONFLICT(id) DO UPDATE SET
      salt = excluded.salt,
      pin_hash = excluded.pin_hash,
      algorithm = excluded.algorithm,
      updated_at = excluded.updated_at
  `).bind(
    credentials.salt,
    credentials.pinHash,
    credentials.algorithm,
    now
  ).run();
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

async function getSessionVersion(db) {
  const row = await db.prepare(`
    SELECT version
    FROM session_state
    WHERE id = 1
  `).first();

  if (!row) {
    throw new Error("La base D1 no está inicializada. Ejecuta la migración incluida.");
  }

  const version = Number(row.version);
  return Number.isInteger(version) && version >= 1 ? version : 1;
}

async function createSessionToken(secret, version) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    scope: "promptario-editor",
    ver: version,
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
    return null;
  }

  const [payloadPart, signaturePart, extra] = token.split(".");

  if (!payloadPart || !signaturePart || extra) {
    return null;
  }

  let payload;

  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecodeBytes(payloadPart)));
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);

  if (
    payload?.scope !== "promptario-editor"
    || !Number.isInteger(payload?.ver)
    || payload.ver < 1
    || !Number.isInteger(payload?.iat)
    || !Number.isInteger(payload?.exp)
    || payload.exp <= now
    || payload.exp - payload.iat > SESSION_TTL_SECONDS
  ) {
    return null;
  }

  try {
    const key = await importHmacKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecodeBytes(signaturePart),
      new TextEncoder().encode(payloadPart)
    );

    return valid ? payload : null;
  } catch {
    return null;
  }
}

function getIpPrefix(ip) {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    const parts = ip.split(".");
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }

  return "";
}

function getClientInfo(request) {
  const ip = normalizeText(request.headers.get("CF-Connecting-IP") || "").slice(0, 80);

  return {
    ip,
    ipPrefix: getIpPrefix(ip),
    country: normalizeText(request.cf?.country || "").slice(0, 8),
    userAgent: normalizeText(request.headers.get("User-Agent") || "").slice(0, 300),
    rayId: normalizeText(request.headers.get("CF-Ray") || "").slice(0, 80)
  };
}

async function logSecurityEvent(db, type, client = {}, extra = {}) {
  const details = JSON.stringify({
    ip: client.ip || "",
    ipPrefix: client.ipPrefix || "",
    country: client.country || "",
    userAgent: client.userAgent || "",
    rayId: client.rayId || "",
    ...extra
  });

  await db.prepare(`
    INSERT INTO security_events (type, created_at, details)
    VALUES (?1, ?2, ?3)
  `).bind(type, new Date().toISOString(), details).run();
}

function parseIpv4(value) {
  const parts = String(value || "").split(".");

  if (parts.length !== 4) {
    return null;
  }

  const numbers = parts.map((part) => Number(part));

  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }

  return (((numbers[0] * 256) + numbers[1]) * 256 + numbers[2]) * 256 + numbers[3];
}

function ipv4MatchesCidr(ip, cidr) {
  const [network, prefixText, extra] = String(cidr || "").split("/");
  const prefix = Number(prefixText);
  const ipValue = parseIpv4(ip);
  const networkValue = parseIpv4(network);

  if (extra !== undefined || ipValue === null || networkValue === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }

  if (prefix === 0) {
    return true;
  }

  const divisor = 2 ** (32 - prefix);
  return Math.floor(ipValue / divisor) === Math.floor(networkValue / divisor);
}

async function isClientBlocked(db, ip) {
  if (!ip) {
    return false;
  }

  const result = await db.prepare(`
    SELECT target, kind
    FROM blocked_clients
    ORDER BY id ASC
  `).all();
  const rows = Array.isArray(result?.results) ? result.results : [];

  return rows.some((row) => {
    const target = normalizeText(row?.target);
    const kind = normalizeText(row?.kind);

    if (kind === "ip") {
      return target === ip;
    }

    if (kind === "cidr") {
      return ipv4MatchesCidr(ip, target);
    }

    return false;
  });
}

async function ensureClientAllowed(db, client) {
  if (await isClientBlocked(db, client.ip)) {
    await logSecurityEvent(db, "blocked-client-request", client);
    throw new HttpError(403, "client-blocked", "Acceso denegado.");
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

async function registerFailedAttempt(db, client) {
  const now = new Date().toISOString();
  const clientDetails = JSON.stringify(client);

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
      VALUES ('pin-failed', ?1, ?2)
    `).bind(now, clientDetails),
    db.prepare(`
      INSERT INTO security_events (type, created_at, details)
      SELECT
        'pin-lockout',
        ?1,
        ?2
      FROM security_state
      WHERE id = 1 AND locked = 1 AND lock_event_recorded = 0
    `).bind(now, clientDetails),
    db.prepare(`
      UPDATE session_state
      SET version = version + 1, updated_at = ?1
      WHERE id = 1
        AND EXISTS (
          SELECT 1
          FROM security_state
          WHERE id = 1 AND locked = 1 AND lock_event_recorded = 0
        )
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

  const row = results[5]?.results?.[0];

  if (!row) {
    throw new Error("No fue posible leer el estado de seguridad.");
  }

  const failedAttempts = Number(row.failedAttempts) || 0;
  const locked = Number(row.locked) === 1;

  return {
    failedAttempts,
    locked,
    newlyLocked: Number(results[2]?.meta?.changes || 0) === 1,
    remainingAttempts: Math.max(MAX_FAILED_ATTEMPTS - failedAttempts, 0),
    lockedAt: row.lockedAt || null
  };
}

async function registerSuccessfulPin(db, client) {
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
      INSERT INTO security_events (type, created_at, details)
      VALUES ('pin-success', ?1, ?2)
    `).bind(now, JSON.stringify(client)),
    db.prepare(`
      SELECT
        failed_attempts AS failedAttempts,
        locked,
        locked_at AS lockedAt
      FROM security_state
      WHERE id = 1
    `)
  ]);

  const row = results[2]?.results?.[0];

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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function resolvePublicAppUrl(env) {
  const candidate = normalizeText(env.PUBLIC_APP_URL) || DEFAULT_PUBLIC_APP_URL;

  try {
    const url = new URL(candidate);

    if (url.protocol !== "https:" && !(url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1"))) {
      throw new Error("invalid-public-app-url");
    }

    return url.toString().endsWith("/") ? url.toString() : `${url.toString()}/`;
  } catch {
    return DEFAULT_PUBLIC_APP_URL;
  }
}

function buildRecoveryUrl(env, token) {
  const url = new URL("recover.html", resolvePublicAppUrl(env));
  url.hash = `token=${encodeURIComponent(token)}`;
  return url.toString();
}

function validateRecoveryToken(value) {
  const token = normalizeText(value);

  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new HttpError(400, "invalid-recovery-token", "El enlace de recuperación no es válido.");
  }

  return token;
}

async function recoveryTokenHash(token) {
  return base64UrlEncodeBytes(await sha256(token));
}

async function getRecoveryRecord(db, token) {
  const tokenHash = await recoveryTokenHash(token);
  const row = await db.prepare(`
    SELECT
      id,
      token_hash AS tokenHash,
      created_at AS createdAt,
      expires_at AS expiresAt,
      used_at AS usedAt,
      requested_ip AS requestedIp,
      used_ip AS usedIp
    FROM recovery_tokens
    WHERE token_hash = ?1
  `).bind(tokenHash).first();

  return row || null;
}

function recoveryRecordStatus(record, now = Date.now()) {
  if (!record) {
    return "invalid";
  }

  if (record.usedAt) {
    return "used";
  }

  const expiresAt = Date.parse(record.expiresAt || "");

  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return "expired";
  }

  return "valid";
}

async function sendRecoveryEmail(env, recoveryUrl, client, tokenId) {
  const apiKey = normalizeText(env.RESEND_API_KEY);
  const recipient = normalizeText(env.RECOVERY_EMAIL);
  const sender = normalizeText(env.RESEND_FROM_EMAIL) || "Promptario <onboarding@resend.dev>";

  if (!apiKey || !recipient) {
    throw new HttpError(503, "recovery-not-configured", "La recuperación por correo no está configurada.");
  }

  const occurredAt = new Date().toISOString();
  const ipLine = client.ip ? `<p><strong>IP:</strong> ${escapeHtml(client.ip)}</p>` : "";
  const countryLine = client.country ? `<p><strong>País:</strong> ${escapeHtml(client.country)}</p>` : "";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `promptario-recovery-${tokenId}`
    },
    body: JSON.stringify({
      from: sender,
      to: [recipient],
      subject: "Promptario — recuperación de acceso",
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1d1c19">
          <h2>Promptario bloqueado</h2>
          <p>La edición fue bloqueada después de varios intentos de PIN incorrectos.</p>
          <p><strong>Fecha:</strong> ${escapeHtml(occurredAt)}</p>
          ${ipLine}
          ${countryLine}
          <p>Usa el siguiente enlace para establecer un PIN nuevo y desbloquear Promptario.</p>
          <p><a href="${escapeHtml(recoveryUrl)}">Recuperar acceso</a></p>
          <p>El enlace expira en 15 minutos y solo puede utilizarse una vez.</p>
        </div>
      `
    })
  });

  if (!response.ok) {
    let details = "";

    try {
      details = await response.text();
    } catch {
      details = "";
    }

    console.error("Resend no pudo enviar el correo de recuperación.", response.status, details.slice(0, 500));
    throw new HttpError(502, "recovery-email-failed", "No fue posible enviar el enlace de recuperación.");
  }
}

async function issueRecovery(env, client, { enforceCooldown = true } = {}) {
  const state = await getSecurityState(env.DB);

  if (!state.locked) {
    throw new HttpError(409, "not-locked", "La edición no está bloqueada.");
  }

  if (enforceCooldown) {
    const latest = await env.DB.prepare(`
      SELECT created_at AS createdAt
      FROM recovery_tokens
      ORDER BY created_at DESC
      LIMIT 1
    `).first();
    const latestAt = latest?.createdAt ? Date.parse(latest.createdAt) : NaN;

    if (Number.isFinite(latestAt) && Date.now() - latestAt < RECOVERY_COOLDOWN_SECONDS * 1000) {
      return { ok: true, status: "sent" };
    }
  }

  const token = base64UrlEncodeBytes(randomBytes(32));
  const tokenHash = await recoveryTokenHash(token);
  const tokenId = crypto.randomUUID();
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + RECOVERY_TTL_SECONDS * 1000).toISOString();

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE recovery_tokens
      SET used_at = ?1
      WHERE used_at IS NULL
    `).bind(createdAt),
    env.DB.prepare(`
      INSERT INTO recovery_tokens (
        id,
        token_hash,
        created_at,
        expires_at,
        requested_ip
      ) VALUES (?1, ?2, ?3, ?4, ?5)
    `).bind(tokenId, tokenHash, createdAt, expiresAt, client.ip || null)
  ]);

  const recoveryUrl = buildRecoveryUrl(env, token);

  try {
    await sendRecoveryEmail(env, recoveryUrl, client, tokenId);
  } catch (error) {
    await env.DB.prepare(`
      DELETE FROM recovery_tokens
      WHERE id = ?1
    `).bind(tokenId).run();
    await logSecurityEvent(env.DB, "recovery-email-failed", client, { tokenId });
    throw error;
  }

  await logSecurityEvent(env.DB, "recovery-email-sent", client, { tokenId });
  return { ok: true, status: "sent" };
}

async function handleSecurityStatus(request, env, origin) {
    const state = await getSecurityState(env.DB);

    return jsonResponse({
        ok: true,
        locked: state.locked
    }, 200, origin);
}

async function handleAuth(request, env, origin) {
  const client = getClientInfo(request);
  await ensureClientAllowed(env.DB, client);

  const body = await readJson(request);
  const pin = normalizeText(body?.pin);

  if (!/^\d{4}$/.test(pin)) {
    throw new HttpError(400, "invalid-pin-format", "El PIN debe tener exactamente 4 dígitos numéricos.");
  }

  const initialState = await getSecurityState(env.DB);

  if (initialState.locked) {
    await logSecurityEvent(env.DB, "pin-attempt-while-locked", client);
    return jsonResponse({
      ok: false,
      status: "locked",
      remainingAttempts: 0
    }, 200, origin);
  }

  if (!(await verifyConfiguredPin(env, pin))) {
    const state = await registerFailedAttempt(env.DB, client);

    if (state.newlyLocked) {
      try {
        await issueRecovery(env, client, { enforceCooldown: false });
      } catch (error) {
        console.error("Promptario quedó bloqueado y no fue posible enviar la recuperación automática.", error);
      }
    }

    return jsonResponse({
      ok: false,
      status: state.locked ? "locked" : "invalid-pin",
      remainingAttempts: state.remainingAttempts
    }, 200, origin);
  }

  const state = await registerSuccessfulPin(env.DB, client);

  if (state.locked) {
    return jsonResponse({
      ok: false,
      status: "locked",
      remainingAttempts: 0
    }, 200, origin);
  }

  const sessionVersion = await getSessionVersion(env.DB);
  const token = await createSessionToken(env.SESSION_SECRET, sessionVersion);

  return jsonResponse({
    ok: true,
    status: "authorized",
    remainingAttempts: MAX_FAILED_ATTEMPTS,
    token,
    expiresIn: SESSION_TTL_SECONDS
  }, 200, origin);
}

async function handleMutation(request, env, origin) {
  const client = getClientInfo(request);
  await ensureClientAllowed(env.DB, client);

  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const session = await verifySessionToken(token, env.SESSION_SECRET);
  const sessionVersion = await getSessionVersion(env.DB);

  if (!session || session.ver !== sessionVersion) {
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
  await logSecurityEvent(env.DB, "mutation-success", client, { action });

  return jsonResponse({ ok: true, status: "saved" }, 200, origin);
}

async function handleRecoveryRequest(request, env, origin) {
  const client = getClientInfo(request);
  await ensureClientAllowed(env.DB, client);
  await readJson(request);
  const result = await issueRecovery(env, client);
  return jsonResponse(result, 200, origin);
}

async function handleRecoveryVerify(request, env, origin) {
  const client = getClientInfo(request);
  await ensureClientAllowed(env.DB, client);
  const body = await readJson(request);
  const token = validateRecoveryToken(body?.token);
  const record = await getRecoveryRecord(env.DB, token);
  const status = recoveryRecordStatus(record);

  await logSecurityEvent(env.DB, "recovery-token-check", client, { status });

  return jsonResponse({
    ok: status === "valid",
    status
  }, 200, origin);
}

async function hasValidAdminCliToken(request, env) {
  const expected = normalizeText(env.ADMIN_CLI_TOKEN);
  const authorization = request.headers.get("Authorization") || "";
  const candidate = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";

  if (expected.length < 32 || candidate.length < 32) {
    return false;
  }

  const [expectedHash, candidateHash] = await Promise.all([
    sha256(expected),
    sha256(candidate)
  ]);

  return timingSafeEqualBytes(expectedHash, candidateHash);
}

async function handleRecoveryReset(request, env, origin) {
  const client = getClientInfo(request);
  await ensureClientAllowed(env.DB, client);
  const body = await readJson(request);
  const token = validateRecoveryToken(body?.token);
  const pin = normalizeText(body?.pin);
  const confirmation = normalizeText(body?.confirmation);

  if (!/^\d{4}$/.test(pin)) {
    throw new HttpError(400, "invalid-pin-format", "El PIN debe tener exactamente 4 dígitos numéricos.");
  }

  if (pin !== confirmation) {
    throw new HttpError(400, "pin-mismatch", "Los PIN no coinciden.");
  }

  const record = await getRecoveryRecord(env.DB, token);
  const status = recoveryRecordStatus(record);

  if (status !== "valid") {
    return jsonResponse({ ok: false, status }, 200, origin);
  }

  const tokenHash = await recoveryTokenHash(token);
  const now = new Date().toISOString();
  const claim = await env.DB.prepare(`
    UPDATE recovery_tokens
    SET used_at = ?1, used_ip = ?2
    WHERE token_hash = ?3
      AND used_at IS NULL
      AND expires_at > ?1
  `).bind(now, client.ip || null, tokenHash).run();

  if (Number(claim?.meta?.changes || 0) !== 1) {
    const currentRecord = await getRecoveryRecord(env.DB, token);
    return jsonResponse({
      ok: false,
      status: recoveryRecordStatus(currentRecord)
    }, 200, origin);
  }

  await writePinCredentials(env.DB, pin, env);
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE security_state
      SET
        failed_attempts = 0,
        locked = 0,
        lock_event_recorded = 0,
        locked_at = NULL,
        last_success_at = ?1,
        updated_at = ?1
      WHERE id = 1
    `).bind(now),
    env.DB.prepare(`
      UPDATE session_state
      SET version = version + 1, updated_at = ?1
      WHERE id = 1
    `).bind(now),
    env.DB.prepare(`
      UPDATE recovery_tokens
      SET used_at = COALESCE(used_at, ?1)
      WHERE used_at IS NULL
    `).bind(now)
  ]);
  await logSecurityEvent(env.DB, "recovery-success", client, { tokenId: record.id });

  return jsonResponse({
    ok: true,
    status: "updated"
  }, 200, origin);
}

async function handleAdminChangePin(request, env, origin) {
  const client = getClientInfo(request);

  if (normalizeText(env.ADMIN_CLI_TOKEN).length < 32) {
    throw new HttpError(404, "not-found", "Ruta no encontrada.");
  }

  if (!(await hasValidAdminCliToken(request, env))) {
    await logSecurityEvent(env.DB, "admin-cli-denied", client);
    throw new HttpError(401, "admin-cli-unauthorized", "Autorización administrativa no válida.");
  }

  const body = await readJson(request);
  const pin = normalizeText(body?.pin);
  const confirmation = normalizeText(body?.confirmation);

  if (!/^\d{4}$/.test(pin)) {
    throw new HttpError(400, "invalid-pin-format", "El PIN debe tener exactamente 4 dígitos numéricos.");
  }

  if (pin !== confirmation) {
    throw new HttpError(400, "pin-mismatch", "Los PIN no coinciden.");
  }

  const now = new Date().toISOString();
  await writePinCredentials(env.DB, pin, env);
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE security_state
      SET
        failed_attempts = 0,
        locked = 0,
        lock_event_recorded = 0,
        locked_at = NULL,
        last_success_at = ?1,
        updated_at = ?1
      WHERE id = 1
    `).bind(now),
    env.DB.prepare(`
      UPDATE session_state
      SET version = version + 1, updated_at = ?1
      WHERE id = 1
    `).bind(now),
    env.DB.prepare(`
      UPDATE recovery_tokens
      SET used_at = COALESCE(used_at, ?1)
      WHERE used_at IS NULL
    `).bind(now)
  ]);
  await logSecurityEvent(env.DB, "admin-pin-change", client);

  return jsonResponse({
    ok: true,
    status: "updated"
  }, 200, origin);
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
          service: "promptario-security"
        }, 200, origin);
      }

      if (request.method === "GET" && url.pathname === "/security/status") {
        return await handleSecurityStatus(request, env, origin);
      }

      if (request.method === "POST" && url.pathname === "/auth") {
        return await handleAuth(request, env, origin);
      }

      if (request.method === "POST" && url.pathname === "/mutate") {
        return await handleMutation(request, env, origin);
      }

      if (request.method === "POST" && url.pathname === "/recovery/request") {
        return await handleRecoveryRequest(request, env, origin);
      }

      if (request.method === "POST" && url.pathname === "/recovery/verify") {
        return await handleRecoveryVerify(request, env, origin);
      }

      if (request.method === "POST" && url.pathname === "/recovery/reset") {
        return await handleRecoveryReset(request, env, origin);
      }

      if (request.method === "POST" && url.pathname === "/admin/change-pin") {
        return await handleAdminChangePin(request, env, origin);
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
