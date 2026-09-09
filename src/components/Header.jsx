import React, { useState, useEffect } from 'react';
import { Bell, Sliders, User, ShieldCheck, LogOut, Award, ChevronDown } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './Header.css';

const Header = () => {
  const { user, logout } = useAuth();
  const [timeStr, setTimeStr] = useState('14:28:09 UTC');
  const [showUserMenu, setShowUserMenu] = useState(false);

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

  return (
    <header className="top-header">
      {/* Left Operational Cluster Tag */}
      <div className="cluster-status-pill font-mono">
        <ShieldCheck size={14} className="cluster-icon text-cyan" />
        <span className="dot-green status-dot pulse-ring"></span>
        <span className="cluster-text">SECTOR 4 - DEFENSE MATRIX CLUSTER: ARMED & OPERATIONAL</span>
      </div>

      {/* Right Controls, Operator Badge & Clock */}
      <div className="header-right-actions">
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
