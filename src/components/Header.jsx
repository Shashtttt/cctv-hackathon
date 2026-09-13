import React, { useState, useEffect } from 'react';
import { Bell, Sliders, User, ShieldCheck, LogOut, Award, ChevronDown, Volume2, VolumeX, AlertTriangle, Images, Sun, Moon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { soundController } from '../utils/audioAlert';
import FirebaseStatusBadge from './FirebaseStatusBadge';
import './Header.css';

const Header = ({ onSelectTab }) => {
  const { user, logout, isAdmin } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [timeStr, setTimeStr] = useState('14:28:09 UTC');
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isSirenActive, setIsSirenActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    const updateZuluTime = () => {
      const now = new Date();
      const hours = String(now.getUTCHours()).padStart(2, '0');
      const minutes = String(now.getUTCMinutes()).padStart(2, '0');
      const seconds = String(now.getUTCSeconds()).padStart(2, '0');
      setTimeStr(`${hours}:${minutes}:${seconds} UTC`);
    };

    updateZuluTime();
    const timer = setInterval(updateZuluTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // Subscribe to real-time tactical siren state
  useEffect(() => {
    const unsubscribe = soundController.subscribe((active, muted) => {
      setIsSirenActive(active);
      setIsMuted(muted);
    });
    return unsubscribe;
  }, []);

  const handleToggleMute = () => {
    soundController.toggleMute();
  };

  const handleTestSiren = () => {
    if (isSirenActive) {
      soundController.silence();
    } else {
      soundController.playSirenBurst(3.5);
    }
  };

  return (
    <header className="top-header">
      {/* Left Operational Cluster Tag or Active Weapon Siren Banner */}
      <div className="flex items-center gap-3">
        <div className="cluster-status-pill font-mono">
          <ShieldCheck size={14} className="cluster-icon text-cyan" />
          <span className="dot-green status-dot pulse-ring"></span>
          <span className="cluster-text">SECTOR 4 - DEFENSE MATRIX CLUSTER: ARMED & OPERATIONAL</span>
        </div>

        <FirebaseStatusBadge />

        {isSirenActive && (
          <div className="siren-active-banner font-mono">
            <AlertTriangle size={14} className="text-red-500 animate-bounce" />
            <span className="siren-text">🚨 DEFCON 1: WEAPON DETECTED — TACTICAL SIREN SOUNDING</span>
            <button
              className="siren-silence-btn"
              onClick={() => soundController.silence()}
              title="Silence Siren"
            >
              SILENCE
            </button>
          </div>
        )}
      </div>

      {/* Right Controls, Operator Badge & Clock */}
      <div className="header-right-actions">
        {/* Test Siren Button */}
        <button
          className={`siren-test-pill font-mono ${isSirenActive ? 'active' : ''}`}
          onClick={handleTestSiren}
          title={isSirenActive ? "Stop active siren noise" : "Test tactical weapon siren noise"}
        >
          <span>{isSirenActive ? 'STOP SIREN' : 'TEST SIREN'}</span>
        </button>

        {/* Audio Mute / Unmute Button */}
        <button
          className={`header-icon-btn sound-toggle-btn ${isMuted ? 'muted' : ''} ${isSirenActive ? 'siren-pulsing' : ''}`}
          onClick={handleToggleMute}
          title={isMuted ? "Unmute Weapon Siren Alarms" : "Mute Weapon Siren Alarms"}
        >
          {isMuted ? (
            <VolumeX size={16} className="text-red-400" />
          ) : (
            <Volume2 size={16} className={isSirenActive ? "text-red-400 animate-pulse" : "text-cyan"} />
          )}
        </button>

        {/* Theme Mode Toggle Button */}
        <button
          className="theme-mode-toggle font-mono"
          onClick={toggleTheme}
          title={theme === 'dark' ? "Switch to Daylight Mode" : "Switch to Tactical Night Mode"}
        >
          {theme === 'dark' ? (
            <>
              <Sun size={14} className="text-amber-400 theme-sun-icon" />
              <span className="theme-toggle-text">LIGHT</span>
            </>
          ) : (
            <>
              <Moon size={14} className="text-indigo-400 theme-moon-icon" />
              <span className="theme-toggle-text">DARK</span>
            </>
          )}
        </button>

        <div className="zulu-clock-container font-mono">
          <span className="zulu-label text-cyan">ZULU:</span>
          <span className="zulu-time">{timeStr}</span>
        </div>

        {/* Authenticated Operator Profile Badge */}
        {user && (
          <div className="operator-profile-wrapper">
            <button 
              className="operator-header-pill font-mono"
              onClick={() => setShowUserMenu(!showUserMenu)}
              title="Click to view credentials or switch operator"
            >
              <div className="operator-avatar-circle">
                <User size={13} className="text-cyan" />
              </div>
              <div className="operator-info-text">
                <span className="operator-name">{user.full_name || user.username}</span>
                <span className="operator-role-tag">{user.role} • {user.clearance_level}</span>
              </div>
              <ChevronDown size={12} className="text-sub" />
            </button>

            {showUserMenu && (
              <div className="operator-dropdown-menu font-mono">
                <div className="dropdown-header">
                  <div className="dropdown-badge-row">
                    <Award size={13} className="text-cyan" />
                    <span>BADGE: {user.badge_number || 'SEC-8821'}</span>
                  </div>
                  <div className="dropdown-dept-text">{user.department || 'Sector-4 Command'}</div>
                  <div className="dropdown-email-text">{user.email || `${user.username}@ibvap.mil`}</div>
                </div>

                <div className="dropdown-divider"></div>

                {isAdmin && (
                  <button 
                    onClick={() => {
                      setShowUserMenu(false);
                      if (onSelectTab) onSelectTab('snapshots');
                    }}
                    className="dropdown-logout-btn font-mono"
                    style={{ color: '#f59e0b', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}
                    title="Open Evidence Snapshots Vault"
                  >
                    <Images size={13} className="text-yellow" />
                    <span>SNAPSHOTS VAULT (ADMIN)</span>
                  </button>
                )}

                <button 
                  onClick={logout}
                  className="dropdown-logout-btn font-mono"
                >
                  <LogOut size={13} className="text-red" />
                  <span>DISENGAGE / SIGN OUT</span>
                </button>
              </div>
            )}
          </div>
        )}

        <button className="header-icon-btn" title="Alert Notifications">
          <Bell size={16} />
          <span className="notification-dot"></span>
        </button>

        <button className="header-icon-btn" title="Dashboard Controls">
          <Sliders size={16} />
        </button>
      </div>
    </header>
  );
};

export default Header;
