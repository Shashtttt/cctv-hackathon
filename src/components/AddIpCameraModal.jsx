import React, { useState, useEffect } from 'react';
import {
  X,
  Radio,
  Camera,
  Smartphone,
  Wifi,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Copy,
  Check,
  ShieldAlert,
  Cpu,
  Video,
  ExternalLink,
  HelpCircle,
  Play,
  Layers,
  Sparkles,
  MapPin,
  Sliders,
  ScanLine
} from 'lucide-react';
import { testCameraStream, fetchNetworkInfo, createCamera } from '../services/apiService';
import './AddIpCameraModal.css';

const PRESETS = [
  {
    id: 'ipwebcam',
    name: 'Android IP Webcam App',
    badge: 'PHONE APP',
    icon: Smartphone,
    url: 'http://192.168.1.50:8080/video',
    fps: 25,
    resolution: '1080p FHD',
    desc: 'Default video feed from the popular IP Webcam Android app',
  },
  {
    id: 'droidcam',
    name: 'DroidCam / Iriun WebCam',
    badge: 'MOBILE STREAM',
    icon: Smartphone,
    url: 'http://192.168.1.50:4747/video',
    fps: 30,
    resolution: '1080p FHD',
    desc: 'MJPEG video port from DroidCam on port 4747',
  },
  {
    id: 'rtsp_cctv',
    name: 'Network RTSP Camera',
    badge: 'CCTV / NVR',
    icon: Camera,
    url: 'rtsp://admin:password@192.168.1.100:554/live/ch0',
    fps: 25,
    resolution: '1080p FHD',
    desc: 'Standard H.264 RTSP stream from Hikvision, Dahua, Reolink, etc.',
  },
  {
    id: 'esp32',
    name: 'ESP32-CAM / IoT Node',
    badge: 'IOT SENSOR',
    icon: Cpu,
    url: 'http://192.168.1.50:81/stream',
    fps: 15,
    resolution: '720p HD',
    desc: 'Low-power micro-surveillance node running MJPEG on port 81',
  },
  {
    id: 'snapshot',
    name: 'Snapshot Polling Feed',
    badge: 'JPEG PULL',
    icon: ScanLine,
    url: 'http://192.168.1.50:8080/shot.jpg',
    fps: 15,
    resolution: '1080p FHD',
    desc: 'High-reliability single frame capture polled at 15 FPS',
  },
  {
    id: 'custom',
    name: 'Custom RTSP / HTTP URL',
    badge: 'MANUAL',
    icon: Video,
    url: '',
    fps: 25,
    resolution: '1080p FHD',
    desc: 'Enter any valid IP camera RTSP, RTMP, HTTP, or MJPEG URL',
  },
];

const ANALYTICS_OPTIONS = [
  { id: 'WEAPON', label: 'Weapon & Armed Threat Detection', icon: ShieldAlert, defaultChecked: true },
  { id: 'INTRUSION', label: 'Virtual Fence Tripwire Intrusion', icon: Layers, defaultChecked: true },
  { id: 'PERSON', label: '17-Point Pose Skeleton & Human Tracker', icon: Radio, defaultChecked: true },
  { id: 'LOITERING', label: 'Dwell Time & Suspicious Loitering', icon: Sliders, defaultChecked: true },
  { id: 'FRS', label: 'FRS Face Recognition Watchlist', icon: Sparkles, defaultChecked: false },
  { id: 'ANPR', label: 'ANPR Automatic License Plate Recognition', icon: Video, defaultChecked: false },
];

export const AddIpCameraModal = ({ isOpen = true, onClose, onCameraAdded }) => {
  const [activeTab, setActiveTab] = useState('network'); // 'network' | 'webpair'
  
  // Network stream form state
  const [selectedPreset, setSelectedPreset] = useState('ipwebcam');
  const [cameraName, setCameraName] = useState('Mobile IP Surveillance Unit');
  const [cameraCode, setCameraCode] = useState(`IP-CAM-${Math.floor(10 + Math.random() * 90)}`);
  const [location, setLocation] = useState('Sector 04 - High Patrol Post');
  const [streamUrl, setStreamUrl] = useState('http://192.168.1.50:8080/video');
  const [fps, setFps] = useState(25);
  const [resolution, setResolution] = useState('1080p FHD');
  const [selectedAnalytics, setSelectedAnalytics] = useState(['WEAPON', 'INTRUSION', 'PERSON', 'LOITERING']);

  // Stream test state
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Web Pair (Phone pairing) state
  const [networkInfo, setNetworkInfo] = useState(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');

  // Helper to compute pairing origin with detected LAN IP
  const getPairOrigin = (netInfo) => {
    const lan = netInfo?.lan_ip;
    if (lan && lan !== '127.0.0.1' && lan !== 'localhost') {
      const port = window.location.port ? `:${window.location.port}` : '';
      return `${window.location.protocol}//${lan}${port}`;
    }
    return window.location.origin;
  };

  // Load network info on mount
  useEffect(() => {
    if (!isOpen) return;
    const loadNet = async () => {
      const info = await fetchNetworkInfo();
      setNetworkInfo(info);
      
      const origin = getPairOrigin(info);
      const pairUrl = `${origin}/?mode=remote-cam&cam_id=${cameraCode.toLowerCase()}`;
      
      // Attempt dynamic QRCode generation
      try {
        const QRCode = await import('qrcode');
        const qr = await QRCode.toDataURL(pairUrl, {
          width: 240,
          margin: 1,
          color: {
            dark: '#00f2fe',
            light: '#070c14',
          },
        });
        setQrCodeDataUrl(qr);
      } catch (err) {
        console.debug('QR Code generation fallback:', err);
      }
    };
    loadNet();
  }, [isOpen, cameraCode]);

  if (!isOpen) return null;

  const handleSelectPreset = (preset) => {
    setSelectedPreset(preset.id);
    if (preset.url) {
      // Replace IP segment if user already entered an IP
      const currentIpMatch = streamUrl.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
      if (currentIpMatch && currentIpMatch[0] !== '192.168.1.50') {
        const newUrl = preset.url.replace('192.168.1.50', currentIpMatch[0]);
        setStreamUrl(newUrl);
      } else {
        setStreamUrl(preset.url);
      }
    }
    setFps(preset.fps);
    setResolution(preset.resolution);
    setTestResult(null);
  };

  const handleTestStream = async () => {
    if (!streamUrl.trim()) return;
    setTesting(true);
    setTestResult(null);
    setSaveError(null);
    try {
      const res = await testCameraStream(streamUrl.trim());
      setTestResult(res);
    } catch (err) {
      setTestResult({
        reachable: false,
        error: err?.response?.data?.detail || err?.message || 'Connection timed out or failed.',
      });
    } finally {
      setTesting(false);
    }
  };

  const toggleAnalytics = (id) => {
    setSelectedAnalytics((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSaveCamera = async (e) => {
    e.preventDefault();
    if (!streamUrl.trim()) {
      setSaveError('Stream URL is required.');
      return;
    }

    setSaving(true);
    setSaveError(null);

    const payload = {
      id: cameraCode.toLowerCase().replace(/[^a-z0-9-_]/g, '-'),
      code: cameraCode.toUpperCase(),
      name: cameraName.trim() || 'External IP Camera',
      location: location.trim() || 'External Device Feed',
      rtsp_url: streamUrl.trim(),
      fps: parseInt(fps, 10) || 25,
      resolution,
      mode: 'IP ACTIVE',
      analytics_modes: selectedAnalytics,
      fence_points: [],
      rtsp_reconnect_attempts: 10,
    };

    try {
      const created = await createCamera(payload);
      if (onCameraAdded) {
        onCameraAdded(created);
      }
      onClose();
    } catch (err) {
      setSaveError(err?.response?.data?.detail || err?.message || 'Failed to save camera.');
    } finally {
      setSaving(false);
    }
  };

  const currentPairUrl = `${getPairOrigin(networkInfo)}/?mode=remote-cam&cam_id=${cameraCode.toLowerCase()}`;

  const copyPairingLink = () => {
    navigator.clipboard.writeText(currentPairUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleLaunchMobile = async () => {
    try {
      const payload = {
        id: cameraCode.toLowerCase().replace(/[^a-z0-9-_]/g, '-'),
        code: cameraCode.toUpperCase(),
        name: `Mobile Unit (${cameraCode.toUpperCase()})`,
        location: location.trim() || 'Mobile Patrol Sector',
        rtsp_url: `mobile://${cameraCode.toLowerCase()}`,
        fps: 20,
        resolution: '720p HD',
        mode: 'MOBILE PAIRED',
        analytics_modes: selectedAnalytics,
        fence_points: [],
      };
      await createCamera(payload);
      if (onCameraAdded) onCameraAdded();
    } catch (err) {
      console.debug('Pre-registration note:', err);
    }
    window.open(currentPairUrl, '_blank');
  };

  return (
    <div className="ip-modal-backdrop" onClick={onClose}>
      <div className="ip-modal-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Top Header Bar */}
        <div className="ip-modal-header">
          <div className="header-title-group">
            <div className="header-icon-box">
              <Radio size={20} className="text-cyan pulse-glow" />
            </div>
            <div>
              <div className="header-title-row font-mono">
                <h3>ADD IP CAMERA / DEVICE FEED</h3>
                <span className="pill-badge pill-cyan font-mono">NETWORK INGEST</span>
              </div>
              <p className="header-sub-text">
                Connect external RTSP CCTV, smartphone camera apps, or pair another phone via QR code.
              </p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Tab Selection Bar */}
        <div className="ip-modal-tabs font-mono">
          <button
            className={`ip-tab-btn ${activeTab === 'network' ? 'active' : ''}`}
            onClick={() => setActiveTab('network')}
          >
            <Wifi size={15} /> NETWORK STREAM / IP APP (RTSP/MJPEG)
          </button>
          <button
            className={`ip-tab-btn ${activeTab === 'webpair' ? 'active' : ''}`}
            onClick={() => setActiveTab('webpair')}
          >
            <Smartphone size={15} /> WEB PAIR MOBILE CAMERA (QR CODE)
          </button>
        </div>

        {/* Modal Body Container */}
        <div className="ip-modal-body">
          {activeTab === 'network' && (
            <div className="network-stream-layout">
              {/* Presets Strip */}
              <div className="presets-section">
                <span className="section-label font-mono">SELECT FEED PRESET / DEVICE TYPE:</span>
                <div className="preset-cards-grid">
                  {PRESETS.map((p) => {
                    const Icon = p.icon;
                    const isSelected = selectedPreset === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`preset-card font-mono ${isSelected ? 'selected' : ''}`}
                        onClick={() => handleSelectPreset(p)}
                      >
                        <div className="preset-top">
                          <Icon size={16} className={isSelected ? 'text-cyan' : 'text-muted'} />
                          <span className="preset-badge">{p.badge}</span>
                        </div>
                        <span className="preset-name">{p.name}</span>
                        <span className="preset-desc font-sans">{p.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Camera Details Form */}
              <form onSubmit={handleSaveCamera} className="ip-form-grid">
                <div className="form-column">
                  <div className="form-group">
                    <label className="font-mono">CAMERA IDENTIFIER / CODE</label>
                    <input
                      type="text"
                      value={cameraCode}
                      onChange={(e) => setCameraCode(e.target.value.toUpperCase())}
                      className="tactical-input font-mono"
                      placeholder="e.g. IP-CAM-01"
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="font-mono">CAMERA NAME</label>
                    <input
                      type="text"
                      value={cameraName}
                      onChange={(e) => setCameraName(e.target.value)}
                      className="tactical-input"
                      placeholder="e.g. Officer Smartphone Feed"
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="font-mono">SECTOR / PHYSICAL LOCATION</label>
                    <div className="input-with-icon">
                      <MapPin size={15} className="input-icon" />
                      <input
                        type="text"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        className="tactical-input with-left-icon"
                        placeholder="e.g. Sector 04 - West Perimeter"
                        required
                      />
                    </div>
                  </div>

                  <div className="form-row-2">
                    <div className="form-group">
                      <label className="font-mono">RESOLUTION</label>
                      <select
                        value={resolution}
                        onChange={(e) => setResolution(e.target.value)}
                        className="tactical-select font-mono"
                      >
                        <option value="720p HD">720p HD</option>
                        <option value="1080p FHD">1080p FHD</option>
                        <option value="4K UHD">4K UHD</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label className="font-mono">TARGET FPS</label>
                      <select
                        value={fps}
                        onChange={(e) => setFps(Number(e.target.value))}
                        className="tactical-select font-mono"
                      >
                        <option value={15}>15 FPS (Eco)</option>
                        <option value={20}>20 FPS (Standard)</option>
                        <option value={25}>25 FPS (Smooth)</option>
                        <option value={30}>30 FPS (Full)</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Right Column: Stream URL + Test Box + Analytics */}
                <div className="form-column">
                  <div className="form-group">
                    <label className="font-mono stream-url-label">
                      <span>STREAM RTSP / HTTP URL</span>
                      <span className="url-hint font-sans">e.g. http://192.168.1.XX:8080/video</span>
                    </label>
                    <div className="stream-url-row">
                      <input
                        type="text"
                        value={streamUrl}
                        onChange={(e) => {
                          setStreamUrl(e.target.value);
                          setTestResult(null);
                        }}
                        className="tactical-input font-mono"
                        placeholder="http://<ip>:8080/video or rtsp://..."
                        required
                      />
                      <button
                        type="button"
                        className="test-btn font-mono"
                        onClick={handleTestStream}
                        disabled={testing || !streamUrl.trim()}
                      >
                        {testing ? (
                          <>
                            <RefreshCw size={14} className="spin-icon" /> TESTING...
                          </>
                        ) : (
                          <>
                            <Play size={14} /> TEST STREAM
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Test Stream Result Feedback */}
                  {testResult && (
                    <div className={`stream-test-card ${testResult.reachable ? 'success' : 'failed'}`}>
                      {testResult.reachable ? (
                        <div className="test-success-row">
                          <div className="test-success-info font-mono">
                            <span className="status-badge-ok">
                              <CheckCircle2 size={15} /> STREAM ONLINE
                            </span>
                            <span className="telemetry-tag">LATENCY: {testResult.latency_ms}ms</span>
                            <span className="telemetry-tag">DETECTED: {testResult.resolution}</span>
                          </div>
                          {testResult.preview_base64 && (
                            <div className="test-preview-thumbnail">
                              <img src={testResult.preview_base64} alt="Camera Preview" />
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="test-fail-row">
                          <AlertTriangle size={18} className="text-red" />
                          <div className="test-fail-text font-mono">
                            <span className="text-red">STREAM UNREACHABLE ({testResult.latency_ms}ms)</span>
                            <span className="error-detail font-sans">{testResult.error}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* AI Analytics Modules */}
                  <div className="form-group">
                    <label className="font-mono">ACTIVE AI SURVEILLANCE MODULES</label>
                    <div className="analytics-checkboxes-grid">
                      {ANALYTICS_OPTIONS.map((opt) => {
                        const Icon = opt.icon;
                        const isChecked = selectedAnalytics.includes(opt.id);
                        return (
                          <label
                            key={opt.id}
                            className={`analytics-chip ${isChecked ? 'active' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleAnalytics(opt.id)}
                            />
                            <Icon size={14} />
                            <span>{opt.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </form>

              {saveError && (
                <div className="save-error-banner font-mono">
                  <AlertTriangle size={15} /> {saveError}
                </div>
              )}
            </div>
          )}

          {activeTab === 'webpair' && (
            <div className="webpair-layout">
              <div className="webpair-left">
                <div className="qr-card">
                  <span className="qr-badge font-mono">SCAN WITH MOBILE CAMERA</span>
                  <div className="qr-image-box">
                    {qrCodeDataUrl ? (
                      <img src={qrCodeDataUrl} alt="Pairing QR Code" className="qr-code-img" />
                    ) : (
                      <div className="qr-placeholder font-mono">
                        <ScanLine size={48} className="text-cyan pulse-glow" />
                        <span>GENERATING SECURE QR KEY...</span>
                      </div>
                    )}
                  </div>
                  <span className="qr-sub font-mono">SECURE SSL WEBCAM TELEMETRY LINK</span>
                </div>
              </div>

              <div className="webpair-right">
                <div className="pairing-steps font-sans">
                  <h4 className="font-mono">📱 ZERO-INSTALL SMARTPHONE PAIRING:</h4>
                  <ol className="steps-list">
                    <li>
                      <strong>Connect to Same Wi-Fi:</strong> Ensure your phone or external device is on the same local Wi-Fi or hotspot.
                    </li>
                    <li>
                      <strong>Scan or Open Link:</strong> Scan the QR code with your phone camera, or open the link below in Chrome / Safari.
                    </li>
                    <li>
                      <strong>Allow Camera Access:</strong> Tap Allow Camera. Your phone will immediately start streaming high-definition video, GPS telemetry, and gyro sensors directly into the defense matrix!
                    </li>
                  </ol>
                  <div className="ssl-tip-banner font-mono">
                    <span className="text-cyan">💡 BROWSER TIP:</span> When opening for the first time on mobile, tap <strong>"Advanced" → "Proceed to {networkInfo?.lan_ip || 'host'}"</strong> to accept the local secure SSL certificate.
                  </div>
                </div>

                <div className="direct-link-box font-mono">
                  <label>OR OPEN THIS LINK ON THE OTHER DEVICE:</label>
                  <div className="link-input-row">
                    <input
                      type="text"
                      readOnly
                      value={currentPairUrl}
                      className="tactical-input font-mono readonly-link"
                    />
                    <button
                      type="button"
                      className="copy-btn font-mono"
                      onClick={copyPairingLink}
                    >
                      {copiedLink ? (
                        <>
                          <Check size={14} className="text-green" /> COPIED!
                        </>
                      ) : (
                        <>
                          <Copy size={14} /> COPY LINK
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="network-telemetry-pill font-mono">
                  <Wifi size={14} className="text-cyan" />
                  <span>LOCAL LAN IP: {networkInfo?.lan_ip || window.location.hostname}</span>
                  <span className="dot-separator">•</span>
                  <span>ENCRYPTION: TLS / HTTPS</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="ip-modal-footer">
          <button type="button" className="btn-secondary font-mono" onClick={onClose}>
            CANCEL
          </button>
          {activeTab === 'network' ? (
            <button
              type="button"
              className="btn-primary font-mono"
              onClick={handleSaveCamera}
              disabled={saving || !streamUrl.trim()}
            >
              {saving ? (
                <>
                  <RefreshCw size={15} className="spin-icon" /> CONNECTING & SAVING...
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} /> ADD CAMERA TO DEFENSE GRID
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary font-mono"
              onClick={handleLaunchMobile}
            >
              <ExternalLink size={16} /> TEST LAUNCH MOBILE CAM IN NEW TAB
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
