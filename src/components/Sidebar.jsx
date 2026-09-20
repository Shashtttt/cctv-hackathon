import React from 'react';
import { 
  Home, 
  Crosshair, 
  BarChart2, 
  Bell, 
  FileText, 
  Settings,
  ShieldCheck,
  UserCheck
} from 'lucide-react';
import './Sidebar.css';

export default function Sidebar({ activeTab = 'dashboard', onSelectTab }) {
  return (
    <aside className="ibvap-sidebar">
      {/* Navigation Links Group */}
      <nav className="sidebar-nav-menu">
        {/* Dashboard */}
        <button
          className={`sidebar-nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => onSelectTab && onSelectTab('dashboard')}
        >
          <Home size={18} className="nav-icon" />
          <span>Dashboard</span>
        </button>

        {/* Detections */}
        <button
          className={`sidebar-nav-item ${activeTab === 'cameras' ? 'active' : ''}`}
          onClick={() => onSelectTab && onSelectTab('cameras')}
        >
          <Crosshair size={18} className="nav-icon" />
          <span>Detections</span>
        </button>

        {/* Analytics */}
        <button
          className={`sidebar-nav-item ${activeTab === 'analytics' ? 'active' : ''}`}
          onClick={() => onSelectTab && onSelectTab('analytics')}
        >
          <BarChart2 size={18} className="nav-icon" />
          <span>Analytics</span>
        </button>

        {/* Alerts */}
        <button
          className={`sidebar-nav-item ${activeTab === 'alerts' ? 'active' : ''}`}
          onClick={() => onSelectTab && onSelectTab('alerts')}
        >
          <Bell size={18} className="nav-icon" />
          <span>Alerts</span>
        </button>

        {/* Cyber & Blockchain */}
        <button
          className={`sidebar-nav-item ${activeTab === 'blockchain' ? 'active' : ''}`}
          onClick={() => onSelectTab && onSelectTab('blockchain')}
        >
          <ShieldCheck size={18} className="nav-icon" />
          <span>Cyber & Chain</span>
        </button>

        {/* Clearance Registry */}
        <button
          className={`sidebar-nav-item ${activeTab === 'registry' ? 'active' : ''}`}
          onClick={() => onSelectTab && onSelectTab('registry')}
        >
          <UserCheck size={18} className="nav-icon" />
          <span>Clearance Registry</span>
        </button>

        {/* Reports */}
        <button
          className={`sidebar-nav-item ${activeTab === 'snapshots' ? 'active' : ''}`}
          onClick={() => onSelectTab && onSelectTab('snapshots')}
        >
          <FileText size={18} className="nav-icon" />
          <span>Reports</span>
        </button>

        {/* Settings */}
        <button
          className={`sidebar-nav-item ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => onSelectTab && onSelectTab('settings')}
        >
          <Settings size={18} className="nav-icon" />
          <span>Settings</span>
        </button>
      </nav>

      {/* Bottom Mission / Motto Footer */}
      <div className="sidebar-footer-brand">
        <div className="mountain-logo-wrap">
          <svg width="28" height="24" viewBox="0 0 32 26" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* 3 small stars/dots */}
            <circle cx="9" cy="4" r="1" fill="#94a3b8" />
            <circle cx="16" cy="2" r="1.2" fill="#94a3b8" />
            <circle cx="23" cy="5" r="1" fill="#94a3b8" />
            {/* Left mountain peak */}
            <path d="M2 24L11 8L18 24H2Z" stroke="#94a3b8" strokeWidth="1.8" strokeLinejoin="round" fill="none" />
            {/* Right mountain peak */}
            <path d="M14 24L22 11L30 24H14Z" stroke="#94a3b8" strokeWidth="1.8" strokeLinejoin="round" fill="none" />
            {/* Internal ridge detail */}
            <path d="M11 8L13 24" stroke="#94a3b8" strokeWidth="1.2" />
            <path d="M22 11L24 24" stroke="#94a3b8" strokeWidth="1.2" />
          </svg>
        </div>
        <div className="motto-text-group">
          <span className="motto-line-1">Secure Borders</span>
          <span className="motto-line-2">Safer Tomorrow</span>
        </div>
      </div>
    </aside>
  );
}
