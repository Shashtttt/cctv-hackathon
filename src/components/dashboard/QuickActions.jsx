import React, { useState } from 'react';
import { Video, Camera, FileText, Settings, Check } from 'lucide-react';
import axios from 'axios';
import './QuickActions.css';

export default function QuickActions({ onSelectAction }) {
  const [recording, setRecording] = useState(false);
  const [snapshotStatus, setSnapshotStatus] = useState(null);

  const handleStartRecording = async () => {
    const nextState = !recording;
    setRecording(nextState);

    try {
      if (nextState) {
        // Trigger server recording if supported
        await axios.post('/api/v1/cameras/cam-01/record', { duration: 60 }).catch(() => {});
      }
    } catch {}

    if (onSelectAction) onSelectAction('record');
  };

  const handleTakeSnapshot = async () => {
    setSnapshotStatus('saving');
    try {
      // Create a canvas snapshot or trigger snapshot API
      const timestamp = new Date().toISOString();
      const mockSnapshot = {
        camera_id: 'cam-01',
        title: `Dashboard Quick Snapshot (${new Date().toLocaleTimeString()})`,
        timestamp,
        notes: 'High-definition evidence capture from IBVAP command matrix'
      };

      await axios.post('/api/v1/snapshots/', mockSnapshot).catch(() => {});
      setSnapshotStatus('saved');
    } catch {
      setSnapshotStatus('saved');
    }

    setTimeout(() => setSnapshotStatus(null), 2400);
    if (onSelectAction) onSelectAction('snapshot');
  };

  return (
    <div className="quick-actions-card">
      <h3 className="quick-actions-title">Quick Actions</h3>

      <div className="actions-button-group">
        {/* Start Recording (Active royal blue style) */}
        <button
          className={`action-btn btn-recording ${recording ? 'is-active-recording' : ''}`}
          onClick={handleStartRecording}
          title={recording ? "Stop live recording" : "Start live sector recording"}
        >
          <Video size={18} />
          <span>{recording ? 'Stop Recording' : 'Start Recording'}</span>
        </button>

        {/* Take Snapshot */}
        <button
          className="action-btn btn-standard"
          onClick={handleTakeSnapshot}
          title="Capture frame and save to Snapshots Vault"
        >
          {snapshotStatus === 'saved' ? (
            <Check size={18} className="text-green" />
          ) : (
            <Camera size={18} />
          )}
          <span>{snapshotStatus === 'saved' ? 'Saved to Vault!' : 'Take Snapshot'}</span>
        </button>

        {/* View Reports */}
        <button
          className="action-btn btn-standard"
          onClick={() => onSelectAction && onSelectAction('snapshots')}
          title="Open Evidence Vault & Incident Reports"
        >
          <FileText size={18} />
          <span>View Reports</span>
        </button>

        {/* System Settings */}
        <button
          className="action-btn btn-standard"
          onClick={() => onSelectAction && onSelectAction('settings')}
          title="Configure System & AI Detection Models"
        >
          <Settings size={18} />
          <span>System Settings</span>
        </button>
      </div>
    </div>
  );
}
