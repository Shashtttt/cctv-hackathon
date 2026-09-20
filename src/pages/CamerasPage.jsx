import React, { useState, useEffect } from 'react';
import { 
  Camera, 
  Video, 
  Search, 
  Filter, 
  LayoutGrid, 
  List, 
  Play, 
  Wrench, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Zap,
  Eye,
  User,
  Truck,
  Shield,
  ShieldAlert,
  VideoOff,
  Radio,
  RefreshCw,
  MapPin,
  Plus,
  Trash2
} from 'lucide-react';
import { fetchCameras, getCameraStreamUrl, deleteCamera } from '../services/apiService';
import { enumerateDeviceCameras } from '../utils/deviceDetector';
import { CameraDetailModal } from '../components/CameraDetailModal';
import { VirtualFenceConfigModal } from '../components/VirtualFenceConfigModal';
import { AddIpCameraModal } from '../components/AddIpCameraModal';
import './CamerasPage.css';

const CamerasPage = () => {
  const [cameras, setCameras] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [resolutionFilter, setResolutionFilter] = useState('all');
  const [viewMode, setViewMode] = useState('grid');
  const [currentPage, setCurrentPage] = useState(1);
  const [streamErrors, setStreamErrors] = useState({});
  const [selectedCameraModal, setSelectedCameraModal] = useState(null);
  const [selectedFenceCamera, setSelectedFenceCamera] = useState(null);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const loadCameras = async () => {
    try {
      // 1. Detect genuine physical hardware cameras on this device
      let hardwareCams = [];
      try {
        const detected = await enumerateDeviceCameras();
        hardwareCams = (detected || []).map((d, index) => ({
          id: d.id || `dev-cam-${index + 1}`,
          code: d.isBack ? 'DEV-REAR-01' : (index === 0 ? 'DEV-OPTICAL-01' : `DEV-OPTICAL-0${index + 1}`),
          name: d.name || d.label || (index === 0 ? 'Integrated HD Camera' : `External USB CCTV ${index}`),
          status: 'online',
          statusText: 'ONLINE ⚡',
          location: 'Local Optical Device (Hardware)',
          gps_coords: 'Active Device Sensor',
          resolution: d.resolution || '1080p FHD',
          lastSeen: 'Live Now',
          image: '/assets/cam1.png',
          streamUrl: null,
          frameUrl: null,
          recText: 'LIVE HARDWARE ⚡',
          badgeTopRight: d.isBack ? '📷 REAR SENSOR' : '💻 FRONT WEBCAM',
          overlayBottomLeft: (d.name || d.label || 'OPTICAL SENSOR').toUpperCase(),
          overlayBottomRight: `${d.resolution || '1080p'} @ 30fps`,
          type: 'online',
          isOffline: false,
          hasDetections: true,
          detectionMode: 'c01_double',
          isDeviceHardware: true,
          isCustomIp: false,
        }));
      } catch (devErr) {
        console.debug('Hardware camera enumeration notice:', devErr);
      }

      // 2. Fetch all real IP/mobile cameras registered in backend
      let backendCams = [];
      try {
        const data = await fetchCameras();
        if (Array.isArray(data)) {
          // Exclude synthetic placeholder feeds, mp4 demo files, and local webcam ingest cam-01
          const realCameras = data.filter(c => 
            c.rtsp_url && 
            !c.rtsp_url.startsWith('synthetic://') &&
            !c.rtsp_url.endsWith('.mp4') &&
            !c.rtsp_url.endsWith('.avi') &&
            c.id.toLowerCase() !== 'cam-01' &&
            !c.id.toLowerCase().startsWith('dev-cam')
          );

          backendCams = realCameras.map((item, index) => {
            const isMobile = Boolean(item.rtsp_url && item.rtsp_url.startsWith('mobile://'));
            const isOnline = item.status === 'online' || item.is_active;
            const isConnecting = item.status === 'connecting';
            const currentStatus = isOnline ? 'online' : (isConnecting ? 'connecting' : (isMobile ? 'standby' : 'offline'));

            return {
              id: item.id,
              code: item.code || `IP-${index + 1}`,
              name: item.name || `IP Camera ${index + 1}`,
              status: currentStatus,
              statusText: isOnline ? 'ONLINE ⚡' : (isConnecting ? 'CONNECTING…' : (isMobile ? 'STANDBY 📱' : 'OFFLINE')),
              location: item.location || 'Network Perimeter',
              gps_coords: item.gps_coords || '28.4949° N, 77.0895° E',
              resolution: item.resolution || '1080p FHD',
              lastSeen: isOnline ? 'Live Now' : (item.last_frame_at ? 'Recent' : 'Offline'),
              image: '/assets/cam2.png',
              streamUrl: item.stream_url || getCameraStreamUrl(item.id),
              frameUrl: item.frame_url || `/api/v1/cameras/${item.id}/frame`,
              recText: isOnline ? 'LIVE AI ⚡' : (isConnecting ? 'CONNECTING' : 'STANDBY'),
              badgeTopRight: isMobile ? '📱 MOBILE CAM' : '🌐 IP CAMERA',
              overlayBottomLeft: (item.location || 'NETWORK STREAM').toUpperCase(),
              overlayBottomRight: `${item.resolution || '1080p'} @ ${item.fps || 25}fps`,
              type: currentStatus,
              isOffline: !isOnline,
              hasDetections: true,
              detectionMode: 'c01_double',
              isCustomIp: true,
              isMobile,
              rtsp_url: item.rtsp_url,
            };
          });
        }
      } catch (apiErr) {
        console.debug('Cameras API load notice:', apiErr);
      }

      // Combine genuine hardware cameras with registered IP cameras
      setCameras([...hardwareCams, ...backendCams]);
    } catch (e) {
      console.debug('Cameras load error:', e);
    }
  };

  const handleDeleteCamera = async (e, camId) => {
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to delete camera ${camId}?`)) return;
    try {
      await deleteCamera(camId);
      setCameras((prev) => prev.filter((c) => c.id !== camId));
    } catch (err) {
      console.error('Failed to delete camera:', err);
    }
  };

  useEffect(() => {
    loadCameras();
    const interval = setInterval(loadCameras, 4000);
    return () => clearInterval(interval);
  }, []);


  // Filtered Cameras
  const filteredCameras = cameras.filter((cam) => {
    const matchesSearch = 
      cam.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      cam.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      cam.location.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === 'all' || cam.status === statusFilter;
    const matchesLocation = locationFilter === 'all' || cam.location.includes(locationFilter);

    return matchesSearch && matchesStatus && matchesLocation;
  });

  const clearFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setLocationFilter('all');
    setResolutionFilter('all');
  };

  const handleStreamError = (id) => {
    setStreamErrors((prev) => ({ ...prev, [id]: true }));
  };

  const totalCamerasCount = cameras.length || 24;
  const onlineCount = cameras.filter(c => c.status === 'online').length || 22;
  const warningCount = cameras.filter(c => c.status === 'warning').length || 1;
  const offlineCount = cameras.filter(c => c.status === 'offline').length || 1;

  return (
    <div className="cameras-page-container">
      {/* Top Title Header Bar */}
      <div className="page-header-row">
        <div className="title-with-badge">
          <div className="camera-header-icon font-mono">
            <Camera size={22} className="text-white" />
          </div>
          <div className="page-title-text-group">
            <div className="title-heading-line">
              <h2>Cameras</h2>
              <span className="pill-badge pill-muted font-mono version-tag">
                V-NET 2.4.9
              </span>
            </div>
            <p className="page-sub-text">
              Monitor connected CCTV cameras, sensor feeds, and hardware telemetry across sectors.
            </p>
          </div>
        </div>

        <div className="header-status-pills font-mono">
          <button
            onClick={() => setSelectedFenceCamera(cameras[0] || defaultCamerasData[0])}
            className="pill-badge font-mono"
            style={{
              background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.25) 0%, rgba(185, 28, 28, 0.4) 100%)',
              border: '1px solid #ef4444',
              color: '#fecaca',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 700,
              padding: '6px 14px',
              borderRadius: '6px',
              boxShadow: '0 2px 10px rgba(239, 68, 68, 0.35)'
            }}
          >
            <Shield size={14} className="text-red" />
            <span>+ CONFIGURE FENCE & RTSP</span>
          </button>

          <span className="pill-badge pill-green">
            <span className="status-dot dot-green pulse-ring"></span> SYSTEM ONLINE
          </span>

          <span className="pill-badge pill-muted font-mono">
            <Zap size={12} className="text-cyan" /> LATENCY: 14ms
          </span>
        </div>
      </div>

      {/* 4 KPI Summary Cards Grid */}
      <div className="kpi-cards-grid">
        {/* Card 1: TOTAL CAMERAS */}
        <div className="kpi-card">
          <div className="kpi-info font-mono">
            <span className="kpi-label">TOTAL CAMERAS</span>
            <span className="kpi-value">{totalCamerasCount}</span>
            <span className="kpi-sub font-sans">Telemetry window: 24h</span>
          </div>
          <div className="kpi-icon-box box-blue">
            <Video size={22} />
          </div>
        </div>

        {/* Card 2: ONLINE */}
        <div className="kpi-card kpi-card-online">
          <div className="kpi-info font-mono">
            <div className="kpi-label-row">
              <span className="kpi-label text-green">ONLINE</span>
              <span className="pill-badge pill-green pill-xs font-mono">● Online</span>
            </div>
            <span className="kpi-value text-green">{onlineCount}</span>
            <span className="kpi-sub font-sans">Operational feeds ({((onlineCount / (totalCamerasCount || 1)) * 100).toFixed(1)}%)</span>
          </div>
        </div>

        {/* Card 3: WARNING */}
        <div className="kpi-card">
          <div className="kpi-info font-mono">
            <div className="kpi-label-row">
              <span className="kpi-label text-purple">WARNING</span>
              <span className="pill-badge pill-purple pill-xs font-mono">⚠️ Warning</span>
            </div>
            <span className="kpi-value">{warningCount}</span>
            <span className="kpi-sub font-sans">Elevated latency / trace packet</span>
          </div>
        </div>

        {/* Card 4: OFFLINE */}
        <div className="kpi-card">
          <div className="kpi-info font-mono">
            <div className="kpi-label-row">
              <span className="kpi-label text-red">OFFLINE</span>
              <span className="pill-badge pill-red pill-xs font-mono">● Offline</span>
            </div>
            <span className="kpi-value text-red">{offlineCount}</span>
            <span className="kpi-sub font-sans">Hardware unreachable</span>
          </div>
        </div>
      </div>

      {/* Control & Filter Strip Bar */}
      <div className="cameras-control-bar">
        <div className="control-left-group">
          {/* Search Input Box */}
          <div className="search-input-box font-mono">
            <Search size={15} className="search-icon" />
            <input 
              type="text" 
              placeholder="Search camera ID, name, location..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>

          {/* Dropdown 1 */}
          <select 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="filter-select font-mono"
          >
            <option value="all">Status: All</option>
            <option value="online">Online</option>
            <option value="warning">Warning</option>
            <option value="offline">Offline</option>
          </select>

          {/* Dropdown 2 */}
          <select 
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            className="filter-select font-mono"
          >
            <option value="all">Location: All</option>
            <option value="Sector 01">Sector 01</option>
            <option value="Sector 02">Sector 02</option>
            <option value="Sector 03">Sector 03</option>
            <option value="Sector 04">Sector 04</option>
            <option value="Sector 05">Sector 05</option>
            <option value="Sector 06">Sector 06</option>
          </select>

          {/* Dropdown 3 */}
          <select 
            value={resolutionFilter}
            onChange={(e) => setResolutionFilter(e.target.value)}
            className="filter-select font-mono"
          >
            <option value="all">Resolution: All</option>
            <option value="1080p">1080p</option>
            <option value="720p">720p</option>
          </select>

          {/* Clear Filters Button */}
          <button className="clear-filters-btn font-mono" onClick={clearFilters}>
            <Filter size={13} />
            <span>Clear Filters</span>
          </button>

          <button className="clear-filters-btn font-mono" onClick={loadCameras} title="Refresh">
            <RefreshCw size={13} />
          </button>
        </div>

        <div className="control-right-group">
          <button
            className="add-ip-camera-top-btn font-mono"
            onClick={() => setIsAddModalOpen(true)}
          >
            <Plus size={14} />
            <span>ADD IP CAMERA</span>
          </button>

          <span className="showing-counter-text font-mono">
            Showing <strong>{filteredCameras.length}</strong> of <strong>{totalCamerasCount}</strong> cameras
          </span>

          <div className="view-mode-toggle">
            <button 
              className={`mode-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid View"
            >
              <LayoutGrid size={15} />
            </button>
            <button 
              className={`mode-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title="List View"
            >
              <List size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* 3x2 Cameras Grid Viewport */}
      <div className={`cameras-grid-container view-${viewMode}`}>
        {filteredCameras.map((cam) => (
          <div key={cam.id} className={`camera-manage-card card-type-${cam.type}`}>
            
            {/* Camera Feed Viewport Box */}
            <div className={`cam-card-viewport scanlines ${cam.isOffline ? 'offline-viewport' : ''}`}>
              {!cam.isOffline ? (
                <>
                  {cam.streamUrl && (cam.streamUrl.endsWith('.mp4') || cam.streamUrl.endsWith('.webm')) ? (
                    <video 
                      src={cam.streamUrl} 
                      autoPlay
                      loop
                      muted
                      playsInline
                      className="cam-viewport-img" 
                    />
                  ) : (
                    <img 
                      src={cam.streamUrl || getCameraStreamUrl(cam.id)}
                      alt={cam.name}
                      className="cam-viewport-img" 
                      onError={(e) => {
                        setTimeout(() => {
                          if (e.target) {
                            e.target.src = `${cam.frameUrl || `/api/v1/cameras/${cam.id}/frame`}?t=${Date.now()}`;
                          }
                        }, 800);
                      }}
                    />
                  )}

                  {/* Top Overlays */}
                  <div className="viewport-top-bar">
                    {cam.status === 'warning' ? (
                      <span className="pill-badge pill-purple rec-pill font-mono">
                        ⚠️ {cam.recText}
                      </span>
                    ) : (
                      <span className="pill-badge pill-red rec-pill font-mono">
                        <span className="status-dot dot-red pulse-ring"></span> {cam.recText}
                      </span>
                    )}

                    <span className="pill-badge pill-muted mode-badge font-mono">
                      {cam.badgeTopRight}
                    </span>
                  </div>

                  {/* Bottom Overlays */}
                  <div className="viewport-bottom-bar font-mono">
                    <span className="overlay-loc">{cam.overlayBottomLeft}</span>
                    <span className="overlay-res">{cam.overlayBottomRight}</span>
                  </div>
                </>
              ) : (
                /* Offline Error Viewport State */
                <div className="offline-error-content font-mono">
                  <div className="offline-top-row">
                    <span className="red-halted-text">● HALTED</span>
                    <span className="no-rec-text">🚫 REC</span>
                  </div>

                  <div className="error-center-box">
                    <div className="error-icon-red">
                      <VideoOff size={24} />
                    </div>
                    <div className="error-title-text">FEED FAILURE: NO SIGNAL</div>
                    <div className="error-code-text">CODE: 0x80040154 (TIMED_OUT)</div>
                  </div>

                  <div className="offline-bottom-row">
                    <span>{cam.overlayBottomLeft}</span>
                    <span>{cam.overlayBottomRight}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Camera Card Body Details */}
            <div className="cam-card-body">
              {/* Header Row */}
              <div className="body-header-row">
                <div className="cam-id-title-group">
                  <span className="cam-code-tag font-mono">{cam.code}</span>
                  <h4 className="cam-title-name">{cam.name}</h4>
                </div>

                {cam.status === 'online' && (
                  <span className="pill-badge pill-green status-tag font-mono">
                    ● Online
                  </span>
                )}
                {cam.status === 'warning' && (
                  <span className="pill-badge pill-purple status-tag font-mono">
                    ⚠️ Warning
                  </span>
                )}
                {cam.status === 'offline' && (
                  <span className="pill-badge pill-red status-tag font-mono">
                    ● Offline
                  </span>
                )}
              </div>

              {/* Meta Stats Row Grid */}
              <div className="meta-stats-grid font-mono">
                <div className="meta-cell">
                  <span className="cell-label">LOCATION</span>
                  <span className="cell-val">{cam.location}</span>
                </div>

                <div className="meta-cell">
                  <span className="cell-label">RESOLUTION</span>
                  <span className="cell-val">{cam.resolution}</span>
                </div>

                <div className="meta-cell">
                  <span className="cell-label">LAST SEEN</span>
                  <span className={`cell-val ${cam.status === 'online' ? 'text-green' : cam.status === 'offline' ? 'text-red' : ''}`}>
                    {cam.lastSeen}
                  </span>
                </div>
              </div>

              {/* GPS Telemetry Bar */}
              <div className="cam-gps-telemetry-row font-mono" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.72rem', color: '#00f2fe', background: 'rgba(0, 242, 254, 0.06)', border: '1px solid rgba(0, 242, 254, 0.18)', borderRadius: '4px', padding: '4px 8px', marginTop: '8px' }}>
                <MapPin size={12} className="text-cyan flex-shrink-0" />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  GPS: {cam.gps_coords || cam.gps || '28.4949° N, 77.0895° E'}
                </span>
              </div>

              {/* Optional Detections Box */}
              {cam.hasDetections && cam.detectionMode === 'c01_double' && (
                <div className="detections-info-box font-mono">
                  <div className="box-header">
                    <span>CURRENT DETECTIONS</span>
                    <span className="text-green">● 2 ACTIVE</span>
                  </div>
                  <div className="det-card-stacked font-mono">
                    <div className="det-row-card">
                      <div className="det-left-info">
                        <User size={13} className="text-green" />
                        <span className="det-name-text">P-115 • Security Officer</span>
                      </div>
                      <span className="badge-authorized font-mono">AUTHORIZED</span>
                    </div>
                    <div className="det-row-card font-mono">
                      <div className="det-left-info">
                        <Truck size={13} className="text-cyan" />
                        <span className="det-name-text">V-021 • Vehicle</span>
                      </div>
                      <span className="plate-tag-box font-mono">PLATE: <strong className="plate-val">HR26AB1234</strong></span>
                    </div>
                  </div>
                </div>
              )}

              {cam.hasDetections && cam.detectionMode === 'c02_patrol' && (
                <div className="detections-info-box font-mono">
                  <div className="box-header">
                    <span>CURRENT DETECTIONS</span>
                    <span className="text-green">● 1 ACTIVE</span>
                  </div>
                  <div className="det-card-stacked font-mono">
                    <div className="det-row-card-single font-mono">
                      <div className="det-row-line1">
                        <div className="det-left-info">
                          <Truck size={13} className="text-cyan" />
                          <span className="det-name-text">V-021 • Vehicle</span>
                        </div>
                        <span className="conf-badge-green font-mono">93%</span>
                      </div>
                      <div className="det-row-line2 font-mono">
                        <span className="plate-tag-box font-mono">PLATE: <strong className="plate-val">HR26AB1234</strong></span>
                        <span className="text-green font-mono">● Patrol en route</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {cam.hasDetections && cam.detectionMode === 'c03_alerts' && (
                <div className="detections-info-box font-mono box-warning-purple">
                  <div className="box-header">
                    <span>CURRENT DETECTIONS</span>
                    <span className="pill-badge-alert font-mono">⚠️ 2 ALERTS</span>
                  </div>
                  <div className="det-card-stacked font-mono">
                    <div className="det-row-card font-mono">
                      <div className="det-left-info">
                        <User size={13} className="text-purple-light" />
                        <span className="det-name-text text-white font-bold">P-102 • UNAUTHORIZED PERSON</span>
                      </div>
                      <span className="badge-conf-purple font-mono">95%</span>
                    </div>
                    <div className="suspicious-activity-card font-mono">
                      <div className="suspicious-top-row">
                        <div className="det-left-info text-cyan">
                          <ShieldAlert size={13} className="text-cyan" />
                          <span className="suspicious-title font-bold">SUSPICIOUS ACTIVITY</span>
                        </div>
                        <span className="time-badge-purple font-mono">04:32</span>
                      </div>
                      <div className="suspicious-meta-row font-mono text-muted">
                        <span>Activity: <strong className="text-white">Loitering</strong></span>
                        <span>Object: <strong className="text-white">P-108</strong></span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {cam.hasDetections && cam.detectionMode === 'c04_security' && (
                <div className="detections-info-box font-mono">
                  <div className="box-header">
                    <span>CURRENT DETECTIONS</span>
                    <span className="text-green">● 1 ACTIVE</span>
                  </div>
                  <div className="det-card-stacked font-mono">
                    <div className="det-row-card font-mono">
                      <div className="det-left-info">
                        <User size={13} className="text-green" />
                        <span className="det-name-text">P-115 • Role: Security Officer</span>
                      </div>
                      <span className="badge-authorized font-mono">AUTHORIZED</span>
                    </div>
                  </div>
                </div>
              )}

              {cam.hasDetections && cam.detectionMode === 'c05_clear' && (
                <div className="detections-info-box font-mono">
                  <div className="box-header">
                    <span>CURRENT DETECTIONS</span>
                    <span className="text-muted">CLEAR</span>
                  </div>
                  <div className="box-content-clear font-mono">
                    <CheckCircle2 size={15} className="text-green font-bold" />
                    <span className="text-muted font-bold">No active detections</span>
                  </div>
                </div>
              )}

              {cam.hasDetections && cam.detectionMode === 'c06_cached' && (
                <div className="detections-info-box font-mono box-offline-red">
                  <div className="box-header">
                    <span>PREVIOUS / CACHED ACTIVITY</span>
                    <span className="badge-no-feed font-mono">NO LIVE FEED</span>
                  </div>
                  <div className="cached-activity-card font-mono">
                    <div className="cached-line1 font-mono">
                      <div className="det-left-info text-red">
                        <AlertTriangle size={13} className="text-red-alert" />
                        <span className="det-name-bold text-red-alert">P-102 • UNAUTHORIZED PERSON</span>
                      </div>
                      <span className="text-muted font-mono">Cached</span>
                    </div>
                    <div className="cached-line2 font-mono text-muted">
                      <span>Last Detection: <strong>P-102</strong></span>
                      <span className="text-muted font-bold">5 minutes ago</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="card-actions-row">
                {!cam.isOffline ? (
                  <button 
                    className={`btn-cam-action ${cam.status === 'warning' ? 'btn-warning-glow' : ''}`}
                    onClick={() => setSelectedCameraModal(cam)}
                  >
                    <Play size={13} fill="currentColor" />
                    <span>View Live</span>
                  </button>
                ) : (
                  <button 
                    className="btn-cam-action btn-offline"
                    onClick={() => setSelectedCameraModal(cam)}
                  >
                    <Wrench size={13} />
                    <span>View Diagnostics</span>
                  </button>
                )}

                <button
                  className="btn-cam-action"
                  style={{
                    background: 'rgba(239, 68, 68, 0.12)',
                    border: '1px solid rgba(239, 68, 68, 0.5)',
                    color: '#fca5a5',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '5px',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                  onClick={() => setSelectedFenceCamera(cam)}
                  title="Configure RTSP Stream & Virtual Fence Polygon"
                >
                  <Shield size={12} className="text-red" />
                  <span>Fence & RTSP</span>
                </button>

                {(cam.isCustomIp || cam.id.startsWith('ip-') || cam.id.startsWith('cam-mobile')) && (
                  <button
                    className="btn-cam-delete font-mono"
                    title="Remove Camera"
                    onClick={(e) => handleDeleteCamera(e, cam.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>

          </div>
        ))}
      </div>

      {/* Page Footer Pagination */}
      <div className="cameras-table-footer font-mono">
        <div className="footer-count-text">
          Showing <strong>1–{filteredCameras.length}</strong> of <strong>{totalCamerasCount}</strong> registered cameras
        </div>

        <div className="pagination-controls">
          <button 
            className="page-nav-btn" 
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
          >
            &lt; Previous
          </button>

          <button 
            className={`page-num-btn ${currentPage === 1 ? 'active' : ''}`}
            onClick={() => setCurrentPage(1)}
          >
            1
          </button>
          <button 
            className={`page-num-btn ${currentPage === 2 ? 'active' : ''}`}
            onClick={() => setCurrentPage(2)}
          >
            2
          </button>
          <button 
            className={`page-num-btn ${currentPage === 3 ? 'active' : ''}`}
            onClick={() => setCurrentPage(3)}
          >
            3
          </button>

          <button 
            className="page-nav-btn" 
            disabled={currentPage === 3}
            onClick={() => setCurrentPage((p) => Math.min(p + 1, 3))}
          >
            Next &gt;
          </button>
        </div>
      </div>

      {/* Expanded Camera Detail Modal */}
      {selectedCameraModal && (
        <CameraDetailModal
          camera={selectedCameraModal}
          isWebcam={selectedCameraModal.isDeviceHardware}
          onClose={() => setSelectedCameraModal(null)}
        />
      )}

      {/* Dynamic Virtual Fence & RTSP Configuration Modal */}
      {selectedFenceCamera && (
        <VirtualFenceConfigModal
          camera={selectedFenceCamera}
          onClose={() => setSelectedFenceCamera(null)}
          onSaveSuccess={(updatedCam) => {
            setCameras((prev) =>
              prev.map((c) => (c.id === updatedCam.id ? { ...c, ...updatedCam } : c))
            );
          }}
        />
      )}

      {/* Add IP Camera Modal */}
      <AddIpCameraModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onCameraAdded={() => {
          loadCameras();
        }}
      />
    </div>
  );
};

export default CamerasPage;
