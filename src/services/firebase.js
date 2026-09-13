// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "firebase/auth";
import {
  getDatabase,
  ref,
  set,
  push,
  onValue,
  off,
  serverTimestamp,
  query,
  limitToLast
} from "firebase/database";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
export const firebaseConfig = {
  apiKey: import.meta.env?.VITE_FIREBASE_API_KEY || "AIzaSyDrUreGAizRcfAnfRUk7G3W6f4Rl4b310w",
  authDomain: import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN || "ibvap-hackathon.firebaseapp.com",
  projectId: import.meta.env?.VITE_FIREBASE_PROJECT_ID || "ibvap-hackathon",
  storageBucket: import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET || "ibvap-hackathon.firebasestorage.app",
  messagingSenderId: import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID || "513585639121",
  appId: import.meta.env?.VITE_FIREBASE_APP_ID || "1:513585639121:web:146a3c47dd3247c0f4dff0",
  measurementId: import.meta.env?.VITE_FIREBASE_MEASUREMENT_ID || "G-M7R63RQJSL",
  databaseURL: import.meta.env?.VITE_FIREBASE_DATABASE_URL || "https://ibvap-hackathon-default-rtdb.firebaseio.com"
};

// Initialize or reuse Firebase App singleton
export const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Initialize Firebase Analytics (gracefully handled in browser environments)
export let analytics = null;
if (typeof window !== "undefined") {
  isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  }).catch(() => {
    // Analytics optional fallback
  });
}

// Initialize Firebase Services
export const auth = getAuth(app);
let rtdbInstance = null;
try {
  rtdbInstance = getDatabase(app);
} catch (err) {
  console.debug("Firebase Realtime Database standby mode:", err.message);
}
export const database = rtdbInstance;
export const firestore = getFirestore(app);

/**
 * Realtime Database Operations: Alerts
 */
export const pushRealtimeAlert = async (alertData) => {
  if (!database) return { success: false, error: "Database in standby" };
  try {
    const alertsRef = ref(database, "alerts");
    const newAlertRef = push(alertsRef);
    const payload = {
      ...alertData,
      timestamp: serverTimestamp(),
      createdAtClient: new Date().toISOString()
    };
    await set(newAlertRef, payload);
    return { success: true, id: newAlertRef.key };
  } catch (error) {
    console.debug("Firebase RTDB alert sync skipped:", error.message);
    return { success: false, error: error.message };
  }
};

export const subscribeToRealtimeAlerts = (callback, limit = 50) => {
  if (!database) {
    callback([]);
    return () => {};
  }
  try {
    const alertsRef = query(ref(database, "alerts"), limitToLast(limit));
    const listener = onValue(
      alertsRef,
      (snapshot) => {
        const data = snapshot.val();
        if (!data) {
          callback([]);
          return;
        }
        const list = Object.entries(data).map(([id, item]) => ({
          id,
          ...item
        }));
        callback(list);
      },
      (error) => {
        console.debug("Firebase RTDB listener notice:", error.message);
      }
    );
    return () => off(alertsRef, "value", listener);
  } catch (err) {
    console.debug("Firebase RTDB subscription notice:", err.message);
    return () => {};
  }
};

/**
 * Realtime Database Operations: Telemetry & Camera Health
 */
export const updateRealtimeTelemetry = async (cameraId, telemetryData) => {
  if (!database) return { success: false, error: "Database in standby" };
  try {
    const telemetryRef = ref(database, `telemetry/${cameraId}`);
    await set(telemetryRef, {
      ...telemetryData,
      updatedAt: serverTimestamp()
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const subscribeToTelemetry = (callback) => {
  if (!database) {
    callback({});
    return () => {};
  }
  try {
    const telemetryRef = ref(database, "telemetry");
    const listener = onValue(
      telemetryRef,
      (snapshot) => {
        const val = snapshot.val();
        callback(val || {});
      },
      (error) => {
        console.debug("Firebase telemetry listener notice:", error.message);
      }
    );
    return () => off(telemetryRef, "value", listener);
  } catch (err) {
    return () => {};
  }
};

/**
 * Authentication Helpers
 */
export const loginWithCredentials = async (email, password) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return { success: true, user: userCredential.user };
  } catch (error) {
    console.error("Firebase Login Error:", error);
    return { success: false, error: error.message, code: error.code };
  }
};

export const registerWithCredentials = async (email, password, displayName = "Operator") => {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName && userCredential.user) {
      await updateProfile(userCredential.user, { displayName });
    }
    return { success: true, user: userCredential.user };
  } catch (error) {
    console.error("Firebase Registration Error:", error);
    return { success: false, error: error.message, code: error.code };
  }
};

export const logoutUser = async () => {
  try {
    await signOut(auth);
    return { success: true };
  } catch (error) {
    console.error("Firebase Signout Error:", error);
    return { success: false, error: error.message };
  }
};

export const onAuthStatusChange = (callback) => {
  return onAuthStateChanged(auth, callback);
};

export default app;
