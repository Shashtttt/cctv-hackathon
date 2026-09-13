import React from 'react';
import { Cloud, CloudOff, Flame } from 'lucide-react';
import useFirebaseRealtime from '../services/useFirebaseRealtime';

export const FirebaseStatusBadge = () => {
  const { connected, alerts } = useFirebaseRealtime({ limitAlerts: 1 });

  return (
    <div
      className={`firebase-status-pill font-mono flex items-center gap-2 px-2.5 py-1 rounded-md text-xs border ${
        connected
          ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-400'
          : 'bg-amber-950/40 border-amber-500/30 text-amber-400'
      }`}
      title={connected ? `Firebase Cloud Synced: ibvap-hackathon (${alerts.length} cloud alerts)` : 'Firebase Cloud Sync Standby'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '3px 9px',
        borderRadius: '4px',
        fontSize: '11px',
        fontWeight: 600,
        letterSpacing: '0.04em',
        border: connected ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid rgba(245, 158, 11, 0.35)',
        background: connected ? 'rgba(6, 78, 59, 0.25)' : 'rgba(120, 53, 15, 0.25)',
        color: connected ? '#34d399' : '#fbbf24',
        boxShadow: connected ? '0 0 10px rgba(16, 185, 129, 0.15)' : 'none'
      }}
    >
      {connected ? (
        <Flame size={13} className="text-emerald-400" style={{ filter: 'drop-shadow(0 0 4px #10b981)' }} />
      ) : (
        <CloudOff size={13} className="text-amber-400" />
      )}
      <span>FIREBASE: {connected ? 'CLOUD SYNC' : 'STANDBY'}</span>
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          backgroundColor: connected ? '#10b981' : '#f59e0b',
          display: 'inline-block',
          boxShadow: connected ? '0 0 6px #10b981' : 'none'
        }}
      />
    </div>
  );
};

export default FirebaseStatusBadge;
