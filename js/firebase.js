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

const categoriesDocumentId = "__promptario_categories__";

const adminAuthEmail = "admin@promptario.app";

const adminPasswordPrefix = "Promptario#";



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



function buildAdminPassword(pin) {

  return `${adminPasswordPrefix}${pin}`;

}



async function createFirestoreService() {

  if (!hasFirebaseConfig) {

    return null;

  }



  const firebaseApp = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js");

  const firestore = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js");

  const firebaseAuth = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js");

  const app = firebaseApp.initializeApp(firebaseConfig);

  const auth = firebaseAuth.getAuth(app);

  await firebaseAuth.setPersistence(auth, firebaseAuth.inMemoryPersistence);

  const db = firestore.getFirestore(app);

  const promptsCollection = firestore.collection(db, "prompts");

  const categoriesDocument = firestore.doc(db, "prompts", categoriesDocumentId);



  return {

    async authenticatePin(pin) {

      if (!/^\d{4}$/.test(pin)) {

        throw new Error("invalid-pin-format");

      }



      await firebaseAuth.signInWithEmailAndPassword(auth, adminAuthEmail, buildAdminPassword(pin));

    },

    async signOutAdmin() {

      if (auth.currentUser) {

        await firebaseAuth.signOut(auth);

      }

    },

    isAdminAuthenticated() {

      return Boolean(auth.currentUser && auth.currentUser.email === adminAuthEmail);

    },

    async createPrompt(data) {

      await firestore.addDoc(promptsCollection, {

        title: data.title,

        content: data.content,

        categories: normalizeCategories(data.categories),

        isFavorite: Boolean(data.isFavorite),

        createdAt: firestore.serverTimestamp(),

        updatedAt: firestore.serverTimestamp()

      });

    },

    async updatePrompt(id, data) {

      await firestore.updateDoc(firestore.doc(db, "prompts", id), {

        title: data.title,

        content: data.content,

        categories: normalizeCategories(data.categories),

        isFavorite: Boolean(data.isFavorite),

        updatedAt: firestore.serverTimestamp()

      });

    },

    async deletePrompt(id) {

      await firestore.deleteDoc(firestore.doc(db, "prompts", id));

    },

    async createCategory(data) {

      const name = normalizeCategoryName(data.name);



      if (!name) {

        return;

      }



      await firestore.setDoc(categoriesDocument, {

        internalType: "promptarioCategories",

        categories: firestore.arrayUnion(name),

        updatedAt: firestore.serverTimestamp()

      }, { merge: true });

    },

    async deleteCategory(name) {

      const category = normalizeCategoryName(name);



      if (!category) {

        return;

      }



      const batch = firestore.writeBatch(db);

      const categoryQuery = firestore.query(promptsCollection, firestore.where("categories", "array-contains", category));

      const categoryPrompts = await firestore.getDocs(categoryQuery);



      batch.set(categoriesDocument, {

        internalType: "promptarioCategories",

        categories: firestore.arrayRemove(category),

        updatedAt: firestore.serverTimestamp()

      }, { merge: true });



      categoryPrompts.forEach((item) => {

        const data = item.data();



        if (item.id === categoriesDocumentId || data.internalType === "promptarioCategories") {

          return;

        }



        batch.update(item.ref, {

          categories: normalizeCategories(data.categories).filter((itemCategory) => itemCategory !== category),

          updatedAt: firestore.serverTimestamp()

        });

      });



      await batch.commit();

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
