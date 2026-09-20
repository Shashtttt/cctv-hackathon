import React, { useState, useEffect, useRef } from 'react';
import {
  ShieldCheck,
  UserCheck,
  Car,
  Shield,
  Upload,
  Trash2,
  Edit2,
  Search,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  PlusCircle,
  Camera,
  X,
  Crosshair,
  VolumeX,
  BadgeAlert,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  fetchFRSWatchlist,
  createFRSSubject,
  updateFRSSubject,
  enrollFRSSubjectPhoto,
  deleteFRSSubject,
  fetchANPRWatchlist,
  createANPRVehicle,
  updateANPRVehicle,
  deleteANPRVehicle
} from '../services/apiService';
import './OfficerRegistryPage.css';

export default function OfficerRegistryPage() {
  const { user } = useAuth();

  // Admin / Commander role verification
  const isAdmin = !user || 
                  user?.role === 'ADMIN' || 
                  user?.role === 'COMMANDER' || 
                  user?.role === 'admin' || 
                  user?.clearance_level === 'TOP_SECRET';

  // Navigation Subtab: 'personnel' | 'vehicles'
  const [activeSubTab, setActiveSubTab] = useState('personnel');

  // Watchlists state
  const [personnelList, setPersonnelList] = useState([]);
  const [vehicleList, setVehicleList] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Toast / feedback message
  const [toast, setToast] = useState(null);

  // Personnel Form State (Add)
  const [personnelForm, setPersonnelForm] = useState({
    name: '',
    alias: '',
    category: 'SENTRY',
    clearance_status: 'AUTHORIZED', // 'AUTHORIZED' | 'UNAUTHORIZED'
    is_weapon_authorized: true,
    notes: '',
  });
  const [personnelPhoto, setPersonnelPhoto] = useState(null);
  const [personnelPreview, setPersonnelPreview] = useState(null);
  const [isSubmittingPersonnel, setIsSubmittingPersonnel] = useState(false);
  const fileInputRef = useRef(null);

  // Vehicle Form State (Add)
  const [vehicleForm, setVehicleForm] = useState({
    plate: '',
    owner: '',
    vehicle_type: 'Tactical 4x4',
    is_weapon_authorized: false,
    notes: '',
  });
  const [isSubmittingVehicle, setIsSubmittingVehicle] = useState(false);

  // Edit Personnel Modal State
  const [editingPersonnel, setEditingPersonnel] = useState(null);
  const [editPersonnelForm, setEditPersonnelForm] = useState({
    name: '',
    alias: '',
    category: 'SENTRY',
    clearance_status: 'AUTHORIZED',
    is_weapon_authorized: true,
    notes: '',
  });
  const [editPersonnelPhoto, setEditPersonnelPhoto] = useState(null);
  const [editPersonnelPreview, setEditPersonnelPreview] = useState(null);
  const [isSavingPersonnelEdit, setIsSavingPersonnelEdit] = useState(false);
  const editFileInputRef = useRef(null);

  // Edit Vehicle Modal State
  const [editingVehicle, setEditingVehicle] = useState(null);
  const [editVehicleForm, setEditVehicleForm] = useState({
    owner: '',
    vehicle_type: 'Tactical 4x4',
    clearance_status: 'AUTHORIZED',
    is_weapon_authorized: false,
    notes: '',
  });
  const [isSavingVehicleEdit, setIsSavingVehicleEdit] = useState(false);

  // Load Watchlists
  const loadData = async () => {
    setIsLoading(true);
    try {
      const [frsData, anprData] = await Promise.all([
        fetchFRSWatchlist(),
        fetchANPRWatchlist(),
      ]);
      setPersonnelList(Array.isArray(frsData) ? frsData : []);
      setVehicleList(Array.isArray(anprData) ? anprData : []);
    } catch (err) {
      showToast('error', 'Failed to synchronize registry databases.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const showToast = (type, message) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 5000);
  };

  // Add Photo change handler
  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setPersonnelPhoto(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPersonnelPreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleClearPhoto = (e) => {
    e.stopPropagation();
    setPersonnelPhoto(null);
    setPersonnelPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Edit Photo change handler
  const handleEditPhotoSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setEditPersonnelPhoto(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setEditPersonnelPreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleClearEditPhoto = (e) => {
    e.stopPropagation();
    setEditPersonnelPhoto(null);
    setEditPersonnelPreview(null);
    if (editFileInputRef.current) editFileInputRef.current.value = '';
  };

  // Submit Personnel (Add)
  const handleCreatePersonnel = async (e) => {
    e.preventDefault();
    if (!personnelForm.name.trim()) {
      showToast('error', 'Personnel full name is required.');
      return;
    }

    setIsSubmittingPersonnel(true);
    const isAuth = personnelForm.clearance_status === 'AUTHORIZED';
    try {
      // 1. Create subject in database
      const payload = {
        name: personnelForm.name.trim(),
        alias: personnelForm.alias.trim() || (isAuth ? 'SENTRY' : 'SUSPECT'),
        category: personnelForm.category,
        threat_level: isAuth ? 'AUTHORIZED' : 'CRITICAL',
        is_weapon_authorized: isAuth ? personnelForm.is_weapon_authorized : false,
        is_authorized: isAuth,
        notes: personnelForm.notes.trim() || (isAuth ? 'Officer enrolled clearance profile' : 'Flagged suspect profile'),
      };

      const newSubject = await createFRSSubject(payload);

      // 2. If photo provided, enroll face embedding via YuNet + SFace
      if (personnelPhoto && newSubject?.id) {
        try {
          await enrollFRSSubjectPhoto(newSubject.id, personnelPhoto);
          showToast('success', `${isAuth ? 'Authorized sentry' : 'Unauthorized suspect'} '${payload.name}' enrolled with YuNet & SFace biometric embedding!`);
        } catch (photoErr) {
          showToast('error', `Subject saved, but facial embedding extraction failed: ${photoErr?.response?.data?.detail || photoErr.message}`);
        }
      } else {
        showToast('success', `${isAuth ? 'Authorized personnel' : 'Unauthorized subject'} '${payload.name}' registered in database.`);
      }

      // Reset form
      setPersonnelForm({
        name: '',
        alias: '',
        category: 'SENTRY',
        clearance_status: 'AUTHORIZED',
        is_weapon_authorized: true,
        notes: '',
      });
      setPersonnelPhoto(null);
      setPersonnelPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';

      await loadData();
    } catch (err) {
      showToast('error', `Failed to enroll personnel: ${err?.response?.data?.detail || err.message}`);
    } finally {
      setIsSubmittingPersonnel(false);
    }
  };

  // Open Edit Personnel Modal
  const handleOpenEditPersonnel = (subj) => {
    setEditingPersonnel(subj);
    const isAuth = subj.is_authorized || subj.threat_level === 'AUTHORIZED';
    setEditPersonnelForm({
      name: subj.name || '',
      alias: subj.alias || '',
      category: subj.category || 'SENTRY',
      clearance_status: isAuth ? 'AUTHORIZED' : 'UNAUTHORIZED',
      is_weapon_authorized: Boolean(subj.is_weapon_authorized),
      notes: subj.notes || '',
    });
    setEditPersonnelPhoto(null);
    setEditPersonnelPreview(subj.avatar_url || null);
  };

  // Save Edit Personnel
  const handleSaveEditPersonnel = async (e) => {
    e.preventDefault();
    if (!editingPersonnel) return;
    if (!editPersonnelForm.name.trim()) {
      showToast('error', 'Personnel name is required.');
      return;
    }

    setIsSavingPersonnelEdit(true);
    const isAuth = editPersonnelForm.clearance_status === 'AUTHORIZED';
    try {
      const payload = {
        name: editPersonnelForm.name.trim(),
        alias: editPersonnelForm.alias.trim() || (isAuth ? 'SENTRY' : 'SUSPECT'),
        category: editPersonnelForm.category,
        threat_level: isAuth ? 'AUTHORIZED' : 'CRITICAL',
        is_weapon_authorized: isAuth ? editPersonnelForm.is_weapon_authorized : false,
        is_authorized: isAuth,
        notes: editPersonnelForm.notes.trim(),
      };

      await updateFRSSubject(editingPersonnel.id, payload);

      // If a new photo was uploaded, re-enroll biometric embedding
      if (editPersonnelPhoto) {
        try {
          await enrollFRSSubjectPhoto(editingPersonnel.id, editPersonnelPhoto);
          showToast('success', `Updated details & new biometric photo for '${payload.name}' enrolled!`);
        } catch (photoErr) {
          showToast('error', `Updated details, but photo embedding extraction failed: ${photoErr?.response?.data?.detail || photoErr.message}`);
        }
      } else {
        showToast('success', `Updated personnel clearance profile for '${payload.name}'.`);
      }

      setEditingPersonnel(null);
      await loadData();
    } catch (err) {
      showToast('error', `Failed to update personnel: ${err?.response?.data?.detail || err.message}`);
    } finally {
      setIsSavingPersonnelEdit(false);
    }
  };

  // Revoke Personnel
  const handleRevokePersonnel = async (id, name) => {
    if (!window.confirm(`Revoke security clearance and remove '${name}' from authorized personnel registry?`)) {
      return;
    }
    try {
      await deleteFRSSubject(id);
      showToast('success', `Clearance revoked for '${name}'. Active pipeline reloaded.`);
      await loadData();
    } catch (err) {
      showToast('error', `Failed to revoke clearance: ${err.message}`);
    }
  };

  // Submit Vehicle (Add)
  const handleCreateVehicle = async (e) => {
    e.preventDefault();
    const cleanPlate = vehicleForm.plate.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (!cleanPlate) {
      showToast('error', 'Valid license plate is required.');
      return;
    }

    setIsSubmittingVehicle(true);
    try {
      const payload = {
        plate: cleanPlate,
        owner: vehicleForm.owner.trim() || 'Border Patrol Unit',
        vehicle_type: vehicleForm.vehicle_type,
        status: 'AUTHORIZED',
        threat_level: 'AUTHORIZED',
        is_weapon_authorized: vehicleForm.is_weapon_authorized,
        is_authorized: true,
        notes: vehicleForm.notes.trim() || 'Authorized Patrol Unit Vehicle',
      };

      await createANPRVehicle(payload);
      showToast('success', `Vehicle plate '${cleanPlate}' registered with AUTHORIZED clearance.`);

      setVehicleForm({
        plate: '',
        owner: '',
        vehicle_type: 'Tactical 4x4',
        is_weapon_authorized: false,
        notes: '',
      });

      await loadData();
    } catch (err) {
      showToast('error', `Failed to register vehicle: ${err?.response?.data?.detail || err.message}`);
    } finally {
      setIsSubmittingVehicle(false);
    }
  };

  // Open Edit Vehicle Modal
  const handleOpenEditVehicle = (veh) => {
    setEditingVehicle(veh);
    const isAuth = veh.is_authorized || veh.status === 'AUTHORIZED' || veh.threat_level === 'AUTHORIZED';
    setEditVehicleForm({
      owner: veh.owner || '',
      vehicle_type: veh.vehicle_type || 'Tactical 4x4',
      clearance_status: isAuth ? 'AUTHORIZED' : 'UNAUTHORIZED',
      is_weapon_authorized: Boolean(veh.is_weapon_authorized),
      notes: veh.notes || '',
    });
  };

  // Save Edit Vehicle
  const handleSaveEditVehicle = async (e) => {
    e.preventDefault();
    if (!editingVehicle) return;

    setIsSavingVehicleEdit(true);
    const isAuth = editVehicleForm.clearance_status === 'AUTHORIZED';
    try {
      const payload = {
        owner: editVehicleForm.owner.trim() || 'Border Patrol Unit',
        vehicle_type: editVehicleForm.vehicle_type,
        status: isAuth ? 'AUTHORIZED' : 'WANTED',
        threat_level: isAuth ? 'AUTHORIZED' : 'CRITICAL',
        is_weapon_authorized: editVehicleForm.is_weapon_authorized,
        is_authorized: isAuth,
        notes: editVehicleForm.notes.trim(),
      };

      await updateANPRVehicle(editingVehicle.plate, payload);
      showToast('success', `Updated vehicle authorization for plate '${editingVehicle.plate}'.`);

      setEditingVehicle(null);
      await loadData();
    } catch (err) {
      showToast('error', `Failed to update vehicle: ${err?.response?.data?.detail || err.message}`);
    } finally {
      setIsSavingVehicleEdit(false);
    }
  };

  // Revoke Vehicle
  const handleRevokeVehicle = async (plate) => {
    if (!window.confirm(`Revoke authorization for vehicle plate '${plate}'? Unregistered plate will trigger critical ANPR alerts.`)) {
      return;
    }
    try {
      await deleteANPRVehicle(plate);
      showToast('success', `Vehicle plate '${plate}' removed from authorized registry.`);
      await loadData();
    } catch (err) {
      showToast('error', `Failed to revoke vehicle: ${err.message}`);
    }
  };

  // Metrics
  const totalAuthorizedPersons = personnelList.filter(p => p.is_authorized || p.threat_level === 'AUTHORIZED').length;
  const activeArmedSentries = personnelList.filter(p => (p.is_authorized || p.threat_level === 'AUTHORIZED') && p.is_weapon_authorized).length;
  const totalAuthorizedVehicles = vehicleList.filter(v => v.is_authorized || v.status === 'AUTHORIZED' || v.threat_level === 'AUTHORIZED').length;

  // Filtered Lists
  const filteredPersonnel = personnelList.filter(p => {
    const q = searchTerm.toLowerCase();
    return (
      (p.name || '').toLowerCase().includes(q) ||
      (p.alias || '').toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q) ||
      (p.notes || '').toLowerCase().includes(q)
    );
  });

  const filteredVehicles = vehicleList.filter(v => {
    const q = searchTerm.toLowerCase();
    return (
      (v.plate || '').toLowerCase().includes(q) ||
      (v.owner || '').toLowerCase().includes(q) ||
      (v.vehicle_type || '').toLowerCase().includes(q)
    );
  });

  const officerName = user?.full_name || user?.username || 'Commander S. Rawat';
  const officerBadge = user?.badge_number || 'BSF-TACTICAL-CMD-09';
  const officerRole = user?.role ? user.role.toUpperCase() : 'SECTOR COMMANDER';

  return (
    <div className="registry-page-container">
      {/* Top Header Row */}
      <div className="registry-header-row">
        <div className="registry-title-group">
          <div className="registry-header-icon">
            <ShieldCheck size={26} />
          </div>
          <div className="registry-title-text">
            <h2>Admin Officer Clearance Registry</h2>
            <div className="registry-sub-text">
              Configure authorized personnel biometric profiles, weapon carry permits, and authorized patrol vehicles.
            </div>
          </div>
        </div>

        <button className="registry-tab-btn" onClick={loadData} title="Reload Active AI Watchlists">
          <RefreshCw size={15} className={isLoading ? 'spin' : ''} />
          <span>Sync Watchlists</span>
        </button>
      </div>

      {/* Officer Clearance Status Banner */}
      <div className="officer-clearance-banner">
        <div className="officer-profile-left">
          <div className="officer-avatar-box">
            {officerName.slice(0, 2).toUpperCase()}
          </div>
          <div className="officer-details-meta">
            <div className="officer-name-row">
              <span className="officer-name-title">{officerName}</span>
              <span className="officer-badge-pill">{officerBadge}</span>
            </div>
            <div className="officer-role-dept">
              CLEARANCE AUTHORITY: {officerRole} &bull; NORTH PERIMETER COMMAND
            </div>
          </div>
        </div>

        <div className="clearance-status-right">
          <div className="clearance-level-indicator">
            <div className="clearance-lvl-tag">
              <span className="pulse-dot-green"></span>
              CLEARANCE LEVEL: TOP SECRET / DEFCON 1
            </div>
            <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
              Armed Sentry Override & Weapon Permit Control: {isAdmin ? 'ADMIN ACCESS ENABLED' : 'READ-ONLY ACCESS'}
            </span>
          </div>
        </div>
      </div>

      {/* Feedback Toast */}
      {toast && (
        <div className={`registry-toast ${toast.type}`}>
          {toast.type === 'success' ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Registry Metrics Row */}
      <div className="registry-metrics-row">
        <div className="metric-tactical-card">
          <div className="metric-icon-wrap" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>
            <UserCheck size={22} />
          </div>
          <div className="metric-info-col">
            <span className="metric-val-num">{totalAuthorizedPersons}</span>
            <span className="metric-label-txt">Authorized Personnel</span>
          </div>
        </div>

        <div className="metric-tactical-card">
          <div className="metric-icon-wrap" style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b' }}>
            <Crosshair size={22} />
          </div>
          <div className="metric-info-col">
            <span className="metric-val-num">{activeArmedSentries}</span>
            <span className="metric-label-txt">Armed Sentry Clearances</span>
          </div>
        </div>

        <div className="metric-tactical-card">
          <div className="metric-icon-wrap" style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}>
            <Car size={22} />
          </div>
          <div className="metric-info-col">
            <span className="metric-val-num">{totalAuthorizedVehicles}</span>
            <span className="metric-label-txt">Authorized Vehicles (ANPR)</span>
          </div>
        </div>

        <div className="metric-tactical-card">
          <div className="metric-icon-wrap" style={{ background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6' }}>
            <ShieldCheck size={22} />
          </div>
          <div className="metric-info-col">
            <span className="metric-val-num">Active</span>
            <span className="metric-label-txt">YuNet & SFace Engine</span>
          </div>
        </div>
      </div>

      {/* Sub-Tabs: Personnel vs Vehicles */}
      <div className="registry-tabs-bar">
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className={`registry-tab-btn ${activeSubTab === 'personnel' ? 'active' : ''}`}
            onClick={() => { setActiveSubTab('personnel'); setSearchTerm(''); }}
          >
            <UserCheck size={16} />
            <span>Authorized Personnel</span>
            <span className="tab-count-badge">{personnelList.length}</span>
          </button>

          <button
            className={`registry-tab-btn ${activeSubTab === 'vehicles' ? 'active' : ''}`}
            onClick={() => { setActiveSubTab('vehicles'); setSearchTerm(''); }}
          >
            <Car size={16} />
            <span>Authorized Patrol Vehicles</span>
            <span className="tab-count-badge">{vehicleList.length}</span>
          </button>
        </div>

        <input
          type="text"
          className="table-search-input"
          placeholder={activeSubTab === 'personnel' ? 'Search personnel name, call-sign...' : 'Search plate number, unit...'}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* TAB 1: AUTHORIZED PERSONNEL */}
      {activeSubTab === 'personnel' && (
        <div className="registry-content-split">
          {/* Form Card: Admin Enrollment or Non-admin lock */}
          <div className="enrollment-form-card">
            {isAdmin ? (
              <>
                <div className="form-header-title">
                  <PlusCircle size={18} color="#10b981" />
                  <span>Enroll Authorized Personnel</span>
                </div>

                <form onSubmit={handleCreatePersonnel} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div className="form-group">
                    <label className="form-label">Full Name *</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g., Havaldar Rajesh Kumar"
                      value={personnelForm.name}
                      onChange={(e) => setPersonnelForm({ ...personnelForm, name: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Call-sign / Badge ID</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g., SENTRY-NORTH-04"
                      value={personnelForm.alias}
                      onChange={(e) => setPersonnelForm({ ...personnelForm, alias: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Security Clearance Status *</label>
                    <select
                      className="form-select"
                      value={personnelForm.clearance_status}
                      onChange={(e) => {
                        const status = e.target.value;
                        setPersonnelForm({
                          ...personnelForm,
                          clearance_status: status,
                          category: status === 'AUTHORIZED' ? 'SENTRY' : 'SUSPECT',
                          is_weapon_authorized: status === 'AUTHORIZED' ? personnelForm.is_weapon_authorized : false,
                        });
                      }}
                    >
                      <option value="AUTHORIZED">🛡️ AUTHORIZED PERSONNEL (Clearance Permitted)</option>
                      <option value="UNAUTHORIZED">🚨 UNAUTHORIZED / SUSPECT (Watchlist Hostile Target)</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Category / Operational Role</label>
                    <select
                      className="form-select"
                      value={personnelForm.category}
                      onChange={(e) => setPersonnelForm({ ...personnelForm, category: e.target.value })}
                    >
                      {personnelForm.clearance_status === 'AUTHORIZED' ? (
                        <>
                          <option value="SENTRY">Perimeter Armed Sentry</option>
                          <option value="SECURITY_OFFICER">Security Officer</option>
                          <option value="PATROL_LEAD">Patrol Unit Lead</option>
                          <option value="AUTHORIZED_PERSONNEL">Base Authorized Personnel</option>
                        </>
                      ) : (
                        <>
                          <option value="SUSPECT">Suspect Target</option>
                          <option value="HIGH_VALUE_TARGET">High-Value Target</option>
                          <option value="INTRUDER">Perimeter Intruder</option>
                          <option value="PERSON_OF_INTEREST">Person of Interest</option>
                        </>
                      )}
                    </select>
                  </div>

                  {/* Weapon Clearance Checkbox */}
                  {personnelForm.clearance_status === 'AUTHORIZED' && (
                    <label className="form-checkbox-row">
                      <input
                        type="checkbox"
                        checked={personnelForm.is_weapon_authorized}
                        onChange={(e) => setPersonnelForm({ ...personnelForm, is_weapon_authorized: e.target.checked })}
                      />
                      <div className="checkbox-text-group">
                        <span className="checkbox-label-main">🛡️ Duty Weapon Clearance Permit</span>
                        <span className="checkbox-sub-label">
                          Allows personnel to carry firearms on duty. Tagged in emerald green [AUTH SENTRY: ... - ARMED] with no hostile alarm.
                        </span>
                      </div>
                    </label>
                  )}

                  {/* Face Photo Upload for YuNet + SFace */}
                  <div className="form-group">
                    <label className="form-label">
                      <span>Facial Biometric Photo</span>
                      <span style={{ fontSize: '0.72rem', color: '#10b981' }}>YuNet + SFace</span>
                    </label>

                    <input
                      type="file"
                      accept="image/*"
                      ref={fileInputRef}
                      onChange={handlePhotoSelect}
                      style={{ display: 'none' }}
                    />

                    <div
                      className="photo-upload-container"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {personnelPreview ? (
                        <div style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}>
                          <img
                            src={personnelPreview}
                            alt="Preview"
                            className="photo-preview-image"
                          />
                          <button
                            type="button"
                            onClick={handleClearPhoto}
                            style={{
                              position: 'absolute',
                              top: 4,
                              right: 12,
                              background: 'rgba(239, 68, 68, 0.85)',
                              border: 'none',
                              color: '#fff',
                              borderRadius: '50%',
                              width: 24,
                              height: 24,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                            title="Remove photo"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <>
                          <Camera size={26} color="#94a3b8" />
                          <div className="upload-prompt-text">
                            Click or drag photo for instant AI facial embedding
                          </div>
                          <div className="upload-prompt-hint">
                            High-resolution front portrait recommended
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Clearance Notes</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g., Gate 4 sentry post assignment"
                      value={personnelForm.notes}
                      onChange={(e) => setPersonnelForm({ ...personnelForm, notes: e.target.value })}
                    />
                  </div>

                  <button
                    type="submit"
                    className="form-submit-btn"
                    disabled={isSubmittingPersonnel}
                  >
                    {isSubmittingPersonnel ? (
                      <>
                        <RefreshCw size={16} className="spin" />
                        <span>Extracting Embeddings...</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck size={16} />
                        <span>Enroll Sentry Clearance</span>
                      </>
                    )}
                  </button>
                </form>
              </>
            ) : (
              <div className="admin-access-lock">
                <ShieldAlert size={36} color="#f59e0b" />
                <h4>COMMANDER CLEARANCE REQUIRED</h4>
                <p>Operator accounts have read-only access. Log in as Sector Commander or Administrator to enroll, modify, or revoke authorized personnel.</p>
              </div>
            )}
          </div>

          {/* Personnel Table Card */}
          <div className="registry-table-card">
            <div className="table-header-bar">
              <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                Enrolled Personnel Database ({filteredPersonnel.length})
              </span>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="custom-tactical-table">
                <thead>
                  <tr>
                    <th>Personnel</th>
                    <th>Role / Category</th>
                    <th>Clearance</th>
                    <th>Weapon Permit</th>
                    <th>Biometric Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPersonnel.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <div className="empty-registry-state">
                          <UserCheck size={32} />
                          <span>No authorized personnel enrolled yet. Add an officer above.</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredPersonnel.map((subj) => (
                      <tr key={subj.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div style={{
                              width: 36,
                              height: 36,
                              borderRadius: '50%',
                              background: '#1e293b',
                              border: '1px solid #10b981',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 700,
                              fontSize: '0.85rem',
                              color: '#10b981',
                              overflow: 'hidden',
                              flexShrink: 0
                            }}>
                              {subj.avatar_url ? (
                                <img src={subj.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              ) : (
                                (subj.name || 'P').slice(0, 2).toUpperCase()
                              )}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span style={{ fontWeight: 700, color: '#f8fafc' }}>{subj.name}</span>
                              <span style={{ fontSize: '0.74rem', color: '#94a3b8' }}>{subj.alias || 'SENTRY'}</span>
                            </div>
                          </div>
                        </td>

                        <td>
                          <span className="badge-role">
                            {subj.category ? subj.category.replace('_', ' ') : 'AUTHORIZED'}
                          </span>
                        </td>

                        <td>
                          <span className={subj.is_authorized || subj.threat_level === 'AUTHORIZED' ? 'badge-clearance-auth' : 'badge-clearance-unauth'}>
                            {subj.is_authorized || subj.threat_level === 'AUTHORIZED' ? '🛡️ AUTHORIZED' : '⚠️ WATCHLIST'}
                          </span>
                        </td>

                        <td>
                          {subj.is_weapon_authorized ? (
                            <span className="badge-weapon-armed">
                              🛡️ ARMED CLEARANCE
                            </span>
                          ) : (
                            <span className="badge-weapon-none">
                              UNARMED
                            </span>
                          )}
                        </td>

                        <td>
                          <span style={{
                            fontSize: '0.74rem',
                            color: subj.has_embedding ? '#10b981' : '#64748b',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4
                          }}>
                            {subj.has_embedding ? '✓ SFace Enrolled' : 'No Embedding'}
                          </span>
                        </td>

                        <td>
                          {isAdmin ? (
                            <div className="action-cell-btns">
                              <button
                                className="btn-edit"
                                onClick={() => handleOpenEditPersonnel(subj)}
                                title="Edit personnel details"
                              >
                                <Edit2 size={13} />
                                <span>Edit</span>
                              </button>
                              <button
                                className="btn-revoke"
                                onClick={() => handleRevokePersonnel(subj.id, subj.name)}
                                title="Revoke clearance"
                              >
                                <Trash2 size={13} />
                                <span>Revoke</span>
                              </button>
                            </div>
                          ) : (
                            <span className="badge-weapon-none">Read Only</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: AUTHORIZED VEHICLES */}
      {activeSubTab === 'vehicles' && (
        <div className="registry-content-split">
          {/* Vehicle Form Card: Admin Registration or Non-admin lock */}
          <div className="enrollment-form-card">
            {isAdmin ? (
              <>
                <div className="form-header-title">
                  <PlusCircle size={18} color="#10b981" />
                  <span>Register Authorized Vehicle</span>
                </div>

                <form onSubmit={handleCreateVehicle} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div className="form-group">
                    <label className="form-label">License Plate Number *</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g., HR26AB1234 or DL01XY9999"
                      value={vehicleForm.plate}
                      onChange={(e) => setVehicleForm({ ...vehicleForm, plate: e.target.value.toUpperCase() })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Assigned Unit / Owner</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g., Sector 4 Patrol Lead / QRF-01"
                      value={vehicleForm.owner}
                      onChange={(e) => setVehicleForm({ ...vehicleForm, owner: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Vehicle Type</label>
                    <select
                      className="form-select"
                      value={vehicleForm.vehicle_type}
                      onChange={(e) => setVehicleForm({ ...vehicleForm, vehicle_type: e.target.value })}
                    >
                      <option value="Tactical 4x4">Tactical 4x4 Patrol</option>
                      <option value="Armored Carrier">Armored Carrier</option>
                      <option value="Patrol SUV">Patrol SUV</option>
                      <option value="Quick Reaction Truck">Quick Reaction Truck</option>
                      <option value="Command Sedan">Command Sedan</option>
                    </select>
                  </div>

                  {/* Weapon Clearance Checkbox */}
                  <label className="form-checkbox-row">
                    <input
                      type="checkbox"
                      checked={vehicleForm.is_weapon_authorized}
                      onChange={(e) => setVehicleForm({ ...vehicleForm, is_weapon_authorized: e.target.checked })}
                    />
                    <div className="checkbox-text-group">
                      <span className="checkbox-label-main">🚗 Armed Escort Vehicle</span>
                      <span className="checkbox-sub-label">
                        Mark vehicle as carrying an authorized security detachment with weapon clearance.
                      </span>
                    </div>
                  </label>

                  <div className="form-group">
                    <label className="form-label">Deployment Notes</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g., Authorized for North Ridge Patrol"
                      value={vehicleForm.notes}
                      onChange={(e) => setVehicleForm({ ...vehicleForm, notes: e.target.value })}
                    />
                  </div>

                  <button
                    type="submit"
                    className="form-submit-btn"
                    disabled={isSubmittingVehicle}
                  >
                    {isSubmittingVehicle ? (
                      <>
                        <RefreshCw size={16} className="spin" />
                        <span>Registering Plate...</span>
                      </>
                    ) : (
                      <>
                        <Car size={16} />
                        <span>Authorize Vehicle Plate</span>
                      </>
                    )}
                  </button>
                </form>
              </>
            ) : (
              <div className="admin-access-lock">
                <ShieldAlert size={36} color="#f59e0b" />
                <h4>COMMANDER CLEARANCE REQUIRED</h4>
                <p>Operator accounts have read-only access. Log in as Sector Commander or Administrator to register, edit, or revoke vehicle authorizations.</p>
              </div>
            )}
          </div>

          {/* Vehicle Table Card */}
          <div className="registry-table-card">
            <div className="table-header-bar">
              <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                Authorized Vehicles Whitelist ({filteredVehicles.length})
              </span>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="custom-tactical-table">
                <thead>
                  <tr>
                    <th>License Plate</th>
                    <th>Assigned Unit / Owner</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Armed Escort</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVehicles.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <div className="empty-registry-state">
                          <Car size={32} />
                          <span>No registered vehicles in database yet. Add a vehicle above.</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredVehicles.map((v) => (
                      <tr key={v.plate}>
                        <td>
                          <span style={{
                            fontFamily: 'monospace',
                            fontWeight: 800,
                            letterSpacing: '0.08em',
                            fontSize: '0.92rem',
                            color: '#10b981',
                            background: '#0b1329',
                            padding: '4px 10px',
                            borderRadius: '4px',
                            border: '1px solid rgba(16, 185, 129, 0.4)'
                          }}>
                            {v.plate}
                          </span>
                        </td>

                        <td>
                          <span style={{ fontWeight: 600, color: '#f8fafc' }}>{v.owner || 'Patrol Unit'}</span>
                        </td>

                        <td>
                          <span className="badge-role">{v.vehicle_type || 'Patrol Vehicle'}</span>
                        </td>

                        <td>
                          <span className={v.is_authorized || v.status === 'AUTHORIZED' ? 'badge-clearance-auth' : 'badge-clearance-unauth'}>
                            {v.is_authorized || v.status === 'AUTHORIZED' ? '🚗 AUTHORIZED' : '⚠️ BLACKLISTED'}
                          </span>
                        </td>

                        <td>
                          {v.is_weapon_authorized ? (
                            <span className="badge-weapon-armed">ARMED ESCORT</span>
                          ) : (
                            <span className="badge-weapon-none">STANDARD</span>
                          )}
                        </td>

                        <td>
                          {isAdmin ? (
                            <div className="action-cell-btns">
                              <button
                                className="btn-edit"
                                onClick={() => handleOpenEditVehicle(v)}
                                title="Edit vehicle details"
                              >
                                <Edit2 size={13} />
                                <span>Edit</span>
                              </button>
                              <button
                                className="btn-revoke"
                                onClick={() => handleRevokeVehicle(v.plate)}
                                title="Revoke vehicle authorization"
                              >
                                <Trash2 size={13} />
                                <span>Revoke</span>
                              </button>
                            </div>
                          ) : (
                            <span className="badge-weapon-none">Read Only</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* EDIT PERSONNEL MODAL */}
      {editingPersonnel && (
        <div className="edit-modal-backdrop" onClick={() => setEditingPersonnel(null)}>
          <div className="edit-modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="edit-modal-header">
              <h3>
                <Edit2 size={18} color="#60a5fa" />
                <span>Edit Personnel Clearance: {editingPersonnel.name}</span>
              </h3>
              <button
                className="edit-modal-close-btn"
                onClick={() => setEditingPersonnel(null)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveEditPersonnel}>
              <div className="edit-modal-body">
                <div className="form-group">
                  <label className="form-label">Full Name *</label>
                  <input
                    type="text"
                    className="form-input"
                    value={editPersonnelForm.name}
                    onChange={(e) => setEditPersonnelForm({ ...editPersonnelForm, name: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Call-sign / Badge ID</label>
                  <input
                    type="text"
                    className="form-input"
                    value={editPersonnelForm.alias}
                    onChange={(e) => setEditPersonnelForm({ ...editPersonnelForm, alias: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Security Clearance Status</label>
                  <select
                    className="form-select"
                    value={editPersonnelForm.clearance_status}
                    onChange={(e) => {
                      const status = e.target.value;
                      setEditPersonnelForm({
                        ...editPersonnelForm,
                        clearance_status: status,
                        category: status === 'AUTHORIZED' ? 'SENTRY' : 'SUSPECT',
                        is_weapon_authorized: status === 'AUTHORIZED' ? editPersonnelForm.is_weapon_authorized : false,
                      });
                    }}
                  >
                    <option value="AUTHORIZED">🛡️ AUTHORIZED PERSONNEL (Clearance Permitted)</option>
                    <option value="UNAUTHORIZED">🚨 UNAUTHORIZED / SUSPECT (Watchlist Hostile Target)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Category / Operational Role</label>
                  <select
                    className="form-select"
                    value={editPersonnelForm.category}
                    onChange={(e) => setEditPersonnelForm({ ...editPersonnelForm, category: e.target.value })}
                  >
                    {editPersonnelForm.clearance_status === 'AUTHORIZED' ? (
                      <>
                        <option value="SENTRY">Perimeter Armed Sentry</option>
                        <option value="SECURITY_OFFICER">Security Officer</option>
                        <option value="PATROL_LEAD">Patrol Unit Lead</option>
                        <option value="AUTHORIZED_PERSONNEL">Base Authorized Personnel</option>
                      </>
                    ) : (
                      <>
                        <option value="SUSPECT">Suspect Target</option>
                        <option value="HIGH_VALUE_TARGET">High-Value Target</option>
                        <option value="INTRUDER">Perimeter Intruder</option>
                        <option value="PERSON_OF_INTEREST">Person of Interest</option>
                      </>
                    )}
                  </select>
                </div>

                {editPersonnelForm.clearance_status === 'AUTHORIZED' && (
                  <label className="form-checkbox-row">
                    <input
                      type="checkbox"
                      checked={editPersonnelForm.is_weapon_authorized}
                      onChange={(e) => setEditPersonnelForm({ ...editPersonnelForm, is_weapon_authorized: e.target.checked })}
                    />
                    <div className="checkbox-text-group">
                      <span className="checkbox-label-main">🛡️ Duty Weapon Clearance Permit</span>
                      <span className="checkbox-sub-label">Allows personnel to carry firearms without triggering hostile alerts.</span>
                    </div>
                  </label>
                )}

                {/* Facial Biometric Photo Re-enrollment */}
                <div className="form-group">
                  <label className="form-label">
                    <span>Update Facial Photo (YuNet + SFace)</span>
                    <span style={{ fontSize: '0.72rem', color: '#10b981' }}>Optional</span>
                  </label>

                  <input
                    type="file"
                    accept="image/*"
                    ref={editFileInputRef}
                    onChange={handleEditPhotoSelect}
                    style={{ display: 'none' }}
                  />

                  <div
                    className="photo-upload-container"
                    onClick={() => editFileInputRef.current?.click()}
                  >
                    {editPersonnelPreview ? (
                      <div style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}>
                        <img
                          src={editPersonnelPreview}
                          alt="Preview"
                          className="photo-preview-image"
                        />
                        <button
                          type="button"
                          onClick={handleClearEditPhoto}
                          style={{
                            position: 'absolute',
                            top: 4,
                            right: 12,
                            background: 'rgba(239, 68, 68, 0.85)',
                            border: 'none',
                            color: '#fff',
                            borderRadius: '50%',
                            width: 24,
                            height: 24,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                          title="Remove photo"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <Camera size={26} color="#94a3b8" />
                        <div className="upload-prompt-text">
                          Click to upload new portrait to re-extract face embedding
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Clearance Notes</label>
                  <input
                    type="text"
                    className="form-input"
                    value={editPersonnelForm.notes}
                    onChange={(e) => setEditPersonnelForm({ ...editPersonnelForm, notes: e.target.value })}
                  />
                </div>
              </div>

              <div className="edit-modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setEditingPersonnel(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="form-submit-btn"
                  style={{ width: 'auto', padding: '8px 20px' }}
                  disabled={isSavingPersonnelEdit}
                >
                  {isSavingPersonnelEdit ? (
                    <>
                      <RefreshCw size={15} className="spin" />
                      <span>Saving Changes...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck size={15} />
                      <span>Save Changes</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT VEHICLE MODAL */}
      {editingVehicle && (
        <div className="edit-modal-backdrop" onClick={() => setEditingVehicle(null)}>
          <div className="edit-modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="edit-modal-header">
              <h3>
                <Edit2 size={18} color="#60a5fa" />
                <span>Edit Vehicle Authorization: {editingVehicle.plate}</span>
              </h3>
              <button
                className="edit-modal-close-btn"
                onClick={() => setEditingVehicle(null)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveEditVehicle}>
              <div className="edit-modal-body">
                <div className="form-group">
                  <label className="form-label">License Plate (Immutable Key)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={editingVehicle.plate}
                    disabled
                    style={{ opacity: 0.7, cursor: 'not-allowed', letterSpacing: '0.08em', fontWeight: 700 }}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Assigned Unit / Owner</label>
                  <input
                    type="text"
                    className="form-input"
                    value={editVehicleForm.owner}
                    onChange={(e) => setEditVehicleForm({ ...editVehicleForm, owner: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Vehicle Type</label>
                  <select
                    className="form-select"
                    value={editVehicleForm.vehicle_type}
                    onChange={(e) => setEditVehicleForm({ ...editVehicleForm, vehicle_type: e.target.value })}
                  >
                    <option value="Tactical 4x4">Tactical 4x4 Patrol</option>
                    <option value="Armored Carrier">Armored Carrier</option>
                    <option value="Patrol SUV">Patrol SUV</option>
                    <option value="Quick Reaction Truck">Quick Reaction Truck</option>
                    <option value="Command Sedan">Command Sedan</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Clearance Status</label>
                  <select
                    className="form-select"
                    value={editVehicleForm.clearance_status}
                    onChange={(e) => setEditVehicleForm({ ...editVehicleForm, clearance_status: e.target.value })}
                  >
                    <option value="AUTHORIZED">🚗 AUTHORIZED (Cleared for sector movement)</option>
                    <option value="UNAUTHORIZED">⚠️ BLACKLISTED / WANTED (Trigger ANPR Alarm)</option>
                  </select>
                </div>

                <label className="form-checkbox-row">
                  <input
                    type="checkbox"
                    checked={editVehicleForm.is_weapon_authorized}
                    onChange={(e) => setEditVehicleForm({ ...editVehicleForm, is_weapon_authorized: e.target.checked })}
                  />
                  <div className="checkbox-text-group">
                    <span className="checkbox-label-main">🚗 Armed Escort Clearance</span>
                    <span className="checkbox-sub-label">Vehicle carries authorized security personnel with firearms.</span>
                  </div>
                </label>

                <div className="form-group">
                  <label className="form-label">Deployment Notes</label>
                  <input
                    type="text"
                    className="form-input"
                    value={editVehicleForm.notes}
                    onChange={(e) => setEditVehicleForm({ ...editVehicleForm, notes: e.target.value })}
                  />
                </div>
              </div>

              <div className="edit-modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setEditingVehicle(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="form-submit-btn"
                  style={{ width: 'auto', padding: '8px 20px' }}
                  disabled={isSavingVehicleEdit}
                >
                  {isSavingVehicleEdit ? (
                    <>
                      <RefreshCw size={15} className="spin" />
                      <span>Saving Changes...</span>
                    </>
                  ) : (
                    <>
                      <Car size={15} />
                      <span>Save Changes</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
