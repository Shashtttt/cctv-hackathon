import React, { useState, useEffect } from 'react';
import { Settings, User, ChevronDown, Award, LogOut, Volume2, VolumeX, Video, VideoOff, Eye } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSentinelCamera } from '../context/SentinelCameraContext';
import { soundController } from '../utils/audioAlert';
import './Header.css';

export default function Header({ onSelectTab }) {
  const { user, logout } = useAuth();
  const { isSentinelActive, toggleSentinel, telemetry } = useSentinelCamera();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [currentDateTime, setCurrentDateTime] = useState('13 Sep 2026  14:32:17');
  const [isSirenActive, setIsSirenActive] = useState(false);

  useEffect(() => {
    const unsub = soundController.subscribe((active) => {
      setIsSirenActive(active);
    });
    return unsub;
  }, []);

  const handleToggleSiren = () => {
    if (isSirenActive) {
      soundController.silence();
    } else {
      soundController.playSirenBurst(3.5);
    }
  };

  useEffect(() => {
    const updateDateTime = () => {
      const now = new Date();
      const day = String(now.getDate()).padStart(2, '0');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const month = months[now.getMonth()];
      const year = now.getFullYear();
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      setCurrentDateTime(`${day} ${month} ${year}  ${hours}:${minutes}:${seconds}`);
    };

    updateDateTime();
    const timer = setInterval(updateDateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="ibvap-header">
      {/* Left Branding Group */}
      <div className="header-brand-group">
        <div className="header-logo-container">
          <svg width="34" height="34" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M18 3L5 8V17C5 25.5 10.5 32.5 18 35C25.5 32.5 31 25.5 31 17V8L18 3Z"
              fill="#172554"
              stroke="#2563eb"
              strokeWidth="2.2"
              strokeLinejoin="round"
            />
            <path
              d="M9.5 18C9.5 18 13 12.5 18 12.5C23 12.5 26.5 18 26.5 18C26.5 18 23 23.5 18 23.5C13 23.5 9.5 18 9.5 18Z"
              fill="#0b1329"
              stroke="#38bdf8"
              strokeWidth="1.8"
            />
            <circle cx="18" cy="18" r="3.2" fill="#38bdf8" />
            <circle cx="19" cy="17" r="1.1" fill="#ffffff" />
          </svg>
        </div>

        <div className="header-title-text-group">
          <h1 className="header-brand-title">IBVAP</h1>
          <div className="header-subtitles">
            <span className="subtitle-line-1">AI-Based Intelligent Video Analytics Platform</span>
            <span className="subtitle-line-2">for Border Surveillance</span>
          </div>
        </div>
      </div>

      {/* Right Controls & Status Group */}
      <div className="header-right-meta">
        {/* Persistent Sentinel Camera Background Toggle */}
        <button
          className={`header-sentinel-btn ${isSentinelActive ? 'sentinel-active' : 'sentinel-inactive'}`}
          onClick={toggleSentinel}
          title={isSentinelActive ? `Camera is running in background & identifying. Status: ${telemetry.lastIdentified}. Click to turn OFF.` : "Camera is OFF. Click to start persistent background identification."}
        >
          <span className={`sentinel-beacon-dot ${isSentinelActive ? 'beacon-pulse' : ''}`} />
          {isSentinelActive ? <Video size={15} /> : <VideoOff size={15} />}
          <div className="sentinel-btn-content">
            <span className="sentinel-main-label">
              {isSentinelActive ? 'SENTINEL CAM: ON' : 'SENTINEL CAM: OFF'}
            </span>
            {isSentinelActive && (
              <span className="sentinel-telemetry-tag">
                {telemetry.fps > 0 ? `${telemetry.fps} FPS` : 'RUNNING'} • {telemetry.personsCount > 0 ? `${telemetry.personsCount} Pers` : 'Clear'}
              </span>
            )}
          </div>
          <span className="sentinel-action-badge">
            {isSentinelActive ? 'TURN OFF' : 'TURN ON'}
          </span>
        </button>

        {/* Tactical Siren Trigger */}
        <button
          className={`header-siren-btn ${isSirenActive ? 'siren-pulsing' : ''}`}
          onClick={handleToggleSiren}
          title={isSirenActive ? "Silence Alarm Siren" : "Test Defense Warning Siren"}
        >
          {isSirenActive ? <VolumeX size={15} /> : <Volume2 size={15} />}
          <span>{isSirenActive ? 'SILENCE' : 'SIREN'}</span>
        </button>

        {/* System Online Badge */}
        <div className="header-system-status">
          <span className="system-status-dot"></span>
          <span className="system-status-text">System Online</span>
        </div>

        {/* Date and Time */}
        <div className="header-clock-display">
          <span>{currentDateTime}</span>
        </div>

        {/* Settings Gear Button */}
        <button
          className="header-settings-btn"
          onClick={() => onSelectTab && onSelectTab('settings')}
          title="System Settings"
        >
          <Settings size={18} />
        </button>

        {/* Operator Profile Menu */}
        <div className="header-operator-wrapper">
          <button
            className="operator-pill-btn"
            onClick={() => setShowUserMenu(!showUserMenu)}
          >
            <div className="operator-icon-wrap">
              <User size={15} />
            </div>
            <span className="operator-display-name">
              Operator 1
            </span>
            <ChevronDown size={14} className="operator-arrow" />
          </button>

          {showUserMenu && (
            <div className="operator-dropdown-card">
              <div className="dropdown-user-header">
                <div className="dropdown-row">
                  <Award size={13} className="text-blue-400" />
                  <span className="dropdown-badge-num">BADGE: SEC-8821</span>
                </div>
                <div className="dropdown-user-email">
                  {user?.email || 'operator1@ibvap.mil'}
                </div>
                <div className="dropdown-user-role">
                  Clearance: TOP SECRET (Level 4)
                </div>
              </div>

              <div className="dropdown-menu-divider"></div>

              <button
                className="dropdown-action-btn"
                onClick={() => {
                  setShowUserMenu(false);
                  logout();
                }}
              >
                <LogOut size={14} className="text-red-400" />
                <span>Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
