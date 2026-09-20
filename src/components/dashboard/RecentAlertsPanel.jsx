import React, { useState, useEffect } from 'react';
import { Bell, ShieldCheck, AlertTriangle, ExternalLink } from 'lucide-react';
import { useWebSocket } from '../../services/useWebSocket';
import { fetchAlerts } from '../../services/apiService';
import { soundController } from '../../utils/audioAlert';
import './RecentAlertsPanel.css';

export default function RecentAlertsPanel({ onNavigateToAlerts }) {
  const { alerts: wsAlerts } = useWebSocket();
  const [alertsList, setAlertsList] = useState([]);
  const [loading, setLoading] = useState(true);

  // 1. Fetch real alerts from database
  useEffect(() => {
    let isMounted = true;
    fetchAlerts({ limit: 10 })
      .then((res) => {
        if (!isMounted) return;
        const items = res?.items || (Array.isArray(res) ? res : []);
        setAlertsList(items.slice(0, 5));
        setLoading(false);
      })
      .catch(() => {
        if (isMounted) setLoading(false);
      });

    return () => { isMounted = false; };
  }, []);

  // 2. Listen to live WebSocket alerts & trigger tactical siren on critical threats
  useEffect(() => {
    if (!wsAlerts || wsAlerts.length === 0) return;
    const latest = wsAlerts[0];
    if (!latest) return;

    // Trigger siren if critical or high alert
    const sev = (latest.severity || '').toUpperCase();
    const title = (latest.title || '').toLowerCase();
    const desc = (latest.description || latest.text || '').toLowerCase();
    const cat = (latest.category || '').toUpperCase();

    const isHighThreat = sev === 'CRITICAL' || sev === 'HIGH' || title.includes('weapon') || title.includes('intrusion') || desc.includes('restricted') || cat.includes('INTRUSION');
    if (isHighThreat) {
      soundController.playSirenBurst(3.2);
    }

    setAlertsList((prev) => {
      if (prev.some((a) => a.id === latest.id)) return prev;
      return [latest, ...prev.slice(0, 4)];
    });
  }, [wsAlerts]);

  return (
    <div className="recent-alerts-panel">
      {/* Panel Header */}
      <div className="recent-alerts-header">
        <div className="alerts-title-group">
          <div className="alerts-bell-icon">
            <Bell size={14} fill="#ffffff" color="#ffffff" />
          </div>
          <h2 className="recent-alerts-title">Recent Alerts</h2>
          <span className="alerts-count-bubble">{alertsList.length}</span>
        </div>

        <button 
          className="alerts-view-all-btn"
          onClick={() => onNavigateToAlerts && onNavigateToAlerts('alerts')}
        >
          View All
        </button>
      </div>

      {/* Alerts Cards List: ONLY SHOWS REAL ALERTS WHEN FOUND */}
      <div className="alerts-list">
        {loading ? (
          <div className="alerts-loading-state">
            <div className="alerts-spinner"></div>
            <span>Syncing database alerts...</span>
          </div>
        ) : alertsList.length === 0 ? (
          <div className="no-alerts-state">
            <ShieldCheck size={32} className="text-green-online" />
            <span className="no-alerts-title">Perimeter Secure • 0 Threats Found</span>
            <span className="no-alerts-desc">Active AI sensors and edge analytics monitoring all perimeter sectors. Alerts appear automatically when detected.</span>
          </div>
        ) : (
          alertsList.map((alert) => {
            const sev = (alert.severity || 'Medium').toUpperCase();
            const sevClass = sev === 'CRITICAL' || sev === 'HIGH' ? 'severity-high' : sev === 'LOW' ? 'severity-low' : 'severity-medium';
            const sevLabel = sev === 'CRITICAL' ? 'Critical' : sev === 'HIGH' ? 'High' : sev === 'LOW' ? 'Low' : 'Medium';

            const timeStr = alert.timestamp
              ? new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
              : alert.time || 'Just now';

            const camLabel = alert.camera_id || alert.cameraId || alert.camera || 'Cam 01';

            return (
              <div 
                key={alert.id} 
                className={`alert-card-item ${sev === 'CRITICAL' ? 'border-pulse-red' : ''}`}
                onClick={() => onNavigateToAlerts && onNavigateToAlerts('alerts')}
              >
                {/* Alert Category Indicator */}
                <div className={`alert-category-icon-box ${sevClass}`}>
                  <AlertTriangle size={16} />
                </div>

                {/* Alert Details */}
                <div className="alert-info-col">
                  <span className="alert-heading">{alert.title || alert.type || 'Security Event'}</span>
                  <span className="alert-desc">{alert.description || alert.text || 'Security event verified by AI model'}</span>
                  <span className="alert-camera-label">({camLabel})</span>
                </div>

                {/* Severity & Time */}
                <div className="alert-meta-col">
                  <span className={`severity-badge ${sevClass}`}>
                    {sevLabel}
                  </span>
                  <span className="alert-timestamp">{timeStr}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
