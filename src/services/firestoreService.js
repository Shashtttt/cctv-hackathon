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
import { db } from "../firebase.js";


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

const _recentSyncCache = new Map();
let _activeWrites = 0;
const MAX_CONCURRENT_WRITES = 4;
const DEDUP_WINDOW_MS = 3500;

// Clean stale dedup cache entries every 30s
if (typeof window !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, timestamp] of _recentSyncCache.entries()) {
      if (now - timestamp > DEDUP_WINDOW_MS * 2) {
        _recentSyncCache.delete(key);
      }
    }
  }, 30000);
}


/**
 * Persist or update an alert in Cloud Firestore.
 * Automatically de-duplicates by alert ID and throttles burst writes.
 */
export const syncAlertToFirestore = async (alert) => {
  if (!alert) return null;
  const alertId = String(alert.id || `ALERT-${Date.now()}`);
  
  // Prevent flooding Firestore write stream
  const now = Date.now();
  if (_recentSyncCache.has(alertId) && (now - _recentSyncCache.get(alertId) < DEDUP_WINDOW_MS)) {
    return { success: true, id: alertId, skipped: true };
  }
  if (_activeWrites >= MAX_CONCURRENT_WRITES) {
    return { success: false, reason: "throttled" };
  }

  _recentSyncCache.set(alertId, now);
  _activeWrites++;

  try {
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
      snapshot_path: alert.snapshot_path || alert.snapshotPath || null,
      snapshot_url: alert.snapshot_url || alert.snapshotUrl || (alert.snapshot_path ? `/api/v1/snapshots/${alertId}` : null),
      snapshot_base64: alert.snapshot_base64 || alert.snapshotBase64 || null,
      frs_match_name: alert.frs_match_name || alert.frsMatchName || null,
      plate_text: alert.plate_text || alert.plateText || null,
      latitude: alert.latitude || null,
      longitude: alert.longitude || null,
      updatedAt: serverTimestamp(),
      createdAt: alert.createdAt || serverTimestamp(),
      source: alert.source || "IBVAP-Edge-AI",
    };

    await setDoc(alertRef, payload, { merge: true });

    // Also persist snapshot record in dedicated 'snapshots' collection for cloud archival
    if (payload.snapshot_base64 || payload.snapshot_url || payload.snapshot_path) {
      try {
        const snapRef = doc(db, "snapshots", alertId);
        await setDoc(snapRef, {
          id: alertId,
          alert_id: alertId,
          camera_id: payload.camera_id,
          category: payload.category,
          severity: payload.severity,
          title: payload.title,
          snapshot_url: payload.snapshot_url,
          snapshot_base64: payload.snapshot_base64,
          snapshot_path: payload.snapshot_path,
          captured_at: alert.timestamp || new Date().toISOString(),
          createdAt: serverTimestamp(),
          source: payload.source,
        }, { merge: true });
      } catch (snapErr) {
        console.debug("Firestore snapshot collection sync notice:", snapErr.message);
      }
    }

    return { success: true, id: alertId };
  } catch (error) {
    console.debug("Firestore alert sync notice:", error.message);
    return { success: false, error: error.message };
  } finally {
    _activeWrites = Math.max(0, _activeWrites - 1);
  }
};

/**
 * Persist a standalone snapshot record into Cloud Firestore with write protection.
 */
export const syncSnapshotToFirestore = async (snapshot) => {
  if (!snapshot) return null;
  const snapId = String(snapshot.id || snapshot.alert_id || `SNAP-${Date.now()}`);
  
  const now = Date.now();
  if (_recentSyncCache.has(snapId) && (now - _recentSyncCache.get(snapId) < DEDUP_WINDOW_MS)) {
    return { success: true, id: snapId, skipped: true };
  }
  if (_activeWrites >= MAX_CONCURRENT_WRITES) {
    return { success: false, reason: "throttled" };
  }

  _recentSyncCache.set(snapId, now);
  _activeWrites++;

  try {
    const snapRef = doc(db, "snapshots", snapId);
    await setDoc(snapRef, {
      id: snapId,
      alert_id: snapshot.alert_id || snapId,
      camera_id: snapshot.camera_id || snapshot.cameraId || "CAM-01",
      category: snapshot.category || "WEAPON",
      severity: snapshot.severity || "CRITICAL",
      title: snapshot.title || "Weapon Evidence Snapshot",
      snapshot_url: snapshot.url || snapshot.snapshot_url || `/api/v1/snapshots/${snapId}`,
      snapshot_base64: snapshot.snapshot_base64 || snapshot.base64 || null,
      snapshot_path: snapshot.relative_path || snapshot.snapshot_path || null,
      captured_at: snapshot.captured_at || new Date().toISOString(),
      file_size_bytes: snapshot.file_size_bytes || (snapshot.snapshot_base64 ? Math.round(snapshot.snapshot_base64.length * 0.75) : 40960),
      createdAt: serverTimestamp(),
      source: snapshot.source || "IBVAP-Defense-Matrix",
    }, { merge: true });
    return { success: true, id: snapId };
  } catch (error) {
    console.debug("Firestore snapshot sync error:", error.message);
    return { success: false, error: error.message };
  } finally {
    _activeWrites = Math.max(0, _activeWrites - 1);
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
 * Real-time subscription to surveillance snapshots from Cloud Firestore.
 * Automatically pushes weapon and threat captures to forensic gallery.
 */
export const subscribeToCloudSnapshots = (onUpdate, onError) => {
  try {
    const q = query(
      collection(db, "snapshots"),
      orderBy("captured_at", "desc"),
      limit(100)
    );

    return onSnapshot(
      q,
      (snapshot) => {
        const items = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const imgUrl = data.snapshot_base64 || data.snapshot_url || (data.snapshot_path ? `/api/v1/snapshots/${docSnap.id}` : null);
          items.push({
            ...data,
            id: docSnap.id,
            filename: `${docSnap.id}.jpg`,
            url: imgUrl,
            category: (data.category || 'WEAPON').toUpperCase(),
            camera_id: data.camera_id || 'CAM-01',
            captured_at: data.captured_at || (data.createdAt?.toDate?.() ? data.createdAt.toDate().toISOString() : new Date().toISOString()),
            file_size_formatted: data.file_size_bytes ? `${(data.file_size_bytes / 1024).toFixed(1)} KB` : '42.5 KB',
            alert_id: data.alert_id || docSnap.id,
          });
        });
        if (onUpdate) onUpdate(items);
      },
      (error) => {
        // Fallback without orderBy in case compound indexing is building
        try {
          const fallbackQ = query(collection(db, "snapshots"), limit(100));
          return onSnapshot(fallbackQ, (snapshot) => {
            const items = [];
            snapshot.forEach((docSnap) => {
              const data = docSnap.data();
              const imgUrl = data.snapshot_base64 || data.snapshot_url || null;
              items.push({
                ...data,
                id: docSnap.id,
                filename: `${docSnap.id}.jpg`,
                url: imgUrl,
                category: (data.category || 'WEAPON').toUpperCase(),
                camera_id: data.camera_id || 'CAM-01',
                captured_at: data.captured_at || new Date().toISOString(),
                file_size_formatted: '42.5 KB',
                alert_id: data.alert_id || docSnap.id,
              });
            });
            items.sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime());
            if (onUpdate) onUpdate(items);
          });
        } catch (fbErr) {
          console.debug("Firestore snapshot fallback subscription notice:", fbErr.message);
        }
        if (onError) onError(error);
      }
    );
  } catch (err) {
    console.debug("Firestore snapshot subscribe init notice:", err.message);
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
