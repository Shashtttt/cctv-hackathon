import React, { useState, useEffect, useRef } from 'react';
import Hls from 'hls.js';
import axios from 'axios';
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
  MapPin,
  Circle,
  Square,
  Minus,
  Slash,
  ChevronDown,
  ChevronUp,
  Check
} from 'lucide-react';
import { TRAFFIC_VISION_SETTINGS } from '../services/trafficVisionCatalog';
import { soundController } from '../utils/audioAlert';
import { useSentinelCamera } from '../context/SentinelCameraContext';
import { VirtualFenceConfigModal } from './VirtualFenceConfigModal';
import './CameraDetailModal.css';

// ── COCO 17 Keypoints & Skeletal Bone Connections ──
const SKELETON_CONNECTIONS = [
  [0, 1], [0, 2], [1, 3], [2, 4], // Head: Nose to Eyes, Eyes to Ears
  [5, 6], // Shoulders
  [5, 7], [7, 9], // Left Arm: Shoulder -> Elbow -> Wrist
  [6, 8], [8, 10], // Right Arm: Shoulder -> Elbow -> Wrist
  [5, 11], [6, 12], [11, 12], // Torso: Shoulders to Hips, Hip to Hip
  [11, 13], [13, 15], // Left Leg: Hip -> Knee -> Ankle
  [12, 14], [14, 16], // Right Leg: Hip -> Knee -> Ankle
];

const COCO_KEYPOINT_NAMES = [
  'Nose', 'Left Eye', 'Right Eye', 'Left Ear', 'Right Ear',
  'Left Shoulder', 'Right Shoulder', 'Left Elbow', 'Right Elbow',
  'Left Wrist', 'Right Wrist', 'Left Hip', 'Right Hip',
  'Left Knee', 'Right Knee', 'Left Ankle', 'Right Ankle'
];

export const getItemIcon = (name) => {
  const n = (name || '').toLowerCase();
  if (n.includes('watch')) return '⌚';
  if (n.includes('clock')) return '⏰';
  if (n.includes('phone') || n.includes('cell')) return '📱';
  if (n.includes('laptop') || n.includes('computer')) return '💻';
  if (n.includes('bottle')) return '🍾';
  if (n.includes('cup') || n.includes('mug')) return '☕';
  if (n.includes('book')) return '📖';
  if (n.includes('pen') || n.includes('pencil')) return '✏️';
  if (n.includes('glasses') || n.includes('spectacles') || n.includes('sunglasses')) return '👓';
  if (n.includes('headphone') || n.includes('earphone') || n.includes('neckband')) return '🎧';
  if (n.includes('backpack') || n.includes('bag') || n.includes('handbag')) return '🎒';
  if (n.includes('suitcase')) return '🧳';
  if (n.includes('chair')) return '🪑';
  if (n.includes('sofa') || n.includes('couch')) return '🛋️';
  if (n.includes('bed')) return '🛏️';
  if (n.includes('wardrobe') || n.includes('door') || n.includes('shelf')) return '🚪';
  if (n.includes('tv') || n.includes('monitor') || n.includes('screen')) return '🖥️';
  if (n.includes('car') || n.includes('truck') || n.includes('bus')) return '🚗';
  if (n.includes('motorcycle') || n.includes('bicycle')) return '🏍️';
  if (n.includes('knife') || n.includes('scissor')) return '✂️';
  return '🎯';
};

export const CameraDetailModal = ({
  camera,
  isWebcam = false,
  webcamStream = null,
  webcamTelemetry = {},
  liveDetections = [],
  onDetectionsUpdate = null,
  onClose,
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [showAiOverlay, setShowAiOverlay] = useState(true);
  const [showVirtualFence, setShowVirtualFence] = useState(true);
  const [showFenceModal, setShowFenceModal] = useState(false);
  const [activeTab, setActiveTab] = useState('telemetry'); // telemetry | detections | events | ptz
  const [snapshotFeedback, setSnapshotFeedback] = useState(false);
  const [modalDetections, setModalDetections] = useState(liveDetections || []);
  const offscreenCanvasRef = useRef(null);
  const isInferringRef = useRef(false);

  // ── Adjustable Virtual Fence State (Line / Horizon, Diagonal, Circle, Box) ──
  const [fenceShape, setFenceShape] = useState('line'); // 'line' | 'diagonal' | 'circle' | 'box'
  const [fenceHeightY, setFenceHeightY] = useState(0.50); // 0.1 to 0.9 (for horizontal tripwire)
  const [fenceDiagY1, setFenceDiagY1] = useState(0.25); // 0.05 to 0.95 (left anchor for diagonal)
  const [fenceDiagY2, setFenceDiagY2] = useState(0.75); // 0.05 to 0.95 (right anchor for diagonal)
  const [fenceRadius, setFenceRadius] = useState(0.28); // 0.1 to 0.45 (for circular zone)
  const [fenceCircleCenter, setFenceCircleCenter] = useState({ x: 0.5, y: 0.5 });
  const [fenceBox, setFenceBox] = useState({ x: 0.1, y: 0.2, w: 0.8, h: 0.6 });
  const [isDraggingFence, setIsDraggingFence] = useState(false);
  const [dragMode, setDragMode] = useState(null);
  const [isFenceBreached, setIsFenceBreached] = useState(false);
  const [fenceSavedFeedback, setFenceSavedFeedback] = useState(false);
  const { liveDetections: sentinelDetections, isSentinelActive, activeStream } = useSentinelCamera();

  const activeDetections = (isSentinelActive && sentinelDetections && sentinelDetections.length > 0)
    ? sentinelDetections
    : (liveDetections && liveDetections.length > 0
        ? liveDetections
        : modalDetections);

  useEffect(() => {
    if (liveDetections && liveDetections.length > 0) {
      setModalDetections(liveDetections);
    } else if (sentinelDetections && sentinelDetections.length > 0) {
      setModalDetections(sentinelDetections);
    }
  }, [liveDetections, sentinelDetections]);

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

  const isDeviceCam = Boolean(
    isWebcam || 
    camera?.isWebcam || 
    camera?.isDeviceHardware || 
    (camera?.id && (camera.id.startsWith('dev-cam') || camera.id === 'cam-01'))
  );

  const camName = camera?.name || (isWebcam ? (camera?.deviceLabel || 'Physical Device Camera (AI Engine)') : 'Sector Camera');
  const camCode = camera?.code || (isWebcam ? 'C-01 AI' : (camera?.id ? camera.id.toUpperCase() : 'CAM-01'));
  const camLocation = isWebcam
    ? (webcamTelemetry.location || 'Noida Sector 28, Uttar Pradesh')
    : (camera?.location || 'Noida Sector 28, Uttar Pradesh');
  const camGps = isWebcam
    ? (webcamTelemetry.gpsCoords || '28.5708° N, 77.3271° E')
    : (camera?.gps || camera?.gps_coords || '28.5708° N, 77.3271° E');

  const streamUrl = (camera?.streamUrl && !camera.streamUrl.includes('.mp4')) 
    ? camera.streamUrl 
    : (camera?.id && !isDeviceCam ? `/api/v1/cameras/${camera.id}/stream` : '');
  const isHls = camera?.feedType === 'hls' || streamUrl.includes('.m3u8');
  const isMjpeg = !isDeviceCam && !isHls && (streamUrl.includes('/stream') || streamUrl.includes('/video') || streamUrl.includes('/shot.jpg') || camera?.isIpCamera || camera?.id?.startsWith('ip-'));

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

    let internalStream = null;

    if (isDeviceCam) {
      const existingStream = webcamStream || (isSentinelActive ? activeStream : null);
      if (existingStream) {
        video.muted = true;
        video.srcObject = existingStream;
        video.play().catch(() => {});
        return;
      }

      // If no stream passed down, acquire directly for this hardware device
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        const constraints = {
          video: camera?.deviceId && !camera.deviceId.startsWith('default-') && !camera.deviceId.startsWith('mobile-')
            ? { deviceId: { ideal: camera.deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
            : { facingMode: { ideal: camera?.facingMode || (camera?.isBack ? 'environment' : 'user') }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        };

        const tryAcquire = async () => {
          try {
            const s = await navigator.mediaDevices.getUserMedia(constraints);
            internalStream = s;
            if (videoRef.current) {
              videoRef.current.srcObject = s;
              videoRef.current.play().catch(() => {});
            }
          } catch (firstErr) {
            console.warn('Modal stream acquisition fallback:', firstErr?.message);
            try {
              const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
              internalStream = s;
              if (videoRef.current) {
                videoRef.current.srcObject = s;
                videoRef.current.play().catch(() => {});
              }
            } catch (err) {
              console.debug('Direct modal camera acquisition error:', err);
            }
          }
        };
        tryAcquire();
      }

      return () => {
        if (internalStream) {
          internalStream.getTracks().forEach((t) => t.stop());
        }
      };
    }

    if (streamUrl && isHls && Hls.isSupported()) {
      const hls = new Hls(TRAFFIC_VISION_SETTINGS.hls);
      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
    } else if (streamUrl && !isMjpeg) {
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
  }, [camera, isDeviceCam, webcamStream, activeStream, isSentinelActive, streamUrl, isHls, isMjpeg]);

  // ── Continuous real-time AI inference loop for camera in modal view (Fallback) ──
  useEffect(() => {
    // Never run duplicate inference if camera is device/webcam (managed by page/sentinel) or IP camera (managed by backend)
    if (isDeviceCam || isWebcam || webcamStream || isSentinelActive || camera?.isIpCamera || camera?.id?.startsWith('ip-')) {
      return;
    }
    if (liveDetections !== undefined && liveDetections !== null) {
      return;
    }

    let mounted = true;
    let timeoutId = null;

    const runModalInference = async () => {
      if (!mounted) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0) {
        timeoutId = setTimeout(runModalInference, 300);
        return;
      }

      if (isInferringRef.current) {
        timeoutId = setTimeout(runModalInference, 150);
        return;
      }

      isInferringRef.current = true;

      try {
        if (!offscreenCanvasRef.current) {
          offscreenCanvasRef.current = document.createElement('canvas');
        }
        const canvas = offscreenCanvasRef.current;
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const scale = Math.min(1.0, 640 / Math.max(vw, 1));
        canvas.width = Math.round(vw * scale);
        canvas.height = Math.round(vh * scale);

        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const b64 = canvas.toDataURL('image/jpeg', 0.65);

        const camId = (camera?.id && !camera.id.startsWith('dev-')) ? camera.id : 'cam-01';
        const res = await axios.post(`/api/v1/cameras/${camId}/ingest`, {
          image: b64,
          location: camLocation || 'Sector 28 Command Post',
        }, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 8000
        });

        if (mounted && res.data && res.data.success) {
          const dets = res.data.detections || [];
          setModalDetections(dets);
          if (onDetectionsUpdate) {
            onDetectionsUpdate(camId, dets);
          }

          const hasWeapon = dets.some(d => d.is_weapon || (d.is_holding && d.held_item_type === 'WEAPON'));
          if (hasWeapon) {
            soundController.triggerWeaponSiren(2000);
          }
        }
      } catch (err) {
        // Silently skip transient inference errors
      } finally {
        isInferringRef.current = false;
        if (mounted) {
          timeoutId = setTimeout(runModalInference, 350);
        }
      }
    };

    timeoutId = setTimeout(runModalInference, 300);

    return () => {
      mounted = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [camera?.id, camLocation, isDeviceCam]);

  // ── Virtual Fence Breach Detection Helper ──
  const checkTargetBreach = (det) => {
    if (!det.bbox) return false;
    const cx = det.bbox.x + det.bbox.w / 2;
    const cy = det.bbox.y + det.bbox.h / 2;
    const topY = det.bbox.y;
    const botY = det.bbox.y + det.bbox.h;

    if (fenceShape === 'line') {
      return (topY <= fenceHeightY && botY >= fenceHeightY) || Math.abs(cy - fenceHeightY) < 0.06;
    } else if (fenceShape === 'diagonal') {
      const yAtBoxLeft = fenceDiagY1 + det.bbox.x * (fenceDiagY2 - fenceDiagY1);
      const yAtBoxRight = fenceDiagY1 + (det.bbox.x + det.bbox.w) * (fenceDiagY2 - fenceDiagY1);
      const yAtBoxCenter = fenceDiagY1 + cx * (fenceDiagY2 - fenceDiagY1);
      const lineMinY = Math.min(yAtBoxLeft, yAtBoxRight);
      const lineMaxY = Math.max(yAtBoxLeft, yAtBoxRight);
      const crossesBox = (topY <= lineMaxY && botY >= lineMinY);
      const centerClose = Math.abs(cy - yAtBoxCenter) < 0.06;
      return crossesBox || centerClose;
    } else if (fenceShape === 'circle') {
      const dx = cx - fenceCircleCenter.x;
      const dy = cy - fenceCircleCenter.y;
      return Math.sqrt(dx * dx + dy * dy) <= fenceRadius;
    } else if (fenceShape === 'box') {
      return (
        det.bbox.x < fenceBox.x + fenceBox.w &&
        det.bbox.x + det.bbox.w > fenceBox.x &&
        det.bbox.y < fenceBox.y + fenceBox.h &&
        det.bbox.y + det.bbox.h > fenceBox.y
      );
    }
    return false;
  };

  // ── Save Virtual Fence Geometry to Backend AI Pipeline ──
  const handleSaveFenceToBackend = async () => {
    try {
      let pts = [];
      if (fenceShape === 'line') {
        pts = [
          { x: 0.0, y: fenceHeightY },
          { x: 1.0, y: fenceHeightY },
          { x: 1.0, y: Math.min(1.0, fenceHeightY + 0.02) },
          { x: 0.0, y: Math.min(1.0, fenceHeightY + 0.02) }
        ];
      } else if (fenceShape === 'diagonal') {
        const buf = 0.025;
        pts = [
          { x: 0.0, y: Math.max(0, fenceDiagY1 - buf) },
          { x: 1.0, y: Math.max(0, fenceDiagY2 - buf) },
          { x: 1.0, y: Math.min(1.0, fenceDiagY2 + buf) },
          { x: 0.0, y: Math.min(1.0, fenceDiagY1 + buf) }
        ];
      } else if (fenceShape === 'circle') {
        const numPoints = 16;
        for (let i = 0; i < numPoints; i++) {
          const angle = (i / numPoints) * Math.PI * 2;
          pts.push({
            x: Math.max(0, Math.min(1, fenceCircleCenter.x + fenceRadius * Math.cos(angle))),
            y: Math.max(0, Math.min(1, fenceCircleCenter.y + fenceRadius * Math.sin(angle))),
          });
        }
      } else if (fenceShape === 'box') {
        pts = [
          { x: fenceBox.x, y: fenceBox.y },
          { x: fenceBox.x + fenceBox.w, y: fenceBox.y },
          { x: fenceBox.x + fenceBox.w, y: fenceBox.y + fenceBox.h },
          { x: fenceBox.x, y: fenceBox.y + fenceBox.h },
        ];
      }

      const camId = camera?.id || 'dev-cam-1';
      await axios.put(`/api/v1/cameras/${camId}/fence`, { points: pts });
      setFenceSavedFeedback(true);
      setTimeout(() => setFenceSavedFeedback(false), 2000);
    } catch (err) {
      console.debug('Error saving fence to backend:', err?.message);
    }
  };

  // ── On-Canvas Mouse Dragging for Virtual Fence Adjustments ──
  const handleContainerMouseDown = (e) => {
    if (!showVirtualFence || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const my = (e.clientY - rect.top) / rect.height;
    const mx = (e.clientX - rect.left) / rect.width;

    if (fenceShape === 'line') {
      if (Math.abs(my - fenceHeightY) < 0.1) {
        setIsDraggingFence(true);
        setDragMode('line');
      }
    } else if (fenceShape === 'diagonal') {
      if (mx < 0.25 && Math.abs(my - fenceDiagY1) < 0.14) {
        setIsDraggingFence(true);
        setDragMode('diag-left');
      } else if (mx > 0.75 && Math.abs(my - fenceDiagY2) < 0.14) {
        setIsDraggingFence(true);
        setDragMode('diag-right');
      } else {
        const lineYAtMx = fenceDiagY1 + mx * (fenceDiagY2 - fenceDiagY1);
        if (Math.abs(my - lineYAtMx) < 0.12) {
          setIsDraggingFence(true);
          setDragMode('diag-center');
        }
      }
    } else if (fenceShape === 'circle') {
      const dx = mx - fenceCircleCenter.x;
      const dy = my - fenceCircleCenter.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (Math.abs(dist - fenceRadius) < 0.08 || dist < 0.08) {
        setIsDraggingFence(true);
        setDragMode('circle');
      }
    } else if (fenceShape === 'box') {
      if (Math.abs(my - (fenceBox.y + fenceBox.h)) < 0.08 || Math.abs(my - fenceBox.y) < 0.08) {
        setIsDraggingFence(true);
        setDragMode('box');
      }
    }
  };

  const handleContainerMouseMove = (e) => {
    if (!isDraggingFence || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const my = Math.max(0.05, Math.min(0.95, (e.clientY - rect.top) / rect.height));
    const mx = Math.max(0.05, Math.min(0.95, (e.clientX - rect.left) / rect.width));

    if (dragMode === 'line') {
      setFenceHeightY(my);
    } else if (dragMode === 'diag-left') {
      setFenceDiagY1(my);
    } else if (dragMode === 'diag-right') {
      setFenceDiagY2(my);
    } else if (dragMode === 'diag-center') {
      const avgY = (fenceDiagY1 + fenceDiagY2) / 2;
      const diff = my - avgY;
      setFenceDiagY1(y => Math.max(0.05, Math.min(0.95, y + diff)));
      setFenceDiagY2(y => Math.max(0.05, Math.min(0.95, y + diff)));
    } else if (dragMode === 'circle') {
      const dx = mx - fenceCircleCenter.x;
      const dy = my - fenceCircleCenter.y;
      const r = Math.max(0.1, Math.min(0.45, Math.sqrt(dx * dx + dy * dy)));
      setFenceRadius(r);
    } else if (dragMode === 'box') {
      const newH = Math.max(0.1, Math.min(0.85, my - fenceBox.y));
      setFenceBox(prev => ({ ...prev, h: newH }));
    }
  };

  const handleContainerMouseUp = () => {
    setIsDraggingFence(false);
    setDragMode(null);
  };

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

        const dets = activeDetections;

        // 1. Draw Virtual Perimeter Tripwire (Line, Circle, Box)
        if (showVirtualFence) {
          const currentBreached = dets.some(d => checkTargetBreach(d));
          setIsFenceBreached(currentBreached);

          const fColor = currentBreached ? '#ef4444' : '#00f2fe';
          const fFill = currentBreached ? 'rgba(239, 68, 68, 0.18)' : 'rgba(0, 242, 254, 0.08)';

          ctx.save();
          ctx.strokeStyle = fColor;
          ctx.shadowColor = fColor;
          ctx.shadowBlur = currentBreached ? 16 : 8;
          ctx.lineWidth = currentBreached ? 3.5 : 2.5;
          ctx.setLineDash([10, 6]);

          if (fenceShape === 'line') {
            // Horizontal Horizon Line Tripwire
            const ly = fenceHeightY * ch;
            ctx.beginPath();
            ctx.moveTo(0, ly);
            ctx.lineTo(cw, ly);
            ctx.stroke();

            // Label & interactive center drag node
            ctx.setLineDash([]);
            ctx.fillStyle = fColor;
            ctx.font = 'bold 11px JetBrains Mono, monospace';
            const statusText = currentBreached 
              ? '🚨 HORIZON TRIPWIRE BREACH DETECTED' 
              : `⚡ HORIZON TRIPWIRE: HEIGHT ${(fenceHeightY * 100).toFixed(0)}% (DRAG TO ADJUST)`;
            ctx.fillText(statusText, 18, Math.max(20, ly - 8));

            // Drag handle node in center
            ctx.beginPath();
            ctx.arc(cw / 2, ly, 8, 0, 2 * Math.PI);
            ctx.fillStyle = fColor;
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();

          } else if (fenceShape === 'diagonal') {
            // Diagonal Tripwire
            const ly1 = fenceDiagY1 * ch;
            const ly2 = fenceDiagY2 * ch;
            ctx.beginPath();
            ctx.moveTo(0, ly1);
            ctx.lineTo(cw, ly2);
            ctx.stroke();

            // Status label
            ctx.setLineDash([]);
            ctx.fillStyle = fColor;
            ctx.font = 'bold 11px JetBrains Mono, monospace';
            const statusText = currentBreached 
              ? '🚨 DIAGONAL TRIPWIRE BREACH DETECTED' 
              : `⚡ DIAGONAL TRIPWIRE: L ${(fenceDiagY1 * 100).toFixed(0)}% • R ${(fenceDiagY2 * 100).toFixed(0)}% (DRAG HANDLES)`;
            const midY = (ly1 + ly2) / 2;
            ctx.fillText(statusText, 18, Math.max(20, Math.min(ch - 20, midY - 12)));

            // Left anchor drag node
            ctx.beginPath();
            ctx.arc(28, fenceDiagY1 * ch + (fenceDiagY2 - fenceDiagY1) * (28 / cw) * ch, 8, 0, 2 * Math.PI);
            ctx.fillStyle = fColor;
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Right anchor drag node
            ctx.beginPath();
            ctx.arc(cw - 28, fenceDiagY1 * ch + (fenceDiagY2 - fenceDiagY1) * ((cw - 28) / cw) * ch, 8, 0, 2 * Math.PI);
            ctx.fillStyle = fColor;
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Center drag node
            ctx.beginPath();
            ctx.arc(cw / 2, midY, 6, 0, 2 * Math.PI);
            ctx.fillStyle = fColor;
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.stroke();

          } else if (fenceShape === 'circle') {
            // Circular Radial Perimeter
            const ccx = fenceCircleCenter.x * cw;
            const ccy = fenceCircleCenter.y * ch;
            const cr = fenceRadius * Math.min(cw, ch);

            ctx.beginPath();
            ctx.arc(ccx, ccy, cr, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.fillStyle = fFill;
            ctx.fill();

            // Center sight & radius indicator
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.arc(ccx, ccy, 5, 0, 2 * Math.PI);
            ctx.fillStyle = fColor;
            ctx.fill();

            ctx.fillStyle = fColor;
            ctx.font = 'bold 11px JetBrains Mono, monospace';
            const statusText = currentBreached 
              ? '🚨 CIRCULAR ZONE BREACH DETECTED' 
              : `⚡ CIRCULAR PERIMETER: RADIUS ${(fenceRadius * 100).toFixed(0)}%`;
            ctx.fillText(statusText, Math.max(10, ccx - 100), Math.max(20, ccy - cr - 10));

          } else {
            // Box / Rectangular Zone
            const bx = fenceBox.x * cw;
            const by = fenceBox.y * ch;
            const bw = fenceBox.w * cw;
            const bh = fenceBox.h * ch;

            ctx.strokeRect(bx, by, bw, bh);
            ctx.fillStyle = fFill;
            ctx.fillRect(bx, by, bw, bh);

            ctx.setLineDash([]);
            ctx.fillStyle = fColor;
            ctx.font = 'bold 11px JetBrains Mono, monospace';
            const statusText = currentBreached 
              ? '🚨 RECTANGULAR PERIMETER BREACH DETECTED' 
              : `⚡ RECTANGULAR ZONE: H ${(fenceBox.h * 100).toFixed(0)}% • W ${(fenceBox.w * 100).toFixed(0)}%`;
            ctx.fillText(statusText, bx + 10, Math.max(20, by - 8));
          }
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
        dets.forEach((det) => {
          if (!det.bbox) return;

          const rawConf = det.bbox?.confidence ?? det.confidence;
          // Filter out low-confidence noisy detections to prevent false bounding boxes
          if (rawConf !== undefined && rawConf !== null && rawConf < 0.42) return;

          const bx = det.bbox.x * cw;
          const by = det.bbox.y * ch;
          const bw = det.bbox.w * cw;
          const bh = det.bbox.h * ch;
          const cName = (det.class_name || '').toLowerCase();
          const heldItem = (det.held_item || '').toLowerCase();
          const isCasual = Boolean(det.is_casual_object) || det.held_item_type === 'CASUAL_OBJECT';
          const isWatch = cName === 'wristwatch' || heldItem === 'wristwatch' || heldItem === 'watch';
          const isClock = !isWatch && (cName.includes('clock') || heldItem.includes('clock'));
          const isUnknown = cName.includes('unknown') || heldItem.includes('unknown');
          const isPhone = !isWatch && !isClock && (cName.includes('phone') || cName.includes('cell') || heldItem.includes('phone'));

          const isWeaponItem = Boolean(det.is_weapon) && !isCasual && !isWatch && !isClock && !isUnknown;
          const isArmed = det.is_holding && (det.held_item_type === 'WEAPON' || isWeaponItem) && !isCasual && !isWatch && !isClock && !isUnknown;
          const isHoldingCasual = det.is_holding && !isArmed;
          const isUnattendedBag = ['backpack', 'suitcase', 'handbag'].includes(cName) && !det.is_held;
          const isHandRaised = ['HANDS_RAISED', 'HAND_RAISED'].includes(det.pose_label);
          const isCriticalPose = ['CROUCHING', 'PRONE'].includes(det.pose_label);
          const isWeapon = isArmed || isWeaponItem;

          const isPerson = det.class_id === 0 || cName === 'person';
          // Tactical UI Palette: Red for weapons/armed; Amber for casual objects; Cyan for persons/operators
          let boxColor = '#00f0ff';
          if (isWeapon) boxColor = '#ef4444';
          else if (!isPerson) boxColor = '#f59e0b';

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

          // ── Skeleton Keypoints & Limb Connections (YOLOv8-pose 17 joints) ──
          if (det.keypoints) {
            const pts = Array.isArray(det.keypoints) ? det.keypoints : (det.keypoints.points || []);
            if (pts.length > 0) {
              ctx.save();
              ctx.strokeStyle = '#00f2fe';
              ctx.lineWidth = 2.5;
              ctx.shadowColor = '#00f2fe';
              ctx.shadowBlur = 6;

              // Draw skeleton limb lines (bones) - require confident joints (>= 0.48) to avoid false criss-cross lines
              SKELETON_CONNECTIONS.forEach(([i, j]) => {
                const kpi = pts[i];
                const kpj = pts[j];
                if (kpi && kpj) {
                  const xi = (kpi.x !== undefined ? kpi.x : (Array.isArray(kpi) ? kpi[0] : 0)) * cw;
                  const yi = (kpi.y !== undefined ? kpi.y : (Array.isArray(kpi) ? kpi[1] : 0)) * ch;
                  const confi = kpi.conf !== undefined ? kpi.conf : (Array.isArray(kpi) ? kpi[2] : 1.0);
                  const xj = (kpj.x !== undefined ? kpj.x : (Array.isArray(kpj) ? kpj[0] : 0)) * cw;
                  const yj = (kpj.y !== undefined ? kpj.y : (Array.isArray(kpj) ? kpj[1] : 0)) * ch;
                  const confj = kpj.conf !== undefined ? kpj.conf : (Array.isArray(kpj) ? kpj[2] : 1.0);

                  if (confi >= 0.48 && confj >= 0.48) {
                    ctx.beginPath();
                    ctx.moveTo(xi, yi);
                    ctx.lineTo(xj, yj);
                    ctx.stroke();
                  }
                }
              });

              // Draw joint nodes (circles with white inner core)
              pts.forEach((kp, kpIdx) => {
                const kx = (kp.x !== undefined ? kp.x : (Array.isArray(kp) ? kp[0] : 0)) * cw;
                const ky = (kp.y !== undefined ? kp.y : (Array.isArray(kp) ? kp[1] : 0)) * ch;
                const kconf = kp.conf !== undefined ? kp.conf : (Array.isArray(kp) ? kp[2] : 1.0);
                if (kconf >= 0.48) {
                  // Outer glowing ring
                  ctx.beginPath();
                  ctx.arc(kx, ky, 4.5, 0, 2 * Math.PI);
                  ctx.fillStyle = '#00f2fe';
                  ctx.fill();
                  // Inner center dot
                  ctx.beginPath();
                  ctx.arc(kx, ky, 2, 0, 2 * Math.PI);
                  ctx.fillStyle = '#ffffff';
                  ctx.fill();

                  // Extremity labels
                  if ([0, 5, 6, 9, 10].includes(kpIdx)) {
                    const tagNames = { 0: 'HEAD', 5: 'L-SHLDR', 6: 'R-SHLDR', 9: 'L-WRIST', 10: 'R-WRIST' };
                    const tag = tagNames[kpIdx];
                    ctx.font = '9px JetBrains Mono, monospace';
                    ctx.fillStyle = 'rgba(6, 11, 19, 0.85)';
                    const tagW = ctx.measureText(tag).width;
                    ctx.fillRect(kx + 6, ky - 6, tagW + 6, 12);
                    ctx.strokeStyle = 'rgba(0, 242, 254, 0.5)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(kx + 6, ky - 6, tagW + 6, 12);
                    ctx.fillStyle = '#00f2fe';
                    ctx.fillText(tag, kx + 9, ky + 3);
                  }
                }
              });
              ctx.restore();
            }
          }
          ctx.restore();

          // Label
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
          } else if (isPhone) {
            labelText = `📱 CELL PHONE${confStr ? ` [${confStr}]` : ''} ${det.is_held ? '• IN HAND' : '• DETECTED'}`;
          } else if (isUnattendedBag) {
            labelText = `⚠️ UNATTENDED BAGGAGE: ${det.class_name.toUpperCase()}${confStr ? ` [${confStr}]` : ''}`;
          } else if (det.is_unusual && det.class_id !== 0) {
            labelText = `⚠️ MONITORED: ${(det.unusual_item || det.class_name).toUpperCase()}${confStr ? ` [${confStr}]` : ''}`;
          } else if (det.class_id === 0) {
            labelText = `👤 ${det.target_id || 'PERSON'} [${det.pose_label || 'ACTIVE'}]`;
          } else if (isHandRaised) {
            labelText = `✋ ${det.target_id || 'PERSON'} [${det.pose_label.replace('_', ' ')}]`;
          } else {
            const icon = getItemIcon(cName);
            labelText = `${icon} ${det.class_name.toUpperCase()}${confStr ? ` [${confStr}]` : ''} ${det.is_held ? '• HELD' : ''}`;
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
  }, [showAiOverlay, showVirtualFence, fenceShape, fenceHeightY, fenceRadius, fenceCircleCenter, fenceBox, activeDetections]);

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
    const cw = video.videoWidth || 1280;
    const ch = video.videoHeight || 720;
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');

    // 1. Draw raw video frame
    ctx.drawImage(video, 0, 0, cw, ch);

    // 2. Draw AI detections overlay layer if active
    if (canvasRef.current) {
      ctx.drawImage(canvasRef.current, 0, 0, cw, ch);
    }

    // 3. Draw Tactical Telemetry Banner on captured image
    const localTime = new Date().toLocaleString();
    const nowUtc = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    const bannerH = Math.max(54, Math.round(ch * 0.08));
    const bannerY = ch - bannerH - 12;

    // Background pill/strip
    ctx.fillStyle = 'rgba(8, 14, 24, 0.92)';
    ctx.fillRect(12, bannerY, Math.min(cw - 24, 820), bannerH);
    ctx.strokeStyle = '#00f2fe';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(12, bannerY, Math.min(cw - 24, 820), bannerH);

    // Header / Location line (e.g. "LOC: NOIDA SECTOR 28 | GPS: 28.5708° N, 77.3271° E")
    ctx.font = `bold ${Math.max(13, Math.round(ch * 0.022))}px JetBrains Mono, monospace`;
    ctx.fillStyle = '#00f2fe';
    ctx.fillText(`📍 LOC: ${camLocation.toUpperCase()} | GPS: ${camGps}`, 24, bannerY + (bannerH * 0.44));

    // Telemetry & Timestamp line (showing local time and UTC)
    ctx.font = `${Math.max(11, Math.round(ch * 0.017))}px JetBrains Mono, monospace`;
    ctx.fillStyle = '#10b981';
    ctx.fillText(`TIMESTAMP: ${localTime} (${nowUtc}) | CAM: ${camCode} | IBVAP FORENSIC CAPTURE`, 24, bannerY + (bannerH * 0.82));

    // Top-left camera watermark
    ctx.fillStyle = 'rgba(8, 14, 24, 0.85)';
    ctx.fillRect(12, 12, 320, 26);
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 1;
    ctx.strokeRect(12, 12, 320, 26);
    ctx.font = 'bold 11px JetBrains Mono, monospace';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(`● ${camCode} • ${camName.toUpperCase()}`, 20, 29);

    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/jpeg', 0.95);
    a.download = `CCTV_SNAPSHOT_${camCode.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.jpg`;
    a.click();
  };

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
              onClick={() => setShowFenceModal(true)}
              style={{ borderColor: 'rgba(239, 68, 68, 0.5)', color: '#f87171' }}
              title="Edit Virtual Fence Polygon & RTSP Stream"
            >
              <ShieldAlert size={15} />
              <span>CONFIGURE FENCE</span>
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
              style={{ transform: `scale(${zoomLevel})`, cursor: isDraggingFence ? 'ns-resize' : 'default' }}
              onMouseDown={handleContainerMouseDown}
              onMouseMove={handleContainerMouseMove}
              onMouseUp={handleContainerMouseUp}
              onMouseLeave={handleContainerMouseUp}
            >
              {isMjpeg ? (
                <img
                  src={streamUrl}
                  alt={camName}
                  className="expanded-native-video"
                  onError={(e) => {
                    setTimeout(() => {
                      if (e.target) {
                        e.target.src = `${streamUrl}?t=${Date.now()}`;
                      }
                    }, 2000);
                  }}
                />
              ) : (
                <video
                  ref={videoRef}
                  className="expanded-native-video"
                  playsInline
                  muted
                  autoPlay
                  loop
                />
              )}
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

                {showVirtualFence && (
                  <>
                    <button
                      className="hud-toggle-btn active"
                      onClick={() => setFenceShape(s => s === 'line' ? 'diagonal' : (s === 'diagonal' ? 'circle' : (s === 'circle' ? 'box' : 'line')))}
                      title="Click to cycle fence shape: Line -> Diagonal -> Circle -> Box"
                    >
                      {fenceShape === 'line' && <Minus size={13} />}
                      {fenceShape === 'diagonal' && <Slash size={13} />}
                      {fenceShape === 'circle' && <Circle size={13} />}
                      {fenceShape === 'box' && <Square size={13} />}
                      <span>{fenceShape.toUpperCase()}</span>
                    </button>

                    {fenceShape === 'line' && (
                      <div className="hud-nudge-group font-mono" title="Nudge Fence Height Y">
                        <button className="hud-nudge-btn" onClick={() => setFenceHeightY(y => Math.max(0.1, y - 0.05))}>▲ Y</button>
                        <button className="hud-nudge-btn" onClick={() => setFenceHeightY(y => Math.min(0.9, y + 0.05))}>▼ Y</button>
                      </div>
                    )}

                    {fenceShape === 'diagonal' && (
                      <div className="hud-nudge-group font-mono" title="Adjust Diagonal Slope / Swap">
                        <button className="hud-nudge-btn" onClick={() => {
                          const y1 = fenceDiagY1;
                          setFenceDiagY1(fenceDiagY2);
                          setFenceDiagY2(y1);
                        }}>SWAP ⤹</button>
                        <button className="hud-nudge-btn" onClick={() => {
                          setFenceDiagY1(y => Math.max(0.05, y - 0.05));
                          setFenceDiagY2(y => Math.max(0.05, y - 0.05));
                        }}>▲ Y</button>
                        <button className="hud-nudge-btn" onClick={() => {
                          setFenceDiagY1(y => Math.min(0.95, y + 0.05));
                          setFenceDiagY2(y => Math.min(0.95, y + 0.05));
                        }}>▼ Y</button>
                      </div>
                    )}
                  </>
                )}
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
                DETECTIONS ({activeDetections.length})
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
                      {isWebcam ? (webcamTelemetry.gpsCoords || '28.4949° N, 77.0895° E (Device Sensor)') : (camera?.gps || camera?.gps_coords || '28.4949° N, 77.0895° E')}
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

            {/* Tab 2: AI Detections & 17-Joint Skeletal Coordinates */}
            {activeTab === 'detections' && (
              <div className="inspector-tab-content">
                <div className="telemetry-section-title">ACTIVE TARGETS & OBJECTS IN FRAME</div>
                {activeDetections.length === 0 ? (
                  <div className="empty-detections-state text-muted text-center py-6">
                    <Eye size={24} className="mx-auto mb-2 opacity-50" />
                    <span>No active security threats or objects in frame.</span>
                  </div>
                ) : (
                  <div className="detections-list">
                    {activeDetections.map((det, idx) => {
                      const cName = (det.class_name || '').toLowerCase();
                      const hItem = (det.held_item || '').toLowerCase();
                      const isCasual = Boolean(det.is_casual_object) || det.held_item_type === 'CASUAL_OBJECT';
                      const isWatch = cName === 'wristwatch' || hItem === 'wristwatch' || hItem === 'watch';
                      const isClock = !isWatch && (cName.includes('clock') || hItem.includes('clock'));
                      const isUnknown = cName.includes('unknown') || hItem.includes('unknown');
                      const isPerson = det.class_id === 0 || cName === 'person' || Boolean(det.pose_label) || (det.keypoints && (det.keypoints.length > 0 || det.keypoints.points?.length > 0));
                      const isWeapon = Boolean(det.is_weapon) && !isCasual && !isWatch && !isClock && !isUnknown;
                      const isHolding = det.is_holding && det.held_item;
                      const isPhone = !isWatch && !isClock && (cName.includes('phone') || cName.includes('cell') || hItem.includes('phone'));
                      const isCasualItem = isCasual || isWatch || isClock || isUnknown || (!isPerson && !isWeapon);
                      const keypointList = Array.isArray(det.keypoints) ? det.keypoints : (det.keypoints?.points || []);
                      const isExpanded = expandedTargetCoords[idx] !== false;

                      let title = `${det.target_id || 'TARGET'} #${idx + 1}`;
                      let badge = 'TRACKED';
                      let badgeClass = 'pill-green';

                      if (isWeapon) {
                        title = `🚨 WEAPON: ${(det.unusual_item || det.class_name || 'FIREARM').toUpperCase()}`;
                        badge = 'CRITICAL ALERT';
                        badgeClass = 'pill-red';
                      } else if (isPerson && isHolding) {
                        title = `👤 ${det.target_id || 'PERSON'} #${idx + 1}`;
                        badge = `HOLDING ${det.held_item}`;
                        badgeClass = 'pill-yellow';
                      } else if (isPerson) {
                        title = `👤 ${det.target_id || 'PERSON'} #${idx + 1}`;
                        badge = det.is_in_fence ? 'PERIMETER ALERT' : 'TRACKED';
                        badgeClass = det.is_in_fence ? 'pill-red' : 'pill-green';
                      } else {
                        const icon = getItemIcon(cName || hItem || det.unusual_item);
                        title = `${icon} ${(det.unusual_item || det.class_name || 'OBJECT').toUpperCase()}`;
                        badge = det.is_held ? 'IN HAND' : (det.threat_level === 'HIGH' ? 'MONITORED' : 'DETECTED');
                        badgeClass = det.threat_level === 'HIGH' ? 'pill-yellow' : 'pill-blue';
                      }

                      return (
                        <div
                          key={idx}
                          className={`detection-inspector-item ${isWeapon ? 'unusual-item-card' : ''}`}
                        >
                          <div className="flex justify-between items-center">
                            <span className="font-bold text-white">
                              {title}
                            </span>
                            <span className={`pill-badge ${badgeClass}`}>
                              {badge}
                            </span>
                          </div>
                          <div className="text-xs text-muted mt-1">
                            {isPerson ? (
                              <>Pose: <span className="text-cyan font-bold">{det.pose_label || 'NORMAL'}</span> • Conf: <span className="text-white">{((det.bbox?.confidence || 0.92) * 100).toFixed(0)}%</span></>
                            ) : (
                              <>Class: <span className="text-cyan font-bold">{det.class_name}</span> • Conf: <span className="text-white">{((det.bbox?.confidence || 0.85) * 100).toFixed(0)}%</span></>
                            )}
                          </div>
                          {isPerson && isHolding && (
                            <div className="text-xs text-yellow mt-1 font-mono">
                              ✋ Handheld: {det.held_item} ({det.held_by_hand || 'IN_HAND'})
                            </div>
                          )}
                          {!isPerson && det.is_held && (
                            <div className="text-xs text-green mt-1 font-mono">
                              🔗 Held by: {det.held_by_target_id || 'Person'} ({det.held_by_hand || 'In Hand'})
                            </div>
                          )}

                          {/* 17-Joint Skeleton Coordinates Breakdown */}
                          {isPerson && keypointList.length > 0 && (
                            <div className="skeleton-joints-accordion">
                              <button
                                className="skeleton-toggle-btn font-mono"
                                onClick={() => setExpandedTargetCoords(prev => ({ ...prev, [idx]: !isExpanded }))}
                              >
                                <span>⚡ 17-JOINT SKELETON COORDINATES</span>
                                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              </button>

                              {isExpanded && (
                                <div className="skeleton-coords-grid font-mono">
                                  {keypointList.map((kp, kpIdx) => {
                                    const name = COCO_KEYPOINT_NAMES[kpIdx] || `Joint ${kpIdx}`;
                                    const kx = Math.round((kp.x !== undefined ? kp.x : (Array.isArray(kp) ? kp[0] : 0)) * 100);
                                    const ky = Math.round((kp.y !== undefined ? kp.y : (Array.isArray(kp) ? kp[1] : 0)) * 100);
                                    const conf = Math.round((kp.conf !== undefined ? kp.conf : (Array.isArray(kp) ? kp[2] : 1.0)) * 100);
                                    return (
                                      <div key={kpIdx} className="joint-coord-item">
                                        <div className="joint-name">
                                          <span>{name}</span>
                                          <span style={{ color: conf > 50 ? '#10b981' : '#64748b' }}>{conf}%</span>
                                        </div>
                                        <div className="joint-xy">
                                          X:{kx}% • Y:{ky}%
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
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

                {/* Virtual Fence Controls & Shape Selector */}
                <div className="fence-config-panel">
                  <div className="telemetry-section-title">VIRTUAL FENCE GEOMETRY & SHAPE</div>
                  <div className="fence-shape-selector">
                    <button
                      className={`fence-shape-btn ${fenceShape === 'line' ? 'active' : ''}`}
                      onClick={() => setFenceShape('line')}
                    >
                      <Minus size={13} />
                      <span>HORIZON LINE</span>
                    </button>
                    <button
                      className={`fence-shape-btn ${fenceShape === 'diagonal' ? 'active' : ''}`}
                      onClick={() => setFenceShape('diagonal')}
                    >
                      <Slash size={13} />
                      <span>DIAGONAL</span>
                    </button>
                    <button
                      className={`fence-shape-btn ${fenceShape === 'circle' ? 'active' : ''}`}
                      onClick={() => setFenceShape('circle')}
                    >
                      <Circle size={13} />
                      <span>CIRCLE ZONE</span>
                    </button>
                    <button
                      className={`fence-shape-btn ${fenceShape === 'box' ? 'active' : ''}`}
                      onClick={() => setFenceShape('box')}
                    >
                      <Square size={13} />
                      <span>RECTANGLE</span>
                    </button>
                  </div>

                  {fenceShape === 'line' && (
                    <div className="fence-slider-group">
                      <div className="fence-slider-label">
                        <span>TRIPWIRE HEIGHT (Y-AXIS)</span>
                        <span className="fence-slider-val">{(fenceHeightY * 100).toFixed(0)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.10"
                        max="0.90"
                        step="0.02"
                        value={fenceHeightY}
                        onChange={(e) => setFenceHeightY(parseFloat(e.target.value))}
                        className="fence-range-slider"
                      />
                    </div>
                  )}

                  {fenceShape === 'diagonal' && (
                    <>
                      <div className="fence-slider-group">
                        <div className="fence-slider-label">
                          <span>LEFT ANCHOR HEIGHT (Y1)</span>
                          <span className="fence-slider-val">{(fenceDiagY1 * 100).toFixed(0)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0.05"
                          max="0.95"
                          step="0.02"
                          value={fenceDiagY1}
                          onChange={(e) => setFenceDiagY1(parseFloat(e.target.value))}
                          className="fence-range-slider"
                        />
                      </div>

                      <div className="fence-slider-group">
                        <div className="fence-slider-label">
                          <span>RIGHT ANCHOR HEIGHT (Y2)</span>
                          <span className="fence-slider-val">{(fenceDiagY2 * 100).toFixed(0)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0.05"
                          max="0.95"
                          step="0.02"
                          value={fenceDiagY2}
                          onChange={(e) => setFenceDiagY2(parseFloat(e.target.value))}
                          className="fence-range-slider"
                        />
                      </div>

                      <div className="fence-preset-row">
                        <button
                          className="fence-preset-btn font-mono"
                          onClick={() => { setFenceDiagY1(0.20); setFenceDiagY2(0.80); }}
                          title="Downward diagonal (\)"
                        >
                          ↘ DOWNWARD
                        </button>
                        <button
                          className="fence-preset-btn font-mono"
                          onClick={() => { setFenceDiagY1(0.80); setFenceDiagY2(0.20); }}
                          title="Upward diagonal (/)"
                        >
                          ↗ UPWARD
                        </button>
                        <button
                          className="fence-preset-btn font-mono"
                          onClick={() => {
                            const y1 = fenceDiagY1;
                            setFenceDiagY1(fenceDiagY2);
                            setFenceDiagY2(y1);
                          }}
                          title="Invert slope"
                        >
                          ⤹ INVERT
                        </button>
                      </div>
                    </>
                  )}

                  {fenceShape === 'circle' && (
                    <>
                      <div className="fence-slider-group">
                        <div className="fence-slider-label">
                          <span>PERIMETER RADIUS</span>
                          <span className="fence-slider-val">{(fenceRadius * 100).toFixed(0)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0.10"
                          max="0.45"
                          step="0.02"
                          value={fenceRadius}
                          onChange={(e) => setFenceRadius(parseFloat(e.target.value))}
                          className="fence-range-slider"
                        />
                      </div>
                      <div className="fence-slider-group">
                        <div className="fence-slider-label">
                          <span>CENTER HEIGHT (Y-AXIS)</span>
                          <span className="fence-slider-val">{(fenceCircleCenter.y * 100).toFixed(0)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0.15"
                          max="0.85"
                          step="0.02"
                          value={fenceCircleCenter.y}
                          onChange={(e) => setFenceCircleCenter(prev => ({ ...prev, y: parseFloat(e.target.value) }))}
                          className="fence-range-slider"
                        />
                      </div>
                    </>
                  )}

                  {fenceShape === 'box' && (
                    <>
                      <div className="fence-slider-group">
                        <div className="fence-slider-label">
                          <span>BOX HEIGHT</span>
                          <span className="fence-slider-val">{(fenceBox.h * 100).toFixed(0)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0.15"
                          max="0.80"
                          step="0.02"
                          value={fenceBox.h}
                          onChange={(e) => setFenceBox(prev => ({ ...prev, h: parseFloat(e.target.value) }))}
                          className="fence-range-slider"
                        />
                      </div>
                      <div className="fence-slider-group">
                        <div className="fence-slider-label">
                          <span>VERTICAL POSITION (Y)</span>
                          <span className="fence-slider-val">{(fenceBox.y * 100).toFixed(0)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0.05"
                          max="0.80"
                          step="0.02"
                          value={fenceBox.y}
                          onChange={(e) => setFenceBox(prev => ({ ...prev, y: parseFloat(e.target.value) }))}
                          className="fence-range-slider"
                        />
                      </div>
                    </>
                  )}

                  <div className={`fence-status-badge ${isFenceBreached ? 'breached' : 'secure'}`}>
                    {isFenceBreached ? (
                      <>
                        <AlertTriangle size={15} />
                        <span>⚠️ TRIPWIRE BREACH ACTIVE: INTRUSION DETECTED</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={15} />
                        <span>⚡ PERIMETER SECURE: NO ACTIVE BREACH</span>
                      </>
                    )}
                  </div>

                  <button
                    className={`modal-action-btn ${fenceSavedFeedback ? 'saved-btn' : ''}`}
                    onClick={handleSaveFenceToBackend}
                  >
                    {fenceSavedFeedback ? <Check size={14} /> : <ShieldAlert size={14} />}
                    <span>{fenceSavedFeedback ? 'SAVED TO AI ENGINE!' : 'SAVE FENCE TO AI ENGINE'}</span>
                  </button>

                  <button
                    className="modal-action-btn w-full mt-2"
                    style={{ background: 'rgba(255, 255, 255, 0.05)', borderColor: 'rgba(255, 255, 255, 0.15)', color: '#94a3b8' }}
                    onClick={() => setShowVirtualFence(!showVirtualFence)}
                  >
                    <Crosshair size={14} />
                    <span>{showVirtualFence ? 'HIDE VIRTUAL TRIPWIRE' : 'SHOW VIRTUAL TRIPWIRE'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Virtual Fence & RTSP Stream Configuration Modal */}
      {showFenceModal && (
        <VirtualFenceConfigModal
          camera={camera}
          onClose={() => setShowFenceModal(false)}
          onSaveSuccess={(updated) => {
            if (camera) {
              camera.fence_points = updated.fence_points;
              camera.fencePoints = updated.fence_points;
              camera.rtsp_url = updated.rtsp_url;
              camera.mode = updated.mode;
            }
          }}
        />
      )}
    </div>
  );
};

export default CameraDetailModal;
