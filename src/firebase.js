import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

export const firebaseConfig = {
  apiKey: "AIzaSyBdmIEhvSgR6mW0R1mLp_jjxrRoQo90Hd4",
  authDomain: "ibvap-acbd6.firebaseapp.com",
  projectId: "ibvap-acbd6",
  storageBucket: "ibvap-acbd6.firebasestorage.app",
  messagingSenderId: "278761100660",
  appId: "1:278761100660:web:7ecc888cf23cf81ae48821",
  measurementId: "G-RVKZH8G1SM"
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
