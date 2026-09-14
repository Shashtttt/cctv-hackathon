// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
export const firebaseConfig = {
  apiKey: "AIzaSyBdmIEhvSgR6mW0R1mLp_jjxrRoQo90Hd4",
  authDomain: "ibvap-acbd6.firebaseapp.com",
  projectId: "ibvap-acbd6",
  storageBucket: "ibvap-acbd6.firebasestorage.app",
  messagingSenderId: "278761100660",
  appId: "1:278761100660:web:7ecc888cf23cf81ae48821",
  measurementId: "G-RVKZH8G1SM"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);

// Initialize Firebase Auth & Providers
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Initialize Cloud Firestore
export const db = getFirestore(app);

// Initialize Cloud Storage
export const storage = getStorage(app);

// Initialize Analytics (safely guarded for browser environments)
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
