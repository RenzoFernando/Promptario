const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

const hasFirebaseConfig = Object.values(firebaseConfig).every((value) => typeof value === "string" && value.trim().length > 0);

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

async function createFirestoreService() {
  if (!hasFirebaseConfig) {
    return null;
  }

  const firebaseApp = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js");
  const firestore = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js");
  const app = firebaseApp.initializeApp(firebaseConfig);
  const db = firestore.getFirestore(app);
  const promptsCollection = firestore.collection(db, "prompts");

  return {
    async createPrompt(data) {
      await firestore.addDoc(promptsCollection, {
        title: data.title,
        content: data.content,
        createdAt: firestore.serverTimestamp()
      });
    },
    async deletePrompt(id) {
      await firestore.deleteDoc(firestore.doc(db, "prompts", id));
    },
    subscribePrompts(onChange, onError) {
      return firestore.onSnapshot(promptsCollection, (snapshot) => {
        const prompts = snapshot.docs.map((item) => {
          const data = item.data();

          return {
            id: item.id,
            title: data.title || "Sin título",
            content: data.content || "",
            createdAt: normalizeDate(data.createdAt)
          };
        });

        onChange(prompts);
      }, onError);
    }
  };
}

export { createFirestoreService, hasFirebaseConfig };
