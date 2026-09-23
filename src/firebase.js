import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyD-Ha7lBlMWbM4Xx78GpSPcGOKMUYweJv0",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "cctv-hackathon-ibvap.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "cctv-hackathon-ibvap",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "cctv-hackathon-ibvap.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "584149324959",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:584149324959:web:4086e5688826043254feaa",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-RVKZH8G1SM"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
export const storage = getStorage(app);

export let analytics = null;
if (typeof window !== "undefined") {
  isSupported()
    .then((supported) => {
      if (supported) {
        analytics = getAnalytics(app);
      }
    })
    .catch(() => {});
}

export default app;
