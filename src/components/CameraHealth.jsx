import React, { useState } from 'react';
import { Camera, RefreshCw, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import './CameraHealth.css';

const CameraHealth = () => {
  const [isDiagnosticRunning, setIsDiagnosticRunning] = useState(false);
  const [integrity, setIntegrity] = useState(91.6);

  const handleRunDiagnostic = () => {
    setIsDiagnosticRunning(true);
    setTimeout(() => {
      setIsDiagnosticRunning(false);
      setIntegrity(92.3);
    }, 2000);
  };

  return (
    <div className="tactical-card camera-health-card">
      {/* Card Top Header */}
      <div className="card-header">
        <div className="card-title-group">
          <div className="card-title-row">
            <Camera size={18} className="card-title-icon" />
            <h3 className="card-title">Camera Health</h3>
          </div>
          <span className="card-subtitle">Real-time node ping & RTSP telemetry</span>
        </div>

        <span className="streams-count-badge font-mono">
          24/26 STREAMS
        </span>
      </div>

      {/* Camera Status Items Breakdown */}
      <div className="camera-status-list">
        <div className="status-row-item">
          <div className="status-row-label">
            <span className="dot-green status-dot"></span>
            <span>Online & Streaming</span>
          </div>
          <span className="status-row-count green-count font-mono">22</span>
        </div>

        <div className="status-row-item">
          <div className="status-row-label">
            <span className="dot-yellow status-dot"></span>
            <span>Warning / High Latency</span>
          </div>
          <span className="status-row-count yellow-count font-mono">1</span>
        </div>

        <div className="status-row-item">
          <div className="status-row-label">
            <span className="dot-red status-dot"></span>
            <span>Offline / Unreachable</span>
          </div>
          <span className="status-row-count red-count font-mono">1</span>
        </div>
      </div>

      {/* Operational Integrity Progress Meter */}
      <div className="integrity-meter-container">
        <div className="integrity-label-row">
          <span className="integrity-title">Operational Integrity</span>
          <span className="integrity-value font-mono">{integrity}%</span>
        </div>

        <div className="integrity-progress-bar">
          <div 
            className="integrity-progress-fill" 
            style={{ width: `${integrity}%` }}
          ></div>
        </div>
      </div>

      {/* Card Footer Bar */}
      <div className="card-footer-bar">
        <span className="diagnostic-time-text">
          Next self-diagnostic is <strong>04:18</strong>
        </span>

        <button 
          className={`btn-tactical ${isDiagnosticRunning ? 'btn-primary' : ''}`}
          onClick={handleRunDiagnostic}
          disabled={isDiagnosticRunning}
        >
          <RefreshCw size={13} className={isDiagnosticRunning ? 'spin-icon' : ''} />
          <span>{isDiagnosticRunning ? 'Running...' : 'Run Diagnostics'}</span>
        </button>
      </div>
    </div>
  );
};

export default CameraHealth;
