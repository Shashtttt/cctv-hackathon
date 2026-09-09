import { useState, useEffect, useRef } from 'react';

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
              const newAlert = {
                id: p.id || String(Date.now()),
                type: p.category || 'Security Alert',
                camera: p.camera_id ? p.camera_id.toUpperCase() : 'CAM',
                text: p.title || p.description || 'Alert detected',
                time: new Date(p.timestamp || Date.now()).toLocaleTimeString(),
                level: (p.severity || 'info').toLowerCase() === 'critical' ? 'crit' : (p.severity || 'info').toLowerCase() === 'warning' ? 'warn' : 'info',
              };
              setAlerts((prev) => [newAlert, ...prev.slice(0, 19)]);
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
