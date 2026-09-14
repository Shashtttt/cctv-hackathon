/**
 * IBVAP — Cloud Firestore Database Service
 * Provides real-time synchronization for:
 * 1. Alerts & Threat Events (collection: "alerts")
 * 2. Camera Configurations & Device Feeds (collection: "cameras")
 * 3. Tactical Incidents & Field Logs (collection: "incidents")
 * 4. System Telemetry & Node Health (collection: "telemetry")
 */

import {
  collection,
  doc,
  setDoc,
  addDoc,
  getDocs,
  getDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp
} from "firebase/firestore";
import { db } from "../firebase";

// ── 1. Connection & Diagnostics ─────────────────────────────────────────────

/**
 * Ping Cloud Firestore to verify connectivity and project authorization.
 */
export const testFirestoreConnection = async () => {
  const t0 = Date.now();
  try {
    const testRef = doc(collection(db, "_health_checks"), "ping");
    await setDoc(testRef, {
      status: "ONLINE",
      platform: "IBVAP-Defense-Matrix",
      lastPing: serverTimestamp(),
      clientTimestamp: new Date().toISOString(),
    }, { merge: true });

    return {
      connected: true,
      latencyMs: Date.now() - t0,
      projectId: "ibvap-acbd6",
      database: "Cloud Firestore (default)",
    };
  } catch (error) {
    console.warn("Firestore connection check notice:", error);
    return {
      connected: false,
      error: error.message || "Failed to reach Cloud Firestore",
      projectId: "ibvap-acbd6",
    };
  }
};

// ── 2. Alerts & Threat Synchronization ──────────────────────────────────────

/**
 * Persist or update an alert in Cloud Firestore.
 * Automatically de-duplicates by alert ID.
 */
export const syncAlertToFirestore = async (alert) => {
  if (!alert) return null;
  try {
    const alertId = String(alert.id || `ALERT-${Date.now()}`);
    const alertRef = doc(db, "alerts", alertId);

    const payload = {
      id: alertId,
      title: alert.title || alert.type || alert.category || "Security Alert",
      type: alert.type || alert.category || "SECURITY_BREACH",
      category: alert.category || alert.type || "GENERAL",
      severity: (alert.severity || alert.level || "HIGH").toUpperCase(),
      camera_id: alert.camera_id || alert.cameraId || alert.camera || "CAM-01",
      camera_code: alert.camera || alert.camera_id || "CAM-01",
      location: alert.location || "Sector 04 Perimeter",
      gps: alert.gps || alert.gps_coords || "34.1524° N, 74.8211° E",
      description: alert.description || alert.text || "Automated AI detection trigger",
      status: (alert.status || "ACTIVE").toUpperCase(),
      acknowledged: Boolean(alert.acknowledged || false),
      dispatched: Boolean(alert.dispatched || false),
      resolved: Boolean(alert.resolved || false),
      threat_level: alert.threat_level || alert.severity || "HIGH",
      target_id: alert.target_id || alert.targetId || null,
      snapshot_path: alert.snapshot_path || null,
      updatedAt: serverTimestamp(),
      createdAt: alert.createdAt || serverTimestamp(),
      source: alert.source || "IBVAP-Edge-AI",
    };

    await setDoc(alertRef, payload, { merge: true });
    return { success: true, id: alertId };
  } catch (error) {
    console.debug("Firestore alert sync notice:", error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Real-time subscription to alerts from Cloud Firestore.
 * Invokes callback whenever new alerts arrive or status changes.
 */
export const subscribeToCloudAlerts = (onUpdate, onError) => {
  try {
    const q = query(
      collection(db, "alerts"),
      orderBy("updatedAt", "desc"),
      limit(50)
    );

    return onSnapshot(
      q,
      (snapshot) => {
        const items = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          items.push({
            ...data,
            id: docSnap.id,
            time: data.updatedAt?.toDate?.() ? data.updatedAt.toDate().toLocaleTimeString() : (data.time || "Just now"),
          });
        });
        if (onUpdate) onUpdate(items);
      },
      (error) => {
        console.debug("Firestore alerts subscription notice:", error.message);
        if (onError) onError(error);
      }
    );
  } catch (err) {
    console.debug("Firestore subscribe init notice:", err.message);
    return () => {};
  }
};

/**
 * Update the triage status of an alert in Cloud Firestore.
 * (e.g. 'ACKNOWLEDGED', 'DISPATCHED', 'RESOLVED')
 */
export const updateCloudAlertStatus = async (alertId, newStatus) => {
  if (!alertId) return;
  try {
    const alertRef = doc(db, "alerts", String(alertId));
    const statusUpper = newStatus.toUpperCase();
    const updateData = {
      status: statusUpper,
      updatedAt: serverTimestamp(),
    };

    if (statusUpper === "ACKNOWLEDGED") updateData.acknowledged = true;
    if (statusUpper === "DISPATCHED") updateData.dispatched = true;
    if (statusUpper === "RESOLVED") updateData.resolved = true;

    await updateDoc(alertRef, updateData);
    return { success: true };
  } catch (error) {
    console.debug("Firestore update alert status notice:", error.message);
    return { success: false, error: error.message };
  }
};

// ── 3. Camera Fleet Synchronization ─────────────────────────────────────────

/**
 * Sync camera registration and telemetry to Cloud Firestore.
 */
export const syncCameraToFirestore = async (camera) => {
  if (!camera || !camera.id) return null;
  try {
    const camId = String(camera.id);
    const camRef = doc(db, "cameras", camId);

    const payload = {
      id: camId,
      code: camera.code || camId.toUpperCase(),
      name: camera.name || `Surveillance Unit ${camId}`,
      location: camera.location || "Border Sector 04",
      gps_coords: camera.gps_coords || camera.gps || "34.1524° N, 74.8211° E",
      rtsp_url: camera.rtsp_url || "",
      fps: camera.fps || 25,
      resolution: camera.resolution || "1080p FHD",
      status: (camera.status || "online").toLowerCase(),
      mode: camera.mode || "ACTIVE",
      analytics_modes: camera.analytics_modes || ["WEAPON", "INTRUSION", "PERSON"],
      lastSeen: serverTimestamp(),
    };

    await setDoc(camRef, payload, { merge: true });
    return { success: true, id: camId };
  } catch (error) {
    console.debug("Firestore camera sync notice:", error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Real-time subscription to the Camera Fleet in Cloud Firestore.
 */
export const subscribeToCloudCameras = (onUpdate, onError) => {
  try {
    const q = query(collection(db, "cameras"), limit(64));
    return onSnapshot(
      q,
      (snapshot) => {
        const cams = [];
        snapshot.forEach((docSnap) => {
          cams.push({ ...docSnap.data(), id: docSnap.id });
        });
        if (onUpdate) onUpdate(cams);
      },
      (error) => {
        console.debug("Firestore cameras subscription notice:", error.message);
        if (onError) onError(error);
      }
    );
  } catch (err) {
    console.debug("Firestore camera subscribe init notice:", err.message);
    return () => {};
  }
};

// ── 4. Tactical Incidents & Field Recon Logs ─────────────────────────────────

/**
 * Record a critical security incident (weapons, breaches, unauthorized persons) in Firestore.
 */
export const logCloudIncident = async (incident) => {
  try {
    const docRef = await addDoc(collection(db, "incidents"), {
      ...incident,
      timestamp: serverTimestamp(),
      defenseSector: "Sector 04 Border Matrix",
    });
    return { success: true, id: docRef.id };
  } catch (error) {
    console.debug("Firestore incident log notice:", error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Fetch recent cloud incident logs.
 */
export const fetchRecentCloudIncidents = async (maxItems = 20) => {
  try {
    const q = query(
      collection(db, "incidents"),
      orderBy("timestamp", "desc"),
      limit(maxItems)
    );
    const snap = await getDocs(q);
    const results = [];
    snap.forEach((d) => results.push({ id: d.id, ...d.data() }));
    return results;
  } catch (error) {
    console.debug("Firestore fetch incidents notice:", error.message);
    return [];
  }
};
