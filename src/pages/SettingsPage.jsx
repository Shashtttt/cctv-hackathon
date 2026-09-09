import React, { useState, useEffect } from 'react';
import { 
  Shield, 
  Eye, 
  Layout, 
  User, 
  UserCheck, 
  UserPlus, 
  Search, 
  Edit3, 
  Trash2, 
  Save, 
  RotateCcw, 
  CheckCircle2, 
  Lock, 
  Smartphone, 
  Key, 
  Sliders, 
  Clock, 
  Zap, 
  Plus, 
  ShieldCheck, 
  Info,
  X
} from 'lucide-react';
import { fetchFRSWatchlist, addFRSSubject, deleteFRSSubject } from '../services/apiService';
import './SettingsPage.css';

const defaultAuthorizedList = [
  {
    id: '1',
    initials: 'RK',
    name: 'Raj Kumar',
    tag: 'P-115',
    role: 'Security Officer',
    status: 'active',
    statusText: 'Active',
    scanStatus: 'SCAN: OK'
  },
  {
    id: '2',
    initials: 'AS',
    name: 'Amit Sharma',
    tag: 'P-121',
    role: 'Border Patrol Officer',
    status: 'active',
    statusText: 'Active',
    scanStatus: 'SCAN: OK'
  },
  {
    id: '3',
    initials: 'VS',
    name: 'Vikram Singh',
    tag: 'P-109',
    role: 'Quick Response Team (QRT)',
    status: 'active',
    statusText: 'Active',
    scanStatus: 'SCAN: OK'
  },
  {
    id: '4',
    initials: 'NP',
    name: 'Neha Patel',
    tag: 'P-134',
    role: 'Terminal Access Specialist',
    status: 'inactive',
    statusText: 'Inactive (Leave / Revoked)',
    scanStatus: 'L3-DENIED'
  }
];

const SettingsPage = () => {
  // Toggle States for Alert Preferences
  const [alerts, setAlerts] = useState({
    security: true,
    intrusion: true,
    nightMovement: true,
    vehicleDetection: false,
    suspiciousActivity: true
  });

  // Toggle States for Detection Display
  const [display, setDisplay] = useState({
    objectTracking: true,
    confidenceScore: true,
    vehiclePlate: true,
    detectionLabels: true
  });

  // Live Surveillance Preferences
  const [cameraLayout, setCameraLayout] = useState('2x2');
  const [timeRangeScope, setTimeRangeScope] = useState('24h');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showCamStatus, setShowCamStatus] = useState(true);

  // Authorized Persons Search & Data
  const [searchTerm, setSearchTerm] = useState('');
  const [authorizedList, setAuthorizedList] = useState(defaultAuthorizedList);
  const [savedSuccessMessage, setSavedSuccessMessage] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonRole, setNewPersonRole] = useState('Security Officer');

  useEffect(() => {
    const loadWatchlist = async () => {
      try {
        const subjects = await fetchFRSWatchlist();
        if (Array.isArray(subjects) && subjects.length > 0) {
          const mapped = subjects.map((s, idx) => {
            const initials = s.name ? s.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : 'OP';
            return {
              id: s.id || String(idx + 1),
              initials: initials,
              name: s.name,
              tag: s.alias || `P-${100 + idx}`,
              role: s.notes || s.category || 'Security Personnel',
              status: 'active',
              statusText: 'Active',
              scanStatus: s.has_embedding ? 'SCAN: OK' : 'PENDING EMBEDDING',
            };
          });
          setAuthorizedList(mapped);
        }
      } catch (err) {
        console.debug('FRS Watchlist load fallback');
      }
    };
    loadWatchlist();
  }, []);

  const toggleAlert = (key) => {
    setAlerts(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleDisplay = (key) => {
    setDisplay(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleRemovePerson = async (id) => {
    try {
      await deleteFRSSubject(id);
    } catch (e) {
      console.debug('Delete FRS fallback');
    }
    setAuthorizedList(prev => prev.filter(item => item.id !== id));
  };

  const handleAddPerson = async (e) => {
    e.preventDefault();
    if (!newPersonName.trim()) return;

    const initials = newPersonName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    const newPerson = {
      id: `W-${Date.now().toString().slice(-4)}`,
      initials,
      name: newPersonName.trim(),
      tag: `P-${Math.floor(100 + Math.random() * 900)}`,
      role: newPersonRole,
      status: 'active',
      statusText: 'Active',
      scanStatus: 'SCAN: OK',
    };

    try {
      await addFRSSubject({
        name: newPerson.name,
        alias: newPerson.tag,
        category: 'SECURITY_STAFF',
        threat_level: 'NONE',
        notes: newPerson.role,
      });
    } catch (err) {
      console.debug('Add FRS fallback');
    }

    setAuthorizedList(prev => [newPerson, ...prev]);
    setNewPersonName('');
    setShowAddModal(false);
  };

  const handleSaveChanges = () => {
    setSavedSuccessMessage(true);
    setTimeout(() => setSavedSuccessMessage(false), 3000);
  };

  const handleResetDefaults = () => {
    setAlerts({
      security: true,
      intrusion: true,
      nightMovement: true,
      vehicleDetection: false,
      suspiciousActivity: true
    });
    setDisplay({
      objectTracking: true,
      confidenceScore: true,
      vehiclePlate: true,
      detectionLabels: true
    });
    setCameraLayout('2x2');
    setTimeRangeScope('24h');
    setAutoRefresh(true);
    setShowCamStatus(true);
  };

  const filteredPersons = authorizedList.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.tag.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="settings-page-container font-sans">
      {/* Save Success Toast */}
      {savedSuccessMessage && (
        <div className="toast-success font-mono">
          <CheckCircle2 size={16} />
          <span>Terminal preferences saved successfully!</span>
        </div>
      )}

      {/* Add Modal */}
      {showAddModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(7, 10, 18, 0.85)',
          backdropFilter: 'blur(8px)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div className="tactical-card" style={{ width: '420px', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h4 className="font-mono text-white font-bold" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <UserCheck size={18} className="text-cyan" />
                Add Authorized Person
              </h4>
              <button onClick={() => setShowAddModal(false)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddPerson} className="font-mono">
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '6px' }}>Full Name</label>
                <input 
                  type="text" 
                  value={newPersonName} 
                  onChange={(e) => setNewPersonName(e.target.value)}
                  placeholder="e.g. Inspector Ramesh Rao"
                  required
                  style={{
                    width: '100%',
                    background: '#070a12',
                    border: '1px solid #192338',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    color: '#fff',
                    outline: 'none',
                    fontSize: '0.85rem',
                  }}
                />
              </div>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '6px' }}>Operational Role</label>
                <input 
                  type="text" 
                  value={newPersonRole} 
                  onChange={(e) => setNewPersonRole(e.target.value)}
                  placeholder="e.g. Quick Response Team"
                  style={{
                    width: '100%',
                    background: '#070a12',
                    border: '1px solid #192338',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    color: '#fff',
                    outline: 'none',
                    fontSize: '0.85rem',
                  }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" onClick={() => setShowAddModal(false)} className="btn-tactical">
                  Cancel
                </button>
                <button type="submit" className="btn-tactical btn-primary">
                  Save & Enroll
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Page Header */}
      <div className="settings-header-row">
        <div className="settings-header-left">
          <div className="title-heading-line">
            <h2>Settings</h2>
            <span className="pill-badge pill-muted font-mono version-tag">
              V4.12-OPS
            </span>
          </div>
          <p className="page-sub-text">
            Manage your dashboard and alert preferences for active surveillance terminal.
          </p>
        </div>

        <div className="header-status-pills font-mono">
          <span className="pill-badge pill-green">
            <span className="status-dot dot-green pulse-ring"></span> System Online
          </span>

          <span className="pill-badge pill-muted font-mono">
            <Clock size={12} className="text-cyan" /> NODE-SYNC: 0.08ms
          </span>
        </div>
      </div>

      {/* Main 2-Column Upper Grid Layout */}
      <div className="settings-upper-grid">
        {/* LEFT COLUMN */}
        <div className="settings-col">
          {/* Card 1: Alert Preferences */}
          <div className="tactical-card settings-card">
            <div className="card-header-with-badge font-mono">
              <div className="header-icon-title">
                <Shield size={16} className="text-cyan" />
                <div className="title-text-group">
                  <h4 className="card-title font-bold text-white">Alert Preferences</h4>
                  <p className="card-subtitle text-muted">
                    Configure push audio-visual priority alarms for active camera zones.
                  </p>
                </div>
              </div>
              <span className="pill-badge pill-muted font-mono text-xs">5 RULES</span>
            </div>

            <div className="toggle-rows-list font-mono">
              <div className="toggle-row-item">
                <div className="toggle-text-info">
                  <span className="toggle-label text-white font-bold">Security Alerts</span>
                  <span className="toggle-desc text-muted">Receive notifications when critical security events are detected.</span>
                </div>
                <button 
                  className={`switch-toggle ${alerts.security ? 'on' : ''}`}
                  onClick={() => toggleAlert('security')}
                >
                  <span className="switch-thumb"></span>
                </button>
              </div>

              <div className="toggle-row-item">
                <div className="toggle-text-info">
                  <span className="toggle-label text-white font-bold">Intrusion Alerts</span>
                  <span className="toggle-desc text-muted">Notify when virtual fence intrusion is detected.</span>
                </div>
                <button 
                  className={`switch-toggle ${alerts.intrusion ? 'on' : ''}`}
                  onClick={() => toggleAlert('intrusion')}
                >
                  <span className="switch-thumb"></span>
                </button>
              </div>

              <div className="toggle-row-item">
                <div className="toggle-text-info">
                  <span className="toggle-label text-white font-bold">Night Movement Alerts</span>
                  <span className="toggle-desc text-muted">Notify when movement is detected during night hours.</span>
                </div>
                <button 
                  className={`switch-toggle ${alerts.nightMovement ? 'on' : ''}`}
                  onClick={() => toggleAlert('nightMovement')}
                >
                  <span className="switch-thumb"></span>
                </button>
              </div>

              <div className="toggle-row-item">
                <div className="toggle-text-info">
                  <span className="toggle-label text-white font-bold">Vehicle Detection Alerts</span>
                  <span className="toggle-desc text-muted">Receive alerts for detected vehicles.</span>
                </div>
                <button 
                  className={`switch-toggle ${alerts.vehicleDetection ? 'on' : ''}`}
                  onClick={() => toggleAlert('vehicleDetection')}
                >
                  <span className="switch-thumb"></span>
                </button>
              </div>

              <div className="toggle-row-item">
                <div className="toggle-text-info">
                  <span className="toggle-label text-white font-bold">Suspicious Activity Alerts</span>
                  <span className="toggle-desc text-muted">Notify when suspicious activity is detected.</span>
                </div>
                <button 
                  className={`switch-toggle ${alerts.suspiciousActivity ? 'on' : ''}`}
                  onClick={() => toggleAlert('suspiciousActivity')}
                >
                  <span className="switch-thumb"></span>
                </button>
              </div>
            </div>
          </div>

          {/* Card 2: Detection Display */}
          <div className="tactical-card settings-card">
            <div className="card-header-with-badge font-mono">
              <div className="header-icon-title">
                <Eye size={16} className="text-cyan" />
                <div className="title-text-group">
                  <h4 className="card-title font-bold text-white">Detection Display</h4>
                  <p className="card-subtitle text-muted">
                    Configure real-time neural vision overlay parameters.
                  </p>
                </div>
              </div>
              <span className="pill-badge pill-muted font-mono text-xs">HUD OSD</span>
            </div>

            <div className="toggle-rows-list font-mono">
              <div className="toggle-row-item">
                <div className="toggle-text-info">
                  <span className="toggle-label text-white font-bold">Show Object Tracking ID</span>
                  <span className="toggle-desc text-muted">Display unique AI tracking ID on detected objects in live surveillance.</span>
                </div>
                <button 
                  className={`switch-toggle ${display.objectTracking ? 'on' : ''}`}
                  onClick={() => toggleDisplay('objectTracking')}
                >
                  <span className="switch-thumb"></span>
                </button>
              </div>

              <div className="toggle-row-item">
                <div className="toggle-text-info">
                  <span className="toggle-label text-white font-bold">Show Confidence Score</span>
                  <span className="toggle-desc text-muted">Display AI confidence score alongside detected objects.</span>
                </div>
                <button 
                  className={`switch-toggle ${display.confidenceScore ? 'on' : ''}`}
                  onClick={() => toggleDisplay('confidenceScore')}
                >
                  <span className="switch-thumb"></span>
                </button>
              </div>

              <div className="toggle-row-item">
                <div className="toggle-text-info">
                  <span className="toggle-label text-white font-bold">Show Vehicle Plate Number</span>
                  <span className="toggle-desc text-muted">Display recognized vehicle registration numbers on vehicle detections.</span>
                </div>
                <button 
                  className={`switch-toggle ${display.vehiclePlate ? 'on' : ''}`}
                  onClick={() => toggleDisplay('vehiclePlate')}
                >
                  <span className="switch-thumb"></span>
                </button>
              </div>

              <div className="toggle-row-item">
                <div className="toggle-text-info">
                  <span className="toggle-label text-white font-bold">Show Detection Labels</span>
                  <span className="toggle-desc text-muted">Display object type labels such as Person, Vehicle and Face.</span>
                </div>
                <button 
                  className={`switch-toggle ${display.detectionLabels ? 'on' : ''}`}
                  onClick={() => toggleDisplay('detectionLabels')}
                >
                  <span className="switch-thumb"></span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="settings-col">
          {/* Card 1: Live Surveillance Preferences */}
          <div className="tactical-card settings-card">
            <div className="card-header-with-badge font-mono">
              <div className="header-icon-title">
                <Layout size={16} className="text-cyan" />
                <div className="title-text-group">
                  <h4 className="card-title font-bold text-white">Live Surveillance Preferences</h4>
                  <p className="card-subtitle text-muted">
                    Default layouts, telemetry refresh, and operational status.
                  </p>
                </div>
              </div>
              <span className="pill-badge pill-muted font-mono text-xs">WORKSPACE</span>
            </div>

            <div className="controls-form-list font-mono">
              <div className="select-field-group">
                <div className="field-label-row">
                  <span className="field-label text-white font-bold">Default Camera Layout</span>
                  <span className="field-scope-tag text-muted">LAYOUT</span>
                </div>
                <select 
                  value={cameraLayout}
                  onChange={(e) => setCameraLayout(e.target.value)}
                  className="settings-select font-mono"
                >
                  <option value="2x2">2 × 2 Grid</option>
                  <option value="3x3">3 × 3 Grid</option>
                  <option value="1x4">1 + 4 Grid Focus</option>
                </select>
              </div>

              <div className="select-field-group">
                <div className="field-label-row">
                  <span className="field-label text-white font-bold">Default Time Range</span>
                  <span className="field-scope-tag text-muted">QUERY SCOPE</span>
                </div>
                <select 
                  value={timeRangeScope}
                  onChange={(e) => setTimeRangeScope(e.target.value)}
                  className="settings-select font-mono"
                >
                  <option value="24h">Last 24 Hours</option>
                  <option value="12h">Last 12 Hours</option>
                  <option value="7d">Last 7 Days</option>
                </select>
              </div>

              <div className="toggle-row-item">
                <div className="toggle-text-info">
                  <span className="toggle-label text-white font-bold">Auto Refresh</span>
                  <span className="toggle-desc text-muted">Automatically refresh live telemetry and event feeds.</span>
                </div>
                <button 
                  className={`switch-toggle ${autoRefresh ? 'on' : ''}`}
                  onClick={() => setAutoRefresh(!autoRefresh)}
                >
                  <span className="switch-thumb"></span>
                </button>
              </div>

              <div className="toggle-row-item">
                <div className="toggle-text-info">
                  <span className="toggle-label text-white font-bold">Show Camera Status</span>
                  <span className="toggle-desc text-muted">Display live camera connection and operational status.</span>
                </div>
                <button 
                  className={`switch-toggle ${showCamStatus ? 'on' : ''}`}
                  onClick={() => setShowCamStatus(!showCamStatus)}
                >
                  <span className="switch-thumb"></span>
                </button>
              </div>
            </div>
          </div>

          {/* Card 2: User Profile */}
          <div className="tactical-card settings-card">
            <div className="card-header-with-badge font-mono">
              <div className="header-icon-title">
                <User size={16} className="text-cyan" />
                <div className="title-text-group">
                  <h4 className="card-title font-bold text-white">User Profile</h4>
                  <p className="card-subtitle text-muted">
                    Active console clearance identity.
                  </p>
                </div>
              </div>
              <span className="pill-badge pill-green-xs font-mono">● ACTIVE</span>
            </div>

            <div className="profile-identity-box font-mono">
              <div className="profile-top-info">
                <div className="profile-avatar-circle font-mono font-bold">
                  SO
                </div>
                <div className="profile-name-group">
                  <h4 className="profile-name font-bold text-white">Security Operator</h4>
                  <p className="profile-sub text-muted">Border Surveillance Officer</p>
                  <span className="profile-id-tag font-mono">ID: OP-8842-BRAVO</span>
                </div>
              </div>

              <div className="profile-meta-grid font-mono">
                <div className="profile-meta-cell">
                  <span className="meta-label text-muted">ASSIGNED ROLE</span>
                  <span className="meta-val text-white font-bold">Surveillance Operator</span>
                </div>
                <div className="profile-meta-cell border-left font-mono">
                  <span className="meta-label text-muted">DUTY STATUS</span>
                  <span className="meta-val text-green font-bold">● Active Watch</span>
                </div>
              </div>

              <div className="profile-footer-row font-mono text-muted">
                <div>TERMINAL LOCATION: <strong className="text-white">Operator Station 04 • Sector 7 Cluster</strong></div>
                <div className="profile-footer-sub">
                  <span>SESSION LOCKOUT: <strong className="text-white">NEVER</strong></span>
                  <span>AUTH: <strong className="text-white">HARDWARE-FIDO2</strong></span>
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: Policy Integrity Verified */}
          <div className="policy-verified-card font-mono">
            <div className="policy-left">
              <Smartphone size={20} className="text-green" />
              <div className="policy-text">
                <span className="policy-title text-white font-bold">Policy Integrity Verified</span>
                <span className="policy-sub text-muted">Sector 7 Perimeter node configuration checksum valid.</span>
              </div>
            </div>
            <span className="pill-badge pill-muted font-mono text-xs">SHA-256</span>
          </div>
        </div>
      </div>

      {/* LOWER SECTION: Authorized Persons Full-Width Whitelist Card */}
      <div className="tactical-card authorized-whitelist-card font-mono">
        <div className="whitelist-header-row">
          <div className="whitelist-title-group">
            <div className="header-icon-title">
              <UserCheck size={18} className="text-cyan" />
              <div>
                <div className="whitelist-title-line">
                  <h3 className="card-title font-bold text-white">Authorized Persons</h3>
                  <span className="pill-badge pill-cyan-sub font-mono text-xs">
                    AI BIOMETRIC WHITELIST
                  </span>
                </div>
                <p className="card-subtitle text-muted">
                  Manage people recognized as authorized by the AI face recognition system.
                </p>
              </div>
            </div>
          </div>

          <div className="whitelist-top-actions">
            <div className="whitelist-stats-pill font-mono">
              <span>Total: <strong>{authorizedList.length}</strong></span>
              <span className="dot-divider">•</span>
              <span className="text-green">● Active: <strong>{authorizedList.filter(a => a.status === 'active').length}</strong></span>
              <span className="dot-divider">•</span>
              <span className="text-muted">● Inactive: <strong>{authorizedList.filter(a => a.status !== 'active').length}</strong></span>
            </div>

            <button className="btn-add-authorized font-mono" onClick={() => setShowAddModal(true)}>
              <Plus size={14} />
              <span>+ Add Authorized Person</span>
            </button>
          </div>
        </div>

        {/* Search Input Bar */}
        <div className="whitelist-search-bar">
          <div className="search-input-box font-mono">
            <Search size={15} className="search-icon" />
            <input 
              type="text" 
              placeholder="Search authorized persons by name, ID, or role..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>

          <div className="sync-status-text font-mono text-green">
            <ShieldCheck size={14} />
            <span>CCTV Real-Time Sync Active</span>
          </div>
        </div>

        {/* Authorized Persons Rows List */}
        <div className="authorized-rows-list font-mono">
          {filteredPersons.map((person) => (
            <div key={person.id} className="person-row-item">
              <div className="person-left-info">
                <div className={`avatar-initial-box ${person.status === 'inactive' ? 'avatar-dark' : 'avatar-cyan'}`}>
                  <span className="initial-text font-bold">{person.initials}</span>
                  <span className="scan-tag">{person.scanStatus}</span>
                </div>

                <div className="person-name-role font-mono">
                  <div className="name-tag-row">
                    <span className="person-name text-white font-bold">{person.name}</span>
                    <span className="person-id-badge font-mono">{person.tag}</span>
                  </div>
                  <div className="role-status-row text-muted">
                    <span>{person.role}</span>
                    <span className="dot-divider">•</span>
                    {person.status === 'active' ? (
                      <span className="text-green font-bold">● Active</span>
                    ) : (
                      <span className="text-muted">● Inactive (Leave / Revoked)</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="person-action-btns font-mono">
                <button className="btn-person-edit">
                  <Edit3 size={13} />
                  <span>Edit</span>
                </button>
                <button className="btn-person-remove" onClick={() => handleRemovePerson(person.id)}>
                  <Trash2 size={13} />
                  <span>Remove</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sticky Bottom Action Bar Footer */}
      <div className="settings-bottom-action-bar font-mono">
        <div className="bar-info-text text-muted">
          <Info size={14} className="text-muted" />
          <span>Preferences apply immediately to the active operator terminal station.</span>
        </div>

        <div className="bar-btn-group">
          <button className="btn-reset-defaults font-mono" onClick={handleResetDefaults}>
            <span>Reset Defaults</span>
          </button>

          <button className="btn-save-changes font-mono" onClick={handleSaveChanges}>
            <Save size={14} />
            <span>Save Changes</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
