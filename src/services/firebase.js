/**
 * IBVAP — Firebase Integration Service
 * Provides unified access to Firebase Auth, Firestore, Storage, Realtime Database, and Analytics.
 */

import {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "firebase/auth";
import {
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp as firestoreServerTimestamp
} from "firebase/firestore";
import {
  getDatabase,
  ref,
  set,
  push,
  onValue,
  off,
  serverTimestamp as rtdbServerTimestamp,
  query as rtdbQuery,
  limitToLast
} from "firebase/database";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "firebase/storage";

// Re-export core instances and config from src/firebase.js
import app, {
  firebaseConfig,
  auth,
  googleProvider,
  db,
  storage,
  analytics
} from "../firebase";

// Initialize Realtime Database instance safely
let rtdbInstance = null;
try {
  rtdbInstance = getDatabase(app);
} catch (err) {
  console.debug("Firebase Realtime Database standby mode:", err.message);
}
export const database = rtdbInstance;

export { app, firebaseConfig, auth, googleProvider, db, storage, analytics };

// ── Auth Helper Functions ──────────────────────────────────────────────────

/**
 * Sign in with Google Popup
 */
export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return { success: true, user: result.user };
  } catch (error) {
    console.error("Firebase Google Sign-In Error:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Sign in with Email and Password
 */
export const signInWithEmail = async (email, password) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return { success: true, user: userCredential.user };
  } catch (error) {
    console.error("Firebase Email Sign-In Error:", error);
    return { success: false, error: error.message };
  }
};

export const loginWithCredentials = async (email, password) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return { success: true, user: userCredential.user };
  } catch (error) {
    console.error("Firebase Login Error:", error);
    return { success: false, error: error.message, code: error.code };
  }
};

/**
 * Register user with Email and Password
 */
export const signUpWithEmail = async (email, password, displayName) => {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName && userCredential.user) {
      await updateProfile(userCredential.user, { displayName });
    }
    return { success: true, user: userCredential.user };
  } catch (error) {
    console.error("Firebase Sign-Up Error:", error);
    return { success: false, error: error.message };
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

/**
 * Sign out of Firebase
 */
export const logOutFirebase = async () => {
  try {
    await signOut(auth);
    return { success: true };
  } catch (error) {
    console.error("Firebase Sign-Out Error:", error);
    return { success: false, error: error.message };
  }
};

export const logoutUser = async () => {
  return await logOutFirebase();
};

export const onAuthStatusChange = (callback) => {
  return onAuthStateChanged(auth, callback);
};

// ── Firestore Sync Helpers ─────────────────────────────────────────────────

/**
 * Log an alert to Cloud Firestore
 */
export const logAlertToFirestore = async (alertData) => {
  try {
    const docRef = await addDoc(collection(db, "alerts"), {
      ...alertData,
      createdAt: firestoreServerTimestamp(),
      platform: "IBVAP-Defense-Matrix",
    });
    return { success: true, id: docRef.id };
  } catch (error) {
    console.debug("Firestore alert log notice:", error.message);
    return { success: false, error: error.message };
  }
};

// ── Realtime Database Operations ───────────────────────────────────────────

export const pushRealtimeAlert = async (alertData) => {
  if (!database) return { success: false, error: "Database in standby" };
  try {
    const alertsRef = ref(database, "alerts");
    const newAlertRef = push(alertsRef);
    const payload = {
      ...alertData,
      timestamp: rtdbServerTimestamp(),
      createdAtClient: new Date().toISOString()
    };
    await set(newAlertRef, payload);
    return { success: true, id: newAlertRef.key };
  } catch (error) {
    console.debug("Firebase RTDB alert sync skipped:", error.message);
    return { success: false, error: error.message };
  }
};

export const subscribeToRealtimeAlerts = (callback, limitCount = 50) => {
  if (!database) {
    callback([]);
    return () => {};
  }
  try {
    const alertsRef = rtdbQuery(ref(database, "alerts"), limitToLast(limitCount));
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

export const updateRealtimeTelemetry = async (cameraId, telemetryData) => {
  if (!database) return { success: false, error: "Database in standby" };
  try {
    const telemetryRef = ref(database, `telemetry/${cameraId}`);
    await set(telemetryRef, {
      ...telemetryData,
      updatedAt: rtdbServerTimestamp()
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

export default app;
