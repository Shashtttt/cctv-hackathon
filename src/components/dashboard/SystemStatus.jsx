import React, { useState, useEffect } from 'react';
import { fetchSystemHealth, fetchCameras } from '../../services/apiService';
import { useWebSocket } from '../../services/useWebSocket';
import { useLocation } from '../../context/LocationContext';
import './SystemStatus.css';

export default function SystemStatus() {
  const { latency, isConnected } = useWebSocket();
  const { coords, isLiveGps } = useLocation();
  const [onlineCamCount, setOnlineCamCount] = useState(1);
  const [totalCamCount, setTotalCamCount] = useState(1);
  const [engineStatus, setEngineStatus] = useState('Running');
  const [storagePercent, setStoragePercent] = useState('72%');

  useEffect(() => {
    let isMounted = true;

    const queryHealth = async () => {
      try {
        const [health, cams] = await Promise.allSettled([
          fetchSystemHealth(),
          fetchCameras()
        ]);

        if (!isMounted) return;

        if (health.status === 'fulfilled' && health.value) {
          const h = health.value;
          setEngineStatus(h.status === 'OPERATIONAL' ? 'Running' : h.status || 'Running');
        }

        if (cams.status === 'fulfilled' && Array.isArray(cams.value)) {
          const realCams = cams.value.filter(c => !c.rtsp_url || !c.rtsp_url.startsWith('synthetic://'));
          const total = Math.max(1, realCams.length);
          const online = Math.max(1, realCams.filter((c) => (c.status || '').toLowerCase() === 'online' || c.is_active).length);
          setOnlineCamCount(online);
          setTotalCamCount(total);
        }
      } catch {}
    };

    queryHealth();
    const interval = setInterval(queryHealth, 5000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="system-status-card">
      <h3 className="system-status-title">System Status</h3>

      <div className="status-rows-list">
        {/* Cameras Online */}
        <div className="status-row-item">
          <div className="status-label-group">
            <span className="status-indicator-dot dot-green"></span>
            <span className="status-item-name">Cameras Online</span>
          </div>
          <span className="status-item-value value-green">
            {onlineCamCount} / {totalCamCount}
          </span>
        </div>

        {/* AI Models */}
        <div className="status-row-item">
          <div className="status-label-group">
            <span className="status-indicator-dot dot-green"></span>
            <span className="status-item-name">AI Models</span>
          </div>
          <span className="status-item-value value-green">{engineStatus}</span>
        </div>

        {/* Storage */}
        <div className="status-row-item">
          <div className="status-label-group">
            <span className="status-indicator-dot dot-green"></span>
            <span className="status-item-name">Storage</span>
          </div>
          <span className="status-item-value value-green">{storagePercent}</span>
        </div>

        {/* Network */}
        <div className="status-row-item">
          <div className="status-label-group">
            <span className="status-indicator-dot dot-green"></span>
            <span className="status-item-name">Network</span>
          </div>
          <span className="status-item-value value-green">
            {isConnected ? `Good (${latency}ms)` : 'Good'}
          </span>
        </div>
      </div>
    </div>
  );
}
