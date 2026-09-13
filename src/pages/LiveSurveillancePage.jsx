import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Video, 
  Square, 
  RefreshCw, 
  Maximize2, 
  AlertTriangle, 
  Clock, 
  ChevronRight,
  Eye,
  Truck,
  UserCheck,
  CheckCircle2,
  Cpu,
  Smartphone,
  Camera as CameraIcon,
  Flame,
  Radio,
  Download,
  Crosshair,
  Shield
} from 'lucide-react';
import { fetchAlerts, getCameraStreamUrl } from '../services/apiService';
import { CameraDetailModal } from '../components/CameraDetailModal';
import { getDevicePlatform, getOpticalCameras } from '../utils/deviceDetector';
import { soundController } from '../utils/audioAlert';
import { useLocation } from '../context/LocationContext';
import axios from 'axios';
import './LiveSurveillancePage.css';

// 10-Channel Border & City Defense Surveillance Matrix (Gurgaon Sector Default)
const DEFENSE_CHANNELS_10 = [
  { 
    id: 'cam-01', code: 'C-01', name: 'DLF Cyber City North Gate', location: 'Gurgaon Cyber City, Haryana', 
    mode: 'OPTICAL 4K', fps: 30, res: '1080p', type: 'GATE', threat: 'CLEAR', targets: 2, 
    gps: '28.4949° N, 77.0895° E', image: '/assets/cam1.png',
    fencePoints: [{ x: 0.12, y: 0.28 }, { x: 0.88, y: 0.28 }, { x: 0.82, y: 0.84 }, { x: 0.18, y: 0.84 }],
    simulatedTargets: [
      { id: 'T-01', label: 'PATROL SENTRY', className: 'person', confidence: 0.98, x: 0.38, y: 0.35, w: 0.16, h: 0.45, color: '#00f2fe', pose: 'STANDING', isBreach: false },
      { id: 'V-01', label: 'JEEP [HR-26-AX-8912]', className: 'vehicle', confidence: 0.94, x: 0.64, y: 0.48, w: 0.24, h: 0.34, color: '#10b981', isVehicle: true, isBreach: false }
    ]
  },
  { 
    id: 'cam-02', code: 'C-02', name: 'Sector 29 Leisure Valley Road', location: 'Gurgaon Sector 29, Haryana', 
    mode: 'THERMAL IR', fps: 30, res: '1080p', type: 'ROAD', threat: 'FLAGGED', targets: 2, 
    gps: '28.4682° N, 77.0620° E', image: '/assets/cam1.png',
    fencePoints: [{ x: 0.15, y: 0.32 }, { x: 0.85, y: 0.32 }, { x: 0.80, y: 0.88 }, { x: 0.20, y: 0.88 }],
    simulatedTargets: [
      { id: 'V-02', label: 'CONVOY TRUCK [HR-55-CZ-4401]', className: 'vehicle', confidence: 0.92, x: 0.28, y: 0.40, w: 0.26, h: 0.36, color: '#10b981', isVehicle: true, isBreach: false },
      { id: 'T-02', label: 'PATROL GUARD', className: 'person', confidence: 0.93, x: 0.66, y: 0.42, w: 0.15, h: 0.42, color: '#00f2fe', pose: 'PATROLLING', isBreach: false }
    ]
  },
  { 
    id: 'cam-03', code: 'C-03', name: 'Sohna Road Surveillance Post', location: 'Gurgaon Sohna Road, Haryana', 
    mode: 'ANOMALY DETECT', fps: 24, res: '1080p', type: 'FENCE', threat: 'ALERT', targets: 1, 
    gps: '28.4198° N, 77.0401° E', image: '/assets/cam1.png',
    fencePoints: [{ x: 0.10, y: 0.22 }, { x: 0.90, y: 0.22 }, { x: 0.85, y: 0.78 }, { x: 0.15, y: 0.78 }],
    simulatedTargets: [
      { id: 'INT-01', label: '🚨 INTRUDER: FENCE BREACH', className: 'person', confidence: 0.99, x: 0.46, y: 0.32, w: 0.18, h: 0.46, color: '#ff0033', pose: 'CROUCHING', isBreach: true, isWeapon: true }
    ]
  },
  { 
    id: 'cam-04', code: 'C-04', name: 'Golf Course Extension Corridor', location: 'Gurgaon Sector 56, Haryana', 
    mode: 'FRS SCANNER', fps: 30, res: '720p', type: 'SENTRY', threat: 'CLEAR', targets: 2, 
    gps: '28.4285° N, 77.1082° E', image: '/assets/cam1.png',
    fencePoints: [{ x: 0.20, y: 0.20 }, { x: 0.80, y: 0.20 }, { x: 0.75, y: 0.82 }, { x: 0.25, y: 0.82 }],
    simulatedTargets: [
      { id: 'FRS-01', label: 'VERIFIED OPERATOR [96%]', className: 'person', confidence: 0.96, x: 0.36, y: 0.28, w: 0.18, h: 0.46, color: '#00f2fe', pose: 'STANDING', isBreach: false },
      { id: 'T-04', label: 'GATE OPERATOR', className: 'person', confidence: 0.95, x: 0.68, y: 0.36, w: 0.15, h: 0.40, color: '#10b981', pose: 'STANDING', isBreach: false }
    ]
  },
  { 
    id: 'cam-05', code: 'C-05', name: 'Udyog Vihar Phase 4 Post', location: 'Gurgaon Udyog Vihar, Haryana', 
    mode: 'LONG-RANGE PTZ', fps: 30, res: '1080p', type: 'TOWER', threat: 'CLEAR', targets: 2, 
    gps: '28.5028° N, 77.0820° E', image: '/assets/cam1.png',
    fencePoints: [{ x: 0.15, y: 0.30 }, { x: 0.85, y: 0.30 }, { x: 0.75, y: 0.85 }, { x: 0.25, y: 0.85 }],
    simulatedTargets: [
      { id: 'T-05', label: 'TOWER LOOKOUT', className: 'person', confidence: 0.97, x: 0.45, y: 0.30, w: 0.14, h: 0.40, color: '#00f2fe', pose: 'OBSERVING', isBreach: false }
    ]
  },
  { 
    id: 'cam-06', code: 'C-06', name: 'Perimeter East Patrol', location: 'Sector 06 Fence Track', 
    mode: 'NIGHT SENSOR', fps: 25, res: '1080p', type: 'PATROL', threat: 'CLEAR', targets: 1, 
    gps: '34.1720° N, 74.8490° E', image: '/assets/cam1.png',
    fencePoints: [{ x: 0.12, y: 0.25 }, { x: 0.88, y: 0.25 }, { x: 0.80, y: 0.80 }, { x: 0.20, y: 0.80 }],
    simulatedTargets: [
      { id: 'T-06', label: 'EAST SENTRY [94%]', className: 'person', confidence: 0.94, x: 0.50, y: 0.35, w: 0.16, h: 0.44, color: '#00f2fe', pose: 'PATROLLING', isBreach: false }
    ]
  },
  { 
    id: 'cam-07', code: 'C-07', name: 'Drone Recon Overflight', location: 'Sector 07 Aerial Grid', 
    mode: 'AIR-TO-GROUND', fps: 60, res: '1080p', type: 'DRONE', threat: 'CLEAR', targets: 2, 
    gps: '34.1800° N, 74.8550° E', image: '/assets/cam1.png',
    fencePoints: [{ x: 0.10, y: 0.20 }, { x: 0.90, y: 0.20 }, { x: 0.85, y: 0.85 }, { x: 0.15, y: 0.85 }],
    simulatedTargets: [
      { id: 'DRN-01', label: 'GROUND UNIT [95%]', className: 'vehicle', confidence: 0.95, x: 0.52, y: 0.45, w: 0.20, h: 0.30, color: '#00f2fe', isVehicle: true, isBreach: false }
    ]
  },
  { 
    id: 'cam-08', code: 'C-08', name: 'Gate Bravo Checkpoint', location: 'Sector 08 Bravo Post', 
    mode: 'ANPR + RADAR', fps: 30, res: '1080p', type: 'CHECKPOINT', threat: 'CLEAR', targets: 2, 
    gps: '34.1430° N, 74.8090° E', image: '/assets/cam1.png',
    fencePoints: [{ x: 0.18, y: 0.30 }, { x: 0.82, y: 0.30 }, { x: 0.78, y: 0.85 }, { x: 0.22, y: 0.85 }],
    simulatedTargets: [
      { id: 'V-08', label: 'INSPECTED VEHICLE [HR-26-BQ-7719]', className: 'vehicle', confidence: 0.97, x: 0.40, y: 0.44, w: 0.25, h: 0.36, color: '#10b981', isVehicle: true, isBreach: false }
    ]
  },
  { 
    id: 'cam-09', code: 'C-09', name: 'Forward Outpost Charlie', location: 'Sector 09 Trench Post', 
    mode: 'ACOUSTIC + IR', fps: 24, res: '720p', type: 'OUTPOST', threat: 'CLEAR', targets: 1, 
    gps: '34.1390° N, 74.8020° E', image: '/assets/cam1.png',
    fencePoints: [{ x: 0.15, y: 0.25 }, { x: 0.85, y: 0.25 }, { x: 0.80, y: 0.85 }, { x: 0.20, y: 0.85 }],
    simulatedTargets: [
      { id: 'T-09', label: 'OUTPOST WATCH', className: 'person', confidence: 0.92, x: 0.44, y: 0.36, w: 0.16, h: 0.42, color: '#00f2fe', pose: 'STANDING', isBreach: false }
    ]
  },
  { 
    id: 'cam-10', code: 'C-10', name: 'Tactical Aerial Sentry', location: 'Sector 10 High Ridge', 
    mode: 'PANORAMIC 360', fps: 30, res: '4K ULTRA', type: 'AERIAL', threat: 'CLEAR', targets: 2, 
    gps: '34.1850° N, 74.8620° E', image: '/assets/cam1.png',
    fencePoints: [{ x: 0.10, y: 0.15 }, { x: 0.90, y: 0.15 }, { x: 0.85, y: 0.88 }, { x: 0.15, y: 0.88 }],
    simulatedTargets: [
      { id: 'T-10', label: 'HIGH RIDGE PATROL', className: 'person', confidence: 0.96, x: 0.48, y: 0.38, w: 0.15, h: 0.42, color: '#00f2fe', pose: 'OBSERVING', isBreach: false }
    ]
  },
];

const LiveSurveillancePage = ({ onNavigateToAlerts }) => {
  const { coords: liveCoords, locationName: liveLocName, isLiveGps: hasLiveSensor } = useLocation();

  // Device & Hardware Camera Discovery States
  const [deviceInfo, setDeviceInfo] = useState(() => getDevicePlatform());
  const [detectedDeviceList, setDetectedDeviceList] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [hardwareStreams, setHardwareStreams] = useState({}); // { [deviceIdOrKey]: MediaStream }
  const [cameraErrors, setCameraErrors] = useState({});

  // Layout Grid & Overlay Controls
  const [layoutGrid, setLayoutGrid] = useState('4'); // Default to 4-Matrix so full surveillance cluster is visible
  const [showAiMarkings, setShowAiMarkings] = useState(true);
  const [showVirtualFence, setShowVirtualFence] = useState(true);
  
  // Custom slot assignments (each slot can be hardware device or CCTV channel)
  const [slotSources, setSlotSources] = useState(() => {
    return Array.from({ length: 10 }, (_, i) => ({
      slotIndex: i,
      sourceType: 'auto', // 'auto' | 'hardware' | 'defense'
      assignedDeviceId: null,
      channelId: DEFENSE_CHANNELS_10[i].id,
    }));
  });

  // Modal inspection state
  const [expandedModalCamera, setExpandedModalCamera] = useState(null);

  // Live Device Real-Time Hardware GPS
  const [liveDeviceGps, setLiveDeviceGps] = useState(() => {
    try {
      const saved = localStorage.getItem('ibvap_live_device_gps');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Real-Time AI Tracking & Inference State
  const liveDetectionsRef = useRef({}); // slotKey -> Detection[]
  const trackedSmoothBoxesRef = useRef({}); // slotKey -> Array of smoothed boxes for 60fps interpolation
  const isIngestingRef = useRef({}); // slotKey -> boolean
  const lastSeenDetectionTimeRef = useRef({}); // slotKey -> timestamp
  const offscreenCanvasRef = useRef(null);
  const [liveDetectedObjects, setLiveDetectedObjects] = useState(() => [
    { id: 'T-01', slotKey: 'slot-0', camCode: 'C-01', className: 'person', confidence: 0.98, poseLabel: 'STANDING', isWeapon: false, threatLevel: 'CLEAR', timestamp: new Date().toLocaleTimeString() },
    { id: 'V-01', slotKey: 'slot-0', camCode: 'C-01', className: 'vehicle', confidence: 0.94, poseLabel: 'JK-02-AX-8912', isWeapon: false, threatLevel: 'CLEAR', timestamp: new Date().toLocaleTimeString() },
    { id: 'V-02', slotKey: 'slot-1', camCode: 'C-02', className: 'vehicle', confidence: 0.92, poseLabel: 'PB-10-CZ-4401', isWeapon: false, threatLevel: 'CLEAR', timestamp: new Date().toLocaleTimeString() },
    { id: 'INT-01', slotKey: 'slot-2', camCode: 'C-03', className: 'person', confidence: 0.99, poseLabel: 'CROUCHING', isWeapon: true, threatLevel: 'ALERT', timestamp: new Date().toLocaleTimeString() },
    { id: 'FRS-01', slotKey: 'slot-3', camCode: 'C-04', className: 'person', confidence: 0.96, poseLabel: 'OPERATOR [96%]', isWeapon: false, threatLevel: 'CLEAR', timestamp: new Date().toLocaleTimeString() },
  ]);

  // Video and Canvas element references for slots
  const videoRefs = useRef({});
  const canvasRefs = useRef({});

  // Stream error fallback tracker
  const [streamErrorFlags, setStreamErrorFlags] = useState({});

  // Hardware Device Discovery Routine
  const scanHardwareDevices = useCallback(async () => {
    setIsScanning(true);
    try {
      const p = getDevicePlatform();
      setDeviceInfo(p);
      const opticalDevices = await getOpticalCameras();
      setDetectedDeviceList(opticalDevices);

      // Auto-assign detected optical devices to initial slots
      if (opticalDevices.length > 0) {
        setSlotSources((prev) =>
          prev.map((slot, idx) => {
            if (idx < opticalDevices.length && slot.sourceType === 'auto') {
              return { ...slot, assignedDeviceId: opticalDevices[idx].deviceId };
            }
            return slot;
          })
        );
      }
    } catch (err) {
      console.debug('Hardware discovery notice:', err);
    } finally {
      setIsScanning(false);
    }
  }, []);

  // Initial Scan on Mount + Listen for physical USB/Camera plugging/unplugging
  useEffect(() => {
    scanHardwareDevices();

    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
      const onDeviceChange = () => {
        scanHardwareDevices();
      };
      navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
      };
    }
  }, [scanHardwareDevices]);

  // Load telemetry data & camera catalog from backend
  const loadData = useCallback(async () => {
    try {
      await fetchAlerts({ limit: 10 });
    } catch (err) {
      console.debug('Surveillance live load fallback:', err);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 12000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Start specific hardware camera device
  const startHardwareCamera = async (deviceId, slotKey = 'slot-0') => {
    try {
      const constraints = {
        video: deviceId 
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const streamKey = deviceId || slotKey;

      setHardwareStreams((prev) => ({ ...prev, [streamKey]: stream }));
      setCameraErrors((prev) => ({ ...prev, [streamKey]: null }));

      // Attach to corresponding video ref if present
      if (videoRefs.current[slotKey]) {
        videoRefs.current[slotKey].srcObject = stream;
        videoRefs.current[slotKey].play().catch(() => {});
      }

      // Re-scan so updated device labels are populated after permission grant
      const updated = await getOpticalCameras();
      if (updated.length > 0) {
        setDetectedDeviceList(updated);
      }

      // Fetch Real Device Hardware GPS Coordinates
      if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const { latitude, longitude, altitude } = pos.coords;
            const latStr = `${Math.abs(latitude).toFixed(4)}° ${latitude >= 0 ? 'N' : 'S'}`;
            const lonStr = `${Math.abs(longitude).toFixed(4)}° ${longitude >= 0 ? 'E' : 'W'}`;
            const formatted = `${latStr}, ${lonStr}`;
            const gpsObj = { latitude, longitude, altitude: altitude ? Math.round(altitude) : null, formatted };
            setLiveDeviceGps(gpsObj);
            try {
              localStorage.setItem('ibvap_live_device_gps', JSON.stringify(gpsObj));
            } catch (e) {}
          },
          (err) => console.debug('Device Geolocation notice:', err?.message),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
      }

      return stream;
    } catch (err) {
      console.warn('Failed to start hardware camera:', err);
      const streamKey = deviceId || slotKey;
      setCameraErrors((prev) => ({
        ...prev,
        [streamKey]: err.message || 'Camera permission denied or device busy.',
      }));
    }
  };

  // Stop specific hardware camera
  const stopHardwareCamera = (streamKey) => {
    setHardwareStreams((prev) => {
      const stream = prev[streamKey];
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      const next = { ...prev };
      delete next[streamKey];
      return next;
    });
  };

  // Start All Detected Cameras (prioritizing genuine optical cameras)
  const startAllCameras = async () => {
    const opticalDevices = detectedDeviceList.filter((d) => !d.isVirtualVoice);
    if (opticalDevices.length === 0) {
      await startHardwareCamera(null, 'slot-0');
    } else {
      for (let i = 0; i < Math.min(10, opticalDevices.length); i++) {
        const dev = opticalDevices[i];
        await startHardwareCamera(dev.deviceId, `slot-${i}`);
      }
    }
  };

  // Stop All Active Cameras
  const stopAllCameras = () => {
    Object.values(hardwareStreams).forEach((stream) => {
      if (stream && stream.getTracks) {
        stream.getTracks().forEach((track) => track.stop());
      }
    });
    setHardwareStreams({});
  };

  // Determine how many cameras to display based on layout selection and detected count
  const detectedCount = Math.max(1, detectedDeviceList.filter((d) => !d.isVirtualVoice).length);
  const displayCount = (() => {
    if (layoutGrid === 'auto') {
      return Math.max(1, Math.min(10, detectedCount));
    }
    return Math.min(10, Math.max(1, parseInt(layoutGrid, 10) || 4));
  })();

  const isAnyCameraActive = Object.keys(hardwareStreams).length > 0;

  // Real-Time YOLOv8 AI Frame Ingestion & Live Detection Loop
  useEffect(() => {
    let timerId;
    let isMounted = true;

    const runAiInferenceLoop = async () => {
      const activeSlotKeys = Object.keys(videoRefs.current).filter((k) => {
        const v = videoRefs.current[k];
        return v && v.readyState >= 2 && v.videoWidth > 0 && !v.paused;
      });

      for (const slotKey of activeSlotKeys) {
        if (isIngestingRef.current[slotKey]) continue;
        const video = videoRefs.current[slotKey];
        if (!video || video.readyState < 2 || video.videoWidth === 0) continue;

        isIngestingRef.current[slotKey] = true;

        try {
          if (!offscreenCanvasRef.current) {
            offscreenCanvasRef.current = document.createElement('canvas');
          }
          const canvas = offscreenCanvasRef.current;
          const vw = video.videoWidth || 640;
          const vh = video.videoHeight || 360;

          // Scale frame down to max width 480 for fast low-latency inference
          const scale = Math.min(1.0, 480 / Math.max(vw, 1));
          const tw = Math.round(vw * scale);
          const th = Math.round(vh * scale);
          canvas.width = tw;
          canvas.height = th;

          const ctx = canvas.getContext('2d', { alpha: false });
          ctx.drawImage(video, 0, 0, tw, th);

          const b64 = canvas.toDataURL('image/jpeg', 0.65);
          const slotIdx = parseInt(slotKey.replace('slot-', ''), 10) || 0;
          const camMeta = DEFENSE_CHANNELS_10[slotIdx] || DEFENSE_CHANNELS_10[0];

          const res = await axios.post(`/api/v1/cameras/${camMeta.id || 'cam-01'}/ingest`, {
            image: b64,
            location: camMeta.location,
          }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000,
          });

          if (res.data && res.data.success) {
            const dets = res.data.detections || [];
            liveDetectionsRef.current[slotKey] = dets;
            lastSeenDetectionTimeRef.current[slotKey] = Date.now();

            // Update live detected objects state for the bottom active detections strip
            if (isMounted) {
              setLiveDetectedObjects((prev) => {
                const formatted = dets.map((d, dIdx) => ({
                  id: d.target_id || `P-${slotIdx + 1}${dIdx}`,
                  slotKey,
                  camCode: camMeta.code,
                  className: d.class_name || 'person',
                  confidence: d.confidence || 0.92,
                  poseLabel: d.pose_label || 'ACTIVE',
                  isWeapon: Boolean(d.is_weapon || (d.is_holding && d.held_item_type === 'WEAPON')),
                  isHolding: Boolean(d.is_holding),
                  heldItem: d.held_item,
                  threatLevel: d.threat_level || (d.is_weapon ? 'ALERT' : 'CLEAR'),
                  timestamp: new Date().toLocaleTimeString(),
                }));
                const other = prev.filter((p) => p.slotKey !== slotKey);
                return [...formatted, ...other];
              });
            }

            // Audio alert if weapon is detected
            const hasWeapon = dets.some(
              (d) => d.is_weapon || 
                     (d.is_holding && d.held_item_type === 'WEAPON') ||
                     ['knife', 'gun', 'pistol', 'rifle', 'shotgun', 'firearm', 'weapon'].some(w => 
                       (d.class_name || '').toLowerCase().includes(w) || 
                       (d.held_item || '').toLowerCase().includes(w)
                     )
            );
            if (hasWeapon) {
              soundController.triggerWeaponSiren(2000);
            }
          }
        } catch (err) {
          // Drop frame gracefully on network jitter
        } finally {
          isIngestingRef.current[slotKey] = false;
        }
      }

      if (isMounted) {
        timerId = setTimeout(runAiInferenceLoop, 280);
      }
    };

    timerId = setTimeout(runAiInferenceLoop, 350);
    return () => {
      isMounted = false;
      clearTimeout(timerId);
    };
  }, []);

  // Single Camera Snapshot Capture
  const handleCaptureSnapshot = (slotIndex, camMeta) => {
    const video = videoRefs.current[`slot-${slotIndex}`];
    const canvas = canvasRefs.current[`slot-${slotIndex}`];
    const offCanvas = document.createElement('canvas');
    const cw = video?.videoWidth || 1280;
    const ch = video?.videoHeight || 720;
    offCanvas.width = cw;
    offCanvas.height = ch;
    const ctx = offCanvas.getContext('2d');

    // Draw video or standby background
    if (video && video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, cw, ch);
    } else {
      ctx.fillStyle = '#070b14';
      ctx.fillRect(0, 0, cw, ch);
    }

    // Draw HUD canvas layer if present
    if (canvas) {
      ctx.drawImage(canvas, 0, 0, cw, ch);
    }

    // Draw forensic timestamp banner
    const nowUtc = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    ctx.fillStyle = 'rgba(8, 14, 24, 0.92)';
    ctx.fillRect(16, ch - 54, Math.min(cw - 32, 680), 44);
    ctx.strokeStyle = '#00f2fe';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(16, ch - 54, Math.min(cw - 32, 680), 44);

    ctx.font = 'bold 13px JetBrains Mono, monospace';
    ctx.fillStyle = '#00f2fe';
    ctx.fillText(`● ${camMeta.code} ${camMeta.name.toUpperCase()} | LOC: ${camMeta.location.toUpperCase()}`, 28, ch - 34);

    ctx.font = '11px JetBrains Mono, monospace';
    ctx.fillStyle = '#10b981';
    ctx.fillText(`TIME: ${nowUtc} | GPS: ${camMeta.gps} | FORENSIC AUDIT`, 28, ch - 18);

    const a = document.createElement('a');
    a.href = offCanvas.toDataURL('image/jpeg', 0.95);
    a.download = `CCTV_SNAPSHOT_${camMeta.code}_${Date.now()}.jpg`;
    a.click();
  };

  // Real-time Tactical HUD Overlay Canvas Rendering Loop (60 FPS Motion Interpolation)
  useEffect(() => {
    let animId;

    const renderOverlayLoop = () => {
      const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

      for (let i = 0; i < displayCount; i++) {
        const slotKey = `slot-${i}`;
        const canvas = canvasRefs.current[slotKey];
        const video = videoRefs.current[slotKey];
        if (!canvas) continue;

        const cw = canvas.clientWidth || 640;
        const ch = canvas.clientHeight || 360;
        if (canvas.width !== cw || canvas.height !== ch) {
          canvas.width = cw;
          canvas.height = ch;
        }

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, cw, ch);

        const camMeta = DEFENSE_CHANNELS_10[i] || DEFENSE_CHANNELS_10[0];
        const hasStream = video && video.readyState >= 2 && video.videoWidth > 0 && !video.paused;
        const rawDets = liveDetectionsRef.current[slotKey] || [];
        const lastSeen = lastSeenDetectionTimeRef.current[slotKey] || 0;
        const isFresh = Date.now() - lastSeen < 5000;
        const validDets = isFresh ? rawDets : [];

        // ── 1. Virtual Perimeter Fence Overlay ───────────────────────────
        if (showVirtualFence && camMeta.fencePoints && camMeta.fencePoints.length >= 3) {
          ctx.save();
          const pts = camMeta.fencePoints;
          const isAlarm = camMeta.threat === 'ALERT';

          // Shaded defense zone interior
          ctx.beginPath();
          ctx.moveTo(pts[0].x * cw, pts[0].y * ch);
          for (let p = 1; p < pts.length; p++) {
            ctx.lineTo(pts[p].x * cw, pts[p].y * ch);
          }
          ctx.closePath();
          ctx.fillStyle = isAlarm ? 'rgba(255, 0, 51, 0.08)' : 'rgba(0, 242, 254, 0.05)';
          ctx.fill();

          // Animated dashed fence perimeter line
          ctx.strokeStyle = isAlarm ? '#ff0033' : 'rgba(0, 242, 254, 0.75)';
          ctx.lineWidth = isAlarm ? 2.5 : 1.5;
          ctx.shadowColor = isAlarm ? '#ff0033' : '#00f2fe';
          ctx.shadowBlur = isAlarm ? 10 : 4;
          ctx.setLineDash([8, 6]);
          ctx.lineDashOffset = -Date.now() / 120;
          ctx.stroke();
          ctx.setLineDash([]);

          // Corner '+' targeting markers
          pts.forEach((pt) => {
            const px = pt.x * cw;
            const py = pt.y * ch;
            ctx.strokeStyle = isAlarm ? '#ff0033' : '#00f2fe';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(px - 6, py); ctx.lineTo(px + 6, py);
            ctx.moveTo(px, py - 6); ctx.lineTo(px, py + 6);
            ctx.stroke();
          });

          // Floating zone banner
          const fx = pts[0].x * cw + 6;
          const fy = pts[0].y * ch + 14;
          ctx.fillStyle = isAlarm ? 'rgba(255, 0, 51, 0.90)' : 'rgba(0, 242, 254, 0.85)';
          ctx.fillRect(fx - 4, fy - 10, isAlarm ? 175 : 155, 14);
          ctx.font = 'bold 8.5px JetBrains Mono, monospace';
          ctx.fillStyle = '#000000';
          ctx.fillText(isAlarm ? '⚡ RESTRICTED ZONE: INTRUSION!' : '⚡ VIRTUAL PERIMETER FENCE', fx, fy);
          ctx.restore();
        }

        // ── 2. AI Detection Markings & Bounding Boxes ─────────────────────
        if (showAiMarkings) {
          if (hasStream) {
            if (validDets.length > 0) {
              if (!trackedSmoothBoxesRef.current[slotKey]) {
                trackedSmoothBoxesRef.current[slotKey] = [];
              }
              const smoothList = trackedSmoothBoxesRef.current[slotKey];

              validDets.forEach((det, dIdx) => {
                if (!det.bbox) return;

                const targetX = det.bbox.x * cw;
                const targetY = det.bbox.y * ch;
                const targetW = det.bbox.w * cw;
                const targetH = det.bbox.h * ch;

                if (!smoothList[dIdx]) {
                  smoothList[dIdx] = { x: targetX, y: targetY, w: targetW, h: targetH };
                }

                smoothList[dIdx].x += (targetX - smoothList[dIdx].x) * 0.32;
                smoothList[dIdx].y += (targetY - smoothList[dIdx].y) * 0.32;
                smoothList[dIdx].w += (targetW - smoothList[dIdx].w) * 0.32;
                smoothList[dIdx].h += (targetH - smoothList[dIdx].h) * 0.32;

                const bx = Math.round(smoothList[dIdx].x);
                const by = Math.round(smoothList[dIdx].y);
                const bw = Math.round(smoothList[dIdx].w);
                const bh = Math.round(smoothList[dIdx].h);

                const cName = (det.class_name || '').toLowerCase();
                const held = (det.held_item || '').toLowerCase();
                const isWeapon = Boolean(
                  det.is_weapon || 
                  (det.is_holding && det.held_item_type === 'WEAPON') || 
                  ['knife', 'gun', 'pistol', 'rifle', 'weapon', 'sword', 'machete', 'dagger'].some(w => cName.includes(w) || held.includes(w))
                );
                const isPhone = cName.includes('phone') || held.includes('phone');
                const isPerson = det.class_id === 0 || cName.includes('person');

                const boxColor = isWeapon ? '#ff0033' : isPhone ? '#f59e0b' : '#00f2fe';

                // Tactical Bounding Box with glow
                ctx.save();
                ctx.strokeStyle = boxColor;
                ctx.lineWidth = isWeapon ? 2.5 : 1.8;
                ctx.shadowColor = boxColor;
                ctx.shadowBlur = isWeapon ? 14 : 6;
                ctx.strokeRect(bx, by, bw, bh);

                // Corner Reticle Brackets
                const cl = Math.min(14, Math.max(6, bw / 4));
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.moveTo(bx, by + cl); ctx.lineTo(bx, by); ctx.lineTo(bx + cl, by);
                ctx.moveTo(bx + bw - cl, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by + cl);
                ctx.moveTo(bx, by + bh - cl); ctx.lineTo(bx, by + bh); ctx.lineTo(bx + cl, by + bh);
                ctx.moveTo(bx + bw - cl, by + bh); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw, by + bh - cl);
                ctx.stroke();

                if (isWeapon) {
                  const cx = bx + bw / 2;
                  const cy = by + bh / 2;
                  ctx.strokeStyle = '#ff0033';
                  ctx.lineWidth = 1;
                  ctx.setLineDash([2, 2]);
                  ctx.beginPath();
                  ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy);
                  ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 10);
                  ctx.stroke();
                  ctx.setLineDash([]);
                }
                ctx.restore();

                // Skeleton Keypoints
                if (det.keypoints && det.keypoints.length >= 5) {
                  ctx.save();
                  const pts = det.keypoints;
                  const drawJoint = (p) => {
                    if (p && p.conf > 0.25) {
                      ctx.fillStyle = '#00f2fe';
                      ctx.beginPath();
                      ctx.arc(p.x * cw, p.y * ch, 3, 0, 2 * Math.PI);
                      ctx.fill();
                    }
                  };
                  const drawBone = (i1, i2) => {
                    const p1 = pts[i1];
                    const p2 = pts[i2];
                    if (p1 && p2 && p1.conf > 0.25 && p2.conf > 0.25) {
                      ctx.strokeStyle = 'rgba(0, 242, 254, 0.65)';
                      ctx.lineWidth = 1.5;
                      ctx.beginPath();
                      ctx.moveTo(p1.x * cw, p1.y * ch);
                      ctx.lineTo(p2.x * cw, p2.y * ch);
                      ctx.stroke();
                    }
                  };

                  const SKELETON_PAIRS = [
                    [0, 1], [0, 2], [1, 3], [2, 4],
                    [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],
                    [5, 11], [6, 12], [11, 12],
                    [11, 13], [13, 15], [12, 14], [14, 16],
                  ];
                  SKELETON_PAIRS.forEach(([a, b]) => {
                    if (pts[a] && pts[b]) drawBone(a, b);
                  });
                  pts.forEach(drawJoint);
                  ctx.restore();
                }

                // Label Pill
                const confStr = `${Math.round((det.confidence || 0.9) * 100)}%`;
                let labelText = '';
                if (isWeapon) {
                  labelText = `🚨 WEAPON: ${(det.unusual_item || det.class_name || 'FIREARM').toUpperCase()} [${confStr}]`;
                } else if (isPhone) {
                  labelText = `📱 CELL PHONE [${confStr}]`;
                } else if (isPerson) {
                  const pose = det.pose_label ? ` • ${det.pose_label}` : '';
                  labelText = `👤 TARGET P-0${dIdx + 1} [${confStr}]${pose}`;
                } else {
                  labelText = `🎯 ${(det.class_name || 'OBJECT').toUpperCase()} [${confStr}]`;
                }

                ctx.save();
                ctx.font = 'bold 9.5px JetBrains Mono, monospace';
                const textW = ctx.measureText(labelText).width;
                const tagY = Math.max(by - 18, 6);

                ctx.fillStyle = isWeapon ? 'rgba(255, 0, 51, 0.92)' : isPhone ? 'rgba(245, 158, 11, 0.92)' : 'rgba(0, 242, 254, 0.88)';
                ctx.fillRect(bx, tagY, textW + 10, 16);
                ctx.fillStyle = '#000000';
                ctx.fillText(labelText, bx + 5, tagY + 12);
                ctx.restore();
              });
            } else {
              // Camera streaming actively, scanning for targets
              ctx.save();
              const cx = cw / 2;
              const cy = ch / 2;
              ctx.strokeStyle = 'rgba(0, 242, 254, 0.35)';
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(cx - 28, cy); ctx.lineTo(cx + 28, cy);
              ctx.moveTo(cx, cy - 28); ctx.lineTo(cx, cy + 28);
              ctx.stroke();

              const radius = 24 + Math.sin(Date.now() / 400) * 4;
              ctx.strokeStyle = 'rgba(0, 242, 254, 0.55)';
              ctx.beginPath();
              ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
              ctx.stroke();

              ctx.fillStyle = 'rgba(7, 12, 22, 0.88)';
              ctx.fillRect(cx - 105, cy + 34, 210, 20);
              ctx.strokeStyle = 'rgba(0, 242, 254, 0.4)';
              ctx.strokeRect(cx - 105, cy + 34, 210, 20);

              ctx.font = 'bold 8.5px JetBrains Mono, monospace';
              ctx.fillStyle = '#00f2fe';
              ctx.textAlign = 'center';
              ctx.fillText('● AI SENSOR ACTIVE • TRACKING TARGETS', cx, cy + 47);
              ctx.textAlign = 'left';
              ctx.restore();
            }
          } else {
            // Standby / Defense Feed Tactical Markings (rendered on all slots!)
            const simulated = camMeta.simulatedTargets || [
              { id: `T-${i + 1}`, label: `PATROL UNIT ${camMeta.code}`, className: 'person', confidence: 0.96, x: 0.42, y: 0.35, w: 0.16, h: 0.45, color: '#00f2fe', pose: 'STANDING' }
            ];

            simulated.forEach((tgt, tIdx) => {
              // Dynamic slight drift for organic tracking feel
              const driftX = Math.sin(Date.now() / 2500 + tIdx * 2 + i) * 0.025;
              const driftY = Math.cos(Date.now() / 3200 + tIdx * 2 + i) * 0.015;

              const bx = Math.round((tgt.x + driftX) * cw);
              const by = Math.round((tgt.y + driftY) * ch);
              const bw = Math.round(tgt.w * cw);
              const bh = Math.round(tgt.h * ch);

              const isAlarm = tgt.isBreach || tgt.isWeapon || tgt.color === '#ff0033';
              const boxColor = isAlarm ? '#ff0033' : tgt.color || '#00f2fe';

              ctx.save();
              // 1. Tactical Bounding Box
              ctx.strokeStyle = boxColor;
              ctx.lineWidth = isAlarm ? 2.5 : 1.6;
              ctx.shadowColor = boxColor;
              ctx.shadowBlur = isAlarm ? 12 : 5;
              ctx.strokeRect(bx, by, bw, bh);

              // 2. High-Tech Corner Reticle Brackets
              const cl = Math.min(12, Math.max(5, bw / 4));
              ctx.lineWidth = 2.4;
              ctx.beginPath();
              ctx.moveTo(bx, by + cl); ctx.lineTo(bx, by); ctx.lineTo(bx + cl, by);
              ctx.moveTo(bx + bw - cl, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by + cl);
              ctx.moveTo(bx, by + bh - cl); ctx.lineTo(bx, by + bh); ctx.lineTo(bx + cl, by + bh);
              ctx.moveTo(bx + bw - cl, by + bh); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw, by + bh - cl);
              ctx.stroke();

              // 3. Alarm crosshairs if breach or weapon
              if (isAlarm) {
                const cx = bx + bw / 2;
                const cy = by + bh / 2;
                ctx.strokeStyle = '#ff0033';
                ctx.lineWidth = 1;
                ctx.setLineDash([2, 2]);
                ctx.beginPath();
                ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy);
                ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 10);
                ctx.stroke();
                ctx.setLineDash([]);
              }

              // 4. Skeleton joint indicators for simulated persons
              if (!tgt.isVehicle && bh > 40) {
                ctx.fillStyle = boxColor;
                const headX = bx + bw / 2;
                const headY = by + bh * 0.16;
                ctx.beginPath(); ctx.arc(headX, headY, 2.5, 0, 2 * Math.PI); ctx.fill();
                const chestY = by + bh * 0.38;
                ctx.beginPath(); ctx.arc(headX, chestY, 2, 0, 2 * Math.PI); ctx.fill();
                ctx.beginPath(); ctx.arc(headX - bw * 0.32, chestY + 5, 2, 0, 2 * Math.PI); ctx.fill();
                ctx.beginPath(); ctx.arc(headX + bw * 0.32, chestY + 5, 2, 0, 2 * Math.PI); ctx.fill();
              }

              // 5. Tactical Tag Pill
              ctx.font = 'bold 9px JetBrains Mono, monospace';
              const textW = ctx.measureText(tgt.label).width;
              const tagY = Math.max(by - 16, 5);

              ctx.fillStyle = isAlarm ? 'rgba(255, 0, 51, 0.92)' : boxColor === '#10b981' ? 'rgba(16, 185, 129, 0.92)' : 'rgba(0, 242, 254, 0.88)';
              ctx.fillRect(bx, tagY, textW + 10, 15);
              ctx.fillStyle = '#000000';
              ctx.fillText(tgt.label, bx + 5, tagY + 11);

              ctx.restore();
            });
          }
        }

        // Top Left Tactical Telemetry
        ctx.fillStyle = 'rgba(7, 12, 22, 0.82)';
        ctx.fillRect(8, 8, 250, 20);
        ctx.strokeStyle = hasStream ? '#10b981' : '#00f2fe';
        ctx.lineWidth = 1;
        ctx.strokeRect(8, 8, 250, 20);
        ctx.font = 'bold 9px JetBrains Mono, monospace';
        ctx.fillStyle = hasStream ? '#10b981' : '#00f2fe';
        ctx.fillText(hasStream ? `● LIVE • YOLOv8 REALTIME TRACKING` : `● ${nowStr} • 60 FPS`, 14, 22);

        // Bottom Left GPS Coordinates (uses real-time dynamic location)
        const displayedGps = (hasStream && liveCoords?.formatted) ? liveCoords.formatted : (liveCoords?.formatted || camMeta.gps);
        const gpsSource = hasLiveSensor ? '• LIVE SENSOR' : '• GEO-LOCATED';
        ctx.fillStyle = 'rgba(7, 12, 22, 0.85)';
        ctx.fillRect(8, ch - 22, 260, 16);
        ctx.font = '8.5px JetBrains Mono, monospace';
        ctx.fillStyle = hasLiveSensor ? '#10b981' : '#00f2fe';
        ctx.fillText(`📍 GPS: ${displayedGps} ${gpsSource}`, 12, ch - 10);
      }

      animId = requestAnimationFrame(renderOverlayLoop);
    };

    animId = requestAnimationFrame(renderOverlayLoop);
    return () => cancelAnimationFrame(animId);
  }, [displayCount, showAiMarkings, showVirtualFence]);

  return (
    <div className="surveillance-page-container">
      {/* Top Title & Status Bar */}
      <div className="page-header-row">
        <div className="page-title-group">
          <div className="page-main-title">
            <h2>Live Surveillance</h2>
            <span className="streams-badge font-mono">Real-Time Camera Discovery Matrix</span>
          </div>
        </div>

        <div className="page-header-pills">
          <span className="pill-badge pill-green font-mono">
            <span className="status-dot dot-green pulse-ring"></span> SYSTEM ONLINE
          </span>

          <span className="pill-badge pill-green font-mono">
            <Cpu size={12} className="text-green" /> GPU ACCELERATED EDGE INFERENCE
          </span>

          <span className="pill-badge pill-muted font-mono">
            <Clock size={12} /> {new Date().toLocaleTimeString()}
          </span>
        </div>
      </div>

      {/* Dynamic Camera Hardware Discovery & Matrix Control Bar */}
      <div className="camera-discovery-bar font-mono">
        <div className="discovery-status-left">
          <div className="discovery-icon-box">
            <CameraIcon size={20} className="text-cyan" />
          </div>

          <div className="discovery-info-text">
            <div className="discovery-title-row">
              <span className="dot-green status-dot pulse-ring"></span>
              <span className="discovery-count-text">
                {detectedDeviceList.length} CAMERA DEVICE{detectedDeviceList.length === 1 ? '' : 'S'} DETECTED
              </span>
              <span className="discovery-max-pill font-mono">10 MAX CHANNELS</span>
            </div>

            <div className="discovery-chips-row">
              {detectedDeviceList.length > 0 ? (
                detectedDeviceList.map((dev, idx) => {
                  const isLive = !!hardwareStreams[dev.deviceId];
                  return (
                    <span key={dev.deviceId || idx} className={`device-chip ${isLive ? 'chip-active' : ''}`}>
                      <span className={`chip-dot ${isLive ? 'dot-green pulse-ring' : 'dot-sub'}`}></span>
                      <span>CAM {idx + 1}: {dev.label || `Connected Video Unit ${idx + 1}`}</span>
                    </span>
                  );
                })
              ) : (
                <span className="device-chip">
                  <span className="chip-dot dot-sub"></span>
                  <span>1 Built-in Camera Initialized • Ready to Connect</span>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="discovery-controls-right">
          {/* AI Markings Visibility Toggle */}
          <button 
            className={`tactical-btn font-mono ${showAiMarkings ? 'active-toggle' : ''}`}
            onClick={() => setShowAiMarkings((v) => !v)}
            title="Toggle AI Detection Markings, Bounding Boxes & Skeleton Joints"
            style={{
              borderColor: showAiMarkings ? 'rgba(0, 242, 254, 0.6)' : 'rgba(255, 255, 255, 0.2)',
              background: showAiMarkings ? 'rgba(0, 242, 254, 0.15)' : 'transparent',
              color: showAiMarkings ? '#00f2fe' : '#94a3b8',
            }}
          >
            <Crosshair size={13} className={showAiMarkings ? 'text-cyan' : ''} />
            <span>AI MARKINGS: {showAiMarkings ? 'ON' : 'OFF'}</span>
          </button>

          {/* Virtual Fence Visibility Toggle */}
          <button 
            className={`tactical-btn font-mono ${showVirtualFence ? 'active-toggle' : ''}`}
            onClick={() => setShowVirtualFence((v) => !v)}
            title="Toggle Virtual Perimeter Fence Zone Lines"
            style={{
              borderColor: showVirtualFence ? 'rgba(16, 185, 129, 0.6)' : 'rgba(255, 255, 255, 0.2)',
              background: showVirtualFence ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
              color: showVirtualFence ? '#34d399' : '#94a3b8',
            }}
          >
            <Shield size={13} className={showVirtualFence ? 'text-green' : ''} />
            <span>VIRTUAL FENCE: {showVirtualFence ? 'ON' : 'OFF'}</span>
          </button>

          {/* Rescan Physical Hardware Devices */}
          <button 
            className="tactical-btn rescan-btn font-mono"
            onClick={scanHardwareDevices}
            disabled={isScanning}
            title="Scan system for newly plugged in USB or IP cameras"
          >
            <RefreshCw size={13} className={isScanning ? 'spin-icon' : ''} />
            <span>{isScanning ? 'SCANNING...' : 'RESCAN DEVICES'}</span>
          </button>

          {/* Master Start/Stop All Cameras */}
          {isAnyCameraActive ? (
            <button 
              className="tactical-btn stop-all-btn font-mono"
              onClick={stopAllCameras}
              title="Stop all active hardware camera streams"
            >
              <Square size={13} className="text-red" />
              <span>STOP ALL CAMERAS</span>
            </button>
          ) : (
            <button 
              className="tactical-btn start-all-btn font-mono"
              onClick={startAllCameras}
              title="Activate all detected physical cameras"
            >
              <Video size={13} className="text-green" />
              <span>START ALL CAMERAS</span>
            </button>
          )}

          {/* Multi-Camera Matrix Layout Selector */}
          <div className="layout-switcher-group font-mono">
            <span className="layout-group-label">MATRIX:</span>
            
            <button 
              id="layout-btn-auto"
              type="button"
              className={`layout-btn ${layoutGrid === 'auto' ? 'active' : ''}`}
              onClick={() => setLayoutGrid('auto')}
              title={`Show exact detected devices count (${detectedDeviceList.length || 1} Camera${detectedDeviceList.length === 1 ? '' : 's'})`}
            >
              AUTO ({detectedDeviceList.length || 1})
            </button>

            <button 
              id="layout-btn-1"
              type="button"
              className={`layout-btn ${layoutGrid === '1' ? 'active' : ''}`}
              onClick={() => setLayoutGrid('1')}
              title="1 Camera Solo Focus"
            >
              1 CAM
            </button>

            <button 
              id="layout-btn-2"
              type="button"
              className={`layout-btn ${layoutGrid === '2' ? 'active' : ''}`}
              onClick={() => setLayoutGrid('2')}
              title="2 Cameras Split Screen"
            >
              2 CAMS
            </button>

            <button 
              id="layout-btn-4"
              type="button"
              className={`layout-btn ${layoutGrid === '4' ? 'active' : ''}`}
              onClick={() => setLayoutGrid('4')}
              title="4 Cameras Quad Matrix (2x2)"
            >
              4 CAMS
            </button>

            <button 
              id="layout-btn-6"
              type="button"
              className={`layout-btn ${layoutGrid === '6' ? 'active' : ''}`}
              onClick={() => setLayoutGrid('6')}
              title="6 Cameras Grid Array (3x2)"
            >
              6 CAMS
            </button>

            <button 
              id="layout-btn-10"
              type="button"
              className={`layout-btn ${layoutGrid === '10' ? 'active' : ''}`}
              onClick={() => setLayoutGrid('10')}
              title="10 Cameras Full Tactical Array (Max 10)"
            >
              10 CAMS (MAX)
            </button>
          </div>
        </div>
      </div>

      {/* Dynamic Multi-Camera Grid Matrix (1 to 10 Cameras) */}
      <div className={`video-streams-grid layout-count-${displayCount}`}>
        {Array.from({ length: displayCount }).map((_, slotIdx) => {
          const camMeta = DEFENSE_CHANNELS_10[slotIdx];
          const slotAssignment = slotSources[slotIdx];
          const detectedDev = detectedDeviceList[slotIdx];
          const hasHardware = !!detectedDev && !detectedDev.isVirtualVoice;
          
          const streamKey = detectedDev ? detectedDev.deviceId : `slot-${slotIdx}`;
          const activeStream = hardwareStreams[streamKey] || (slotIdx === 0 ? hardwareStreams['default'] : null);
          const isStreaming = !!activeStream;
          const camError = cameraErrors[streamKey];

          return (
            <div 
              key={camMeta.id || slotIdx} 
              className={`camera-feed-card ${isStreaming ? 'active-webcam-card' : ''} ${camMeta.threat === 'ALERT' ? 'unusual-alert-glow' : ''}`}
            >
              {/* Card Header */}
              <div className="feed-header">
                <div className="feed-header-title">
                  <Video size={14} className={isStreaming ? 'text-green' : 'text-cyan'} />
                  <span className="feed-name">
                    {camMeta.code} {hasHardware ? `[DEV: ${detectedDev.label || `CAM ${slotIdx + 1}`}]` : camMeta.name.toUpperCase()}
                  </span>
                  <span className={`feed-mode-tag ${isStreaming ? 'pill-green' : ''}`}>
                    {isStreaming ? 'LIVE 60FPS' : camMeta.mode}
                  </span>
                </div>

                <div className="feed-header-right">
                  {/* Source selector dropdown */}
                  {detectedDeviceList.length > 1 && (
                    <select
                      value={slotAssignment?.assignedDeviceId || ''}
                      onChange={(e) => {
                        const devId = e.target.value;
                        setSlotSources((prev) =>
                          prev.map((s, i) => (i === slotIdx ? { ...s, assignedDeviceId: devId } : s))
                        );
                        if (isStreaming) {
                          stopHardwareCamera(streamKey);
                          startHardwareCamera(devId, `slot-${slotIdx}`);
                        }
                      }}
                      className="camera-device-source-select font-mono"
                      title="Select hardware device input"
                    >
                      {detectedDeviceList.map((d, dIdx) => (
                        <option key={d.deviceId || dIdx} value={d.deviceId}>
                          📷 {d.label || `Device ${dIdx + 1}`}
                        </option>
                      ))}
                    </select>
                  )}

                  {/* Camera Start / Stop Toggle */}
                  <button 
                    id={`cam-slot-${slotIdx}-toggle-btn`}
                    type="button"
                    className={`feed-action-icon-btn ${isStreaming ? 'btn-active-cam' : ''}`}
                    onClick={() => {
                      if (isStreaming) {
                        stopHardwareCamera(streamKey);
                      } else {
                        startHardwareCamera(detectedDev?.deviceId, `slot-${slotIdx}`);
                      }
                    }}
                    title={isStreaming ? "Stop stream" : "Start hardware stream"}
                  >
                    {isStreaming ? <Square size={12} className="text-red" /> : <Video size={12} />}
                  </button>

                  {/* Snapshot Capture Action */}
                  <button 
                    id={`cam-slot-${slotIdx}-snapshot-btn`}
                    type="button"
                    className="feed-action-icon-btn"
                    onClick={() => handleCaptureSnapshot(slotIdx, camMeta)}
                    title="Capture forensic snapshot"
                  >
                    <Download size={12} />
                  </button>

                  {/* Fullscreen Inspector Modal Expand */}
                  <button 
                    id={`cam-slot-${slotIdx}-maximize-btn`}
                    type="button"
                    className="feed-action-icon-btn"
                    onClick={() => {
                      setExpandedModalCamera({
                        ...camMeta,
                        slotIdx,
                        streamKey,
                        isHardwareStreaming: isStreaming,
                        activeStream: activeStream,
                      });
                    }}
                    title="Expand Full Camera View"
                  >
                    <Maximize2 size={12} />
                  </button>
                </div>
              </div>

              {/* Card Video Viewport */}
              <div className="feed-viewport scanlines">
                {isStreaming ? (
                  <>
                    <video
                      ref={(el) => {
                        if (el) {
                          videoRefs.current[`slot-${slotIdx}`] = el;
                          if (activeStream && el.srcObject !== activeStream) {
                            el.srcObject = activeStream;
                            el.play().catch(() => {});
                          }
                        }
                      }}
                      autoPlay
                      playsInline
                      muted
                      className="hardware-accelerated-video"
                    />
                    <canvas
                      ref={(el) => {
                        if (el) canvasRefs.current[`slot-${slotIdx}`] = el;
                      }}
                      className="camera-hud-canvas-overlay"
                    />
                  </>
                ) : (
                  <>
                    <img 
                      src={
                        streamErrorFlags[camMeta.id]
                          ? camMeta.image || '/assets/cam1.png'
                          : getCameraStreamUrl(camMeta.id)
                      }
                      onError={() => {
                        setStreamErrorFlags((prev) => ({ ...prev, [camMeta.id]: true }));
                      }}
                      alt={camMeta.name}
                      className="camera-img-bg"
                    />
                    <canvas
                      ref={(el) => {
                        if (el) canvasRefs.current[`slot-${slotIdx}`] = el;
                      }}
                      className="camera-hud-canvas-overlay"
                    />
                  </>
                )}

                {/* Error Banner if access failed */}
                {camError && (
                  <div className="camera-error-banner font-mono">
                    <AlertTriangle size={15} className="text-red flex-shrink-0" />
                    <div className="camera-error-msg">{camError}</div>
                  </div>
                )}

                {/* Quick overlay launch button when stream is inactive */}
                {!isStreaming && hasHardware && (
                  <button 
                    id={`cam-slot-${slotIdx}-launch-btn`}
                    type="button"
                    onClick={() => startHardwareCamera(detectedDev?.deviceId, `slot-${slotIdx}`)}
                    className="webcam-launch-overlay-btn font-mono"
                    title="Activate camera hardware stream"
                  >
                    {deviceInfo.isMobile ? <Smartphone size={13} /> : <CameraIcon size={13} />}
                    <span>START {detectedDev.label?.toUpperCase() || `CAM ${slotIdx + 1}`}</span>
                  </button>
                )}

                {/* Telemetry Labels */}
                <div className="embedded-video-timestamp font-mono">
                  {camMeta.code} • {isStreaming ? 'LIVE HARDWARE' : 'NET SENSOR'} • {camMeta.res}
                </div>

                <div className="feed-overlay-top-left-box font-mono">
                  <div className="green-utc-time">{new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC</div>
                  <div className="fps-mbps-info">
                    {isStreaming ? `60 FPS • 12ms • ${camMeta.res}` : `REC 30FPS • 4.2 Mbps • ${camMeta.res}`}
                  </div>
                </div>

                {/* Tactical Corner Reticles */}
                <div className="camera-hud-corner corner-tl"></div>
                <div className="camera-hud-corner corner-tr"></div>
                <div className="camera-hud-corner corner-bl"></div>
                <div className="camera-hud-corner corner-br"></div>
              </div>

              {/* Card Footer Strip */}
              <div className="feed-footer-strip">
                <div className="footer-left-info">
                  {camMeta.threat === 'ALERT' ? (
                    <>
                      <Flame size={14} className="text-red animate-pulse" />
                      <span className="text-red">
                        <strong>DEFCON 1 Threat Triggered • Intercept Dispatched</strong>
                      </span>
                    </>
                  ) : camMeta.threat === 'FLAGGED' ? (
                    <>
                      <AlertTriangle size={14} className="text-yellow" />
                      <span className="text-yellow">
                        <strong>Suspicious Activity Detected • Monitoring</strong>
                      </span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={14} className="text-green" />
                      <span>
                        <strong>{camMeta.targets} Targets Tracked • Sector Secure</strong>
                      </span>
                    </>
                  )}
                </div>
                <span className="footer-right font-mono">{(isStreaming && liveLocName) ? liveLocName.toUpperCase() : camMeta.location.toUpperCase()}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Active Detections Strip (Driven by real-time YOLOv8 detector) */}
      <div className="active-detections-section">
        <div className="section-title-bar">
          <div className="section-title-left">
            <Radio size={16} className="text-cyan" />
            <h4 className="section-title">Active Detections</h4>
            <span className={`pill-badge ${liveDetectedObjects.length > 0 ? 'pill-green' : 'pill-muted'} font-mono`}>
              {liveDetectedObjects.length > 0 ? `${liveDetectedObjects.length} REALTIME TRACKED` : '4 BASELINE TRACKED'}
            </span>
          </div>
          <span className="section-engine-tag font-mono">YOLOv8 EDGE REALTIME</span>
        </div>

        <div className="detections-strip-grid">
          {liveDetectedObjects.length > 0 ? (
            liveDetectedObjects.slice(0, 8).map((det, idx) => {
              const isWeap = det.isWeapon;
              const isPh = det.className.toLowerCase().includes('phone') || (det.heldItem || '').toLowerCase().includes('phone');
              const cardTheme = isWeap ? 'card-red' : isPh ? 'card-yellow' : 'card-green';
              const avatarTheme = isWeap ? 'avatar-red' : isPh ? 'avatar-yellow' : 'avatar-green';

              return (
                <div key={det.id || idx} className={`detection-strip-card ${cardTheme}`}>
                  <div className={`strip-avatar ${avatarTheme}`}>
                    {isWeap ? <AlertTriangle size={14} /> : isPh ? <Smartphone size={14} /> : <UserCheck size={14} />}
                  </div>
                  <div className="strip-details">
                    <div className="strip-header">
                      <span className="strip-id font-mono">
                        {det.id} <span className="cam-code font-mono">{det.camCode}</span>
                      </span>
                      <span className="strip-conf font-mono">
                        {Math.round((det.confidence || 0.9) * 100)}%
                      </span>
                    </div>
                    <div className="strip-title">
                      {isWeap ? '🚨 WEAPON' : isPh ? '📱 CELL PHONE' : det.className.toUpperCase()}
                    </div>
                    <div className="strip-sub font-mono">
                      {det.isHolding && det.heldItem 
                        ? `Holding: ${det.heldItem}` 
                        : det.poseLabel || 'Active Tracking'} • {det.timestamp}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <>
              <div className="detection-strip-card card-green">
                <div className="strip-avatar avatar-green">
                  <UserCheck size={14} />
                </div>
                <div className="strip-details">
                  <div className="strip-header">
                    <span className="strip-id font-mono">P-101 <span className="cam-code font-mono">C-01</span></span>
                    <span className="strip-conf font-mono">96%</span>
                  </div>
                  <div className="strip-title">SURVEILLANCE SENTRY</div>
                  <div className="strip-sub">Standing • Optical Feed Active</div>
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
                  <div className="strip-title">PATROL VEHICLE</div>
                  <div className="strip-sub">Plate: HR26AB1234 • Perimeter</div>
                </div>
              </div>

              <div className="detection-strip-card card-purple">
                <div className="strip-avatar avatar-purple">
                  <Eye size={14} />
                </div>
                <div className="strip-details">
                  <div className="strip-header">
                    <span className="strip-id font-mono">P-308 <span className="cam-code font-mono">C-03</span></span>
                    <span className="strip-status-text font-mono text-purple">Clear</span>
                  </div>
                  <div className="strip-title">GATEWAY POST</div>
                  <div className="strip-sub">Sector 03 Border Line</div>
                </div>
              </div>

              <div className="detection-strip-card card-green">
                <div className="strip-avatar avatar-green">
                  <CheckCircle2 size={14} />
                </div>
                <div className="strip-details">
                  <div className="strip-header">
                    <span className="strip-id font-mono">SYS-01 <span className="cam-code font-mono">EDGE</span></span>
                    <span className="strip-conf font-mono">100%</span>
                  </div>
                  <div className="strip-title">YOLOv8 ONLINE</div>
                  <div className="strip-sub">Awaiting Hardware Detections</div>
                </div>
              </div>
            </>
          )}
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
          camera={expandedModalCamera}
          isWebcam={Boolean(expandedModalCamera.isHardwareStreaming || hardwareStreams[expandedModalCamera.streamKey] || (expandedModalCamera.slotIdx === 0 && Object.keys(hardwareStreams).length > 0))}
          webcamStream={expandedModalCamera.activeStream || hardwareStreams[expandedModalCamera.streamKey] || Object.values(hardwareStreams)[0] || null}
          webcamTelemetry={{
            actualFps: 60,
            lastLatencyMs: 12,
            unusualCount: expandedModalCamera.threat === 'ALERT' ? 1 : 0,
            weaponsCount: expandedModalCamera.threat === 'ALERT' ? 1 : 0,
          }}
          liveDetections={liveDetectedObjects.filter((d) => d.slotKey === `slot-${expandedModalCamera.slotIdx ?? 0}`)}
          onClose={() => setExpandedModalCamera(null)}
        />
      )}
    </div>
  );
};

export default LiveSurveillancePage;
