import React from 'react';
import { 
  LayoutDashboard, 
  Video, 
  ShieldAlert, 
  Camera, 
  BarChart3, 
  Settings, 
  UserCheck, 
  LogOut, 
  Radio, 
  Images 
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './Sidebar.css';

const Sidebar = ({ activeTab = 'dashboard', onSelectTab }) => {
  const { user, logout, isAdmin } = useAuth();

  return (
    <>
      {/* Desktop Sticky Sidebar */}
      <aside className="sidebar-container desktop-sidebar">
        {/* Brand Header */}
        <div className="sidebar-brand">
          <div className="brand-icon-box">
            <Radio className="brand-logo-icon" size={22} />
          </div>
          <div className="brand-text-group">
            <h1 className="brand-title">IBVAP</h1>
            <span className="brand-subtitle">BORDER VIDEO ANALYTICS</span>
          </div>
        </div>

        {/* Navigation Group Header */}
        <div className="nav-section-header">
          <span className="nav-section-title">COMMAND MODULES</span>
          <span className="defcon-pill">
            <span className="dot-green status-dot"></span> DEFCON 4
          </span>
        </div>

        {/* Navigation Menu */}
        <nav className="sidebar-nav">
          <button 
            className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => onSelectTab && onSelectTab('dashboard')}
          >
            <LayoutDashboard size={18} className="nav-icon" />
            <span>Dashboard</span>
          </button>

          <button 
            className={`nav-item ${activeTab === 'surveillance' ? 'active' : ''}`}
            onClick={() => onSelectTab && onSelectTab('surveillance')}
          >
            <Video size={18} className="nav-icon" />
            <span>Live Surveillance</span>
          </button>

          <button 
            className={`nav-item ${activeTab === 'alerts' ? 'active' : ''}`}
            onClick={() => onSelectTab && onSelectTab('alerts')}
          >
            <ShieldAlert size={18} className="nav-icon" />
            <span>Alerts & Events</span>
            <span className="nav-crit-badge">5 CRIT</span>
          </button>

          <button 
            className={`nav-item ${activeTab === 'cameras' ? 'active' : ''}`}
            onClick={() => onSelectTab && onSelectTab('cameras')}
          >
            <Camera size={18} className="nav-icon" />
            <span>Cameras</span>
          </button>

          <button 
            className={`nav-item ${activeTab === 'analytics' ? 'active' : ''}`}
            onClick={() => onSelectTab && onSelectTab('analytics')}
          >
            <BarChart3 size={18} className="nav-icon" />
            <span>Analytics</span>
          </button>

          {/* Classified Admin Snapshots Link */}
          {isAdmin && (
            <button 
              className={`nav-item nav-item-admin ${activeTab === 'snapshots' ? 'active' : ''}`}
              onClick={() => onSelectTab && onSelectTab('snapshots')}
              title="Classified Surveillance Snapshots (Admin Only)"
            >
              <Images size={18} className="nav-icon" />
              <span>Snapshots</span>
              <span className="nav-admin-badge">ADMIN</span>
            </button>
          )}

          <button 
            className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => onSelectTab && onSelectTab('settings')}
          >
            <Settings size={18} className="nav-icon" />
            <span>Settings</span>
          </button>
        </nav>

        {/* Bottom Profile Footer */}
        <div className="sidebar-footer">
          <div className="agent-card">
            <div className="agent-avatar">
              <UserCheck size={18} />
            </div>
            <div className="agent-info">
              <div className="agent-name" title={user?.full_name || user?.username}>
                {user?.full_name || user?.username || 'Agent J. Vance'}
              </div>
              <div className="agent-role">{user?.role || 'SYS-OP L3'} • {user?.clearance_level || 'SECRET'}</div>
            </div>
            <span className="agent-status-badge">ACTIVE</span>
          </div>

          <button className="signout-btn" onClick={logout} title="Terminate operator session">
            <LogOut size={16} />
            <span>Secure Signout</span>
          </button>
        </div>
      </aside>

      {/* Mobile Tactical Bottom Navigation Bar */}
      <nav className="mobile-bottom-nav font-mono">
        <button
          className={`mobile-nav-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => onSelectTab && onSelectTab('dashboard')}
        >
          <LayoutDashboard size={19} />
          <span>Home</span>
        </button>

        <button
          className={`mobile-nav-btn ${activeTab === 'surveillance' ? 'active' : ''}`}
          onClick={() => onSelectTab && onSelectTab('surveillance')}
        >
          <Video size={19} />
          <span>Live AI</span>
        </button>

        <button
          className={`mobile-nav-btn ${activeTab === 'alerts' ? 'active' : ''}`}
          onClick={() => onSelectTab && onSelectTab('alerts')}
        >
          <div className="mobile-alert-icon-wrapper">
            <ShieldAlert size={19} />
            <span className="mobile-alert-dot"></span>
          </div>
          <span>Alerts</span>
        </button>

        <button
          className={`mobile-nav-btn ${activeTab === 'cameras' ? 'active' : ''}`}
          onClick={() => onSelectTab && onSelectTab('cameras')}
        >
          <Camera size={19} />
          <span>Cameras</span>
        </button>

        {isAdmin && (
          <button
            className={`mobile-nav-btn ${activeTab === 'snapshots' ? 'active' : ''}`}
            onClick={() => onSelectTab && onSelectTab('snapshots')}
            title="Snapshots Vault"
          >
            <Images size={19} />
            <span>Snaps</span>
          </button>
        )}

        <button
          className={`mobile-nav-btn ${activeTab === 'analytics' ? 'active' : ''}`}
          onClick={() => onSelectTab && onSelectTab('analytics')}
        >
          <BarChart3 size={19} />
          <span>Stats</span>
        </button>

        <button
          className={`mobile-nav-btn ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => onSelectTab && onSelectTab('settings')}
        >
          <Settings size={19} />
          <span>Config</span>
        </button>
      </nav>
    </>
  );
};

export default Sidebar;
