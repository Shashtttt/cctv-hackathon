import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  Smartphone,
  MapPin,
  Sparkles,
  Crosshair
} from 'lucide-react';
import { fetchCameras, fetchAlerts, acknowledgeAlert, getCameraStreamUrl } from '../services/apiService';
import { useWebcamBridge } from '../services/useWebcamBridge';
import { CameraDetailModal } from '../components/CameraDetailModal';
import { AddIpCameraModal } from '../components/AddIpCameraModal';
import { Camera as CameraIcon, Plus } from 'lucide-react';
import './LiveSurveillancePage.css';

// COCO Skeleton limb connections
const SKELETON_LIMBS = [
  [0, 1], [0, 2], [1, 3], [2, 4],           // Face / Head
  [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],  // Arms
  [5, 11], [6, 12], [11, 12],               // Torso
  [11, 13], [13, 15], [12, 14], [14, 16],   // Legs
];



const LiveSurveillancePage = ({ onNavigateToAlerts }) => {
  const [viewMode, setViewMode] = useState('webcam'); // 'webcam' (Hero Device Cam) | 'matrix' (Dynamic Grid)
  const [selectedGridCount, setSelectedGridCount] = useState('auto'); // 'auto' | 2 | 4 | 6 | 8 | 1
  const [selectedFilter, setSelectedFilter] = useState('all');
  const [acknowledgedAlert, setAcknowledgedAlert] = useState(false);
  const [streamErrorFlags, setStreamErrorFlags] = useState({});
  const [liveAlerts, setLiveAlerts] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [expandedModalCamera, setExpandedModalCamera] = useState(null); // Camera object or 'webcam'
  const [isAddIpModalOpen, setIsAddIpModalOpen] = useState(false);

  const handleStreamError = (camId) => {
    setStreamErrorFlags((prev) => ({ ...prev, [camId]: true }));
  };

  const heroVideoRef = useRef(null);
  const heroCanvasRef = useRef(null);
  const matrixVideoRef = useRef(null);
  const matrixCanvasRef = useRef(null);

  const [showAiOverlay, setShowAiOverlay] = useState(true);
  const [showVirtualFence, setShowVirtualFence] = useState(true);

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
    geoPosition,
    resolvedLocation,
    setLocationOverride,
    popularLocations,
  } = useWebcamBridge('cam-01', 25, heroVideoRef);

  // Load real registered cameras dynamically from backend
  const loadBackendCameras = useCallback(async () => {
    try {
      const data = await fetchCameras(true);
      if (Array.isArray(data)) {
        // Exclude synthetic placeholder feeds and non-running cameras
        const real = data.filter(c => 
          c.id !== 'cam-01' && 
          (!c.rtsp_url || !c.rtsp_url.startsWith('synthetic://')) &&
          (c.is_running || c.is_active || c.status === 'online')
        );
        setCameras(real);
      }
    } catch (e) {
      console.debug('Failed to fetch backend cameras:', e);
    }
  }, []);

  useEffect(() => {
    loadBackendCameras();
    const interval = setInterval(loadBackendCameras, 4000);
    return () => clearInterval(interval);
  }, [loadBackendCameras]);

  // Primary Device Hardware Camera
  const primaryCam = {
    id: 'cam-01',
    code: 'C-01',
    name: activeCameraLabel || 'Primary Optical Sensor',
    location: resolvedLocation || 'Sector 04 Perimeter',
    gps_coords: geoPosition?.formatted || '28.4949° N, 77.0895° E',
    mode: 'ACTIVE SENSOR',
    status: isWebcamActive ? 'online' : 'offline',
    fps: webcamTelemetry?.fps || 25,
    persons: liveDetections?.filter(d => d.class_name === 'person').length || 0,
    vehicles: liveDetections?.filter(d => ['car', 'truck', 'bus', 'motorcycle'].includes(d.class_name)).length || 0,
    weapons: liveDetections?.filter(d => d.is_weapon).length || 0,
    streamImg: '/assets/cam1.png',
    tags: ['PRIMARY', 'AI_LIVE'],
    isDeviceHardware: true,
  };

  // Additional Hardware Optical Sensors (if multi-wbcam or mobile front/rear)
  const secondaryHardwareCams = (availableCameras || [])
    .filter((_, idx) => idx > 0)
    .map((d, idx) => ({
      id: d.id || `dev-cam-${idx + 2}`,
      code: d.isBack ? 'DEV-REAR-01' : `DEV-OPTICAL-0${idx + 2}`,
      name: d.name || d.label || `Hardware Lens ${idx + 2}`,
      location: resolvedLocation || 'Local Optical Sensor',
      gps_coords: geoPosition?.formatted || 'Active Device Sensor',
      mode: 'HARDWARE SENSOR',
      status: 'online',
      fps: 40,
      persons: 0,
      vehicles: 0,
      weapons: 0,
      streamImg: '/assets/cam1.png',
      tags: ['HARDWARE', 'OPTICAL'],
      isDeviceHardware: true,
    }));

  // External real IP & Mobile cameras from backend (strictly running / streaming)
  const externalIpCameras = cameras
    .filter(c => c.id !== 'cam-01' && (!c.rtsp_url || !c.rtsp_url.startsWith('synthetic://')) && (c.is_running || c.is_active || c.status === 'online' || c.status === 'connecting'))
    .map((c, idx) => {
      const isOnline = c.status === 'online' || c.is_active;
      const isConnecting = c.status === 'connecting';
      const isMobile = Boolean(c.rtsp_url && c.rtsp_url.startsWith('mobile://'));
      const currentStatus = isOnline ? 'online' : (isConnecting ? 'connecting' : (isMobile ? 'standby' : 'offline'));

      return {
        id: c.id,
        code: c.code || `IP-0${idx + 1}`,
        name: c.name || `IP Camera ${idx + 1}`,
        location: c.location || 'Network Perimeter',
        gps_coords: c.gps_coords || '28.4949° N, 77.0895° E',
        mode: isMobile ? 'MOBILE PAIRED' : (c.mode || 'IP SURVEILLANCE'),
        status: currentStatus,
        fps: c.fps || 25,
        persons: 0,
        vehicles: 0,
        weapons: 0,
        streamImg: '/assets/cam2.png',
        streamUrl: c.stream_url || getCameraStreamUrl(c.id),
        tags: [isMobile ? 'MOBILE' : 'IP_FEED', 'AI_STREAM'],
        isIpCamera: true,
        isMobile,
      };
    });

  const allDynamicCameras = [primaryCam, ...secondaryHardwareCams, ...externalIpCameras];

  // Dynamic Camera Count & Grid Calculation: strictly matches real connected cameras!
  const autoDetectedCount = Math.max(1, allDynamicCameras.length);
  const effectiveGridCount = selectedGridCount === 'auto' ? autoDetectedCount : Number(selectedGridCount);
  const displayedCameras = allDynamicCameras.slice(0, effectiveGridCount);


  // Auto-start detected device camera on mount
  useEffect(() => {
    startWebcam().catch(() => {});
  }, []);

  // Attach local media stream directly to both video elements for 60 FPS zero-lag playback
  useEffect(() => {
    if (heroVideoRef.current && localStream) {
      if (heroVideoRef.current.srcObject !== localStream) {
        heroVideoRef.current.srcObject = localStream;
      }
      heroVideoRef.current.play().catch((err) => console.debug('Hero video play error:', err));
    }
    if (matrixVideoRef.current && localStream) {
      if (matrixVideoRef.current.srcObject !== localStream) {
        matrixVideoRef.current.srcObject = localStream;
      }
      matrixVideoRef.current.play().catch((err) => console.debug('Matrix video play error:', err));
    }
  }, [localStream, isWebcamActive, viewMode]);

  // High-Speed 60 FPS Hardware-Accelerated Canvas Overlay Loop
  useEffect(() => {
    if (!isWebcamActive) return;

    let animId;

    const renderOverlay = () => {
      const targetCanvas = viewMode === 'webcam' ? heroCanvasRef.current : matrixCanvasRef.current;
      const targetVideo = viewMode === 'webcam' ? heroVideoRef.current : matrixVideoRef.current;

      if (targetCanvas && targetVideo && targetVideo.videoWidth > 0) {
        const cw = targetCanvas.clientWidth || targetVideo.videoWidth || 640;
        const ch = targetCanvas.clientHeight || targetVideo.videoHeight || 360;
        if (targetCanvas.width !== cw || targetCanvas.height !== ch) {
          targetCanvas.width = cw;
          targetCanvas.height = ch;
        }

        const ctx = targetCanvas.getContext('2d');
        ctx.clearRect(0, 0, cw, ch);

        if (showAiOverlay) {
          // 1. Draw Virtual Perimeter Tripwire (Matching Expanded Inspection Modal)
          if (showVirtualFence) {
            ctx.save();
            ctx.strokeStyle = 'rgba(0, 242, 254, 0.45)';
            ctx.lineWidth = 2;
            ctx.setLineDash([8, 6]);
            ctx.strokeRect(cw * 0.08, ch * 0.12, cw * 0.84, ch * 0.78);
            ctx.fillStyle = 'rgba(0, 242, 254, 0.85)';
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

          const dets = liveDetections || [];

          // 3. Draw Tether Lines between persons and held items
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

                const tetherColor = det.held_item_type === 'WEAPON' ? '#FF0033' : '#10B981';
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

          // 4. Draw each detected target (with corner brackets, labels matching Image 2, and pose skeleton)
          dets.forEach((det) => {
            if (!det.bbox) return;

            const rawConf = det.bbox?.confidence ?? det.confidence;
            // Filter out low-confidence noisy detections
            if (rawConf !== undefined && rawConf !== null && rawConf < 0.42) return;

            const bx = det.bbox.x * cw;
            const by = det.bbox.y * ch;
            const bw = det.bbox.w * cw;
            const bh = det.bbox.h * ch;
            const cName = (det.class_name || '').toLowerCase();
            const heldItem = (det.held_item || '').toLowerCase();
            const unusualName = (det.unusual_item || '').toLowerCase();
            const isCasual = Boolean(det.is_casual_object) || det.held_item_type === 'CASUAL_OBJECT';
            const isWatch = cName === 'wristwatch' || heldItem === 'wristwatch' || heldItem === 'watch' || unusualName === 'wristwatch';
            const isClock = !isWatch && (cName.includes('clock') || heldItem.includes('clock'));
            const isUnknown = cName.includes('unknown') || heldItem.includes('unknown') || unusualName.includes('unknown');
            const isPhone = !isWatch && !isClock && (cName.includes('phone') || cName.includes('cell') || heldItem.includes('phone'));

            const isWeaponItem = Boolean(det.is_weapon) && !isCasual && !isWatch && !isClock && !isUnknown;
            const isArmed = det.is_holding && (det.held_item_type === 'WEAPON' || isWeaponItem) && !isCasual && !isWatch && !isClock && !isUnknown;
            const isHoldingCasual = det.is_holding && !isArmed;
            const isUnattendedBag = ['backpack', 'suitcase', 'handbag'].includes(cName) && !det.is_held;
            const isVehicle = [1, 2, 3, 5, 7].includes(det.class_id) || ['car', 'truck', 'bus', 'motorcycle', 'bicycle', 'vehicle', 'van', 'suv', 'auto', 'pickup'].some((v) => cName.includes(v));
            const isPerson = det.class_id === 0 || cName === 'person' || Boolean(det.pose_label) || Boolean(det.keypoints && det.keypoints.length > 0);
            const isWeapon = isArmed || isWeaponItem;

            // Strict Color Scheme: Red for Weapon/Armed, Amber for watch/unknown/casual, Cyan for Vehicle, Emerald for Person/Normal
            const boxColor = isWeapon ? '#FF0033' : isVehicle ? '#00F2FE' : (isWatch || isUnknown) ? '#F59E0B' : '#10B981';

            // 1. Draw Bounding Box with Cyber Glow
            ctx.save();
            ctx.strokeStyle = boxColor;
            ctx.lineWidth = isWeapon ? 3.5 : 2;
            ctx.shadowColor = boxColor;
            ctx.shadowBlur = isWeapon ? 18 : isVehicle ? 10 : 8;
            ctx.strokeRect(bx, by, bw, bh);

            // 2. High-Tech Corner Reticle Brackets
            const cornerLen = Math.min(18, bw / 3);
            ctx.lineWidth = isWeapon ? 4 : 2.5;
            ctx.beginPath();
            ctx.moveTo(bx, by + cornerLen); ctx.lineTo(bx, by); ctx.lineTo(bx + cornerLen, by);
            ctx.moveTo(bx + bw - cornerLen, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by + cornerLen);
            ctx.moveTo(bx, by + bh - cornerLen); ctx.lineTo(bx, by + bh); ctx.lineTo(bx + cornerLen, by + bh);
            ctx.moveTo(bx + bw - cornerLen, by + bh); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw, by + cornerLen);
            ctx.stroke();

            // 3. Pose Keypoint Skeleton Overlay (When Present)
            if (det.keypoints && det.keypoints.length > 0) {
              const kps = det.keypoints;
              ctx.save();
              ctx.fillStyle = '#10B981';
              kps.forEach((kp) => {
                if (kp.conf >= 0.48) {
                  ctx.fillStyle = isWeapon ? '#FF0033' : '#10B981';
                  ctx.beginPath();
                  ctx.arc(kp.x * cw, kp.y * ch, 3.5, 0, 2 * Math.PI);
                  ctx.fill();
                }
              });
              ctx.restore();
            }

            // 4. Tactical Floating Label Tag
            ctx.save();
            const confStr = rawConf != null ? `${(rawConf * 100).toFixed(0)}%` : '';
            let labelText = '';
            if (isArmed) {
              labelText = `🚨 ARMED SUBJECT: HOLDING ${det.held_item} (${(det.held_by_hand || 'HAND').replace('_', ' ')})`;
            } else if (isHoldingCasual) {
              if (isWatch) {
                labelText = `⌚ HOLDING WATCH (${(det.held_by_hand || 'HAND').replace('_', ' ')})`;
              } else if (isUnknown) {
                labelText = `🔍 HOLDING UNKNOWN OBJECT (${(det.held_by_hand || 'HAND').replace('_', ' ')})`;
              } else if (isPhone) {
                labelText = `📱 HOLDING PHONE (${(det.held_by_hand || 'HAND').replace('_', ' ')})`;
              } else {
                labelText = `📦 HOLDING: ${det.held_item} (${(det.held_by_hand || 'HAND').replace('_', ' ')})`;
              }
            } else if (isWeapon) {
              labelText = `🚨 WEAPON: ${(det.unusual_item || det.class_name).toUpperCase()}${confStr ? ` [${confStr}]` : ''}`;
            } else if (isWatch) {
              labelText = `⌚ WRISTWATCH${confStr ? ` [${confStr}]` : ''} ${det.is_held ? '• ON WRIST' : ''}`;
            } else if (isClock) {
              labelText = `⏰ CLOCK${confStr ? ` [${confStr}]` : ''}`;
            } else if (isUnknown) {
              labelText = `🔍 UNKNOWN OBJECT${confStr ? ` [${confStr}]` : ''} ${det.is_held ? '• HELD' : ''}`;
            } else if (isVehicle) {
              const vehType = cName.includes('truck') ? 'TRUCK' : cName.includes('bus') ? 'BUS' : cName.includes('motorcycle') ? 'MOTORCYCLE' : cName.includes('bicycle') ? 'BICYCLE' : 'CAR';
              labelText = `🚗 VEHICLE: ${vehType}${confStr ? ` [${confStr}]` : ''}`;
            } else if (isPhone) {
              labelText = `📱 CELL PHONE${confStr ? ` [${confStr}]` : ''} ${det.is_held ? '• IN HAND' : '• DETECTED'}`;
            } else if (isUnattendedBag) {
              labelText = `⚠️ UNATTENDED BAGGAGE: ${det.class_name.toUpperCase()}${confStr ? ` [${confStr}]` : ''}`;
            } else if (det.is_unusual && det.class_id !== 0) {
              labelText = `⚠️ MONITORED: ${(det.unusual_item || det.class_name).toUpperCase()}${confStr ? ` [${confStr}]` : ''}`;
            } else if (isPerson) {
              labelText = `👤 ${det.target_id || 'PERSON'} [${det.pose_label || 'ACTIVE'}]`;
            } else {
              const icon = cName.includes('bottle') ? '🍾 ' : cName.includes('laptop') ? '💻 ' : cName.includes('cup') ? '☕ ' : cName.includes('book') ? '📖 ' : '🎯 ';
              labelText = `${icon}${det.class_name.toUpperCase()}${confStr ? ` [${confStr}]` : ''} ${det.is_held ? '• HELD' : ''}`;
            }

            ctx.font = 'bold 12px JetBrains Mono, monospace';
            const textWidth = ctx.measureText(labelText).width;
            const tagY = Math.max(by - 24, 4);

            ctx.fillStyle = isWeapon 
              ? 'rgba(255, 0, 51, 0.94)' 
              : isVehicle 
                ? 'rgba(4, 25, 42, 0.94)' 
                : (isWatch || isUnknown)
                  ? 'rgba(40, 25, 5, 0.92)'
                  : 'rgba(5, 30, 20, 0.92)';
            ctx.fillRect(bx, tagY, textWidth + 14, 20);
            ctx.strokeStyle = boxColor;
            ctx.lineWidth = 1;
            ctx.strokeRect(bx, tagY, textWidth + 14, 20);

            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(labelText, bx + 7, tagY + 14);
            ctx.restore();
          });

          // 5. HUD Top Status Overlay
          const armedCnt = dets.filter((d) => d.is_holding && d.held_item_type === 'WEAPON' && !d.is_casual_object).length;
          const weaponCnt = dets.filter((d) => {
            if (d.is_casual_object || d.held_item_type === 'CASUAL_OBJECT') return false;
            const name = (d.class_name || '').toLowerCase();
            const unusual = (d.unusual_item || '').toLowerCase();
            const held = (d.held_item || '').toLowerCase();
            if (name.includes('watch') || held.includes('watch') || unusual.includes('watch') ||
                name.includes('unknown') || held.includes('unknown') || unusual.includes('unknown')) {
              return false;
            }
            return Boolean(d.is_weapon);
          }).length;
          const phoneCnt = dets.filter((d) => (d.class_name || '').toLowerCase().includes('phone') || (d.held_item || '').toLowerCase().includes('phone')).length;
          const pplCnt = dets.filter((d) => d.class_id === 0 || (d.class_name || '').toLowerCase() === 'person' || d.pose_label).length;
          const vehCnt = dets.filter((d) => [1, 2, 3, 5, 7].includes(d.class_id) || ['car', 'truck', 'bus', 'motorcycle', 'bicycle', 'vehicle', 'van', 'suv', 'auto', 'pickup'].some((v) => (d.class_name || '').toLowerCase().includes(v))).length;

          const hasWeaponThreat = armedCnt > 0 || weaponCnt > 0;
          const hudW = Math.min(560, cw - 20);
          ctx.fillStyle = 'rgba(10, 16, 28, 0.90)';
          ctx.fillRect(10, 10, hudW, 24);
          ctx.strokeStyle = hasWeaponThreat ? 'rgba(255, 0, 51, 0.85)' : 'rgba(16, 185, 129, 0.6)';
          ctx.strokeRect(10, 10, hudW, 24);
          ctx.font = 'bold 10px JetBrains Mono, monospace';
          ctx.fillStyle = hasWeaponThreat ? '#FF0033' : '#10B981';
          ctx.fillText(
            `C-01 AI • ${webcamTelemetry.actualFps || 30} FPS • ${webcamTelemetry.lastLatencyMs || 10}ms • 👤 PERSONS:${pplCnt} • 🚗 VEHICLES:${vehCnt} • 🚨 WEAPONS:${weaponCnt} • 📱 PHONES:${phoneCnt}`,
            16,
            26
          );

          // 6. Bottom GPS Location HUD
          const currentGps = (isWebcamActive && geoPosition?.formatted)
            ? `LIVE GPS: ${geoPosition.formatted} (±${geoPosition.accuracy}m)`
            : (cameras[0]?.gps_coords ? `SECTOR GPS: ${cameras[0].gps_coords}` : 'SECTOR GPS: 34.1524° N, 74.8211° E');
          ctx.fillStyle = 'rgba(10, 16, 28, 0.88)';
          ctx.fillRect(10, targetCanvas.height - 28, Math.min(380, cw - 20), 20);
          ctx.strokeStyle = '#00f2fe';
          ctx.lineWidth = 1;
          ctx.strokeRect(10, targetCanvas.height - 28, Math.min(380, cw - 20), 20);
          ctx.font = 'bold 9.5px JetBrains Mono, monospace';
          ctx.fillStyle = '#00f2fe';
          ctx.fillText(`📍 ${currentGps} • REC ACTIVE`, 16, targetCanvas.height - 14);
        }
      }
      animId = requestAnimationFrame(renderOverlay);
    };

    animId = requestAnimationFrame(renderOverlay);
    return () => cancelAnimationFrame(animId);
  }, [isWebcamActive, liveDetections, viewMode, showAiOverlay, showVirtualFence, webcamTelemetry, geoPosition, cameras]);

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

  const hasUnusualThreat = webcamTelemetry.unusualCount > 0;

  const handleQuickFeedSnapshot = () => {
    const activeVid = viewMode === 'webcam' ? heroVideoRef.current : matrixVideoRef.current;
    const activeCanvas = viewMode === 'webcam' ? heroCanvasRef.current : matrixCanvasRef.current;
    if (!activeVid || !isWebcamActive) {
      setExpandedModalCamera(cameras[0] || { id: 'cam-01', code: 'C-01', name: 'North Gate', location: 'Noida Sector 28' });
      return;
    }
    const cw = activeVid.videoWidth || 1280;
    const ch = activeVid.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');

    // 1. Draw raw video frame
    ctx.drawImage(activeVid, 0, 0, cw, ch);

    // 2. Draw AI detections overlay layer
    if (activeCanvas) {
      ctx.drawImage(activeCanvas, 0, 0, cw, ch);
    }

    // 3. Draw Tactical Telemetry Banner on captured image
    const nowUtc = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    const bannerH = Math.max(54, Math.round(ch * 0.08));
    const bannerY = ch - bannerH - 12;

    const locText = (resolvedLocation || 'Noida Sector 28, Uttar Pradesh').toUpperCase();
    const gpsText = geoPosition?.formatted || webcamTelemetry.gpsCoords || '28.5708° N, 77.3271° E';

    ctx.fillStyle = 'rgba(8, 14, 24, 0.92)';
    ctx.fillRect(12, bannerY, Math.min(cw - 24, 820), bannerH);
    ctx.strokeStyle = '#00f2fe';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(12, bannerY, Math.min(cw - 24, 820), bannerH);

    ctx.font = `bold ${Math.max(13, Math.round(ch * 0.022))}px JetBrains Mono, monospace`;
    ctx.fillStyle = '#00f2fe';
    ctx.fillText(`📍 LOC: ${locText} | GPS: ${gpsText}`, 24, bannerY + (bannerH * 0.44));

    ctx.font = `${Math.max(11, Math.round(ch * 0.017))}px JetBrains Mono, monospace`;
    ctx.fillStyle = '#10b981';
    ctx.fillText(`TIMESTAMP: ${nowUtc} | CAM: C-01 AI | IBVAP FORENSIC CAPTURE`, 24, bannerY + (bannerH * 0.82));

    ctx.fillStyle = 'rgba(8, 14, 24, 0.85)';
    ctx.fillRect(12, 12, 320, 26);
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 1;
    ctx.strokeRect(12, 12, 320, 26);
    ctx.font = 'bold 11px JetBrains Mono, monospace';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(`● C-01 AI • ${activeCameraLabel.toUpperCase()}`, 20, 29);

    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/jpeg', 0.95);
    a.download = `CCTV_SNAPSHOT_C_01_AI_${Date.now()}.jpg`;
    a.click();
  };

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
      <div className="surveillance-mode-tabs font-mono">
        <button
          className={`mode-tab-btn ${viewMode === 'webcam' ? 'active-tab' : ''}`}
          onClick={() => {
            setViewMode('webcam');
            if (!isWebcamActive) startWebcam();
          }}
        >
          {deviceInfo.isMobile ? (
            <Smartphone size={15} className={isWebcamActive ? 'text-green pulse-ring' : 'text-cyan'} />
          ) : (
            <CameraIcon size={15} className={isWebcamActive ? 'text-green pulse-ring' : 'text-cyan'} />
          )}
          <span>
            {deviceInfo.isMobile ? '📱 MOBILE CAMERA AI' : deviceInfo.isTablet ? '📟 TABLET CAMERA AI' : '💻 DETECTED DEVICE CAMERA AI'}
          </span>
          <span className="mode-tab-badge">
            {isWebcamActive ? 'LIVE AI • 60FPS' : 'STANDBY'}
          </span>
        </button>

        <button
          className={`mode-tab-btn ${viewMode === 'matrix' ? 'active-tab' : ''}`}
          onClick={() => setViewMode('matrix')}
        >
          <Grid2X2 size={15} className="text-sub" />
          <span>🛰️ DYNAMIC MATRIX ({displayedCameras.length} CAMERAS)</span>
        </button>

        <button
          className="mode-tab-btn"
          style={{ borderColor: 'rgba(0, 242, 254, 0.45)', color: '#00f2fe', background: 'rgba(0, 242, 254, 0.08)' }}
          onClick={() => setIsAddIpModalOpen(true)}
        >
          <Plus size={15} className="text-cyan" />
          <span>📡 + ADD IP CAMERA</span>
        </button>
      </div>

      {/* Hero Detected Device Camera View (when in device camera mode) */}
      {viewMode === 'webcam' && (
        <div className="hero-device-camera-view">
          <div className="hero-camera-card tactical-card font-mono">
            {/* Header */}
            <div className="hero-camera-header">
              <div className="hero-cam-title-group">
                <div className="flex items-center gap-2">
                  <Video size={16} className={isWebcamActive ? 'text-green pulse-ring' : 'text-cyan'} />
                  <span className="text-white font-bold text-sm">
                    {activeCameraLabel.toUpperCase()} (DETECTED DEVICE CAMERA)
                  </span>
                  <span className="pill-badge pill-green text-xs font-mono">
                    {isWebcamActive ? `${webcamTelemetry.actualFps || 30} FPS • 60FPS AI` : 'STANDBY'}
                  </span>
                </div>
                <div className="hero-location-subtext">
                  <MapPin size={11} className="text-cyan" />
                  <strong className="text-white">{resolvedLocation}</strong>
                  <span className="text-cyan">({geoPosition?.formatted || '28.5708° N, 77.3271° E'})</span>
                </div>
              </div>

              <div className="hero-cam-controls-group">
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
                        📷 {cam.label || `Camera ${idx + 1}`}
                      </option>
                    ))}
                  </select>
                )}

                {popularLocations && (
                  <select
                    value={popularLocations.find((l) => l.name === resolvedLocation)?.id || 'custom'}
                    onChange={(e) => {
                      const sel = popularLocations.find((l) => l.id === e.target.value);
                      if (sel) {
                        setLocationOverride(sel.name, { latitude: sel.latitude, longitude: sel.longitude, gps: sel.gps });
                      }
                    }}
                    className="camera-device-select font-mono"
                    title="Surveillance Sector Location"
                  >
                    <option value="custom" disabled>📍 {resolvedLocation}</option>
                    {popularLocations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        📍 {loc.shortName || loc.name}
                      </option>
                    ))}
                  </select>
                )}

                <button
                  className={`btn-action font-mono ${isWebcamActive ? 'btn-red' : 'btn-cyan'}`}
                  onClick={isWebcamActive ? stopWebcam : () => startWebcam()}
                  style={{ padding: '6px 12px', fontSize: '11px' }}
                >
                  {isWebcamActive ? 'STOP SENSOR' : 'START SENSOR'}
                </button>

                <button
                  className="icon-action-btn"
                  title="Fullscreen Inspection"
                  onClick={() => setExpandedModalCamera({ isWebcam: true })}
                >
                  <Maximize2 size={14} />
                </button>
              </div>
            </div>

            {/* Viewport */}
            <div className="hero-camera-viewport scanlines">
              <video
                ref={heroVideoRef}
                autoPlay
                playsInline
                muted
                className="hardware-accelerated-video"
                style={{ display: isWebcamActive ? 'block' : 'none' }}
              />
              <canvas
                ref={heroCanvasRef}
                className="camera-hud-canvas-overlay"
                style={{ display: isWebcamActive ? 'block' : 'none' }}
              />

              {/* In-Video HUD Overlay Toolbar (Matching Inspection Modal) */}
              {isWebcamActive && (
                <div className="in-video-hud-toolbar font-mono">
                  <button
                    className={`hud-toggle-btn ${showAiOverlay ? 'active' : ''}`}
                    onClick={() => setShowAiOverlay(!showAiOverlay)}
                    title="Toggle AI Target Bounding Boxes & Tracking"
                  >
                    <Sparkles size={13} />
                    <span>AI OVERLAY</span>
                  </button>

                  <button
                    className={`hud-toggle-btn ${showVirtualFence ? 'active' : ''}`}
                    onClick={() => setShowVirtualFence(!showVirtualFence)}
                    title="Toggle Virtual Perimeter Tripwire"
                  >
                    <Crosshair size={13} />
                    <span>VIRTUAL FENCE</span>
                  </button>
                </div>
              )}

              {!isWebcamActive && (
                <div className="hero-standby-overlay font-mono">
                  <div className="hero-standby-box">
                    <CameraIcon size={48} className="text-cyan animate-pulse mb-3" style={{ margin: '0 auto 12px' }} />
                    <h3 className="text-white text-base font-bold mb-1">
                      DETECTED DEVICE CAMERA: {activeCameraLabel}
                    </h3>
                    <p className="text-muted text-xs mb-4">
                      Sensor Location: <span className="text-white font-bold">{resolvedLocation}</span> ({geoPosition?.formatted || '28.5708° N, 77.3271° E'})
                    </p>
                    <button
                      onClick={() => startWebcam()}
                      className="btn-hero-activate font-mono"
                    >
                      ▶ ACTIVATE DETECTED DEVICE CAMERA
                    </button>
                    {webcamError && (
                      <div className="mt-3 text-red text-xs bg-red-950/40 p-2 rounded border border-red-800">
                        {webcamError}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Bottom Telemetry Overlay */}
              {isWebcamActive && (
                <div className="hero-cam-telemetry-bar font-mono">
                  <div className="telemetry-pill">
                    <MapPin size={11} className="text-cyan" />
                    <span>{geoPosition?.formatted || '28.5708° N, 77.3271° E'}</span>
                  </div>
                  <div className="telemetry-pill">
                    <span>SECTOR: <strong>{resolvedLocation}</strong></span>
                  </div>
                  <div className="telemetry-pill">
                    <span className="text-green">⚡ {webcamTelemetry.actualFps || 30} FPS</span>
                  </div>
                  <div className="telemetry-pill">
                    <span>LATENCY: {webcamTelemetry.lastLatencyMs || 12}ms</span>
                  </div>
                  <div className="telemetry-pill">
                    <span className="text-green">👤 PERSONS: {webcamTelemetry.personsCount || 0}</span>
                  </div>
                  <div className="telemetry-pill">
                    <span className="text-cyan">🚗 VEHICLES: {webcamTelemetry.vehiclesCount || 0}</span>
                  </div>
                  <div className="telemetry-pill">
                    <span className="text-yellow">🎯 TARGETS: {webcamTelemetry.detectionsCount || 0}</span>
                  </div>
                  {webcamTelemetry.weaponsCount > 0 && (
                    <div className="telemetry-pill pill-alert">
                      <span className="text-red animate-pulse">🚨 WEAPONS: {webcamTelemetry.weaponsCount}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Control & Filter Strip for Matrix view */}
      {viewMode === 'matrix' && (
      <div className="surveillance-control-strip">
        <div className="control-left-group">
          {/* Dropdown 1: Dynamic Camera Selector */}
          <div className="select-dropdown-box">
            <Video size={14} className="text-cyan" />
            <select 
              value={selectedFilter} 
              onChange={(e) => setSelectedFilter(e.target.value)}
              className="custom-select font-mono"
            >
              <option value="all">All Cameras ({displayedCameras.length}/{displayedCameras.length})</option>
              {displayedCameras.map((c) => (
                <option key={c.id} value={c.id}>{c.code} {c.name}</option>
              ))}
            </select>
          </div>

          {/* Dropdown 2: Event Filter */}
          <div className="select-dropdown-box">
            <Filter size={14} className="text-sub" />
            <select className="custom-select font-mono">
              <option value="all-events">All Events (Breach & Motion)</option>
              <option value="breach">Breach Only</option>
              <option value="motion">Motion Only</option>
            </select>
          </div>

          {/* Dynamic YOLOv8 Neural Tag */}
          <span className="pill-badge pill-green neural-tag font-mono">
            <span className="status-dot dot-green"></span> YOLOv8 Edge Engine • Dynamic {effectiveGridCount}-Cam Matrix Active
          </span>
        </div>

        <div className="control-right-group">
          {/* Dynamic Grid Layout Toggles */}
          <div className="grid-toggle-buttons font-mono">
            <button 
              className={`grid-btn ${selectedGridCount === 'auto' ? 'active' : ''}`}
              onClick={() => { setSelectedGridCount('auto'); setViewMode('matrix'); }}
              title="Dynamic Auto-Detect Grid (2 or 8 Cams)"
            >
              <span>⚡ AUTO ({effectiveGridCount})</span>
            </button>

            <button 
              className={`grid-btn ${selectedGridCount === 2 ? 'active' : ''}`}
              onClick={() => { setSelectedGridCount(2); setViewMode('matrix'); }}
              title="2-Camera Side-by-Side View"
            >
              <span>2-CAM</span>
            </button>

            <button 
              className={`grid-btn ${selectedGridCount === 4 ? 'active' : ''}`}
              onClick={() => { setSelectedGridCount(4); setViewMode('matrix'); }}
              title="4-Camera Matrix (2x2)"
            >
              <Grid2X2 size={13} /> <span>4-CAM</span>
            </button>

            <button 
              className={`grid-btn ${selectedGridCount === 6 ? 'active' : ''}`}
              onClick={() => { setSelectedGridCount(6); setViewMode('matrix'); }}
              title="6-Camera Matrix (3x2)"
            >
              <Grid3X3 size={13} /> <span>6-CAM</span>
            </button>

            <button 
              className={`grid-btn ${selectedGridCount === 8 ? 'active' : ''}`}
              onClick={() => { setSelectedGridCount(8); setViewMode('matrix'); }}
              title="8-Camera Defense Matrix (4x2)"
            >
              <span>8-CAM</span>
            </button>

            <button 
              className={`grid-btn ${selectedGridCount === 1 ? 'active' : ''}`}
              onClick={() => { setSelectedGridCount(1); setViewMode('matrix'); }}
              title="Single Full Screen Camera View"
            >
              <Square size={13} /> <span>1-1</span>
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

      {/* Dynamic Camera Grid (Dynamically adapts to 2, 4, 6, 8 or any detected camera count) */}
      <div 
        className={`video-streams-grid layout-dynamic-${effectiveGridCount} layout-${effectiveGridCount === 1 ? '1x1' : effectiveGridCount === 2 ? '1x2' : effectiveGridCount === 4 ? '2x2' : effectiveGridCount === 6 ? '3x2' : '4x2'}`} 
        style={{ display: viewMode === 'matrix' ? 'grid' : 'none' }}
      >
        {displayedCameras.map((cam, idx) => {
          if (cam.isLocalDevice) {
            // CAMERA 1: DYNAMIC DETECTED DEVICE CAMERA
            return (
              <div 
                key={cam.id} 
                className={`camera-feed-card ${isWebcamActive ? 'active-webcam-card' : ''} ${hasUnusualThreat ? 'unusual-alert-glow' : ''}`}
              >
                <div className="feed-header">
                  <div className="feed-header-title">
                    <Video size={15} className={isWebcamActive ? 'text-green' : 'text-cyan'} />
                    <span className="feed-name">
                      {isWebcamActive ? `C-01 ${activeCameraLabel.toUpperCase()}` : 'C-01 NORTH GATE / LOCAL DEVICE'}
                    </span>
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
                        {availableCameras.map((c, cIdx) => (
                          <option key={c.deviceId || cIdx} value={c.deviceId}>
                            {c.label || `Camera ${cIdx + 1}`}
                          </option>
                        ))}
                      </select>
                    )}

                    {isWebcamActive && popularLocations && (
                      <select
                        value={popularLocations.find((l) => l.name === resolvedLocation)?.id || 'custom'}
                        onChange={(e) => {
                          const sel = popularLocations.find((l) => l.id === e.target.value);
                          if (sel) {
                            setLocationOverride(sel.name, { latitude: sel.latitude, longitude: sel.longitude, gps: sel.gps });
                          }
                        }}
                        className="camera-device-select font-mono"
                        title="Surveillance Sector Location"
                      >
                        <option value="custom" disabled>📍 {resolvedLocation || 'Noida Sector 28'}</option>
                        {popularLocations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            📍 {loc.shortName || loc.name}
                          </option>
                        ))}
                      </select>
                    )}

                    <span className={`pill-badge ${webcamTelemetry.weaponsCount > 0 ? 'pill-red' : 'pill-green'} status-pill-sm`}>
                      <span className={`status-dot ${webcamTelemetry.weaponsCount > 0 ? 'dot-red pulse-ring' : 'dot-green pulse-ring'}`}></span> 
                      {webcamTelemetry.weaponsCount > 0
                        ? `🚨 WEAPON DETECTED (${webcamTelemetry.weaponsCount})`
                        : isWebcamActive 
                          ? `LIVE AI • ${webcamTelemetry.detectionsCount} Targets` 
                          : 'LIVE • Standby'}
                    </span>
                    <button className="feed-menu-btn"><MoreVertical size={14} /></button>
                  </div>
                </div>

                <div className="feed-viewport scanlines">
                  {isWebcamActive ? (
                    <>
                      <video
                        ref={matrixVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className="hardware-accelerated-video"
                      />
                      <canvas
                        ref={matrixCanvasRef}
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

                  <div className="feed-overlay-gps-box font-mono">
                    <MapPin size={11} className="text-cyan" />
                    <span>
                      {isWebcamActive 
                        ? `LOC: ${(resolvedLocation || 'NOIDA SECTOR 28').toUpperCase()} | GPS: ${geoPosition?.formatted || webcamTelemetry.gpsCoords || '28.5708° N, 77.3271° E'}`
                        : `LOC: ${(cameras[0]?.location || 'NOIDA SECTOR 28').toUpperCase()} | GPS: ${cameras[0]?.gps_coords || '28.5708° N, 77.3271° E'}`}
                    </span>
                  </div>

                  {/* Real-time Detection Summary Strip (Person, Vehicle, Weapon) */}
                  <div className="card-detection-summary-strip font-mono">
                    <span className="det-summary-badge det-badge-person">
                      👤 {webcamTelemetry.personsCount || (isWebcamActive ? 0 : 1)} {(webcamTelemetry.personsCount || (isWebcamActive ? 0 : 1)) === 1 ? 'PERSON' : 'PERSONS'}
                    </span>
                    <span className="det-summary-badge det-badge-vehicle">
                      🚗 {webcamTelemetry.vehiclesCount || 0} {(webcamTelemetry.vehiclesCount || 0) === 1 ? 'VEHICLE' : 'VEHICLES'}
                    </span>
                    {webcamTelemetry.weaponsCount > 0 ? (
                      <span className="det-summary-badge det-badge-weapon animate-pulse">
                        🚨 {webcamTelemetry.weaponsCount} THREAT
                      </span>
                    ) : (
                      <span className="det-summary-badge det-badge-person" style={{ borderColor: 'rgba(16, 185, 129, 0.3)', color: '#10b981' }}>
                        🛡️ SECURE
                      </span>
                    )}
                  </div>

                  <div className="feed-overlay-controls">
                    {isWebcamActive && (
                      <button onClick={switchCamera} title="Flip camera" className="mobile-touch-btn">
                        <RefreshCw size={13} />
                      </button>
                    )}
                    <button 
                      title="Capture Forensic Snapshot with Location & GPS" 
                      className="mobile-touch-btn"
                      onClick={handleQuickFeedSnapshot}
                    >
                      <CameraIcon size={13} />
                    </button>
                    <button title="Pan"><Hand size={13} /></button>
                    <button title="Zoom"><ZoomIn size={13} /></button>
                    <button 
                      title="Fullscreen"
                      onClick={() => setExpandedModalCamera(isWebcamActive ? { isWebcam: true } : (cameras[0] || cam))}
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
                          <strong>Device: {deviceInfo.platformName}</strong> | <strong>Persons: {webcamTelemetry.personsCount || 0}</strong> | <strong>Vehicles: {webcamTelemetry.vehiclesCount || 0}</strong> | <strong>Alerts: {webcamTelemetry.alertsCount}</strong>
                        </>
                      ) : (
                        <>
                          <strong>Person ID: P-115</strong> | <strong>Sector: Noida Sec 28 • Authorized</strong>
                        </>
                      )}
                    </span>
                  </div>
                  <span className="footer-right font-mono">{isWebcamActive ? (deviceInfo.isMobile ? 'MOBILE_STREAM_ACTIVE' : 'DEVICE_STREAM_ACTIVE') : 'SECTOR_GATE_ALPHA'}</span>
                </div>
              </div>
            );
          }

          // CAMERAS 2 TO 8: SECTOR DEFENSE MATRIX CAMERAS
          const isAlert = cam.status === 'warning' || cam.weapons > 0;
          return (
            <div 
              key={cam.id} 
              className={`camera-feed-card ${isAlert ? 'alert-feed-card' : ''}`}
            >
              <div className={`feed-header ${isAlert ? 'alert-header' : ''}`}>
                <div className="feed-header-title">
                  {isAlert ? <AlertTriangle size={16} className="text-red" /> : <Video size={15} className="text-cyan" />}
                  <span className="feed-name">{cam.code} {cam.name.toUpperCase()}</span>
                  <span className={`feed-mode-tag ${isAlert ? 'alert-tag' : cam.mode.includes('IR') ? 'ir-mode-tag' : 'station-tag'} font-mono`}>
                    {cam.mode}
                  </span>
                </div>
                <div className="feed-header-right">
                  <span className={`pill-badge ${isAlert ? 'pill-red' : 'pill-green'} status-pill-sm font-mono`}>
                    <span className={`status-dot ${isAlert ? 'dot-red pulse-ring' : 'dot-green'}`}></span>
                    {isAlert ? 'ALERT • Intrusion Detected' : 'LIVE • No Threat'}
                  </span>
                  <button className="feed-menu-btn"><MoreVertical size={14} /></button>
                </div>
              </div>

              <div 
                className={`feed-viewport scanlines ${isAlert ? 'alert-tint' : cam.mode.includes('IR') ? 'thermal-tint' : ''}`}
                onClick={() => setExpandedModalCamera(cam)}
                style={{ cursor: 'pointer' }}
                title="Click to view full screen"
              >
                <img 
                  src={cam.streamUrl || getCameraStreamUrl(cam.id)} 
                  onError={(e) => {
                    setTimeout(() => {
                      if (e.target) {
                        e.target.src = `${cam.frameUrl || `/api/v1/cameras/${cam.id}/frame`}?t=${Date.now()}`;
                      }
                    }, 800);
                  }}
                  alt={`${cam.code} Feed`} 
                  className="camera-img-bg" 
                />

                <div className="embedded-video-timestamp font-mono">
                  {new Date().toISOString().replace('T', ' ').substring(0, 10)} {new Date().toLocaleTimeString()} UTC {cam.code}
                </div>

                <div className="feed-overlay-top-left-box font-mono">
                  <div className={isAlert ? 'red-text' : 'green-utc-time'}>{new Date().toLocaleTimeString()} UTC</div>
                  <div className="fps-mbps-info">{cam.code} • {cam.location.toUpperCase()} • {cam.fps || 30} FPS</div>
                </div>

                <div className={`feed-overlay-top-right-box font-mono ${isAlert ? 'reticle-tag' : cam.mode.includes('IR') ? 'purple-title-box' : 'green-title-box'}`}>
                  {cam.mode}
                </div>

                <div className="feed-overlay-gps-box font-mono" style={isAlert ? { borderColor: 'rgba(255, 0, 51, 0.5)', color: '#ff6b81' } : {}}>
                  <MapPin size={11} className={isAlert ? 'text-red' : 'text-cyan'} />
                  <span>LOC: {cam.location.toUpperCase()} | GPS: {cam.gps_coords}</span>
                </div>

                {/* Specific Tactical AI Overlays per Sector Camera */}
                {cam.id === 'cam-02' && (
                  <div className="anpr-vehicle-bounding-zone">
                    <div className="ir-anchor-sq ir-sq-tl"></div>
                    <div className="ir-anchor-sq ir-sq-tr"></div>
                    <div className="ir-anchor-sq ir-sq-bl"></div>
                    <div className="ir-anchor-sq ir-sq-br"></div>
                    <div className="anpr-vehicle-card font-mono">
                      <div className="anpr-header-row">
                        <Shield size={14} className="text-purple-light" />
                        <div className="anpr-title-text">ID: V-021 | VEHICLE • 93%</div>
                      </div>
                      <div className="anpr-plate-row">
                        <span className="plate-label font-mono">PLATE:</span>
                        <span className="plate-value-box font-mono">HR26AB1234</span>
                      </div>
                    </div>
                  </div>
                )}

                {cam.id === 'cam-03' && (
                  <div className="intruder-bounding-box">
                    <div className="intruder-tag font-mono">TARGET #P-102 INTRUDER [94%]</div>
                  </div>
                )}

                {cam.id === 'cam-04' && (
                  <div className="sentry-bounding-zone">
                    <div className="sentry-tag-box font-mono">
                      <ShieldCheck size={14} className="text-green" />
                      <span className="sentry-tag-text">ID: P-115 | AUTHORIZED SENTRY • 98%</span>
                    </div>
                  </div>
                )}

                {cam.id === 'cam-05' && (
                  <div className="anpr-vehicle-bounding-zone" style={{ top: '25%', left: '35%', width: '180px', height: '100px' }}>
                    <div className="anpr-vehicle-card font-mono" style={{ background: 'rgba(0, 242, 254, 0.15)', borderColor: '#00F2FE' }}>
                      <span className="text-cyan font-bold text-xs">🚗 VEHICLE FLOW: 142/MIN</span>
                      <div className="text-xs text-white">RECON SATELLITE LINK</div>
                    </div>
                  </div>
                )}

                {cam.id === 'cam-06' && (
                  <div className="sentry-bounding-zone" style={{ top: '30%', left: '40%' }}>
                    <div className="sentry-tag-box font-mono">
                      <ShieldCheck size={14} className="text-green" />
                      <span className="sentry-tag-text">EAST PATROL UNIT 2 • ACTIVE</span>
                    </div>
                  </div>
                )}

                {cam.id === 'cam-07' && (
                  <div className="anpr-vehicle-bounding-zone" style={{ top: '35%', left: '30%', width: '190px' }}>
                    <div className="anpr-vehicle-card font-mono">
                      <span className="text-cyan font-bold text-xs">🚤 PATROL VESSEL V-08</span>
                      <div className="text-xs text-white">YAMUNA RIVER CHECKPOINT</div>
                    </div>
                  </div>
                )}

                {cam.id === 'cam-08' && (
                  <div className="sentry-bounding-zone" style={{ top: '20%', left: '45%' }}>
                    <div className="sentry-tag-box font-mono" style={{ borderColor: '#00F2FE' }}>
                      <Radio size={14} className="text-cyan" />
                      <span className="sentry-tag-text">PTZ RADAR LOCK • SECTOR CLEAR</span>
                    </div>
                  </div>
                )}

                {/* Per-Card Detection Summary Strip (Person, Vehicle, Weapon) */}
                <div className="card-detection-summary-strip font-mono">
                  <span className="det-summary-badge det-badge-person">
                    👤 {cam.persons} {cam.persons === 1 ? 'PERSON' : 'PERSONS'}
                  </span>
                  <span className="det-summary-badge det-badge-vehicle">
                    🚗 {cam.vehicles} {cam.vehicles === 1 ? 'VEHICLE' : 'VEHICLES'}
                  </span>
                  {cam.weapons > 0 ? (
                    <span className="det-summary-badge det-badge-weapon animate-pulse">
                      🚨 {cam.weapons} THREAT
                    </span>
                  ) : (
                    <span className="det-summary-badge det-badge-person" style={{ borderColor: 'rgba(16, 185, 129, 0.3)', color: '#10b981' }}>
                      🛡️ SECURE
                    </span>
                  )}
                </div>

                <div className="feed-overlay-controls">
                  <button title="Pan"><Hand size={13} /></button>
                  <button title="Zoom"><ZoomIn size={13} /></button>
                  <button 
                    title="Fullscreen Forensic Inspection"
                    onClick={() => setExpandedModalCamera(cam)}
                  >
                    <Maximize2 size={13} />
                  </button>
                </div>
              </div>

              {/* Feed Footer Strip */}
              <div className={`feed-footer-strip ${isAlert ? 'alert-footer' : ''}`}>
                <div className="footer-left-info">
                  {isAlert ? <AlertOctagon size={18} className="text-red" /> : <ShieldCheck size={14} className="text-green" />}
                  <span>
                    {isAlert ? (
                      <strong className="text-red">Intrusion Alert • Tactical Unit Dispatched</strong>
                    ) : (
                      <><strong>{cam.name}</strong> • Persons: {cam.persons} | Vehicles: {cam.vehicles} • Clear</>
                    )}
                  </span>
                </div>

                {isAlert ? (
                  <button 
                    className={`ack-btn-stacked ${acknowledgedAlert ? 'ack' : ''}`}
                    onClick={() => handleAcknowledge('ALT-101')}
                  >
                    <span className="ack-text font-mono">{acknowledgedAlert ? 'ACKNOWLEDGED' : 'ACKNOWLEDGE'}</span>
                    <span className="ack-count font-mono">(1)</span>
                  </button>
                ) : (
                  <span className="footer-right font-mono">{cam.code}_SECTOR_ONLINE</span>
                )}
              </div>
            </div>
          );
        })}
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
              <AlertTriangle size={15} />
            </div>
            <div className="strip-details">
              <div className="strip-header">
                <span className="strip-id font-mono">P-102 <span className="cam-code font-mono">C-03</span></span>
                <span className="strip-conf font-mono text-red">94%</span>
              </div>
              <div className="strip-title font-semibold">Unauthorized Intrusion</div>
              <div className="strip-sub">Perimeter Sector Breach</div>
            </div>
          </div>

          <div className="detection-strip-card card-purple">
            <div className="strip-avatar avatar-purple">
              <Eye size={15} />
            </div>
            <div className="strip-details">
              <div className="strip-header">
                <span className="strip-id font-mono">P-308 <span className="cam-code font-mono">C-07</span></span>
                <span className="strip-status-text font-mono text-purple">Flagged</span>
              </div>
              <div className="strip-title font-semibold">Loitering Subject</div>
              <div className="strip-sub">Dwell Time: 04m 52s</div>
            </div>
          </div>

          <div className="detection-strip-card card-blue">
            <div className="strip-avatar avatar-blue">
              <Truck size={15} />
            </div>
            <div className="strip-details">
              <div className="strip-header">
                <span className="strip-id font-mono">V-021 <span className="cam-code font-mono">C-02</span></span>
                <span className="strip-conf font-mono text-cyan">93%</span>
              </div>
              <div className="strip-title font-semibold">Motorized Vehicle</div>
              <div className="strip-sub">Plate: HR-26-AB-1234</div>
            </div>
          </div>

          <div className="detection-strip-card card-green">
            <div className="strip-avatar avatar-green">
              <UserCheck size={15} />
            </div>
            <div className="strip-details">
              <div className="strip-header">
                <span className="strip-id font-mono">P-115 <span className="cam-code font-mono">C-01</span></span>
                <span className="strip-conf font-mono text-green">97%</span>
              </div>
              <div className="strip-title font-semibold">Authorized Personnel</div>
              <div className="strip-sub">Duty Patrol Officer</div>
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
              <div className="log-main-msg text-red">● Unauthorized Breach</div>
              <div className="log-meta font-mono">Target: Unknown Male</div>
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
              <div className="log-main-msg text-purple">● Loitering Anomaly</div>
              <div className="log-meta font-mono">Status: High Persistence</div>
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
              <div className="log-main-msg text-cyan">● Vehicle Inbound</div>
              <div className="log-meta font-mono">ANPR: HR26AB1234 (93%)</div>
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
              <div className="log-main-msg text-green">● Security Officer</div>
              <div className="log-meta font-mono">FRS: Clearance Alpha</div>
            </div>
          </div>
        </div>
      </div>

      {/* Expanded Big Camera Inspection Modal */}
      {expandedModalCamera && (
        <CameraDetailModal
          camera={expandedModalCamera}
          isWebcam={Boolean(expandedModalCamera.isWebcam || expandedModalCamera.isDeviceHardware || expandedModalCamera.id === 'cam-01')}
          webcamStream={localStream}
          webcamTelemetry={webcamTelemetry}
          liveDetections={liveDetections}
          onClose={() => setExpandedModalCamera(null)}
        />
      )}

      {/* Add IP Camera Modal */}
      <AddIpCameraModal
        isOpen={isAddIpModalOpen}
        onClose={() => setIsAddIpModalOpen(false)}
        onCameraAdded={() => {
          fetchCameras().then((data) => {
            if (Array.isArray(data)) setCameras(data);
          });
        }}
      />
    </div>
  );
};

export default LiveSurveillancePage;
