const firebaseConfig = {
  apiKey: "AIzaSyBFjzY_c2mMSNraVkogHdvsfJcEqqPOB1I",
  authDomain: "promptario-58cd3.firebaseapp.com",
  projectId: "promptario-58cd3",
  storageBucket: "promptario-58cd3.firebasestorage.app",
  messagingSenderId: "573696993748",
  appId: "1:573696993748:web:92a48618e14e5eab02ce41",
  measurementId: "G-1CVWY0RSSC"
};

const hasFirebaseConfig = Object.values(firebaseConfig).every((value) => typeof value === "string" && value.trim().length > 0);
const categoriesDocumentId = "promptario_categories";
const securityConfigDocumentPath = ["publicConfig", "security"];

function normalizeDate(value) {
  if (!value) {
    return new Date().toISOString();
  }

  if (typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
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

function normalizeSecurityApiUrl(value) {
  const candidate = String(value || "").trim().replace(/\/+$/g, "");

  if (!candidate) {
    return "";
  }

  try {
    const url = new URL(candidate);
    const isSecureRemote = url.protocol === "https:";
    const isLocal = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");

    return isSecureRemote || isLocal ? url.toString().replace(/\/+$/g, "") : "";
  } catch {
    return "";
  }
}

async function createFirestoreService() {
  if (!hasFirebaseConfig) {
    return null;
  }

  const firebaseApp = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js");
  const firestore = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js");

  const app = firebaseApp.initializeApp(firebaseConfig);
  const db = firestore.getFirestore(app);
  const promptsCollection = firestore.collection(db, "prompts");
  const categoriesDocument = firestore.doc(db, "prompts", categoriesDocumentId);
  const securityConfigDocument = firestore.doc(db, ...securityConfigDocumentPath);

  let securityApiBaseUrl = "";
  let adminSessionToken = "";

  async function resolveSecurityApiBaseUrl() {
    if (securityApiBaseUrl) {
      return securityApiBaseUrl;
    }

    const snapshot = await firestore.getDoc(securityConfigDocument);

    if (!snapshot.exists()) {
      throw new Error("security-api-not-configured");
    }

    securityApiBaseUrl = normalizeSecurityApiUrl(snapshot.data()?.workerUrl);

    if (!securityApiBaseUrl) {
      throw new Error("security-api-invalid");
    }

    return securityApiBaseUrl;
  }

  async function callSecurityApi(path, options = {}) {
    const baseUrl = await resolveSecurityApiBaseUrl();
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      cache: "no-store"
    });

    let result = null;

    try {
      result = await response.json();
    } catch {
      result = null;
    }

    if (!response.ok) {
      const error = new Error(result?.message || "security-api-request-failed");
      error.code = result?.code || "security-api-request-failed";
      error.status = response.status;
      throw error;
    }

    return result || {};
  }

  async function mutate(action, payload) {
    if (!adminSessionToken) {
      throw new Error("admin-session-missing");
    }

    return callSecurityApi("/mutate", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminSessionToken}`
      },
      body: JSON.stringify({ action, payload })
    });
  }

  return {
    async authenticatePin(pin) {
      if (!/^\d{4}$/.test(pin)) {
        throw new Error("invalid-pin-format");
      }

      const result = await callSecurityApi("/auth", {
        method: "POST",
        body: JSON.stringify({ pin })
      });

      if (result.ok && typeof result.token === "string" && result.token) {
        adminSessionToken = result.token;
      } else {
        adminSessionToken = "";
      }

      return result;
    },

    async signOutAdmin() {
      adminSessionToken = "";
    },

    async createPrompt(data) {
      await mutate("createPrompt", {
        title: data.title,
        content: data.content,
        categories: normalizeCategories(data.categories),
        isFavorite: Boolean(data.isFavorite)
      });
    },

    async updatePrompt(id, data) {
      await mutate("updatePrompt", {
        id,
        title: data.title,
        content: data.content,
        categories: normalizeCategories(data.categories),
        isFavorite: Boolean(data.isFavorite)
      });
    },

    async deletePrompt(id) {
      await mutate("deletePrompt", { id });
    },

    async createCategory(data) {
      const name = normalizeCategoryName(data.name);

      if (!name) {
        return;
      }

      await mutate("createCategory", { name });
    },

    async deleteCategory(name) {
      const category = normalizeCategoryName(name);

      if (!category) {
        return;
      }

      await mutate("deleteCategory", { name: category });
    },

    subscribePrompts(onChange, onError) {
      return firestore.onSnapshot(promptsCollection, (snapshot) => {
        const prompts = snapshot.docs.reduce((items, item) => {
          const data = item.data();

          if (item.id === categoriesDocumentId || data.internalType === "promptarioCategories") {
            return items;
          }

          items.push({
            id: item.id,
            title: data.title || "Sin título",
            content: data.content || "",
            categories: normalizeCategories(data.categories),
            isFavorite: Boolean(data.isFavorite),
            createdAt: normalizeDate(data.createdAt),
            updatedAt: normalizeDate(data.updatedAt || data.createdAt)
          });

          return items;
        }, []);

        onChange(prompts);
      }, onError);
    },

    subscribeCategories(onChange, onError) {
      return firestore.onSnapshot(categoriesDocument, (snapshot) => {
        if (!snapshot.exists()) {
          onChange([]);
          return;
        }

        const data = snapshot.data();
        onChange(normalizeCategories(data.categories));
      }, onError);
    }
  };
}

export { createFirestoreService, hasFirebaseConfig };
