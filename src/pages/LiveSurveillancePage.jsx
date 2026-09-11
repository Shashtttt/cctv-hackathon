import React, { useState, useEffect, useRef } from 'react';
import { 
  Video, 
  Filter, 
  Grid2X2, 
  Grid3X3, 
  Square, 
  RefreshCw, 
  Maximize2, 
  MoreVertical, 
  Hand, 
  ZoomIn, 
  AlertTriangle, 
  AlertOctagon,
  ShieldCheck, 
  Radio, 
  Clock, 
  ChevronRight,
  Eye,
  Truck,
  UserCheck,
  Sliders,
  CheckCircle2,
  Shield,
  Cpu,
  Smartphone
} from 'lucide-react';
import { fetchCameras, fetchAlerts, acknowledgeAlert, getCameraStreamUrl } from '../services/apiService';
import { useWebcamBridge } from '../services/useWebcamBridge';
import { TrafficVisionPlayer } from '../components/TrafficVisionPlayer';
import { CameraDetailModal } from '../components/CameraDetailModal';
import { INDIA_TRAFFIC_CAMERAS } from '../services/trafficVisionCatalog';
import { Camera as CameraIcon, Globe } from 'lucide-react';
import './LiveSurveillancePage.css';

// COCO Skeleton limb connections
const SKELETON_LIMBS = [
  [0, 1], [0, 2], [1, 3], [2, 4],           // Face / Head
  [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],  // Arms
  [5, 11], [6, 12], [11, 12],               // Torso
  [11, 13], [13, 15], [12, 14], [14, 16],   // Legs
];

const LiveSurveillancePage = ({ onNavigateToAlerts }) => {
  const [viewMode, setViewMode] = useState('trafficvision'); // 'trafficvision' | 'matrix' | 'webcam'
  const [layoutGrid, setLayoutGrid] = useState('2x2');
  const [selectedFilter, setSelectedFilter] = useState('all');
  const [acknowledgedAlert, setAcknowledgedAlert] = useState(false);
  const [streamErrorFlags, setStreamErrorFlags] = useState({});
  const [liveAlerts, setLiveAlerts] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [selectedTrafficCam, setSelectedTrafficCam] = useState(INDIA_TRAFFIC_CAMERAS[0]);
  const [expandedModalCamera, setExpandedModalCamera] = useState(null); // Camera object or 'webcam'

  const webcamVideoRef = useRef(null);
  const overlayCanvasRef = useRef(null);

  // Dynamic Device & Physical Camera AI bridge
  const {
    isWebcamActive,
    localStream,
    startWebcam,
    stopWebcam,
    switchCamera,
    selectCamera,
    liveDetections,
    latestAnnotatedFrame,
    telemetry: webcamTelemetry,
    webcamError,
    deviceInfo,
    availableCameras,
    activeDeviceId,
    activeCameraLabel,
    facingMode,
  } = useWebcamBridge('cam-01', 25, webcamVideoRef);

  // Attach local media stream directly to video element for 60 FPS zero-lag playback
  useEffect(() => {
    if (webcamVideoRef.current && localStream) {
      webcamVideoRef.current.srcObject = localStream;
      webcamVideoRef.current.play().catch((err) => console.debug('Video play error:', err));
    }
  }, [localStream, isWebcamActive]);

  // High-Speed 60 FPS Hardware-Accelerated Canvas Overlay Loop
  useEffect(() => {
    if (!isWebcamActive || !overlayCanvasRef.current || !webcamVideoRef.current) return;

    let animId;
    const canvas = overlayCanvasRef.current;
    const video = webcamVideoRef.current;

    const renderOverlay = () => {
      if (canvas && video && video.videoWidth > 0) {
        const cw = canvas.clientWidth || video.videoWidth || 640;
        const ch = canvas.clientHeight || video.videoHeight || 360;
        if (canvas.width !== cw || canvas.height !== ch) {
          canvas.width = cw;
          canvas.height = ch;
        }

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, cw, ch);

        const dets = liveDetections || [];

        // 1. Draw Tether Lines between persons and held items
        dets.forEach((det) => {
          if (det.is_holding && det.held_item) {
            const heldObj = dets.find((o) => o.held_by_target_id === det.target_id && o.bbox);
            if (heldObj && det.bbox) {
              const px1 = det.bbox.x * cw;
              const py1 = det.bbox.y * ch;
              const pw = det.bbox.w * cw;
              const ph = det.bbox.h * ch;

              const ox1 = heldObj.bbox.x * cw;
              const oy1 = heldObj.bbox.y * ch;
              const ow = heldObj.bbox.w * cw;
              const oh = heldObj.bbox.h * ch;

              const objCenter = { x: ox1 + ow / 2, y: oy1 + oh / 2 };
              let startPt = { x: px1 + pw / 2, y: py1 + ph / 2 };

              if (det.keypoints && det.keypoints.length >= 11) {
                const lWrist = det.keypoints[9];
                const rWrist = det.keypoints[10];
                if (det.held_by_hand === 'LEFT_HAND' && lWrist && lWrist.conf > 0.2) {
                  startPt = { x: lWrist.x * cw, y: lWrist.y * ch };
                } else if (det.held_by_hand === 'RIGHT_HAND' && rWrist && rWrist.conf > 0.2) {
                  startPt = { x: rWrist.x * cw, y: rWrist.y * ch };
                } else if (rWrist && rWrist.conf > 0.2) {
                  startPt = { x: rWrist.x * cw, y: rWrist.y * ch };
                } else if (lWrist && lWrist.conf > 0.2) {
                  startPt = { x: lWrist.x * cw, y: lWrist.y * ch };
                }
              }

              const tetherColor = det.held_item_type === 'WEAPON' ? '#FF0033' : '#00F2FE';
              ctx.save();
              ctx.strokeStyle = tetherColor;
              ctx.lineWidth = det.held_item_type === 'WEAPON' ? 2.5 : 1.5;
              ctx.setLineDash([4, 3]);
              ctx.shadowColor = tetherColor;
              ctx.shadowBlur = 8;
              ctx.beginPath();
              ctx.moveTo(startPt.x, startPt.y);
              ctx.lineTo(objCenter.x, objCenter.y);
              ctx.stroke();

              ctx.setLineDash([]);
              ctx.fillStyle = tetherColor;
              ctx.beginPath();
              ctx.arc(objCenter.x, objCenter.y, 4, 0, 2 * Math.PI);
              ctx.fill();
              ctx.restore();
            }
          }
        });

        // 2. Draw each detected target
        dets.forEach((det) => {
          if (!det.bbox) return;

          const bx = det.bbox.x * cw;
          const by = det.bbox.y * ch;
          const bw = det.bbox.w * cw;
          const bh = det.bbox.h * ch;

          const isArmed = det.is_holding && det.held_item_type === 'WEAPON';
          const isWeapon = det.is_weapon;
          const isHoldingCasual = det.is_holding && det.held_item_type === 'CASUAL_OBJECT';
          const isUnattendedBag = ['backpack', 'suitcase', 'handbag'].includes(det.class_name?.toLowerCase()) && !det.is_held;
          const isUnusual = det.is_unusual || det.unusual_item || isWeapon || isArmed;
          const isHandRaised = ['HANDS_RAISED', 'HAND_RAISED'].includes(det.pose_label);
          const isCriticalPose = ['CROUCHING', 'PRONE'].includes(det.pose_label);
          const isAlert = isUnusual || isCriticalPose || isHandRaised || isArmed || isWeapon;

          let boxColor = det.class_id === 0 ? '#00F2FE' : '#FBBF24';
          if (isArmed || isWeapon) {
            boxColor = '#FF0033';
          } else if (isUnattendedBag) {
            boxColor = '#F97316';
          } else if (isHoldingCasual) {
            boxColor = '#06B6D4';
          } else if (isUnusual) {
            boxColor = '#FF0033';
          } else if (isHandRaised) {
            boxColor = '#F59E0B';
          } else if (isCriticalPose) {
            boxColor = '#EC4899';
          }

          // 1. Draw Bounding Box with Cyber Glow
          ctx.save();
          ctx.strokeStyle = boxColor;
          ctx.lineWidth = isAlert ? 3 : 2;
          ctx.shadowColor = boxColor;
          ctx.shadowBlur = isAlert ? 16 : 6;
          ctx.strokeRect(bx, by, bw, bh);

          // 2. Corner Bracket Reticles
          const cornerSize = Math.min(18, Math.max(6, bw / 4));
          ctx.lineWidth = isAlert ? 4 : 3;
          ctx.beginPath();
          ctx.moveTo(bx, by + cornerSize); ctx.lineTo(bx, by); ctx.lineTo(bx + cornerSize, by);
          ctx.moveTo(bx + bw - cornerSize, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by + cornerSize);
          ctx.moveTo(bx, by + bh - cornerSize); ctx.lineTo(bx, by + bh); ctx.lineTo(bx + cornerSize, by + bh);
          ctx.moveTo(bx + bw - cornerSize, by + bh); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw, by + bh - cornerSize);
          ctx.stroke();

          // Crosshair on armed targets
          if (isArmed || isWeapon) {
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

          // 3. Draw 17-Keypoint Pose Skeleton for Humans
          if (det.keypoints && det.keypoints.length > 0) {
            const kps = det.keypoints;
            ctx.save();
            ctx.lineWidth = 2.5;

            // Draw limbs
            SKELETON_LIMBS.forEach(([i1, i2]) => {
              if (i1 < kps.length && i2 < kps.length) {
                const kp1 = kps[i1];
                const kp2 = kps[i2];
                if (kp1.conf > 0.35 && kp2.conf > 0.35) {
                  ctx.strokeStyle = isArmed ? '#FF0033' : isHoldingCasual ? '#06B6D4' : isHandRaised ? '#F59E0B' : '#10B981';
                  ctx.beginPath();
                  ctx.moveTo(kp1.x * cw, kp1.y * ch);
                  ctx.lineTo(kp2.x * cw, kp2.y * ch);
                  ctx.stroke();
                }
              }
            });

            // Draw joints
            kps.forEach((kp) => {
              if (kp.conf > 0.35) {
                ctx.fillStyle = isArmed ? '#FF0033' : isHoldingCasual ? '#06B6D4' : isHandRaised ? '#FBBF24' : '#00F2FE';
                ctx.beginPath();
                ctx.arc(kp.x * cw, kp.y * ch, 3.5, 0, 2 * Math.PI);
                ctx.fill();
              }
            });
            ctx.restore();
          }

          // 4. Tactical Floating Label Tag
          let labelText = '';
          if (isArmed) {
            labelText = `🚨 ARMED SUBJECT: HOLDING ${det.held_item} (${(det.held_by_hand || 'HAND').replace('_', ' ')})`;
          } else if (isHoldingCasual) {
            labelText = `📦 HOLDING: ${det.held_item} (${(det.held_by_hand || 'HAND').replace('_', ' ')})`;
          } else if (isWeapon) {
            labelText = `🚨 WEAPON: ${det.class_name.toUpperCase()} [${((det.confidence || 0.9) * 100).toFixed(0)}%]`;
          } else if (isUnattendedBag) {
            labelText = `⚠️ UNATTENDED BAGGAGE: ${det.class_name.toUpperCase()}`;
          } else if (isUnusual) {
            labelText = `⚠️ UNUSUAL: ${(det.unusual_item || det.class_name).toUpperCase()}`;
          } else if (isHandRaised) {
            labelText = `✋ ${det.target_id || 'PERSON'} [${det.pose_label.replace('_', ' ')}]`;
          } else {
            labelText = `${det.target_id || 'PERSON'} [${det.pose_label || 'NORMAL'}] ${det.loiter_seconds > 2 ? `• ${Math.round(det.loiter_seconds)}s` : ''}`;
          }

          ctx.font = 'bold 11px JetBrains Mono, monospace';
          const textWidth = ctx.measureText(labelText).width;
          const tagY = Math.max(by - 20, 2);

          ctx.fillStyle = (isArmed || isWeapon) ? 'rgba(45, 5, 15, 0.94)' : isUnattendedBag ? 'rgba(38, 20, 5, 0.94)' : isHandRaised ? 'rgba(42, 28, 5, 0.92)' : 'rgba(10, 16, 28, 0.90)';
          ctx.fillRect(bx, tagY, textWidth + 12, 18);
          ctx.strokeStyle = boxColor;
          ctx.lineWidth = 1;
          ctx.strokeRect(bx, tagY, textWidth + 12, 18);

          ctx.fillStyle = boxColor;
          ctx.fillText(labelText, bx + 6, tagY + 13);
        });

        // 5. HUD Top Status Overlay
        const armedCnt = dets.filter((d) => d.is_holding && d.held_item_type === 'WEAPON').length;
        const weaponCnt = dets.filter((d) => d.is_weapon).length;
        const hudW = armedCnt > 0 ? 460 : 380;
        ctx.fillStyle = 'rgba(10, 16, 28, 0.88)';
        ctx.fillRect(10, 10, hudW, 24);
        ctx.strokeStyle = armedCnt > 0 ? 'rgba(255, 0, 51, 0.8)' : 'rgba(0, 242, 254, 0.4)';
        ctx.strokeRect(10, 10, hudW, 24);
        ctx.font = 'bold 10px JetBrains Mono, monospace';
        ctx.fillStyle = armedCnt > 0 || weaponCnt > 0 ? '#FF0033' : '#10B981';
        ctx.fillText(
          `C-01 AI • ${webcamTelemetry.actualFps || 30} FPS • ${webcamTelemetry.lastLatencyMs || 10}ms • PPL:${dets.filter((d) => d.class_id === 0).length} • ARMED:${armedCnt} • WEAPONS:${weaponCnt}`,
          16,
          26
        );
      }
      animId = requestAnimationFrame(renderOverlay);
    };

    animId = requestAnimationFrame(renderOverlay);
    return () => cancelAnimationFrame(animId);
  }, [isWebcamActive, liveDetections, webcamTelemetry]);

  const loadData = async () => {
    try {
      const [cams, alertsRes] = await Promise.all([
        fetchCameras(),
        fetchAlerts({ limit: 10 }),
      ]);
      setCameras(cams);
      setLiveAlerts(alertsRes.items || []);
    } catch (err) {
      console.debug('Surveillance live load fallback:', err);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 12000);
    return () => clearInterval(interval);
  }, []);

  const handleAcknowledge = async (alertId) => {
    setAcknowledgedAlert(true);
    await acknowledgeAlert(alertId || 'ALT-101');
  };

  const handleStreamError = (camKey) => {
    setStreamErrorFlags((prev) => ({ ...prev, [camKey]: true }));
  };

  const hasUnusualThreat = webcamTelemetry.unusualCount > 0;

  return (
    <div className="surveillance-page-container">
      {/* Top Title & Status Bar */}
      <div className="page-header-row">
        <div className="page-title-group">
          <div className="page-main-title">
            <h2>Live Surveillance</h2>
            <span className="streams-badge font-mono">Live High-Speed Video Feeds</span>
          </div>
        </div>

        <div className="page-header-pills">
          <span className="pill-badge pill-green font-mono">
            <span className="status-dot dot-green pulse-ring"></span> SYSTEM ONLINE
          </span>

          <span className="pill-badge pill-green font-mono">
            <Cpu size={12} className="text-green" /> MPS GPU ACCELERATED
          </span>

          <span className="pill-badge pill-muted font-mono">
            <Clock size={12} /> {new Date().toLocaleTimeString()}
          </span>
        </div>
      </div>

      {/* Clean Mode Switcher Tabs */}
      <div className="surveillance-mode-tabs">
        <button
          className={`mode-tab-btn ${viewMode === 'trafficvision' ? 'active-tab' : ''}`}
          onClick={() => setViewMode('trafficvision')}
        >
          <Globe size={15} className="text-cyan" />
          <span>🇮🇳 TRAFFICVISION INDIA FEEDS</span>
          <span className="mode-tab-badge">LIVE 60FPS</span>
        </button>

        <button
          className={`mode-tab-btn ${viewMode === 'webcam' || isWebcamActive ? 'active-tab' : ''}`}
          onClick={() => {
            setViewMode('webcam');
            if (!isWebcamActive) startWebcam();
          }}
        >
          {deviceInfo.isMobile ? (
            <Smartphone size={15} className={isWebcamActive ? 'text-green pulse-ring' : 'text-sub'} />
          ) : (
            <CameraIcon size={15} className={isWebcamActive ? 'text-green pulse-ring' : 'text-sub'} />
          )}
          <span>
            {deviceInfo.isMobile ? '📱 MOBILE CAMERA AI' : deviceInfo.isTablet ? '📟 TABLET CAMERA AI' : '💻 DEVICE CAMERA AI'}
          </span>
          <span className="mode-tab-badge">
            {isWebcamActive ? (facingMode === 'environment' ? 'REAR CAM' : 'FRONT CAM') : '60FPS AI'}
          </span>
        </button>

        <button
          className={`mode-tab-btn ${viewMode === 'matrix' ? 'active-tab' : ''}`}
          onClick={() => setViewMode('matrix')}
        >
          <Grid2X2 size={15} className="text-sub" />
          <span>🛰️ 4-CAMERA MATRIX</span>
        </button>
      </div>

      {/* When TrafficVision Live Mode is active */}
      {viewMode === 'trafficvision' && (
        <TrafficVisionPlayer
          activeCamera={selectedTrafficCam}
          onSelectCamera={(cam) => setSelectedTrafficCam(cam)}
          onExpand={(cam) => setExpandedModalCamera(cam)}
          showControls={true}
          enableAiOverlay={true}
        />
      )}

      {/* Control & Filter Strip for Matrix view */}
      {viewMode !== 'trafficvision' && (
      <div className="surveillance-control-strip">
        <div className="control-left-group">
          {/* Dropdown 1 */}
          <div className="select-dropdown-box">
            <Video size={14} className="text-cyan" />
            <select 
              value={selectedFilter} 
              onChange={(e) => setSelectedFilter(e.target.value)}
              className="custom-select"
            >
              <option value="all">All Cameras (4/4)</option>
              <option value="c01">C-01 North Gate</option>
              <option value="c02">C-02 Border Road</option>
              <option value="c03">C-03 Fence Zone</option>
              <option value="c04">C-04 BOP Entry</option>
            </select>
          </div>

          {/* Dropdown 2 */}
          <div className="select-dropdown-box">
            <Filter size={14} className="text-sub" />
            <select className="custom-select">
              <option value="all-events">All Events (Breach & Motion)</option>
              <option value="breach">Breach Only</option>
              <option value="motion">Motion Only</option>
            </select>
          </div>

          {/* YOLOv8 Neural Tag */}
          <span className="pill-badge pill-green neural-tag">
            <span className="status-dot dot-green"></span> YOLOv8 Parallel Multi-Threaded Engine Active
          </span>
        </div>

        <div className="control-right-group">
          {/* Grid Layout Toggles */}
          <div className="grid-toggle-buttons">
            <button 
              className={`grid-btn ${layoutGrid === '2x2' ? 'active' : ''}`}
              onClick={() => { setLayoutGrid('2x2'); setViewMode('matrix'); }}
              title="2x2 View"
            >
              <Grid2X2 size={14} /> <span>2x2</span>
            </button>

            <button 
              className={`grid-btn ${layoutGrid === '3x3' ? 'active' : ''}`}
              onClick={() => { setLayoutGrid('3x3'); setViewMode('matrix'); }}
              title="3x3 View"
            >
              <Grid3X3 size={14} /> <span>3x3</span>
            </button>

            <button 
              className={`grid-btn ${layoutGrid === '1x1' ? 'active' : ''}`}
              onClick={() => { setLayoutGrid('1x1'); setViewMode('matrix'); }}
              title="Full Screen View"
            >
              <Square size={14} /> <span>1-1</span>
            </button>
          </div>

          <button 
            className={`btn-action font-mono ${isWebcamActive ? 'btn-red' : 'btn-cyan'}`}
            onClick={isWebcamActive ? stopWebcam : () => { startWebcam(); setViewMode('webcam'); }}
            title={`Toggle ${deviceInfo?.platformName || 'Device'} Camera AI Stream`}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
          >
            {deviceInfo?.isMobile ? <Smartphone size={13} className={isWebcamActive ? 'pulse-ring' : ''} /> : <CameraIcon size={13} className={isWebcamActive ? 'pulse-ring' : ''} />}
            <span>
              {isWebcamActive 
                ? (deviceInfo?.isMobile ? 'STOP MOBILE CAM' : 'STOP DEVICE CAM') 
                : (deviceInfo?.isMobile ? 'USE MOBILE CAMERA AI' : 'USE DEVICE CAMERA AI')}
            </span>
          </button>

          <button className="icon-action-btn" onClick={loadData} title="Refresh Telemetry">
            <RefreshCw size={14} />
          </button>

          <button 
            className="icon-action-btn" 
            title="Expand Full Camera View (Large Inspector)"
            onClick={() => setExpandedModalCamera(isWebcamActive ? { isWebcam: true } : (cameras[0] || { id: 'cam-01', code: 'C-01', name: 'North Gate', location: 'Sector 01' }))}
          >
            <Maximize2 size={14} />
          </button>
        </div>
      </div>
      )}

      {/* 2x2 Video Camera Grid */}
      <div className={`video-streams-grid layout-${layoutGrid}`} style={{ display: viewMode === 'trafficvision' ? 'none' : 'grid' }}>
        
        {/* CAMERA 1: DYNAMIC DEVICE CAMERA / C-01 */}
        <div className={`camera-feed-card ${isWebcamActive ? 'active-webcam-card' : ''} ${hasUnusualThreat ? 'unusual-alert-glow' : ''}`}>
          <div className="feed-header">
            <div className="feed-header-title">
              <Video size={15} className={isWebcamActive ? 'text-green' : 'text-cyan'} />
              <span className="feed-name">{isWebcamActive ? `C-01 ${activeCameraLabel.toUpperCase()}` : 'C-01 NORTH GATE / LOCAL'}</span>
              <span className={`feed-mode-tag ${isWebcamActive ? 'pill-green' : ''}`}>
                {isWebcamActive ? `${webcamTelemetry.actualFps || 30} FPS • ${deviceInfo.isMobile ? 'MOBILE' : 'AI ENGINE'}` : 'OPT-4K'}
              </span>
            </div>
            <div className="feed-header-right">
              {isWebcamActive && (
                <button 
                  className="camera-flip-btn font-mono"
                  onClick={switchCamera}
                  title="Switch or flip camera (Rear / Front / External)"
                >
                  <RefreshCw size={12} className="camera-flip-icon" />
                  <span>{facingMode === 'environment' ? 'FLIP FRONT' : 'FLIP REAR'}</span>
                </button>
              )}

              {availableCameras && availableCameras.length > 1 && (
                <select
                  value={activeDeviceId || ''}
                  onChange={(e) => selectCamera(e.target.value)}
                  className="camera-device-select font-mono"
                  title="Select Hardware Camera"
                >
                  {availableCameras.map((cam, idx) => (
                    <option key={cam.deviceId || idx} value={cam.deviceId}>
                      {cam.label || `Camera ${idx + 1}`}
                    </option>
                  ))}
                </select>
              )}

              <span className={`pill-badge ${hasUnusualThreat ? 'pill-red' : isWebcamActive ? 'pill-green' : 'pill-green'} status-pill-sm`}>
                <span className={`status-dot ${hasUnusualThreat ? 'dot-red pulse-ring' : isWebcamActive ? 'dot-green pulse-ring' : 'dot-green'}`}></span> 
                {hasUnusualThreat
                  ? `⚠️ UNUSUAL ITEM DETECTED (${webcamTelemetry.unusualCount})`
                  : isWebcamActive 
                    ? `LIVE AI • ${webcamTelemetry.detectionsCount} Targets` 
                    : 'LIVE • Normal Activity'}
              </span>
              <button className="feed-menu-btn"><MoreVertical size={14} /></button>
            </div>
          </div>

          <div className="feed-viewport scanlines">
            {isWebcamActive ? (
              <>
                <video
                  ref={webcamVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="hardware-accelerated-video"
                />
                <canvas
                  ref={overlayCanvasRef}
                  className="camera-hud-canvas-overlay"
                />
              </>
            ) : (
              <img 
                src={
                  streamErrorFlags['cam-01'] 
                    ? '/assets/cam1.png' 
                    : getCameraStreamUrl('cam-01')
                } 
                onError={() => handleStreamError('cam-01')}
                alt="C-01 Camera Feed" 
                className="camera-img-bg" 
              />
            )}

            {webcamError && (
              <div className="camera-error-banner font-mono">
                <AlertTriangle size={16} className="text-red flex-shrink-0" style={{ marginTop: '2px' }} />
                <div className="camera-error-msg">
                  <div>{webcamError}</div>
                  {typeof window !== 'undefined' && window.location.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(window.location.hostname) && (
                    <div style={{ marginTop: '8px' }}>
                      <button
                        onClick={() => { window.location.href = `https://${window.location.host}`; }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '6px 12px',
                          background: '#00ffff',
                          color: '#000000',
                          fontWeight: '700',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          border: 'none',
                          fontSize: '11px',
                        }}
                      >
                        <Shield size={12} />
                        <span>SWITCH TO SECURE HTTPS (ENABLES CAMERA)</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {!isWebcamActive && (
              <button 
                onClick={() => startWebcam()}
                className="webcam-launch-overlay-btn font-mono"
                title="Click to activate device camera AI analysis"
              >
                {deviceInfo.isMobile ? <Smartphone size={14} /> : <CameraIcon size={14} />}
                <span>START {deviceInfo.isMobile ? 'MOBILE' : 'DEVICE'} CAMERA AI</span>
              </button>
            )}

            <div className="embedded-video-timestamp font-mono">
              {new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC CH-01 {isWebcamActive ? (deviceInfo.isMobile ? 'MOBILE-AI' : 'GPU-ACCEL') : 'REC'}
            </div>

            <div className="feed-overlay-top-left-box font-mono">
              <div className="green-utc-time">{new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC</div>
              <div className="fps-mbps-info">
                {isWebcamActive 
                  ? `${activeCameraLabel.toUpperCase()} • ${webcamTelemetry.lastLatencyMs || 10}ms • ${webcamTelemetry.actualFps || 30} FPS`
                  : 'CH-01 • REC 30FPS • 4.2 Mbps'}
              </div>
            </div>

            <div className="feed-overlay-top-right-box font-mono">
              {isWebcamActive ? `${activeCameraLabel.toUpperCase()} LIVE FEED` : 'NORTH GATE ENTRY LIVE'}
            </div>

            {/* Detections summary overlay when webcam is active */}
            {isWebcamActive && webcamTelemetry.detections && webcamTelemetry.detections.length > 0 && (
              <div className="webcam-detections-strip font-mono">
                {webcamTelemetry.detections.map((det, idx) => {
                  const isUnusual = det.is_unusual || det.unusual_item;
                  return (
                    <div 
                      key={idx} 
                      className="webcam-det-pill"
                      style={isUnusual ? { borderColor: '#FF0033', color: '#FF0033', background: 'rgba(255, 0, 51, 0.2)' } : {}}
                    >
                      {isUnusual ? <AlertTriangle size={11} /> : <UserCheck size={11} />}
                      <span>
                        {isUnusual ? `⚠️ ${det.unusual_item || det.class_name}`.toUpperCase() : det.class_name.toUpperCase()} 
                        {det.pose_label ? ` [${det.pose_label}]` : ''} 
                        {det.loiter_seconds > 2 ? ` (${Math.round(det.loiter_seconds)}s)` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="feed-overlay-controls">
              {isWebcamActive && (
                <button onClick={switchCamera} title="Flip camera" className="mobile-touch-btn">
                  <RefreshCw size={13} />
                </button>
              )}
              <button title="Pan"><Hand size={13} /></button>
              <button title="Zoom"><ZoomIn size={13} /></button>
              <button 
                title="Fullscreen"
                onClick={() => setExpandedModalCamera(isWebcamActive ? { isWebcam: true } : (cameras[0] || { id: 'cam-01', code: 'C-01', name: 'North Gate' }))}
              >
                <Maximize2 size={13} />
              </button>
            </div>
          </div>

          <div className="feed-footer-strip">
            <div className="footer-left-info">
              <CheckCircle2 size={14} className={hasUnusualThreat ? 'text-red' : 'text-green'} />
              <span>
                {isWebcamActive ? (
                  <>
                    <strong>Device: {deviceInfo.platformName}</strong> | <strong>Camera: {activeCameraLabel}</strong> | <strong>Targets: {webcamTelemetry.detectionsCount}</strong> | <strong>Alerts: {webcamTelemetry.alertsCount}</strong>
                  </>
                ) : (
                  <>
                    <strong>Person ID: P-115 (Security Officer)</strong> | <strong>Vehicle ID: V-021 • Authorized</strong>
                  </>
                )}
              </span>
            </div>
            <span className="footer-right font-mono">{isWebcamActive ? (deviceInfo.isMobile ? 'MOBILE_STREAM_ACTIVE' : 'DEVICE_STREAM_ACTIVE') : 'SECTOR_GATE_ALPHA'}</span>
          </div>
        </div>

        {/* CAMERA 2: C-02 BORDER ROAD */}
        <div className="camera-feed-card">
          <div className="feed-header">
            <div className="feed-header-title">
              <Video size={15} className="text-cyan" />
              <div className="name-stack">
                <span className="feed-name">C-02 BORDER ROAD</span>
              </div>
              <span className="feed-mode-tag ir-mode-tag font-mono">IR ACTIVE</span>
            </div>
            <div className="feed-header-right">
              <span className="pill-badge pill-green status-pill-sm">
                <span className="status-dot dot-green"></span> LIVE • No Threat Detected
              </span>
              <button className="feed-menu-btn"><MoreVertical size={14} /></button>
            </div>
          </div>

          <div className="feed-viewport scanlines thermal-tint">
            <img 
              src={streamErrorFlags['cam-02'] ? '/assets/cam2.png' : getCameraStreamUrl('cam-02')} 
              onError={() => handleStreamError('cam-02')}
              alt="C-02 Border Road IR Feed" 
              className="camera-img-bg" 
            />

            <div className="embedded-video-timestamp font-mono">
              2024-10-27 03:47:21 UTC CAM PER
            </div>

            <div className="feed-overlay-top-left-box font-mono">
              <div className="green-utc-time">2024-10-27 03:47:21 UTC</div>
              <div className="fps-mbps-info">CAM 04 • PERIMETER G-1 • 30 FPS</div>
            </div>

            <div className="feed-overlay-top-right-box font-mono purple-title-box">
              INFRARED THERMAL ENABLED
            </div>

            <div className="anpr-vehicle-bounding-zone">
              <div className="ir-anchor-sq ir-sq-tl"></div>
              <div className="ir-anchor-sq ir-sq-tr"></div>
              <div className="ir-anchor-sq ir-sq-bl"></div>
              <div className="ir-anchor-sq ir-sq-br"></div>
              <div className="ir-vehicle-highlight font-mono"></div>

              <div className="anpr-vehicle-card font-mono">
                <div className="anpr-header-row">
                  <Shield size={14} className="text-purple-light" />
                  <div className="anpr-title-text">
                    ID: V-021 | VEHICLE • 93%
                  </div>
                </div>
                <div className="anpr-plate-row">
                  <span className="plate-label font-mono">PLATE:</span>
                  <span className="plate-value-box font-mono">HR26AB1234</span>
                </div>
              </div>
            </div>

            <div className="feed-overlay-controls">
              <button title="Pan"><Hand size={13} /></button>
              <button title="Zoom"><ZoomIn size={13} /></button>
              <button title="Fullscreen"><Maximize2 size={13} /></button>
            </div>
          </div>

          <div className="feed-footer-strip">
            <div className="footer-left-info">
              <ShieldCheck size={14} className="text-green" />
              <span>
                <strong>Vehicle Detection: 1 • Sector Perimeter Clear</strong>
              </span>
            </div>
            <span className="footer-right font-mono">SECTOR_G1_HIGHWAY</span>
          </div>
        </div>

        {/* CAMERA 3: C-03 FENCE ZONE (BREACH DETECTED) */}
        <div className="camera-feed-card alert-feed-card">
          <div className="feed-header alert-header">
            <div className="feed-header-title">
              <AlertTriangle size={16} className="text-red" />
              <span className="feed-name">C-03 FENCE ZONE</span>
              <span className="feed-mode-tag alert-tag">BREACH DETECTED</span>
            </div>
            <div className="feed-header-right">
              <span className="pill-badge pill-red status-pill-sm">
                <span className="status-dot dot-red pulse-ring"></span> ALERT • Intrusion Detected
              </span>
              <button className="feed-menu-btn"><MoreVertical size={14} /></button>
            </div>
          </div>

          <div className="feed-viewport scanlines alert-tint">
            <img 
              src={streamErrorFlags['cam-03'] ? '/assets/cam3.png' : getCameraStreamUrl('cam-03')} 
              onError={() => handleStreamError('cam-03')}
              alt="C-03 Breach Feed" 
              className="camera-img-bg" 
            />

            <div className="feed-overlay-top">
              <div className="overlay-meta-left font-mono">
                <span className="red-text">2024-10-28 02:35:47 AM</span>
                <span className="meta-sub">CAM 4 PERIMETER SOUTH • REC</span>
              </div>

              <span className="pill-badge pill-red reticle-tag font-mono">
                TARGET RETICLE ACTIVE
              </span>
            </div>

            <div className="intruder-bounding-box">
              <div className="intruder-tag font-mono">TARGET #P-102 INTRUDER [94%]</div>
            </div>

            <div className="feed-overlay-controls">
              <button title="Pan"><Hand size={13} /></button>
              <button title="Filter"><Sliders size={13} /></button>
              <button title="Fullscreen"><Maximize2 size={13} /></button>
            </div>
          </div>

          {/* Alert Footer */}
          <div className="feed-footer-strip alert-footer">
            <div className="alert-footer-left">
              <div className="alert-target-icon-box">
                <AlertOctagon size={18} />
              </div>
              <div className="alert-footer-text-group">
                <div className="alert-title-line">Intrusion Detected at Perimeter Fence •</div>
                <div className="alert-sub-line">Dispatched Alert to Sector 4 Unit</div>
              </div>
            </div>

            <button 
              className={`ack-btn-stacked ${acknowledgedAlert ? 'ack' : ''}`}
              onClick={() => handleAcknowledge('ALT-101')}
            >
              <span className="ack-text font-mono">{acknowledgedAlert ? 'ACKNOWLEDGED' : 'ACKNOWLEDGE'}</span>
              <span className="ack-count font-mono">(1)</span>
            </button>
          </div>
        </div>

        {/* CAMERA 4: C-04 BOP ENTRY */}
        <div className="camera-feed-card">
          <div className="feed-header">
            <div className="feed-header-title">
              <Video size={15} className="text-cyan" />
              <span className="feed-name">C-04 BOP ENTRY</span>
              <span className="feed-mode-tag station-tag font-mono">STATION 7</span>
            </div>
            <div className="feed-header-right">
              <span className="pill-badge pill-green status-pill-sm">
                <span className="status-dot dot-green"></span> LIVE • No Threat Detected
              </span>
              <button className="feed-menu-btn"><MoreVertical size={14} /></button>
            </div>
          </div>

          <div className="feed-viewport scanlines">
            <img 
              src={streamErrorFlags['cam-04'] ? '/assets/cam4.png' : getCameraStreamUrl('cam-04')} 
              onError={() => handleStreamError('cam-04')}
              alt="C-04 BOP Entry Feed" 
              className="camera-img-bg" 
            />

            <div className="embedded-video-timestamp font-mono text-white-faded">
              CAM 7 BOP ENTRY POINT
            </div>
            <div className="embedded-top-right font-mono">
              DATE: 2024/10/26<br />NIGHT VISION ACTIVE
            </div>

            <div className="feed-overlay-top-left-box font-mono">
              <div className="green-utc-time">2024/10/26 02:47:18 AM</div>
              <div className="fps-mbps-info">CAM 7 BOP ENTRY POINT • ZOOM: 1.0x</div>
            </div>

            <div className="feed-overlay-top-right-box font-mono green-title-box">
              NIGHT VISION ACTIVE
            </div>

            <div className="sentry-bounding-zone">
              <div className="sentry-anchor sq-tl"></div>
              <div className="sentry-anchor sq-tr"></div>
              <div className="sentry-anchor sq-bl"></div>
              <div className="sentry-anchor sq-br"></div>
              <div className="sentry-highlight-fill"></div>

              <div className="sentry-tag-box font-mono">
                <ShieldCheck size={14} className="text-green" />
                <span className="sentry-tag-text">
                  ID: P-115 | AUTHORIZED SENTRY • 98%
                </span>
              </div>
            </div>

            <div className="feed-overlay-bottom-left-box font-mono">
              <div>LAT: 32.7894° N | LONG: 67.1234° E</div>
            </div>

            <div className="feed-overlay-controls">
              <button title="Pan"><Hand size={13} /></button>
              <button title="Zoom"><ZoomIn size={13} /></button>
              <button title="Fullscreen"><Maximize2 size={13} /></button>
            </div>
          </div>

          <div className="feed-footer-strip">
            <div className="footer-left-info">
              <CheckCircle2 size={14} className="text-green" />
              <span>
                <strong>No Threat Detected • Sentry On Duty</strong>
              </span>
            </div>
            <span className="footer-right font-mono">SECTOR_BOP_ENTRY</span>
          </div>
        </div>

      </div>

      {/* Active Detections Strip */}
      <div className="active-detections-section">
        <div className="section-title-bar">
          <div className="section-title-left">
            <Radio size={16} className="text-cyan" />
            <h4 className="section-title">Active Detections</h4>
            <span className="pill-badge pill-green font-mono">4 TRACKED</span>
          </div>
          <span className="section-engine-tag font-mono">YOLOv8 EDGE REALTIME</span>
        </div>

        <div className="detections-strip-grid">
          <div className="detection-strip-card card-red">
            <div className="strip-avatar avatar-red">
              <AlertTriangle size={14} />
            </div>
            <div className="strip-details">
              <div className="strip-header">
                <span className="strip-id font-mono">P-102 <span className="cam-code font-mono">C-03</span></span>
                <span className="strip-conf font-mono">94%</span>
              </div>
              <div className="strip-title">Unauth...</div>
              <div className="strip-sub">Fence Breach • Unre...</div>
            </div>
          </div>

          <div className="detection-strip-card card-purple">
            <div className="strip-avatar avatar-purple">
              <Eye size={14} />
            </div>
            <div className="strip-details">
              <div className="strip-header">
                <span className="strip-id font-mono">P-308 <span className="cam-code font-mono">C-07</span></span>
                <span className="strip-status-text font-mono text-purple">Alert</span>
              </div>
              <div className="strip-title">Loite...</div>
              <div className="strip-sub">Duration: 04:52</div>
            </div>
          </div>

          <div className="detection-strip-card card-blue">
            <div className="strip-avatar avatar-blue">
              <Truck size={14} />
            </div>
            <div className="strip-details">
              <div className="strip-header">
                <span className="strip-id font-mono">V-021 <span className="cam-code font-mono">C-02</span></span>
                <span className="strip-conf font-mono">93%</span>
              </div>
              <div className="strip-title">Vehi...</div>
              <div className="strip-sub">Plate: HR26AB1234</div>
            </div>
          </div>

          <div className="detection-strip-card card-green">
            <div className="strip-avatar avatar-green">
              <UserCheck size={14} />
            </div>
            <div className="strip-details">
              <div className="strip-header">
                <span className="strip-id font-mono">P-115 <span className="cam-code font-mono">C-01</span></span>
                <span className="strip-conf font-mono">97%</span>
              </div>
              <div className="strip-title">Author...</div>
              <div className="strip-sub">Security Officer</div>
            </div>
          </div>
        </div>
      </div>

      {/* Live Event Telemetry Strip */}
      <div className="telemetry-events-section">
        <div className="section-title-bar">
          <div className="section-title-left">
            <Radio size={16} className="text-cyan" />
            <h4 className="section-title">Live Event Telemetry</h4>
            <span className="pill-badge pill-muted font-mono">BUFFER: 28 LOGS</span>
          </div>

          <button 
            className="btn-tactical font-mono"
            onClick={() => onNavigateToAlerts && onNavigateToAlerts('alerts')}
          >
            <span>Open Full Event History</span>
            <ChevronRight size={14} />
          </button>
        </div>

        <div className="telemetry-cards-grid">
          <div className="telemetry-log-card card-red">
            <div className="log-icon-block bg-red"></div>
            <div className="log-content font-mono">
              <div className="log-top-row">
                <span className="log-time">20:41 UTC</span>
                <span className="log-cam">C-03</span>
                <span className="log-id">ID: P-102</span>
                <span className="log-action-badge action-dispatch">Dispatch</span>
              </div>
              <div className="log-main-msg text-red">● Unauth...</div>
              <div className="log-meta font-mono">Face Match: --</div>
            </div>
          </div>

          <div className="telemetry-log-card card-purple">
            <div className="log-icon-block bg-purple"></div>
            <div className="log-content font-mono">
              <div className="log-top-row">
                <span className="log-time">20:36 UTC</span>
                <span className="log-cam">C-07</span>
                <span className="log-id">ID: P-308</span>
                <span className="log-action-badge action-flagged">Flagged</span>
              </div>
              <div className="log-main-msg text-purple">● Loitering ...</div>
              <div className="log-meta font-mono">Activity: Loit...</div>
            </div>
          </div>

          <div className="telemetry-log-card card-blue">
            <div className="log-icon-block bg-blue"></div>
            <div className="log-content font-mono">
              <div className="log-top-row">
                <span className="log-time">20:31 UTC</span>
                <span className="log-cam">C-02</span>
                <span className="log-id">ID: V-021</span>
                <span className="log-action-badge action-logged">Logged</span>
              </div>
              <div className="log-main-msg text-cyan">● Vehicle De...</div>
              <div className="log-meta font-mono">HR26AB1234 • 93...</div>
            </div>
          </div>

          <div className="telemetry-log-card card-green">
            <div className="log-icon-block bg-green"></div>
            <div className="log-content font-mono">
              <div className="log-top-row">
                <span className="log-status-verified text-green">Verified</span>
                <span className="log-cam">C-01</span>
                <span className="log-id">ID: P-115</span>
                <span className="log-action-badge action-active">Active</span>
              </div>
              <div className="log-main-msg text-green">● Authorized...</div>
              <div className="log-meta font-mono">Security Office...</div>
            </div>
          </div>
        </div>
      </div>

      {/* Expanded Big Camera Inspection Modal */}
      {expandedModalCamera && (
        <CameraDetailModal
          camera={expandedModalCamera.isWebcam ? null : expandedModalCamera}
          isWebcam={expandedModalCamera.isWebcam}
          webcamStream={localStream}
          webcamTelemetry={webcamTelemetry}
          liveDetections={expandedModalCamera.isWebcam ? liveDetections : []}
          onClose={() => setExpandedModalCamera(null)}
        />
      )}
    </div>
  );
};

export default LiveSurveillancePage;
