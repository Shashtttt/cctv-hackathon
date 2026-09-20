import { useState, useEffect, useCallback } from 'react';
import {
  database,
  subscribeToRealtimeAlerts,
  subscribeToTelemetry,
  pushRealtimeAlert,
  updateRealtimeTelemetry
} from './firebase';
import { ref, onValue } from 'firebase/database';

export const useFirebaseRealtime = (options = { limitAlerts: 30 }) => {
  const [connected, setConnected] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [telemetry, setTelemetry] = useState({});
  const [lastSyncTime, setLastSyncTime] = useState(null);

  // Monitor connection status to Firebase RTDB (.info/connected)
  useEffect(() => {
    if (!database) return;
    let connectedRef;
    try {
      connectedRef = ref(database, '.info/connected');
      const unsubscribe = onValue(connectedRef, (snap) => {
        const isConn = !!snap.val();
        setConnected(isConn);
        if (isConn) {
          setLastSyncTime(new Date());
        }
      });
      return () => unsubscribe();
    } catch (err) {
      console.debug('Firebase RTDB connection check notice:', err?.message);
    }
  }, []);

  // Real-time alerts subscription
  useEffect(() => {
    const unsubscribeAlerts = subscribeToRealtimeAlerts((newAlerts) => {
      setAlerts(newAlerts.reverse()); // most recent first
      setLastSyncTime(new Date());
    }, options.limitAlerts || 30);

    return () => {
      if (typeof unsubscribeAlerts === 'function') {
        unsubscribeAlerts();
      }
    };
  }, [options.limitAlerts]);

  // Real-time telemetry subscription
  useEffect(() => {
    const unsubscribeTelemetry = subscribeToTelemetry((newTelemetry) => {
      setTelemetry(newTelemetry);
      setLastSyncTime(new Date());
    });

    return () => {
      if (typeof unsubscribeTelemetry === 'function') {
        unsubscribeTelemetry();
      }
    };
  }, []);

  const sendAlert = useCallback(async (alertData) => {
    return await pushRealtimeAlert(alertData);
  }, []);

  const sendTelemetry = useCallback(async (cameraId, data) => {
    return await updateRealtimeTelemetry(cameraId, data);
  }, []);

  return {
    connected,
    alerts,
    telemetry,
    lastSyncTime,
    sendAlert,
    sendTelemetry
  };
};

export default useFirebaseRealtime;
