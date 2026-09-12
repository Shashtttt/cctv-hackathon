import React, { useState, useEffect, useRef } from 'react';
import Hls from 'hls.js';
import {
  X,
  Maximize2,
  Minimize2,
  Camera,
  Video,
  Radio,
  Activity,
  Sliders,
  ShieldAlert,
  ShieldCheck,
  Zap,
  Cpu,
  Layers,
  Sparkles,
  Download,
  Crosshair,
  ZoomIn,
  ZoomOut,
  Compass,
  AlertTriangle,
  Flame,
  CheckCircle2,
  Play,
  Pause,
  RefreshCw,
  Eye,
  MapPin
} from 'lucide-react';
import { TRAFFIC_VISION_SETTINGS } from '../services/trafficVisionCatalog';
import './CameraDetailModal.css';

export const CameraDetailModal = ({
  camera,
  isWebcam = false,
  webcamStream = null,
  webcamTelemetry = {},
  liveDetections = [],
  onClose,
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [showAiOverlay, setShowAiOverlay] = useState(true);
  const [showVirtualFence, setShowVirtualFence] = useState(true);
  const [activeTab, setActiveTab] = useState('telemetry'); // telemetry | detections | events | ptz
  const [snapshotFeedback, setSnapshotFeedback] = useState(false);
  const [streamStats, setStreamStats] = useState({
    fps: isWebcam ? (webcamTelemetry.actualFps || 30) : (camera?.fps || 30),
    latency: isWebcam ? `${webcamTelemetry.lastLatencyMs || 10}ms` : '0.4s',
    bitrate: '5.2 Mbps',
    resolution: camera?.resolution || '1080p FHD',
    codec: 'H.264 / AVC-1',
    engine: isWebcam ? 'Apple Silicon Metal GPU (MPS)' : 'TrafficVision LowLatency Worker',
  });

  const modalRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const hlsRef = useRef(null);

  // Keyboard shortcut to close (Escape) or Fullscreen (F)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Initialize stream
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isWebcam && webcamStream) {
      video.srcObject = webcamStream;
      video.play().catch(() => {});
      return;
    }

    const streamUrl = camera?.streamUrl || '/videos/mumbai_traffic.mp4';
    const isHls = camera?.feedType === 'hls' || streamUrl.includes('.m3u8');
    
    if (isHls && Hls.isSupported()) {
      const hls = new Hls(TRAFFIC_VISION_SETTINGS.hls);
      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
    } else {
      video.src = streamUrl;
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      video.loop = true;
      video.onloadeddata = () => {
        video.play().catch(() => {});
      };
      video.play().catch(() => {});
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [camera, isWebcam, webcamStream]);

  // High-Speed Canvas AI Overlay Loop in Expanded View
  useEffect(() => {
    if (!showAiOverlay || !canvasRef.current || !videoRef.current) return;

    let animId;
    const canvas = canvasRef.current;
    const video = videoRef.current;

    const renderOverlay = () => {
      if (canvas && video) {
        const cw = canvas.clientWidth || 1280;
        const ch = canvas.clientHeight || 720;
        if (canvas.width !== cw || canvas.height !== ch) {
          canvas.width = cw;
          canvas.height = ch;
        }

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, cw, ch);

        // 1. Draw Virtual Perimeter Tripwire
        if (showVirtualFence) {
          ctx.save();
          ctx.strokeStyle = 'rgba(0, 242, 254, 0.4)';
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 6]);
          ctx.strokeRect(cw * 0.08, ch * 0.12, cw * 0.84, ch * 0.78);
          ctx.fillStyle = 'rgba(0, 242, 254, 0.8)';
          ctx.font = 'bold 11px JetBrains Mono, monospace';
          ctx.fillText('⚡ VIRTUAL PERIMETER TRIPWIRE ACTIVE', cw * 0.08 + 8, ch * 0.12 + 16);
          ctx.restore();
        }

        // 2. Draw Crosshair Center Sight
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 242, 254, 0.25)';
        ctx.lineWidth = 1;
        const cx = cw / 2;
        const cy = ch / 2;
        ctx.beginPath();
        ctx.moveTo(cx - 24, cy); ctx.lineTo(cx + 24, cy);
        ctx.moveTo(cx, cy - 24); ctx.lineTo(cx, cy + 24);
        ctx.arc(cx, cy, 36, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // 3. Draw Detections
        const dets = liveDetections || [];
        dets.forEach((det) => {
          if (!det.bbox) return;

          const bx = det.bbox.x * cw;
          const by = det.bbox.y * ch;
          const bw = det.bbox.w * cw;
          const bh = det.bbox.h * ch;
          const cName = (det.class_name || '').toLowerCase();
          const heldItem = (det.held_item || '').toLowerCase();
          const isWeaponItem = det.is_weapon || 
            ['knife', 'gun', 'pistol', 'rifle', 'shotgun', 'firearm', 'weapon', 'scissors', 'blade', 'dagger', 'machete', 'sword'].some(w => cName.includes(w) || heldItem.includes(w));
          const isArmed = det.is_holding && (det.held_item_type === 'WEAPON' || isWeaponItem);
          const isHoldingCasual = det.is_holding && det.held_item_type === 'CASUAL_OBJECT' && !isWeaponItem;
          const isPhone = cName.includes('phone') || cName.includes('cell') || heldItem.includes('phone');
          const isUnattendedBag = ['backpack', 'suitcase', 'handbag'].includes(cName) && !det.is_held;
          const isHandRaised = ['HANDS_RAISED', 'HAND_RAISED'].includes(det.pose_label);
          const isCriticalPose = ['CROUCHING', 'PRONE'].includes(det.pose_label);
          const isWeapon = isArmed || isWeaponItem;

          // Strict User Rule: Red for weapons/armed; Green for all casual objects, phones, and people
          const boxColor = isWeapon ? '#FF0033' : '#10B981';

          // Box
          ctx.save();
          ctx.strokeStyle = boxColor;
          ctx.lineWidth = isWeapon ? 3 : 2;
          ctx.shadowColor = boxColor;
          ctx.shadowBlur = isWeapon ? 18 : 8;
          ctx.strokeRect(bx, by, bw, bh);

          // Corner Reticles
          const cornerLen = Math.min(20, bw / 3);
          ctx.lineWidth = 3.5;
          ctx.beginPath();
          ctx.moveTo(bx, by + cornerLen); ctx.lineTo(bx, by); ctx.lineTo(bx + cornerLen, by);
          ctx.moveTo(bx + bw - cornerLen, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by + cornerLen);
          ctx.moveTo(bx, by + bh - cornerLen); ctx.lineTo(bx, by + bh); ctx.lineTo(bx + cornerLen, by + bh);
          ctx.moveTo(bx + bw - cornerLen, by + bh); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw, by + bh - cornerLen);
          ctx.stroke();

          // Crosshair for armed subjects or weapons
          if (isWeapon) {
            const cx = bx + bw / 2;
            const cy = by + bh / 2;
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(cx - 12, cy); ctx.lineTo(cx + 12, cy);
            ctx.moveTo(cx, cy - 12); ctx.lineTo(cx, cy + 12);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          ctx.restore();

          // Label
          ctx.save();
          const confStr = `${((det.confidence || 0.85) * 100).toFixed(0)}%`;
          let labelText = '';
          if (isArmed) {
            labelText = `🚨 ARMED SUBJECT: HOLDING ${det.held_item} (${(det.held_by_hand || 'HAND').replace('_', ' ')})`;
          } else if (isHoldingCasual) {
            const isHoldPhone = (det.held_item || '').toLowerCase().includes('phone') || (det.held_item || '').toLowerCase().includes('cell');
            labelText = isHoldPhone
              ? `📱 HOLDING PHONE (${(det.held_by_hand || 'HAND').replace('_', ' ')})`
              : `📦 HOLDING: ${det.held_item} (${(det.held_by_hand || 'HAND').replace('_', ' ')})`;
          } else if (isWeapon) {
            labelText = `🚨 WEAPON: ${(det.unusual_item || det.class_name).toUpperCase()} [${confStr}]`;
          } else if (isPhone) {
            labelText = `📱 CELL PHONE [${confStr}] ${det.is_held ? '• IN HAND' : '• DETECTED'}`;
          } else if (isUnattendedBag) {
            labelText = `⚠️ UNATTENDED BAGGAGE: ${det.class_name.toUpperCase()} [${confStr}]`;
          } else if (det.is_unusual && det.class_id !== 0) {
            labelText = `⚠️ MONITORED: ${(det.unusual_item || det.class_name).toUpperCase()} [${confStr}]`;
          } else if (det.class_id === 0) {
            labelText = `👤 ${det.target_id || 'PERSON'} [${det.pose_label || 'ACTIVE'}]`;
          } else if (isHandRaised) {
            labelText = `✋ ${det.target_id || 'PERSON'} [${det.pose_label.replace('_', ' ')}]`;
          } else {
            const icon = cName.includes('bottle') ? '🍾 ' : cName.includes('laptop') ? '💻 ' : cName.includes('cup') ? '☕ ' : cName.includes('book') ? '📖 ' : cName.includes('car') || cName.includes('truck') || cName.includes('bus') ? '🚗 ' : '🎯 ';
            labelText = `${icon}${det.class_name.toUpperCase()} [${confStr}] ${det.is_held ? '• HELD' : ''}`;
          }

          ctx.font = 'bold 12px JetBrains Mono, monospace';
          const textWidth = ctx.measureText(labelText).width;
          const tagY = Math.max(by - 24, 4);

          ctx.fillStyle = isWeapon ? 'rgba(255, 0, 51, 0.94)' : 'rgba(5, 30, 20, 0.92)';
          ctx.fillRect(bx, tagY, textWidth + 14, 20);
          ctx.strokeStyle = boxColor;
          ctx.lineWidth = 1;
          ctx.strokeRect(bx, tagY, textWidth + 14, 20);

          ctx.fillStyle = '#FFFFFF';
          ctx.fillText(labelText, bx + 7, tagY + 14);
          ctx.restore();
        });
      }
      animId = requestAnimationFrame(renderOverlay);
    };

    animId = requestAnimationFrame(renderOverlay);
    return () => cancelAnimationFrame(animId);
  }, [showAiOverlay, showVirtualFence, liveDetections]);

  const toggleFullscreen = () => {
    if (!modalRef.current) return;
    if (!document.fullscreenElement) {
      modalRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const handleCaptureSnapshot = () => {
    setSnapshotFeedback(true);
    setTimeout(() => setSnapshotFeedback(false), 1200);

    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/jpeg', 0.95);
    a.download = `CCTV_SNAPSHOT_${camera?.code || 'CAMERA'}_${Date.now()}.jpg`;
    a.click();
  };

  const camName = camera?.name || (isWebcam ? (camera?.deviceLabel || 'Physical Device Camera (AI Engine)') : 'Sector Camera');
  const camCode = camera?.code || (isWebcam ? 'C-01 AI' : 'CAM-01');
  const camLocation = camera?.location || (isWebcam ? 'Local Terminal Command Post' : 'Sector-4 Perimeter');

  return (
    <div className="camera-modal-backdrop" onClick={onClose}>
      <div
        ref={modalRef}
        className={`camera-modal-dialog ${isFullscreen ? 'fullscreen-mode' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Top Header */}
        <div className="camera-modal-top-bar font-mono">
          <div className="modal-bar-left">
            <div className="modal-cam-badge">
              <span className="pulse-dot"></span>
              <span className="cam-code-text">{camCode}</span>
            </div>
            <div className="modal-cam-titles">
              <h3 className="modal-cam-name">{camName}</h3>
              <span className="modal-cam-loc">{camLocation}</span>
            </div>
          </div>

          <div className="modal-bar-right">
            <div className="live-telemetry-chip">
              <Activity size={13} className="text-cyan" />
              <span>{isWebcam ? `${webcamTelemetry.actualFps || 30} FPS` : '60 FPS FHD'}</span>
            </div>

            <button
              className="modal-tool-btn"
              onClick={handleCaptureSnapshot}
              title="Capture High-Res Snapshot"
            >
              <Download size={15} />
              <span>SNAPSHOT</span>
            </button>

            <button
              className="modal-tool-btn"
              onClick={toggleFullscreen}
              title="Toggle Fullscreen (F)"
            >
              {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              <span>{isFullscreen ? 'EXIT' : 'FULLSCREEN'}</span>
            </button>

            <button
              className="modal-close-btn"
              onClick={onClose}
              title="Close (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Main Content (2-Column: Big Video Viewport + Right Inspector Sidebar) */}
        <div className="camera-modal-body">
          {/* Big Expanded Video Frame */}
          <div className="expanded-viewport-container">
            <div
              className="video-zoom-wrapper"
              style={{ transform: `scale(${zoomLevel})` }}
            >
              <video
                ref={videoRef}
                className="expanded-native-video"
                playsInline
                muted
                autoPlay
                loop
              />
              <canvas ref={canvasRef} className="expanded-ai-canvas" />
            </div>

            {/* Flash feedback on snapshot capture */}
            {snapshotFeedback && <div className="snapshot-flash-overlay"></div>}

            {/* In-Video Tactical HUD Controls */}
            <div className="in-video-hud-toolbar font-mono">
              <div className="zoom-controls">
                <button
                  className="hud-tool-btn"
                  onClick={() => setZoomLevel((z) => Math.max(1, z - 0.25))}
                  title="Zoom Out"
                >
                  <ZoomOut size={14} />
                </button>
                <span className="zoom-level-text">{(zoomLevel * 100).toFixed(0)}%</span>
                <button
                  className="hud-tool-btn"
                  onClick={() => setZoomLevel((z) => Math.min(3, z + 0.25))}
                  title="Zoom In"
                >
                  <ZoomIn size={14} />
                </button>
              </div>

              <div className="overlay-toggles">
                <button
                  className={`hud-toggle-btn ${showAiOverlay ? 'active' : ''}`}
                  onClick={() => setShowAiOverlay(!showAiOverlay)}
                >
                  <Sparkles size={13} />
                  <span>AI OVERLAY</span>
                </button>

                <button
                  className={`hud-toggle-btn ${showVirtualFence ? 'active' : ''}`}
                  onClick={() => setShowVirtualFence(!showVirtualFence)}
                >
                  <Crosshair size={13} />
                  <span>VIRTUAL FENCE</span>
                </button>
              </div>
            </div>
          </div>

          {/* Right Inspector & Telemetry Sidebar */}
          <div className="camera-inspector-sidebar font-mono">
            {/* Inspector Tab Bar */}
            <div className="inspector-tabs">
              <button
                className={`inspector-tab-btn ${activeTab === 'telemetry' ? 'active' : ''}`}
                onClick={() => setActiveTab('telemetry')}
              >
                TELEMETRY
              </button>
              <button
                className={`inspector-tab-btn ${activeTab === 'detections' ? 'active' : ''}`}
                onClick={() => setActiveTab('detections')}
              >
                DETECTIONS ({liveDetections.length})
              </button>
              <button
                className={`inspector-tab-btn ${activeTab === 'ptz' ? 'active' : ''}`}
                onClick={() => setActiveTab('ptz')}
              >
                PTZ & FENCE
              </button>
            </div>

            {/* Tab 1: Live Hardware Telemetry */}
            {activeTab === 'telemetry' && (
              <div className="inspector-tab-content">
                <div className="telemetry-section-title">STREAM SPECIFICATIONS</div>
                <div className="telemetry-keyval-grid">
                  <div className="telemetry-card">
                    <span className="key-lbl">VIDEO CODEC</span>
                    <span className="val-text text-cyan">{streamStats.codec}</span>
                  </div>
                  <div className="telemetry-card">
                    <span className="key-lbl">RESOLUTION</span>
                    <span className="val-text text-white">{streamStats.resolution}</span>
                  </div>
                  <div className="telemetry-card">
                    <span className="key-lbl">FRAME RATE</span>
                    <span className="val-text text-green">{streamStats.fps} FPS</span>
                  </div>
                  <div className="telemetry-card">
                    <span className="key-lbl">LATENCY</span>
                    <span className="val-text text-yellow">{streamStats.latency}</span>
                  </div>
                  <div className="telemetry-card">
                    <span className="key-lbl">BITRATE</span>
                    <span className="val-text text-white">{streamStats.bitrate}</span>
                  </div>
                  <div className="telemetry-card">
                    <span className="key-lbl">AI ACCELERATION</span>
                    <span className="val-text text-purple">{streamStats.engine}</span>
                  </div>
                  <div className="telemetry-card" style={{ gridColumn: 'span 2' }}>
                    <span className="key-lbl flex items-center gap-1">
                      <MapPin size={11} className="text-cyan" /> GEOGRAPHIC GPS COORDINATES
                    </span>
                    <span className="val-text text-cyan">
                      {isWebcam ? (webcamTelemetry.gpsCoords || '34.1524° N, 74.8211° E (Device Sensor)') : (camera?.gps || camera?.gps_coords || '34.1524° N, 74.8211° E')}
                    </span>
                  </div>
                </div>

                <div className="telemetry-section-title mt-4">SURVEILLANCE HEALTH</div>
                <div className="status-indicator-box">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-green" />
                    <span className="text-white font-bold">STREAM SYNCHRONIZED</span>
                  </div>
                  <p className="text-muted text-xs mt-1">
                    Zero frame drops in the last 15 minutes. Tripwire boundaries calibrated.
                  </p>
                </div>
              </div>
            )}

            {/* Tab 2: AI Detections & Threat Analysis */}
            {activeTab === 'detections' && (
              <div className="inspector-tab-content">
                <div className="telemetry-section-title">ACTIVE DETECTED TARGETS</div>
                {liveDetections.length === 0 ? (
                  <div className="empty-detections-state text-muted text-center py-6">
                    <Eye size={24} className="mx-auto mb-2 opacity-50" />
                    <span>No active security threats in frame.</span>
                  </div>
                ) : (
                  <div className="detections-list">
                    {liveDetections.map((det, idx) => {
                      const isUnusual = det.is_unusual || det.unusual_item || det.threat_level === 'CRITICAL';
                      return (
                        <div
                          key={idx}
                          className={`detection-inspector-item ${isUnusual ? 'unusual-item-card' : ''}`}
                        >
                          <div className="flex justify-between items-center">
                            <span className="font-bold text-white">
                              {isUnusual ? `⚠️ ${det.unusual_item || 'UNUSUAL OBJECT'}` : `${det.target_id || 'PERSON'} #${idx + 1}`}
                            </span>
                            <span className={`pill-badge ${isUnusual ? 'pill-red' : 'pill-green'}`}>
                              {isUnusual ? 'CRITICAL ALERT' : 'TRACKED'}
                            </span>
                          </div>
                          <div className="text-xs text-muted mt-1">
                            Pose: <span className="text-cyan">{det.pose_label || 'NORMAL'}</span> • Conf: <span className="text-white">{((det.bbox?.confidence || 0.92) * 100).toFixed(0)}%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Tab 3: PTZ & Perimeter Fence Settings */}
            {activeTab === 'ptz' && (
              <div className="inspector-tab-content">
                <div className="telemetry-section-title">PAN-TILT-ZOOM CONTROLS</div>
                <div className="ptz-joystick-grid">
                  <button className="ptz-btn" title="Tilt Up">▲</button>
                  <div className="ptz-row">
                    <button className="ptz-btn" title="Pan Left">◀</button>
                    <div className="ptz-center-node">PTZ</div>
                    <button className="ptz-btn" title="Pan Right">▶</button>
                  </div>
                  <button className="ptz-btn" title="Tilt Down">▼</button>
                </div>

                <div className="telemetry-section-title mt-4">VIRTUAL FENCE BOUNDARY</div>
                <button
                  className="modal-action-btn w-full"
                  onClick={() => setShowVirtualFence(!showVirtualFence)}
                >
                  <Crosshair size={14} />
                  <span>{showVirtualFence ? 'HIDE VIRTUAL TRIPWIRE' : 'SHOW VIRTUAL TRIPWIRE'}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CameraDetailModal;
