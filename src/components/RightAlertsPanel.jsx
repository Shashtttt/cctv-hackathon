import React, { useState, useEffect } from 'react';
import { ShieldAlert, Bell, ChevronRight, Camera, User, Eye, Truck, AlertTriangle } from 'lucide-react';
import { fetchAlerts } from '../services/apiService';
import './RightAlertsPanel.css';

export const RightAlertsPanel = ({ alerts: liveWsAlerts = [], onNavigateToAlerts }) => {
  const [dbAlerts, setDbAlerts] = useState([]);

  const loadAlerts = async () => {
    try {
      const res = await fetchAlerts({ limit: 10 });
      if (res && res.items && res.items.length > 0) {
        setDbAlerts(res.items);
      }
    } catch (err) {
      console.debug('RightAlertsPanel DB fetch error:', err);
    }
  };

  useEffect(() => {
    loadAlerts();
    const interval = setInterval(loadAlerts, 5000);
    return () => clearInterval(interval);
  }, []);

  // Merge live WS alerts with DB alerts (most recent first)
  const combinedAlerts = [...liveWsAlerts, ...dbAlerts].slice(0, 6);

  return (
    <div className="tactical-card right-alerts-panel">
      {/* Panel Header */}
      <div className="recent-alerts-header font-mono">
        <div className="header-title-left">
          <Bell size={18} className="text-coral" />
          <h4 className="panel-title-text font-bold text-white">Recent Alerts (Live Database)</h4>
        </div>
        <span className="pill-badge pill-red-badge font-mono font-bold">
          {combinedAlerts.length} LOGGED
        </span>
      </div>

      {/* Alerts Cards List */}
      <div className="recent-alerts-list font-mono">
        {combinedAlerts.length === 0 ? (
          <div className="text-muted text-xs py-8 text-center">
            No active threat alerts in database.
          </div>
        ) : (
          combinedAlerts.map((alert, idx) => {
            const isArmed = alert.category?.includes('ARMED') || alert.title?.includes('Armed');
            const isWeapon = alert.category?.includes('WEAPON') || alert.title?.includes('Weapon');
            const isCrit = (alert.severity || alert.level) === 'CRITICAL' || (alert.severity || alert.level) === 'crit' || alert.category?.includes('UNUSUAL') || isArmed || isWeapon;
            const isWarn = (alert.severity || alert.level) === 'HIGH' || (alert.severity || alert.level) === 'WARNING' || (alert.severity || alert.level) === 'warn';
            const cardClass = isCrit ? 'card-critical' : isWarn ? 'card-warning' : 'card-info';
            const dotClass = isCrit ? 'dot-red' : isWarn ? 'dot-purple' : 'dot-cyan';
            const badgeText = isArmed ? 'ARMED ⚠️' : isWeapon ? 'WEAPON' : isCrit ? 'CRITICAL' : isWarn ? 'WARNING' : 'INFO';
            const tagClass = isCrit ? 'tag-coral' : isWarn ? 'tag-purple' : 'tag-cyan';

            const alertTitle = alert.title || alert.type || alert.category || 'Security Alert';
            const alertText = alert.description || alert.text || 'Target movement detected in sector';
            const alertCam = alert.camera_id ? alert.camera_id.toUpperCase() : (alert.camera || 'CAM-01');
            const alertTime = alert.timestamp ? new Date(alert.timestamp).toLocaleTimeString() : (alert.time || 'JUST NOW');

            return (
              <div key={alert.id || idx} className={`alert-record-card ${cardClass}`}>
                <div className="alert-card-top-row">
                  <div className="alert-type-group">
                    <span className={`status-dot ${dotClass} ${isCrit ? 'pulse-ring' : ''}`}></span>
                    <span className="alert-type-title">{alertTitle}</span>
                  </div>
                  <span className={`pill-badge ${tagClass} alert-level-badge font-bold`}>
                    {badgeText}
                  </span>
                </div>

                <div className="alert-msg-body">
                  <p className="alert-msg-text">{alertText}</p>
                </div>

                <div className="alert-card-bottom-row">
                  <span className="alert-camera-label">
                    <Camera size={12} /> {alertCam}
                  </span>
                  <span className="alert-time-label">{alertTime}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Panel Footer */}
      {onNavigateToAlerts && (
        <button
          className="panel-footer-btn font-mono"
          onClick={() => onNavigateToAlerts('alerts')}
        >
          <span>View All Security Alerts in DB</span>
          <ChevronRight size={14} />
        </button>
      )}
    </div>
  );
};

export default RightAlertsPanel;
