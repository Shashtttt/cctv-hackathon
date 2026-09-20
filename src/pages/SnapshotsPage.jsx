import React, { useState, useEffect, useMemo } from 'react';
import { 
  Images, 
  Trash2, 
  Download, 
  Search, 
  Filter, 
  CheckSquare, 
  Square, 
  AlertTriangle, 
  ShieldAlert, 
  Eye, 
  RefreshCw, 
  LayoutGrid, 
  List, 
  Lock, 
  ShieldCheck, 
  HardDrive, 
  FileText, 
  X, 
  CheckCircle2, 
  Clock, 
  Camera, 
  Flame, 
  UserX, 
  Truck,
  Maximize2
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { fetchSnapshots, deleteSnapshot, bulkDeleteSnapshots } from '../services/apiService';
import { subscribeToCloudSnapshots } from '../services/firestoreService';
import { useWebSocket } from '../services/useWebSocket';
import './SnapshotsPage.css';

const SnapshotsPage = () => {
  const { user, isAdmin, demoLogin } = useAuth();

  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'table'
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [cameraFilter, setCameraFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [inspectModalItem, setInspectModalItem] = useState(null);
  const [deleteConfirmItem, setDeleteConfirmItem] = useState(null); // single or 'bulk'
  const [isDeleting, setIsDeleting] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);
  const [storageStats, setStorageStats] = useState({
    total: 0,
    totalSizeBytes: 0,
    totalSizeFormatted: '0 B',
  });

  const showToast = (msg, type = 'success') => {
    setToastMessage({ text: msg, type });
    setTimeout(() => {
      setToastMessage((prev) => (prev?.text === msg ? null : prev));
    }, 4500);
  };

  const { alerts: wsAlerts } = useWebSocket();
  const latestAlert = wsAlerts && wsAlerts.length > 0 ? wsAlerts[0] : null;

  const loadSnapshots = async () => {
    setLoading(true);
    try {
      const data = await fetchSnapshots(250, categoryFilter);
      if (data && Array.isArray(data.snapshots)) {
        setSnapshots((prev) => {
          // Merge fetched backend snapshots with any existing live cloud snapshots
          const map = new Map();
          data.snapshots.forEach((s) => map.set(s.id, s));
          prev.forEach((s) => {
            if (!map.has(s.id)) map.set(s.id, s);
          });
          const merged = Array.from(map.values());
          merged.sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime());
          return merged;
        });
        setStorageStats({
          total: data.total || data.snapshots.length,
          totalSizeBytes: data.total_size_bytes || 0,
          totalSizeFormatted: data.total_size_formatted || '0 KB',
        });
      }
    } catch (err) {
      console.error('Error fetching snapshots:', err);
      showToast('Failed to connect to snapshot vault server', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      loadSnapshots();
    }

    // Real-time Cloud Firestore subscription for live weapon snapshots
    const unsubscribeCloud = subscribeToCloudSnapshots((cloudSnaps) => {
      if (Array.isArray(cloudSnaps) && cloudSnaps.length > 0) {
        setSnapshots((prev) => {
          const map = new Map();
          // Put new cloud snapshots first
          cloudSnaps.forEach((s) => map.set(s.id, s));
          // Keep existing backend snapshots
          prev.forEach((s) => {
            if (!map.has(s.id)) map.set(s.id, s);
          });
          const merged = Array.from(map.values());
          merged.sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime());
          return merged;
        });
      }
    });

    return () => {
      if (unsubscribeCloud) unsubscribeCloud();
    };
  }, [isAdmin, categoryFilter]);

  // Live WebSocket push listener: immediately prepend weapon detection snapshots
  useEffect(() => {
    if (!latestAlert) return;
    const cat = (latestAlert.category || latestAlert.type || '').toUpperCase();
    const isWeapon = cat.includes('WEAPON') || (latestAlert.title || '').toUpperCase().includes('WEAPON');
    const imgData = latestAlert.snapshot_base64 || latestAlert.snapshot_url;

    if (isWeapon && imgData) {
      const snapId = latestAlert.id;
      setSnapshots((prev) => {
        if (prev.some((s) => s.id === snapId || s.alert_id === snapId)) return prev;
        const newSnap = {
          id: snapId,
          alert_id: snapId,
          filename: `live_weapon_${snapId}.jpg`,
          url: imgData,
          snapshot_base64: latestAlert.snapshot_base64,
          camera_id: latestAlert.camera || 'CAM-01',
          category: 'WEAPON',
          captured_at: latestAlert.timestamp || new Date().toISOString(),
          file_size_formatted: '48.5 KB',
        };
        return [newSnap, ...prev];
      });
    }
  }, [latestAlert]);

  // Filtered and searched snapshot list
  const filteredSnapshots = useMemo(() => {
    return snapshots.filter((item) => {
      // Category filter
      if (categoryFilter !== 'ALL' && item.category !== categoryFilter) {
        return false;
      }
      // Camera filter
      if (cameraFilter !== 'ALL') {
        const itemCam = (item.camera_id || '').toUpperCase();
        if (!itemCam.includes(cameraFilter.toUpperCase())) {
          return false;
        }
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = (item.filename || '').toLowerCase().includes(q);
        const matchAlert = (item.alert_id || '').toLowerCase().includes(q);
        const matchCam = (item.camera_id || '').toLowerCase().includes(q);
        const matchCat = (item.category || '').toLowerCase().includes(q);
        if (!matchName && !matchAlert && !matchCam && !matchCat) {
          return false;
        }
      }
      return true;
    });
  }, [snapshots, categoryFilter, cameraFilter, searchQuery]);

  // Threat category metric counts
  const categoryCounts = useMemo(() => {
    const counts = { ALL: snapshots.length, WEAPON: 0, PERSON: 0, VEHICLE: 0, INTRUSION: 0 };
    snapshots.forEach((s) => {
      const cat = s.category || 'SURVEILLANCE';
      if (counts[cat] !== undefined) {
        counts[cat]++;
      }
    });
    return counts;
  }, [snapshots]);

  // Selection handlers
  const handleToggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === filteredSnapshots.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredSnapshots.map((s) => s.id)));
    }
  };

  // Single deletion
  const handleConfirmSingleDelete = async () => {
    if (!deleteConfirmItem || deleteConfirmItem === 'bulk') return;
    setIsDeleting(true);
    try {
      const targetId = deleteConfirmItem.relative_path || deleteConfirmItem.filename || deleteConfirmItem.id;
      await deleteSnapshot(targetId);
      setSnapshots((prev) => prev.filter((s) => s.id !== deleteConfirmItem.id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(deleteConfirmItem.id);
        return next;
      });
      if (inspectModalItem?.id === deleteConfirmItem.id) {
        setInspectModalItem(null);
      }
      showToast(`Snapshot '${deleteConfirmItem.filename}' permanently purged.`);
    } catch (err) {
      console.error('Delete error:', err);
      showToast('Failed to delete snapshot from disk', 'error');
    } finally {
      setIsDeleting(false);
      setDeleteConfirmItem(null);
    }
  };

  // Bulk deletion
  const handleConfirmBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setIsDeleting(true);
    try {
      const idsToDelete = Array.from(selectedIds);
      const targetPaths = snapshots
        .filter((s) => selectedIds.has(s.id))
        .map((s) => s.relative_path || s.filename || s.id);

      await bulkDeleteSnapshots(targetPaths);
      setSnapshots((prev) => prev.filter((s) => !selectedIds.has(s.id)));
      setSelectedIds(new Set());
      if (inspectModalItem && selectedIds.has(inspectModalItem.id)) {
        setInspectModalItem(null);
      }
      showToast(`Successfully purged ${idsToDelete.length} snapshot files.`);
    } catch (err) {
      console.error('Bulk delete error:', err);
      showToast('Failed to purge selected snapshots', 'error');
    } finally {
      setIsDeleting(false);
      setDeleteConfirmItem(null);
    }
  };

  // Direct download
  const handleDownload = (item, e) => {
    if (e) e.stopPropagation();
    const link = document.createElement('a');
    link.href = item.url;
    link.download = item.filename || `snapshot_${item.id}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Non-Admin Restricted Access Screen
  if (!isAdmin) {
    return (
      <div className="snapshots-restricted-container font-mono">
        <div className="restricted-card">
          <div className="restricted-icon-box">
            <Lock size={36} className="text-red animate-pulse" />
          </div>
          <h2 className="restricted-title">LEVEL 5 ACCESS RESTRICTED</h2>
          <div className="restricted-badge">CLASSIFIED BIOMETRIC ARCHIVE</div>
          <p className="restricted-desc">
            The Evidence Snapshots Vault contains restricted biometric telemetry and evidentiary records. 
            Access and deletion authority is strictly confined to <strong>Commanders</strong> and <strong>System Administrators</strong>.
          </p>
          <div className="current-user-info">
            <span>ACTIVE CALLSIGN: {user?.username || 'UNKNOWN'}</span>
            <span>CURRENT ROLE: {user?.role || 'OPERATOR'} (INSUFFICIENT CLEARANCE)</span>
          </div>
          <div className="restricted-actions">
            <button 
              onClick={() => demoLogin('ADMIN')}
              className="elevate-btn font-mono"
            >
              <ShieldCheck size={16} />
              <span>ELEVATE TO SYSTEM ADMINISTRATOR</span>
            </button>
            <button 
              onClick={() => demoLogin('COMMANDER')}
              className="elevate-btn commander-btn font-mono"
            >
              <ShieldAlert size={16} />
              <span>ELEVATE TO DUTY COMMANDER</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="snapshots-page-container">
      {/* Toast Notification */}
      {toastMessage && (
        <div className={`snapshot-toast ${toastMessage.type === 'error' ? 'toast-error' : 'toast-success'} font-mono`}>
          {toastMessage.type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
          <span>{toastMessage.text}</span>
          <button className="toast-close-btn" onClick={() => setToastMessage(null)}>
            <X size={13} />
          </button>
        </div>
      )}

      {/* Top Header & Telemetry Strip */}
      <div className="snapshots-header-block">
        <div className="header-left-cluster">
          <div className="vault-badge-icon">
            <Images size={24} className="text-cyan" />
          </div>
          <div>
            <div className="vault-sub-label font-mono">
              <span className="dot-green status-dot"></span>
              <span>DEFENSE MATRIX EVIDENCE VAULT • SECTOR 4</span>
              <span className="vault-clearance-pill">LEVEL 5 ADMIN</span>
            </div>
            <h1 className="vault-main-title">EVIDENCE SNAPSHOT ARCHIVE</h1>
          </div>
        </div>

        <div className="header-actions-cluster font-mono">
          <button 
            className="vault-action-btn refresh-btn"
            onClick={loadSnapshots}
            disabled={loading}
            title="Refresh snapshot repository from disk"
          >
            <RefreshCw size={14} className={loading ? 'spin-icon' : ''} />
            <span>SYNC VAULT</span>
          </button>

          {selectedIds.size > 0 && (
            <button 
              className="vault-action-btn purge-btn text-red animate-pulse"
              onClick={() => setDeleteConfirmItem('bulk')}
              title="Delete all selected snapshots from storage"
            >
              <Trash2 size={14} />
              <span>PURGE SELECTED ({selectedIds.size})</span>
            </button>
          )}
        </div>
      </div>

      {/* 4 Storage Telemetry Cards */}
      <div className="snapshots-kpi-grid font-mono">
        <div className="kpi-vault-card">
          <div className="kpi-vault-header">
            <span className="kpi-vault-title">TOTAL EVIDENCE FILES</span>
            <Images size={16} className="text-cyan" />
          </div>
          <div className="kpi-vault-value">{storageStats.total.toLocaleString()}</div>
          <div className="kpi-vault-footer text-sub">Captured frames across all BOP sensors</div>
        </div>

        <div className="kpi-vault-card">
          <div className="kpi-vault-header">
            <span className="kpi-vault-title">VAULT STORAGE SIZE</span>
            <HardDrive size={16} className="text-yellow" />
          </div>
          <div className="kpi-vault-value">{storageStats.totalSizeFormatted}</div>
          <div className="kpi-vault-footer text-sub">SSD array storage utilization</div>
        </div>

        <div className="kpi-vault-card">
          <div className="kpi-vault-header">
            <span className="kpi-vault-title">CRITICAL WEAPON SNAPS</span>
            <Flame size={16} className="text-red" />
          </div>
          <div className="kpi-vault-value text-red">{categoryCounts.WEAPON}</div>
          <div className="kpi-vault-footer text-sub">DEFCON 1 classified threat captures</div>
        </div>

        <div className="kpi-vault-card">
          <div className="kpi-vault-header">
            <span className="kpi-vault-title">ADMIN RETENTION POLICY</span>
            <Clock size={16} className="text-green" />
          </div>
          <div className="kpi-vault-value text-green">30-DAY PURGE</div>
          <div className="kpi-vault-footer text-sub">Automated forensics archival active</div>
        </div>
      </div>

      {/* Control & Filter Toolbar */}
      <div className="vault-toolbar-container">
        {/* Category Filter Tabs */}
        <div className="category-tabs-group font-mono">
          <button 
            className={`cat-pill ${categoryFilter === 'ALL' ? 'active' : ''}`}
            onClick={() => setCategoryFilter('ALL')}
          >
            <span>ALL</span>
            <span className="cat-count-pill">{categoryCounts.ALL}</span>
          </button>

          <button 
            className={`cat-pill cat-weapon ${categoryFilter === 'WEAPON' ? 'active' : ''}`}
            onClick={() => setCategoryFilter('WEAPON')}
          >
            <Flame size={13} />
            <span>WEAPON</span>
            <span className="cat-count-pill">{categoryCounts.WEAPON}</span>
          </button>

          <button 
            className={`cat-pill cat-person ${categoryFilter === 'PERSON' ? 'active' : ''}`}
            onClick={() => setCategoryFilter('PERSON')}
          >
            <UserX size={13} />
            <span>PERSON</span>
            <span className="cat-count-pill">{categoryCounts.PERSON}</span>
          </button>

          <button 
            className={`cat-pill cat-vehicle ${categoryFilter === 'VEHICLE' ? 'active' : ''}`}
            onClick={() => setCategoryFilter('VEHICLE')}
          >
            <Truck size={13} />
            <span>VEHICLE</span>
            <span className="cat-count-pill">{categoryCounts.VEHICLE}</span>
          </button>

          <button 
            className={`cat-pill cat-intrusion ${categoryFilter === 'INTRUSION' ? 'active' : ''}`}
            onClick={() => setCategoryFilter('INTRUSION')}
          >
            <ShieldAlert size={13} />
            <span>INTRUSION</span>
            <span className="cat-count-pill">{categoryCounts.INTRUSION}</span>
          </button>
        </div>

        {/* Search, Camera Filter, & View Mode Switcher */}
        <div className="vault-filter-actions">
          {/* Search Box */}
          <div className="vault-search-box font-mono">
            <Search size={14} className="text-sub" />
            <input 
              type="text"
              placeholder="Search filename, ALT-ID, or camera..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="vault-search-input"
            />
            {searchQuery && (
              <button className="search-clear-btn" onClick={() => setSearchQuery('')}>
                <X size={12} />
              </button>
            )}
          </div>

          {/* Camera Filter Selector */}
          <div className="vault-camera-select-wrap font-mono">
            <Camera size={13} className="text-cyan" />
            <select 
              value={cameraFilter} 
              onChange={(e) => setCameraFilter(e.target.value)}
              className="vault-camera-select"
            >
              <option value="ALL">ALL CAMERAS</option>
              <option value="CAM-01">CAM-01 (NORTH GATE)</option>
              <option value="CAM-02">CAM-02 (BORDER ROAD)</option>
              <option value="CAM-03">CAM-03 (FENCE ZONE)</option>
              <option value="CAM-04">CAM-04 (BOP ENTRY)</option>
              <option value="CAM-05">CAM-05 (WATCH TOWER)</option>
            </select>
          </div>

          {/* Select All Action */}
          <button 
            className="vault-select-all-btn font-mono"
            onClick={handleSelectAll}
            title={selectedIds.size === filteredSnapshots.length ? 'Deselect All' : 'Select All'}
          >
            {selectedIds.size > 0 && selectedIds.size === filteredSnapshots.length ? (
              <CheckSquare size={15} className="text-cyan" />
            ) : (
              <Square size={15} className="text-sub" />
            )}
            <span>{selectedIds.size === filteredSnapshots.length ? 'DESELECT' : 'SELECT ALL'}</span>
          </button>

          {/* View Toggle */}
          <div className="view-mode-toggle font-mono">
            <button 
              className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid Cards View"
            >
              <LayoutGrid size={15} />
            </button>
            <button 
              className={`view-toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
              onClick={() => setViewMode('table')}
              title="Forensic Table View"
            >
              <List size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* Snapshot Gallery / Grid / Table Display */}
      {loading ? (
        <div className="vault-loading-state font-mono">
          <div className="loading-spinner"></div>
          <div className="loading-text">INTERROGATING EVIDENCE REPOSITORY...</div>
        </div>
      ) : filteredSnapshots.length === 0 ? (
        <div className="vault-empty-state font-mono">
          <Images size={42} className="text-sub" />
          <div className="empty-title">NO SURVEILLANCE SNAPSHOTS FOUND</div>
          <p className="empty-desc">
            No image captures match your selected criteria or search parameters in Sector 4 storage.
          </p>
          {(categoryFilter !== 'ALL' || cameraFilter !== 'ALL' || searchQuery) && (
            <button 
              className="reset-filters-btn font-mono"
              onClick={() => { setCategoryFilter('ALL'); setCameraFilter('ALL'); setSearchQuery(''); }}
            >
              RESET ALL FILTERS
            </button>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        /* GRID VIEW */
        <div className="snapshots-grid-layout">
          {filteredSnapshots.map((item) => {
            const isSelected = selectedIds.has(item.id);
            const isWeapon = item.category === 'WEAPON';

            return (
              <div 
                key={item.id} 
                className={`snapshot-card ${isSelected ? 'selected' : ''} ${isWeapon ? 'threat-weapon' : ''}`}
                onClick={() => setInspectModalItem(item)}
              >
                {/* Selection Checkbox */}
                <div 
                  className="card-checkbox-wrap"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleSelect(item.id);
                  }}
                  title="Select for bulk purge"
                >
                  {isSelected ? (
                    <CheckSquare size={17} className="text-cyan check-active" />
                  ) : (
                    <Square size={17} className="check-inactive" />
                  )}
                </div>

                {/* Threat Category Pill */}
                <div className="card-top-badges">
                  <span className={`threat-pill cat-${(item.category || 'surv').toLowerCase()} font-mono`}>
                    {item.category}
                  </span>
                  <span className="cam-pill font-mono">{item.camera_id}</span>
                </div>

                {/* Snapshot Image Container */}
                <div className="card-image-box">
                  <img 
                    src={item.url || item.snapshot_base64} 
                    alt={item.filename}
                    className="snapshot-img"
                    loading="lazy"
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="100%" height="100%" fill="%230b131f"/><text x="50%" y="50%" fill="%2300f2fe" font-family="monospace" font-size="12" text-anchor="middle" dominant-baseline="middle">[ EVIDENCE ARCHIVED ]</text></svg>';
                    }}
                  />
                  <div className="card-image-overlay">
                    <div className="overlay-inspect-pill font-mono">
                      <Maximize2 size={13} />
                      <span>INSPECT</span>
                    </div>
                  </div>
                </div>

                {/* Card Meta Footer */}
                <div className="card-info-footer">
                  <div className="card-meta-row font-mono">
                    <span className="meta-time" title={item.captured_at}>
                      <Clock size={11} className="text-sub inline-mr" />
                      {new Date(item.captured_at).toLocaleTimeString()}
                    </span>
                    <span className="meta-size">{item.file_size_formatted}</span>
                  </div>

                  <div className="card-filename font-mono" title={item.filename}>
                    {item.filename}
                  </div>

                  {item.alert_id && (
                    <div className="card-alert-tag font-mono">
                      <ShieldAlert size={11} className="text-red inline-mr" />
                      <span>{item.alert_id}</span>
                    </div>
                  )}

                  {/* Card Actions Strip */}
                  <div className="card-action-bar font-mono" onClick={(e) => e.stopPropagation()}>
                    <button 
                      className="card-btn inspect-btn"
                      onClick={() => setInspectModalItem(item)}
                      title="Inspect full image and forensic telemetry"
                    >
                      <Eye size={13} />
                      <span>VIEW</span>
                    </button>

                    <button 
                      className="card-btn download-btn"
                      onClick={(e) => handleDownload(item, e)}
                      title="Download full JPEG image"
                    >
                      <Download size={13} />
                    </button>

                    <button 
                      className="card-btn delete-btn"
                      onClick={() => setDeleteConfirmItem(item)}
                      title="Permanently purge snapshot file (Admin Only)"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* TABLE VIEW */
        <div className="snapshots-table-wrapper font-mono">
          <table className="snapshots-forensic-table">
            <thead>
              <tr>
                <th style={{ width: '40px' }}>
                  <button 
                    className="table-header-check-btn"
                    onClick={handleSelectAll}
                  >
                    {selectedIds.size > 0 && selectedIds.size === filteredSnapshots.length ? (
                      <CheckSquare size={14} className="text-cyan" />
                    ) : (
                      <Square size={14} className="text-sub" />
                    )}
                  </button>
                </th>
                <th style={{ width: '70px' }}>PREVIEW</th>
                <th>FILE IDENTIFIER</th>
                <th>CATEGORY</th>
                <th>SENSOR / CAMERA</th>
                <th>TIMESTAMP (ZULU)</th>
                <th>ALERT REF</th>
                <th>FILE SIZE</th>
                <th style={{ textAlign: 'right' }}>ADMIN ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filteredSnapshots.map((item) => {
                const isSelected = selectedIds.has(item.id);
                return (
                  <tr 
                    key={item.id} 
                    className={`table-row ${isSelected ? 'row-selected' : ''}`}
                    onClick={() => setInspectModalItem(item)}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <button 
                        className="table-row-check-btn"
                        onClick={() => handleToggleSelect(item.id)}
                      >
                        {isSelected ? (
                          <CheckSquare size={15} className="text-cyan" />
                        ) : (
                          <Square size={15} className="text-sub" />
                        )}
                      </button>
                    </td>
                    <td>
                      <img 
                        src={item.url || item.snapshot_base64} 
                        alt="thumb" 
                        className="table-thumbnail-img"
                        onError={(e) => {
                          e.target.onerror = null;
                          e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="50" viewBox="0 0 80 50"><rect width="100%" height="100%" fill="%230b131f"/><text x="50%" y="50%" fill="%2300f2fe" font-family="monospace" font-size="9" text-anchor="middle" dominant-baseline="middle">[ REC ]</text></svg>';
                        }}
                      />
                    </td>
                    <td className="table-file-cell">
                      <span className="file-name-text">{item.filename}</span>
                      <span className="file-path-sub">{item.relative_path}</span>
                    </td>
                    <td>
                      <span className={`threat-pill cat-${(item.category || 'surv').toLowerCase()}`}>
                        {item.category}
                      </span>
                    </td>
                    <td>
                      <span className="table-cam-tag">{item.camera_id}</span>
                    </td>
                    <td className="table-time-cell">
                      {new Date(item.captured_at).toLocaleString()}
                    </td>
                    <td>
                      {item.alert_id ? (
                        <span className="table-alert-pill">{item.alert_id}</span>
                      ) : (
                        <span className="text-muted">--</span>
                      )}
                    </td>
                    <td>{item.file_size_formatted}</td>
                    <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                      <div className="table-actions-group">
                        <button 
                          className="table-action-btn view-btn"
                          onClick={() => setInspectModalItem(item)}
                          title="Inspect Snapshot"
                        >
                          <Eye size={13} />
                        </button>
                        <button 
                          className="table-action-btn dl-btn"
                          onClick={(e) => handleDownload(item, e)}
                          title="Download Snapshot"
                        >
                          <Download size={13} />
                        </button>
                        <button 
                          className="table-action-btn del-btn"
                          onClick={() => setDeleteConfirmItem(item)}
                          title="Purge Snapshot"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* INSPECTION MODAL */}
      {inspectModalItem && (
        <div className="modal-backdrop" onClick={() => setInspectModalItem(null)}>
          <div className="inspect-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="inspect-modal-header font-mono">
              <div className="modal-title-left">
                <ShieldCheck size={18} className="text-cyan" />
                <span className="modal-title-text">FORENSIC SNAPSHOT INSPECTOR</span>
                <span className={`threat-pill cat-${(inspectModalItem.category || 'surv').toLowerCase()}`}>
                  {inspectModalItem.category}
                </span>
              </div>
              <button 
                className="modal-close-btn"
                onClick={() => setInspectModalItem(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="inspect-modal-body">
              {/* Image Preview Window */}
              <div className="inspect-image-viewport">
                <img 
                  src={inspectModalItem.url || inspectModalItem.snapshot_base64} 
                  alt={inspectModalItem.filename}
                  className="inspect-full-img"
                  onError={(e) => {
                    e.target.onerror = null;
                    e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="100%" height="100%" fill="%230b131f"/><text x="50%" y="50%" fill="%2300f2fe" font-family="monospace" font-size="14" text-anchor="middle" dominant-baseline="middle">[ FORENSIC EVIDENCE FRAME ]</text></svg>';
                  }}
                />
                <div className="image-crosshair top-left"></div>
                <div className="image-crosshair top-right"></div>
                <div className="image-crosshair bottom-left"></div>
                <div className="image-crosshair bottom-right"></div>
              </div>

              {/* Forensic Details Column */}
              <div className="inspect-meta-panel font-mono">
                <div className="meta-section-title">SURVEILLANCE TELEMETRY</div>

                <div className="meta-info-grid">
                  <div className="meta-item">
                    <span className="meta-k">FILE IDENTIFIER:</span>
                    <span className="meta-v text-cyan">{inspectModalItem.filename}</span>
                  </div>

                  <div className="meta-item">
                    <span className="meta-k">STORAGE PATH:</span>
                    <span className="meta-v">{inspectModalItem.relative_path || inspectModalItem.filename}</span>
                  </div>

                  <div className="meta-item">
                    <span className="meta-k">SENSOR UNIT:</span>
                    <span className="meta-v text-green">{inspectModalItem.camera_id}</span>
                  </div>

                  <div className="meta-item">
                    <span className="meta-k">ALERT REFERENCE:</span>
                    <span className="meta-v text-red">{inspectModalItem.alert_id || 'STANDALONE_BURST'}</span>
                  </div>

                  <div className="meta-item">
                    <span className="meta-k">TIMESTAMP (ZULU):</span>
                    <span className="meta-v">{new Date(inspectModalItem.captured_at).toUTCString()}</span>
                  </div>

                  <div className="meta-item">
                    <span className="meta-k">FILE SIZE:</span>
                    <span className="meta-v">{inspectModalItem.file_size_formatted} ({inspectModalItem.file_size_bytes} B)</span>
                  </div>

                  <div className="meta-item">
                    <span className="meta-k">THREAT LEVEL:</span>
                    <span className="meta-v text-yellow">{inspectModalItem.category === 'WEAPON' ? 'CRITICAL (DEFCON 1)' : 'ELEVATED FORENSIC'}</span>
                  </div>

                  <div className="meta-item">
                    <span className="meta-k">HASH CHECKSUM:</span>
                    <span className="meta-v text-sub" style={{ wordBreak: 'break-all' }}>
                      SHA256: 4f8b9e...{inspectModalItem.id.slice(0, 12)}
                    </span>
                  </div>
                </div>

                {/* Modal Actions */}
                <div className="modal-actions-footer">
                  <button 
                    className="modal-action-btn download-btn"
                    onClick={(e) => handleDownload(inspectModalItem, e)}
                  >
                    <Download size={14} />
                    <span>EXPORT EVIDENCE JPEG</span>
                  </button>

                  <button 
                    className="modal-action-btn delete-btn"
                    onClick={() => {
                      setDeleteConfirmItem(inspectModalItem);
                    }}
                  >
                    <Trash2 size={14} />
                    <span>PERMANENTLY PURGE (ADMIN)</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deleteConfirmItem && (
        <div className="modal-backdrop" onClick={() => !isDeleting && setDeleteConfirmItem(null)}>
          <div className="delete-confirm-card font-mono" onClick={(e) => e.stopPropagation()}>
            <div className="delete-confirm-icon-box">
              <Trash2 size={26} className="text-red" />
            </div>

            <h3 className="delete-confirm-title">
              {deleteConfirmItem === 'bulk'
                ? `CONFIRM BULK EVIDENCE PURGE (${selectedIds.size} FILES)`
                : 'CONFIRM PERMANENT EVIDENCE DELETION'}
            </h3>

            <p className="delete-confirm-desc">
              {deleteConfirmItem === 'bulk' ? (
                <>
                  You are about to permanently eradicate <strong>{selectedIds.size}</strong> surveillance snapshot files 
                  from the Sector 4 border defense storage array. This action is irreversible and recorded in the audit log.
                </>
              ) : (
                <>
                  You are about to permanently delete <strong>{deleteConfirmItem.filename}</strong> from the classified 
                  snapshot vault. This evidentiary file cannot be recovered.
                </>
              )}
            </p>

            <div className="delete-confirm-buttons">
              <button 
                className="confirm-cancel-btn"
                disabled={isDeleting}
                onClick={() => setDeleteConfirmItem(null)}
              >
                ABORT / CANCEL
              </button>

              <button 
                className="confirm-purge-btn"
                disabled={isDeleting}
                onClick={deleteConfirmItem === 'bulk' ? handleConfirmBulkDelete : handleConfirmSingleDelete}
              >
                {isDeleting ? (
                  <span className="flex items-center gap-2">
                    <RefreshCw size={14} className="spin-icon" />
                    <span>PURGING FROM STORAGE...</span>
                  </span>
                ) : (
                  <span>CONFIRM PERMANENT PURGE</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SnapshotsPage;
