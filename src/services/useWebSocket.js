import { useState, useEffect, useRef } from 'react';
import { soundController } from '../utils/audioAlert';
import { syncAlertToFirestore } from './firestoreService';

/**
 * Custom hook to connect to FastAPI WebSocket alert broadcast stream (/ws/alerts)
 * with automatic reconnection and live telemetry animation fallback.
 */
export const useWebSocket = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [latency, setLatency] = useState(14);
  const [lastPing, setLastPing] = useState(3);
  const [trackedCount, setTrackedCount] = useState(4);
  const [alerts, setAlerts] = useState([
    { id: '1', type: 'Breach Alert', camera: 'C-03', text: 'Perimeter fence tripwire crossed in Zone 4', time: '16:17:02', level: 'crit' },
    { id: '2', type: 'Loitering', camera: 'C-07', text: 'Unidentified subject loitering at Sector 4 North Gate', time: '16:15:44', level: 'warn' },
    { id: '3', type: 'ANPR Scan', camera: 'C-02', text: 'Vehicle WR768R1234 matched with Security Unit #4', time: '16:12:10', level: 'info' },
    { id: '4', type: 'Thermal Target', camera: 'C-06', text: 'Heat anomaly detected near Ridge View Ridge', time: '16:08:30', level: 'warn' },
    { id: '5', type: 'System Ping', camera: 'SYS-09', text: 'Telemetry synchronization complete across 26 nodes', time: '16:05:00', level: 'info' }
  ]);

  const socketRef = useRef(null);

  useEffect(() => {
    // Determine WebSocket URL dynamically based on location
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/alerts`;

    let reconnectTimer = null;
    let isUnmounted = false;

    const connect = () => {
      try {
        const socket = new WebSocket(wsUrl);
        socketRef.current = socket;

        socket.onopen = () => {
          if (!isUnmounted) setIsConnected(true);
          console.log('Connected to IBVAP WebSocket Alert Stream:', wsUrl);
        };

        socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'ALERT' && data.payload) {
              const p = data.payload;
              const rawCam = p.camera_id || p.cameraId || '';
              const camStr = rawCam ? rawCam.toUpperCase() : 'BOP-01';
              const newAlert = {
                id: p.id || String(Date.now()),
                type: p.category || p.title || 'Security Alert',
                category: p.category,
                camera: camStr,
                camera_id: rawCam || 'cam-01',
                cameraId: rawCam || 'cam-01',
                target_id: p.target_id || p.targetId,
                targetId: p.target_id || p.targetId,
                title: p.title,
                text: p.title || p.description || 'Alert detected',
                description: p.description,
                time: new Date(p.timestamp || Date.now()).toLocaleTimeString(),
                timestamp: p.timestamp || new Date().toISOString(),
                severity: p.severity || 'HIGH',
                level: (p.severity || 'info').toLowerCase() === 'critical' ? 'crit' : (p.severity || 'info').toLowerCase() === 'warning' || (p.severity || '').toLowerCase() === 'high' ? 'warn' : 'info',
                snapshot_path: p.snapshot_path || p.snapshotPath || null,
                snapshot_url: p.snapshot_url || p.snapshotUrl || (p.snapshot_path ? `/api/v1/snapshots/${p.id}` : null),
                snapshot_base64: p.snapshot_base64 || p.snapshotBase64 || null,
                frs_match_name: p.frs_match_name || p.frsMatchName || null,
                frs_match_score: p.frs_match_score || p.frsMatchScore || null,
                plate_text: p.plate_text || p.plateText || null,
                latitude: p.latitude || null,
                longitude: p.longitude || null,
                gps_coords: p.gps_coords || p.gpsCoords || null,
              };

              // Siren trigger logic: Suppress for authorized sentries/vehicles, trigger for unauthorized hostiles
              const cat = String(p.category || '').toUpperCase();
              const title = String(p.title || '').toLowerCase();
              const isAuthClearance = p.is_authorized ||
                cat === 'AUTHORIZED_PATROL' ||
                cat === 'AUTHORIZED_ARMED_PATROL' ||
                cat === 'AUTHORIZED_VEHICLE' ||
                title.includes('authorized sentry') ||
                title.includes('authorized vehicle') ||
                title.includes('[auth sentry') ||
                title.includes('[auth vehicle') ||
                title.includes('weapon clearance') ||
                title.includes('clearance confirmed') ||
                title.startsWith('🛡️');

              if (!isAuthClearance) {
                const isUnauthorizedThreat =
                  cat === 'ARMED_HOSTILE_INTRUDER' ||
                  cat === 'UNAUTHORIZED_VEHICLE' ||
                  cat === 'VIRTUAL_FENCE_INTRUSION' ||
                  cat === 'RESTRICTED_ZONE_BREACH' ||
                  (cat === 'ANPR_MATCH' && String(p.severity || '').toUpperCase() === 'CRITICAL') ||
                  title.includes('unauthorized') ||
                  title.includes('armed hostile') ||
                  title.includes('hostile') ||
                  (cat.includes('WEAPON') && !cat.includes('AUTHORIZED')) ||
                  (cat.includes('ARMED') && !cat.includes('AUTHORIZED'));

                if (isUnauthorizedThreat) {
                  soundController.playSirenBurst(3.5);
                }
              }

              setAlerts((prev) => [newAlert, ...prev.slice(0, 19)]);
              syncAlertToFirestore(newAlert).catch(() => {});
            } else if (data.type === 'PING') {
              setLastPing((p) => (p >= 5 ? 1 : p + 1));
            }
          } catch (err) {
            console.debug('WS parse error:', err);
          }
        };

        socket.onerror = () => {
          if (!isUnmounted) setIsConnected(false);
        };

        socket.onclose = () => {
          if (!isUnmounted) {
            setIsConnected(false);
            // Reconnect after 3s
            reconnectTimer = setTimeout(connect, 3000);
          }
        };
      } catch (err) {
        if (!isUnmounted) {
          setIsConnected(false);
          reconnectTimer = setTimeout(connect, 4000);
        }
      }
    };

    connect();

    // Heartbeat ticker for UI jitter simulation
    const interval = setInterval(() => {
      setLastPing((prev) => (prev >= 5 ? 1 : prev + 1));
      setLatency(12 + Math.floor(Math.random() * 5));
    }, 2500);

    return () => {
      isUnmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socketRef.current) {
        socketRef.current.close();
      }
      clearInterval(interval);
    };
  }, []);

  return {
    isConnected,
    latency,
    lastPing,
    trackedCount,
    alerts,
  };
};
