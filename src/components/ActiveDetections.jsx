import React, { useState, useEffect } from 'react';
import { Target, AlertTriangle, ShieldCheck, Eye, Truck, Camera, CheckCircle2 } from 'lucide-react';
import { fetchAlerts } from '../services/apiService';
import './ActiveDetections.css';

export const ActiveDetections = () => {
  const [detections, setDetections] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadDetections = async () => {
    try {
      const res = await fetchAlerts({ limit: 4 });
      if (res && res.items && res.items.length > 0) {
        const mapped = res.items.map((item, idx) => {
          const isArmed = item.category?.includes('ARMED') || item.title?.includes('Armed');
          const isWeapon = item.category?.includes('WEAPON') || item.title?.includes('Weapon');
          const isBaggage = item.category?.includes('BAGGAGE') || item.title?.includes('Baggage');
          const isCrit = item.severity === 'CRITICAL' || item.category?.includes('UNUSUAL') || isArmed || isWeapon;
          const isWarn = item.severity === 'HIGH' || item.severity === 'WARNING' || isBaggage;

          let badgeText = 'Verified Entity';
          if (isArmed) badgeText = '🚨 LETHAL ARMED THREAT';
          else if (isWeapon) badgeText = '⚠️ WEAPON DETECTED';
          else if (isBaggage) badgeText = '📦 UNATTENDED BAGGAGE';
          else if (isCrit) badgeText = '⚠️ Critical Alert Active';
          else if (isWarn) badgeText = 'Flagged Activity';

          return {
            id: item.target_id || `TRK-${item.id?.substring(0, 4) || (100 + idx)}`,
            type: (isArmed ? 'ARMED SUBJECT' : isWeapon ? 'WEAPON DETECTED' : isBaggage ? 'UNATTENDED BAGGAGE' : item.category || item.title || 'DETECTION').toUpperCase(),
            sub: item.description || `Camera: ${item.camera_id || 'CAM-01'}`,
            conf: item.frs_match_score ? `${(item.frs_match_score * 100).toFixed(0)}%` : '95%',
            cam: `Camera ${(item.camera_id || 'CAM-01').toUpperCase()}`,
            badge: badgeText,
            theme: isCrit ? 'red' : isWarn ? 'purple' : 'green',
            icon: isCrit ? <AlertTriangle size={18} /> : isWarn ? <Eye size={18} /> : <ShieldCheck size={18} />
          };
        });
        setDetections(mapped);
      }
    } catch (err) {
      console.debug('ActiveDetections DB fetch fallback');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetections();
    const interval = setInterval(loadDetections, 6000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="tactical-card active-detections-card">
      {/* Card Top Header */}
      <div className="card-header">
        <div className="card-title-group">
          <div className="card-title-row">
            <Target size={18} className="card-title-icon" />
            <h3 className="card-title">Active Detections (SQLite Database)</h3>
          </div>
          <span className="card-subtitle">Real-time neural tracking stored in backend database</span>
        </div>

        <span className="pill-badge pill-cyan">
          {detections.length} TRACKED ENTITIES
        </span>
      </div>

      {/* 2x2 Detections Grid */}
      <div className="detections-grid">
        {detections.length === 0 ? (
          <div className="text-muted font-mono text-xs col-span-2 py-6 text-center">
            Awaiting live detection frames from AI pipeline...
          </div>
        ) : (
          detections.map((item) => (
            <div key={item.id} className={`detection-item-card theme-${item.theme}`}>
              {/* Top Row inside Item */}
              <div className="item-top-row">
                <div className="item-icon-box">
                  {item.icon}
                  <span className="item-id">{item.id}</span>
                </div>

                <div className="item-main-details">
                  <h4 className="item-title">{item.type}</h4>
                  <p className="item-sub">{item.sub}</p>
                </div>

                <div className="item-conf-box">
                  <span className="conf-value">{item.conf}</span>
                  <span className="conf-label">Conf</span>
                </div>
              </div>

              {/* Bottom Strip inside Item */}
              <div className="item-bottom-strip">
                <span className="item-cam-name">
                  <Camera size={12} /> {item.cam}
                </span>
                <span className={`item-status-badge badge-${item.theme}`}>
                  {item.theme === 'green' && <CheckCircle2 size={11} />}
                  {item.theme === 'red' && <span className="status-dot dot-red pulse-ring"></span>}
                  {item.badge}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ActiveDetections;
