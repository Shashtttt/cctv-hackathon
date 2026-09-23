import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Plus, 
  Maximize2, 
  Minimize2, 
  Volume2, 
  VolumeX, 
  Camera as CameraIcon, 
  Grid,
  Square,
  LayoutGrid,
  RefreshCw,
  Eye,
  Shield,
  Radio,
  Sliders,
  Smartphone
} from 'lucide-react';
import axios from 'axios';
import { enumerateDeviceCameras, getDevicePlatform } from '../../utils/deviceDetector';
import { fetchCameras, getCameraStreamUrl } from '../../services/apiService';
import { soundController, isUnauthorizedWeaponThreat } from '../../utils/audioAlert';
import { useSentinelCamera } from '../../context/SentinelCameraContext';
import { useLocation } from '../../context/LocationContext';
import { AddIpCameraModal } from '../AddIpCameraModal';
import { CameraDetailModal } from '../CameraDetailModal';
import './LiveFeedsGrid.css';

/**
 * Individual Camera Feed Item Component
 * Manages video element lifecycle, stream attachment, AI detection ingestion, and sensor switching.
 */
export function CameraFeedItem({ 
  cam, 
  index, 
  stream, 
  isHero,
  isSensorStandby, 
  onActivateSensor, 
  onDetectionsUpdate,
  isSingleHero = false,
  isModalOpen = false,
  onClick,
  sentinelDetections = [],
  sentinelTelemetry = null,
  isSentinelActive = false
}) {
  const videoRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const offscreenCanvasRef = useRef(null);
  const isInferringRef = useRef(false);
  const [activeDetections, setActiveDetections] = useState([]);
  const [useFrameFallback, setUseFrameFallback] = useState(false);
  const [frameTimestamp, setFrameTimestamp] = useState(Date.now());
  const { coords, locationName } = useLocation();

  useEffect(() => {
    if (!useFrameFallback || !cam.isIpCamera) return;
    const interval = setInterval(() => {
      setFrameTimestamp(Date.now());
    }, 150); // High-reliability 7-8 FPS frame polling fallback
    return () => clearInterval(interval);
  }, [useFrameFallback, cam.isIpCamera]);

  const attachStream = useCallback((el) => {
    videoRef.current = el;
    if (el && stream && el.srcObject !== stream) {
      el.srcObject = stream;
      el.muted = true;
      el.play().catch(() => {});
    }
  }, [stream]);

  useEffect(() => {
    if (videoRef.current) {
      if (stream && videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        videoRef.current.play().catch(() => {});
      } else if (!stream && !cam.isIpCamera) {
        videoRef.current.srcObject = null;
      }
    }
  }, [stream, cam.isIpCamera]);

  const isWebcam = cam.isDeviceHardware;
  const isBack = cam.isBack;
  const camCode = isWebcam 
    ? (index === 0 ? 'DEV-OPTICAL-01' : `DEV-OPTICAL-0${index + 1}`) 
    : (cam.code || `CAM-0${index + 1}`);

  // Unified detections: when Sentinel is running in the background, use its real-time detections directly to eliminate double server load
  const effectiveDetections = (isSentinelActive && sentinelDetections && sentinelDetections.length > 0)
    ? sentinelDetections
    : activeDetections;

  useEffect(() => {
    if (effectiveDetections && effectiveDetections.length > 0 && onDetectionsUpdate) {
      onDetectionsUpdate(effectiveDetections);
    }
  }, [effectiveDetections, onDetectionsUpdate]);

  // Fallback ingestion loop when Sentinel is paused
  useEffect(() => {
    // If Sentinel is running in background, let Sentinel handle ingest to avoid duplicate pipeline load
    if (isSentinelActive && isWebcam) return;
    if (!stream || !isWebcam || isModalOpen) return;

    let mounted = true;
    let timeoutId = null;

    const runInference = async () => {
      if (!mounted) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0) {
        timeoutId = setTimeout(runInference, 300);
        return;
      }

      if (isInferringRef.current) {
        timeoutId = setTimeout(runInference, 150);
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
        const scale = Math.min(1.0, 480 / Math.max(vw, 1));
        canvas.width = Math.round(vw * scale);
        canvas.height = Math.round(vh * scale);

        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const b64 = canvas.toDataURL('image/jpeg', 0.65);

        // Always ingest to cam-01 (the primary AI pipeline) with live geolocation
        const res = await axios.post('/api/v1/cameras/cam-01/ingest', {
          image: b64,
          location: locationName || cam.location || 'Border Sector-4 HQ',
          gps: coords?.formatted || '34.1524° N, 74.8211° E',
        }, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 3500
        });

        if (mounted && res.data && res.data.success) {
          const dets = res.data.detections || [];
          setActiveDetections(dets);
          if (onDetectionsUpdate) {
            onDetectionsUpdate(dets);
          }

          // Trigger siren ONLY for genuine unauthorized weapon threats
          const hasUnauthorizedWeapon = dets.some(d => isUnauthorizedWeaponThreat(d, dets));
          if (hasUnauthorizedWeapon) {
            soundController.triggerWeaponSiren(2000);
          }
        }
      } catch (err) {
        // Continue on transient inference timeout or error
      } finally {
        isInferringRef.current = false;
        if (mounted) {
          timeoutId = setTimeout(runInference, 350);
        }
      }
    };

    timeoutId = setTimeout(runInference, 500);

    return () => {
      mounted = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [stream, isWebcam, isModalOpen, isSentinelActive, locationName, coords?.formatted]);

  // Draw HUD overlays and bounding boxes
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const w = video.videoWidth || 640;
    const h = video.videoHeight || 360;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Top Tactical HUD Status Banner
    const peopleCount = effectiveDetections.filter(d => d.class_id === 0 || (d.class_name || '').toLowerCase() === 'person').length;
    const threatCount = effectiveDetections.filter(d => d.is_weapon || (d.is_holding && d.held_item_type === 'WEAPON') || d.threat_level === 'CRITICAL').length;
    const targetCount = effectiveDetections.length;

    const hudText = `${camCode} AI | PEOPLE: ${peopleCount} | TARGETS: ${targetCount} | THREATS: ${threatCount} | FPS: ${cam.fps || 30}`;
    ctx.font = 'bold 11px monospace';
    const hudW = ctx.measureText(hudText).width + 24;
    const hudH = 22;
    ctx.fillStyle = 'rgba(8, 14, 26, 0.88)';
    ctx.fillRect(12, 12, hudW, hudH);
    ctx.strokeStyle = threatCount > 0 ? '#ef4444' : '#00f0ff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(12, 12, hudW, hudH);

    ctx.beginPath();
    ctx.arc(20, 12 + hudH / 2, 3.5, 0, 2 * Math.PI);
    ctx.fillStyle = threatCount > 0 ? '#ef4444' : '#00f0ff';
    ctx.fill();

    ctx.fillStyle = threatCount > 0 ? '#ff6b6b' : '#38bdf8';
    ctx.fillText(hudText, 30, 12 + 15);

    // 2. Draw Tether Lines from Holding Persons to Held Items
    effectiveDetections.forEach((det) => {
      if (det.is_holding && det.held_item && det.bbox) {
        const heldObj = effectiveDetections.find(o => 
          o !== det && 
          o.bbox && 
          (o.held_by_target_id === det.target_id || (o.class_name || '').toLowerCase().includes((det.held_item || '').toLowerCase()))
        );
        if (heldObj && heldObj.bbox) {
          const px = (det.bbox.x + det.bbox.w / 2) * w;
          const py = (det.bbox.y + det.bbox.h * 0.45) * h;
          const ox = (heldObj.bbox.x + heldObj.bbox.w / 2) * w;
          const oy = (heldObj.bbox.y + heldObj.bbox.h / 2) * h;

          ctx.save();
          ctx.beginPath();
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = det.held_item_type === 'WEAPON' ? '#ef4444' : '#00f0ff';
          ctx.lineWidth = 2;
          ctx.moveTo(px, py);
          ctx.lineTo(ox, oy);
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(ox, oy, 4, 0, 2 * Math.PI);
          ctx.fillStyle = '#00f0ff';
          ctx.fill();
          ctx.restore();
        }
      }
    });

    // 3. Draw All Detected Objects & Target Coordinates
    effectiveDetections.forEach((d, detIdx) => {
      if (!d.bbox) return;
      const rawConf = d.bbox?.confidence ?? d.confidence;
      if (rawConf !== undefined && rawConf !== null && rawConf < 0.42) return;
      const x = d.bbox.x * w;
      const y = d.bbox.y * h;
      const bw = d.bbox.w * w;
      const bh = d.bbox.h * h;

      const isWeapon = d.is_weapon || ['knife', 'gun', 'pistol', 'rifle', 'firearm', 'dagger', 'blade', 'weapon', 'scissors'].some(
        name => (d.class_name || '').toLowerCase().includes(name) || (d.held_item || '').toLowerCase().includes(name)
      );
      const isPerson = d.class_id === 0 || (d.class_name || '').toLowerCase() === 'person';
      const isVehicle = [1, 2, 3, 5, 7].includes(d.class_id) || ['car', 'truck', 'bus', 'motorcycle', 'vehicle'].some(
        name => (d.class_name || '').toLowerCase().includes(name)
      );

      const isAuthorized = Boolean(
        d.is_authorized || 
        d.threat_level === 'AUTHORIZED' || 
        d.is_weapon_authorized
      );
      const hasName = Boolean(d.frs_match_name);
      const isBlacklisted = Boolean(d.is_blacklisted || d.threat_level === 'CRITICAL' || d.threat_level === 'UNAUTHORIZED');

      let color = '#00f0ff'; // Cyan for standard Person
      if (hasName && isAuthorized) {
        color = '#10b981'; // Emerald Green strictly for identified Authorized Personnel / Sentry
      } else if (isWeapon || isBlacklisted) {
        color = '#ef4444'; // Red for Weapon / Blacklisted / Hostile
      } else if (isVehicle) {
        color = '#3b82f6'; // Blue for Vehicle
      } else if (!isPerson) {
        color = '#f59e0b'; // Amber for Casual Objects
      }

      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;

      // Draw corner brackets
      const cl = Math.min(18, Math.min(bw, bh) / 4);
      ctx.beginPath();
      ctx.moveTo(x, y + cl); ctx.lineTo(x, y); ctx.lineTo(x + cl, y);
      ctx.moveTo(x + bw - cl, y); ctx.lineTo(x + bw, y); ctx.lineTo(x + bw, y + cl);
      ctx.moveTo(x + bw, y + bh - cl); ctx.lineTo(x + bw, y + bh); ctx.lineTo(x + bw - cl, y + bh);
      ctx.moveTo(x + cl, y + bh); ctx.lineTo(x, y + bh); ctx.lineTo(x, y + bh - cl);
      ctx.stroke();

      // Faint semi-transparent box
      const isAuthBox = isAuthorized || (hasName && !isBlacklisted);
      ctx.fillStyle = isWeapon 
        ? 'rgba(239, 68, 68, 0.12)' 
        : isAuthBox 
          ? 'rgba(16, 185, 129, 0.09)' 
          : (isPerson ? 'rgba(0, 240, 255, 0.05)' : 'rgba(245, 158, 11, 0.05)');
      ctx.fillRect(x, y, bw, bh);
      ctx.strokeRect(x, y, bw, bh);

      // Label badge: Authorized Name / Role, Target ID, Class Name, Confidence %, Position Coordinates, Dwell Time
      const conf = Math.round((d.confidence || 0.85) * 100);
      const targetId = d.target_id || (isPerson ? `PERSON-0${detIdx + 1}` : `ITEM-0${detIdx + 1}`);

      let labelText = '';
      if (hasName) {
        const personName = (d.frs_match_name || '').trim().toUpperCase();
        const role = (d.authorization_role || (isAuthorized ? 'AUTHORIZED SENTRY' : 'IDENTIFIED')).toUpperCase();
        if (isAuthorized) {
          labelText = `🛡️ ${personName} [${role}] [${conf}%]`;
        } else if (isBlacklisted) {
          labelText = `⚠️ [ALERT] SUSPECT: ${personName} [${conf}%]`;
        } else {
          labelText = `👤 ${personName} [${conf}%]`;
        }
      } else if (isVehicle && d.plate_text) {
        labelText = `🚗 VEHICLE [${d.plate_text.toUpperCase()}] [${conf}%]`;
      } else {
        labelText = `${targetId} ${(d.class_name || 'TARGET').toUpperCase()} [${conf}%]`;
      }

      labelText += ` • [X:${Math.round(x)} Y:${Math.round(y)}]`;
      if (d.pose_label && isPerson) labelText += ` • [${d.pose_label}]`;
      if (d.is_holding) {
        if (isAuthorized && (d.held_item_type === 'WEAPON' || isWeapon)) {
          labelText += ` • [SERVICE WEAPON: ${(d.held_item || 'WEAPON').toUpperCase()} (CLEARED)]`;
        } else {
          labelText += ` • [HOLDING ${(d.held_item || 'ITEM').toUpperCase()}]`;
        }
      }
      const dwellSec = Math.round(d.loiter_seconds || d.dwell_time || 0);
      if (dwellSec > 0 && !isAuthorized) labelText += ` • DWELL:${dwellSec}s`;

      ctx.font = 'bold 11px monospace';
      const tw = ctx.measureText(labelText).width;
      const badgeY = Math.max(0, y - 20);
      ctx.fillStyle = 'rgba(10, 16, 30, 0.90)';
      ctx.fillRect(x, badgeY, tw + 10, 18);
      ctx.strokeStyle = color;
      ctx.strokeRect(x, badgeY, tw + 10, 18);
      ctx.fillStyle = color;
      ctx.fillText(labelText, x + 5, badgeY + 13);

      // Skeleton Keypoints & Limb Connections (YOLOv8-pose)
      if (d.keypoints) {
        const pts = Array.isArray(d.keypoints) ? d.keypoints : (d.keypoints.points || []);
        if (pts.length > 0) {
          const SKELETON_CONNECTIONS = [
            [0, 1], [0, 2], [1, 3], [2, 4], // Head
            [5, 6], // Shoulders
            [5, 7], [7, 9], // Left Arm
            [6, 8], [8, 10], // Right Arm
            [5, 11], [6, 12], [11, 12], // Torso
            [11, 13], [13, 15], // Left Leg
            [12, 14], [14, 16], // Right Leg
          ];

          const isAuthSentry = isAuthorized || (hasName && !isBlacklisted);
          const boneColor = isAuthSentry ? '#10b981' : '#00f0ff';
          ctx.save();
          ctx.strokeStyle = boneColor;
          ctx.lineWidth = 2;
          ctx.shadowColor = boneColor;
          ctx.shadowBlur = 5;

          SKELETON_CONNECTIONS.forEach(([i, j]) => {
            const kpi = pts[i];
            const kpj = pts[j];
            if (kpi && kpj) {
              const xi = (kpi.x !== undefined ? kpi.x : (Array.isArray(kpi) ? kpi[0] : 0)) * w;
              const yi = (kpi.y !== undefined ? kpi.y : (Array.isArray(kpi) ? kpi[1] : 0)) * h;
              const confi = kpi.conf !== undefined ? kpi.conf : (Array.isArray(kpi) ? kpi[2] : 1.0);
              const xj = (kpj.x !== undefined ? kpj.x : (Array.isArray(kpj) ? kpj[0] : 0)) * w;
              const yj = (kpj.y !== undefined ? kpj.y : (Array.isArray(kpj) ? kpj[1] : 0)) * h;
              const confj = kpj.conf !== undefined ? kpj.conf : (Array.isArray(kpj) ? kpj[2] : 1.0);

              if (confi >= 0.48 && confj >= 0.48) {
                ctx.beginPath();
                ctx.moveTo(xi, yi);
                ctx.lineTo(xj, yj);
                ctx.stroke();
              }
            }
          });

          // Draw joint nodes
          pts.forEach(kp => {
            const kx = (kp.x !== undefined ? kp.x : (Array.isArray(kp) ? kp[0] : 0)) * w;
            const ky = (kp.y !== undefined ? kp.y : (Array.isArray(kp) ? kp[1] : 0)) * h;
            const kconf = kp.conf !== undefined ? kp.conf : (Array.isArray(kp) ? kp[2] : 1.0);
            if (kconf >= 0.48) {
              ctx.beginPath();
              ctx.arc(kx, ky, 3.5, 0, 2 * Math.PI);
              ctx.fillStyle = boneColor;
              ctx.fill();
              ctx.beginPath();
              ctx.arc(kx, ky, 1.5, 0, 2 * Math.PI);
              ctx.fillStyle = '#ffffff';
              ctx.fill();
            }
          });
          ctx.restore();
        }
      }

      ctx.restore();
    });

    // 4. Draw Bottom Tactical GPS Coordinates & Location Banner
    const locLine = `LOC: ${(locationName || 'SECTOR-4 HQ / COMMAND POST').toUpperCase()}`;
    const nowUtc = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    const gpsCoordsStr = coords?.formatted || '28.4949° N, 77.0895° E';
    const subLine = `${gpsCoordsStr} | ${nowUtc} | IBVAP AI • ${camCode}`;

    ctx.font = 'bold 11px monospace';
    const locW = Math.max(ctx.measureText(locLine).width, ctx.measureText(subLine).width) + 24;
    const bannerW = Math.min(w - 24, Math.max(400, locW));
    const bannerH = 42;
    const bannerY = h - bannerH - 28;

    ctx.fillStyle = 'rgba(8, 14, 24, 0.90)';
    ctx.fillRect(12, bannerY, bannerW, bannerH);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1;
    ctx.strokeRect(12, bannerY, bannerW, bannerH);

    ctx.fillStyle = '#facc15';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(locLine, 20, bannerY + 17);

    ctx.fillStyle = '#10b981';
    ctx.font = '10px monospace';
    ctx.fillText(subLine, 20, bannerY + 34);

  }, [effectiveDetections, cam.fps, camCode, coords?.formatted, locationName]);

  return (
    <div
      className={`camera-feed-card ${isSingleHero ? 'card-hero-single' : ''}`}
      onClick={onClick}
      title="Click to inspect camera telemetry & PTZ controls"
    >
      {/* Feed Top Overlay Bar */}
      <div className="feed-top-bar">
        <div className="feed-camera-name">
          <span className={`feed-indicator-dot ${cam.status === 'online' ? 'dot-online' : (cam.status === 'connecting' ? 'dot-connecting' : 'dot-standby')}`}></span>
          <span>{cam.name || cam.label}</span>
          {cam.facingMode && (
            <span className="feed-facing-pill">
              {cam.facingMode === 'environment' ? 'REAR' : 'FRONT'}
            </span>
          )}
        </div>
        <div className="feed-badges-group">
          {effectiveDetections.length > 0 && (
            <span className="feed-ai-live-badge">
              AI DETECTING ({effectiveDetections.length})
            </span>
          )}
          <span className="feed-res-pill">{cam.resolution || '1080p FHD'}</span>
          {cam.status === 'online' ? (
            <span className="feed-live-badge">LIVE</span>
          ) : cam.status === 'connecting' ? (
            <span className="feed-connecting-badge">CONNECTING…</span>
          ) : cam.isMobile ? (
            <span className="feed-standby-badge">MOBILE STANDBY</span>
          ) : (
            <span className="feed-standby-badge">STANDBY</span>
          )}
        </div>
      </div>

      {/* REAL LIVE VIDEO VIEWPORT */}
      <div className="feed-media-wrapper">
        {isWebcam ? (
          <div className="webcam-live-container">
            {stream ? (
              <>
                <video
                  ref={attachStream}
                  autoPlay
                  playsInline
                  muted
                  className="live-video-element"
                />
                <canvas
                  ref={overlayCanvasRef}
                  className="live-detection-overlay"
                />
              </>
            ) : isSensorStandby ? (
              <div className="video-standby-overlay sensor-standby-box">
                <Smartphone size={32} className="standby-icon pulse-soft" />
                <span className="standby-text">
                  {isBack ? 'Rear Lens (Standby)' : 'Front Lens (Standby)'}
                </span>
                <span className="standby-subtext">
                  Hardware ISP currently locked to primary sensor
                </span>
                <button
                  type="button"
                  className="switch-sensor-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onActivateSensor(cam.id);
                  }}
                >
                  <RefreshCw size={13} className="spin-hover" />
                  <span>Switch to this Camera</span>
                </button>
              </div>
            ) : (
              <div className="video-standby-overlay">
                <CameraIcon size={32} className="standby-icon pulse-soft" />
                <span className="standby-text">Initializing Camera Feed…</span>
                <span className="standby-subtext">{cam.name}</span>
                <button
                  type="button"
                  className="switch-sensor-btn"
                  style={{ marginTop: '0.5rem' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onActivateSensor(cam.id);
                  }}
                >
                  <RefreshCw size={13} className="spin-hover" />
                  <span>Connect Camera</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          /* User-Added External IP or Mobile Camera */
          <div className="ip-stream-container">
            {cam.streamUrl && (cam.streamUrl.endsWith('.mp4') || cam.streamUrl.endsWith('.webm')) ? (
              <video
                src={cam.streamUrl}
                autoPlay
                loop
                muted
                playsInline
                className="live-video-element"
              />
            ) : cam.isMobile && cam.status === 'standby' ? (
              <div className="video-standby-overlay sensor-standby-box">
                <Smartphone size={36} className="standby-icon pulse-soft text-cyan-400" />
                <span className="standby-text">Mobile Unit Standby</span>
                <span className="standby-subtext">
                  Waiting for paired smartphone video ingest
                </span>
                <button
                  type="button"
                  className="switch-sensor-btn mt-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    const pairUrl = `${window.location.origin}/?mode=remote-cam&cam_id=${cam.id.toLowerCase()}`;
                    window.open(pairUrl, '_blank');
                  }}
                >
                  <Radio size={13} className="spin-hover" />
                  <span>Launch Mobile Camera</span>
                </button>
              </div>
            ) : (
              <img
                src={
                  useFrameFallback
                    ? `${cam.frameUrl || `/api/v1/cameras/${cam.id}/frame`}?t=${frameTimestamp}`
                    : (cam.streamUrl || getCameraStreamUrl(cam.id))
                }
                alt={cam.name}
                className="live-video-element"
                onError={() => {
                  setUseFrameFallback(true);
                }}
              />
            )}
          </div>
        )}

        {/* Bottom telemetry HUD */}
        <div className="feed-bottom-hud">
          <div className="hud-left-stats">
            <span className="hud-cam-code">{camCode}</span>
            {effectiveDetections.length > 0 && (
              <span className="hud-ai-count">
                AI: {effectiveDetections.map(d => {
                  if (d.frs_match_name) {
                    const isAuth = d.is_authorized || d.threat_level === 'AUTHORIZED';
                    return isAuth 
                      ? `🛡️ ${d.frs_match_name.toUpperCase()} (AUTH)`
                      : `⚠️ ${d.frs_match_name.toUpperCase()}`;
                  }
                  if (d.plate_text) {
                    return `🚗 ${d.plate_text.toUpperCase()}`;
                  }
                  return (d.class_name || 'OBJECT').toUpperCase();
                }).filter((v, i, a) => a.indexOf(v) === i).join(', ')}
              </span>
            )}
            <span className="hud-gps-tag">
              📍 {coords?.formatted || '28.4949° N, 77.0895° E'} ({locationName || 'Sector 28'})
            </span>
          </div>
          <span className="hud-live-fps">{cam.status === 'online' ? `${cam.fps || 30} FPS` : (cam.status === 'connecting' ? 'SYNCING' : 'STANDBY')}</span>
        </div>
      </div>
    </div>
  );
}

export default function LiveFeedsGrid({ onSelectCamera }) {
  const { 
    activeStream: sentinelStream,
    liveDetections: sentinelDetections,
    telemetry: sentinelTelemetry,
    isSentinelActive 
  } = useSentinelCamera();
  const { locationName: dynamicLocation, coords: dynamicCoords } = useLocation();
  const [deviceCameras, setDeviceCameras] = useState([]);
  const [ipCameras, setIpCameras] = useState([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isAddIpModalOpen, setIsAddIpModalOpen] = useState(false);
  const [activeModalCam, setActiveModalCam] = useState(null);

  // Active camera streams keyed by camera ID
  const [streams, setStreams] = useState({});
  const [standbySensors, setStandbySensors] = useState({});
  const [cameraDetections, setCameraDetections] = useState({});
  const activeStreamsRef = useRef({});

  // Layout mode: 'auto' | '1' | 'grid'
  const [layoutMode, setLayoutMode] = useState('auto');
  const [selectedHeroIndex, setSelectedHeroIndex] = useState(0);

  // Siren state
  const [isSirenActive, setIsSirenActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // 1. Subscribe to tactical siren
  useEffect(() => {
    const unsub = soundController.subscribe((active, muted) => {
      setIsSirenActive(active);
      setIsMuted(muted);
    });
    return unsub;
  }, []);

  // 2. Detect genuine hardware cameras on this device (Laptop: 1, Mobile: 2, etc.)
  const detectHardwareCameras = useCallback(async () => {
    try {
      const cams = await enumerateDeviceCameras();
      if (cams && cams.length > 0) {
        setDeviceCameras(cams);
      } else {
        const platform = getDevicePlatform();
        setDeviceCameras([{
          id: 'dev-cam-01',
          deviceId: 'default-cam-01',
          label: platform.isMobile ? 'Integrated Mobile Camera' : 'Integrated HD Camera (Front)',
          name: platform.isMobile ? 'Integrated Mobile Camera' : 'Integrated HD Camera (Front)',
          facingMode: 'user',
          isFront: true,
          isBack: false,
          isDeviceHardware: true,
          resolution: '1080p FHD',
          fps: 30,
          status: 'online',
        }]);
      }
    } catch (err) {
      console.debug('Hardware camera discovery error:', err);
      const platform = getDevicePlatform();
      setDeviceCameras([{
        id: 'dev-cam-01',
        deviceId: 'default-cam-01',
        label: platform.isMobile ? 'Integrated Mobile Camera' : 'Integrated HD Camera (Front)',
        name: platform.isMobile ? 'Integrated Mobile Camera' : 'Integrated HD Camera (Front)',
        facingMode: 'user',
        isFront: true,
        isBack: false,
        isDeviceHardware: true,
        resolution: '1080p FHD',
        fps: 30,
        status: 'online',
      }]);
    }
  }, []);

  useEffect(() => {
    detectHardwareCameras();

    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
      const handleDeviceChange = () => {
        enumerateDeviceCameras().then(cams => {
          if (cams && cams.length > 0) setDeviceCameras(cams);
        }).catch(() => {});
      };
      navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      };
    }
  }, [detectHardwareCameras]);

  // 3. Acquire live video streams for detected hardware cameras
  const startCameraStream = useCallback(async (cam, isPrimary = true, retryCount = 0) => {
    // If this is primary hardware camera and persistent Sentinel stream is active, use it directly!
    if (isPrimary && sentinelStream && sentinelStream.active) {
      activeStreamsRef.current[cam.id] = sentinelStream;
      setStreams(prev => ({ ...prev, [cam.id]: sentinelStream }));
      setStandbySensors(prev => ({ ...prev, [cam.id]: false }));
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;

    // Reuse active stream if already alive
    const existing = activeStreamsRef.current[cam.id];
    if (existing && existing.active && existing.getVideoTracks().some(t => t.readyState === 'live')) {
      setStreams(prev => ({ ...prev, [cam.id]: existing }));
      setStandbySensors(prev => ({ ...prev, [cam.id]: false }));
      return;
    }

    try {
      const constraints = {
        video: cam.deviceId && !cam.deviceId.startsWith('mobile-') && !cam.deviceId.startsWith('default-')
          ? { deviceId: { ideal: cam.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: { ideal: cam.facingMode || (cam.isBack ? 'environment' : 'user') }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      };

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (firstErr) {
        console.warn(`Specific constraints failed for ${cam.name}, trying simple fallback:`, firstErr?.message);
        // Brief pause to allow any releasing driver handle to free
        await new Promise(r => setTimeout(r, 300));
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      
      activeStreamsRef.current[cam.id] = stream;
      setStreams(prev => ({ ...prev, [cam.id]: stream }));
      setStandbySensors(prev => ({ ...prev, [cam.id]: false }));

      // If camera label was generic, update it with track label
      const track = stream.getVideoTracks()[0];
      if (track && track.label && (!cam.label || cam.label.startsWith('Integrated HD Camera'))) {
        setDeviceCameras(prev => prev.map(c => c.id === cam.id ? { ...c, label: track.label, name: track.label } : c));
      }
    } catch (err) {
      console.debug(`Camera stream error for ${cam.name}:`, err?.message);
      
      // If error is "Device in use" or similar transient lock and we have retries left:
      if (retryCount < 3 && isPrimary) {
        console.info(`Camera busy, retrying in 600ms (attempt ${retryCount + 1}/3)...`);
        setTimeout(() => {
          startCameraStream(cam, isPrimary, retryCount + 1);
        }, 600);
        return;
      }

      // Only mark standby if there are multiple sensors (e.g. dual-camera phone) and this isn't primary
      if (deviceCameras.length > 1 && !isPrimary) {
        setStandbySensors(prev => ({ ...prev, [cam.id]: true }));
      } else {
        setStandbySensors(prev => ({ ...prev, [cam.id]: false }));
      }
    }
  }, [deviceCameras, sentinelStream]);

  // Keep primary hardware camera synced with persistent sentinelStream
  useEffect(() => {
    if (sentinelStream && sentinelStream.active && deviceCameras.length > 0) {
      const primary = deviceCameras[0];
      if (primary) {
        activeStreamsRef.current[primary.id] = sentinelStream;
        setStreams(prev => ({ ...prev, [primary.id]: sentinelStream }));
        setStandbySensors(prev => ({ ...prev, [primary.id]: false }));
      }
    }
  }, [sentinelStream, deviceCameras]);

  // Initialize streams whenever detected hardware cameras list updates
  useEffect(() => {
    if (deviceCameras.length === 0) return;

    let mounted = true;

    const initStreams = async () => {
      // Start primary camera stream
      const primary = deviceCameras[0];
      if (primary) {
        await startCameraStream(primary, true);
      }

      // If secondary camera exists (e.g. Mobile Front Camera or 2nd USB webcam)
      if (deviceCameras.length > 1) {
        for (let i = 1; i < deviceCameras.length; i++) {
          if (!mounted) break;
          await startCameraStream(deviceCameras[i], false);
        }
      }
    };

    initStreams();

    return () => {
      mounted = false;
      Object.values(activeStreamsRef.current).forEach(stream => {
        // Do NOT stop persistent sentinelStream on unmount! Keeps running in background!
        if (stream && stream !== sentinelStream && stream.getTracks) {
          stream.getTracks().forEach(track => track.stop());
        }
      });
      activeStreamsRef.current = {};
    };
  }, [deviceCameras, startCameraStream, sentinelStream]);

  // Switch active sensor on mobile (stops current stream and activates target)
  const handleActivateSensor = useCallback(async (camId) => {
    const targetCam = deviceCameras.find(c => c.id === camId);
    if (!targetCam) return;

    // Stop other streams if required by mobile hardware
    Object.entries(activeStreamsRef.current).forEach(([id, stream]) => {
      if (id !== camId && stream) {
        stream.getTracks().forEach(track => track.stop());
        delete activeStreamsRef.current[id];
      }
    });

    setStreams({});
    setStandbySensors(prev => ({
      ...prev,
      [camId]: false,
      ...deviceCameras.filter(c => c.id !== camId).reduce((acc, c) => ({ ...acc, [c.id]: true }), {})
    }));

    // Give hardware 200ms to release sensor handle
    await new Promise(r => setTimeout(r, 200));
    await startCameraStream(targetCam, true);
  }, [deviceCameras, startCameraStream]);

  // 4. Load only real IP/mobile cameras from backend API (exclude synthetic mock seeds)
  useEffect(() => {
    let isMounted = true;

    const loadCams = () => {
      fetchCameras(true)
        .then((cams) => {
          if (!isMounted) return;
          if (Array.isArray(cams)) {
            // Keep only running/active external IP and mobile cameras (exclude synthetic mock seeds, video files, local hardware dev-cam, and local device webcam ingest cam-01)
            const realIpCams = cams.filter(c => 
              c.rtsp_url && 
              !c.rtsp_url.startsWith('synthetic://') &&
              !c.rtsp_url.endsWith('.mp4') &&
              !c.rtsp_url.endsWith('.avi') &&
              !c.id.toLowerCase().startsWith('dev-cam') &&
              !c.id.toLowerCase().startsWith('dev-optical') &&
              c.id.toLowerCase() !== 'cam-01' && // cam-01 is primary device webcam ingest
              !c.name.toLowerCase().includes('cam-01') &&
              (c.is_running || c.is_active || c.status === 'online' || c.status === 'connecting')
            );

            setIpCameras(realIpCams.map((c, idx) => {
              const isMobile = Boolean(c.rtsp_url && c.rtsp_url.startsWith('mobile://'));
              const isOnline = c.status === 'online' || c.is_active;
              const isConnecting = c.status === 'connecting';
              const currentStatus = isOnline ? 'online' : (isConnecting ? 'connecting' : (isMobile ? 'standby' : (c.status || 'offline')));

              return {
                id: c.id || `ip-cam-${idx + 1}`,
                code: c.code || `IP-${idx + 1}`,
                name: c.name || `IP Camera ${idx + 1}`,
                location: c.location || 'External Stream',
                streamUrl: c.stream_url || getCameraStreamUrl(c.id),
                frameUrl: c.frame_url || `/api/v1/cameras/${c.id}/frame`,
                isIpCamera: true,
                isMobile,
                status: currentStatus,
                is_active: isOnline,
                resolution: c.resolution || '1080p FHD',
                fps: c.fps || 30
              };
            }));
          }
        })
        .catch(() => {});
    };

    loadCams();
    const interval = setInterval(loadCams, 3000);

    return () => { 
      isMounted = false; 
      clearInterval(interval);
    };
  }, []);

  // Callback when a new IP camera is added via modal
  const handleIpCameraAdded = (newCam) => {
    if (!newCam) return;
    if (newCam.id === 'cam-01' || (newCam.id && newCam.id.toLowerCase().startsWith('dev-'))) return;
    const isMobile = Boolean(newCam.rtsp_url && newCam.rtsp_url.startsWith('mobile://'));
    const newEntry = {
      id: newCam.id || `ip-cam-${Date.now()}`,
      code: newCam.code || 'IP-CAM',
      name: newCam.name || `IP Camera ${ipCameras.length + 1}`,
      location: newCam.location || 'Network IP Stream',
      streamUrl: newCam.stream_url || getCameraStreamUrl(newCam.id),
      frameUrl: newCam.frame_url || `/api/v1/cameras/${newCam.id}/frame`,
      isIpCamera: true,
      isMobile,
      status: isMobile ? 'standby' : (newCam.status || 'connecting'),
      is_active: newCam.status === 'online',
      resolution: newCam.resolution || '1080p FHD',
      fps: newCam.fps || 30
    };

    setIpCameras(prev => [...prev.filter(c => c.id !== newEntry.id), newEntry]);
    setIsAddIpModalOpen(false);
  };

  // Compile active camera matrix: strictly detected hardware cameras + user-added IP cameras
  const activeCameras = [
    ...deviceCameras,
    ...ipCameras
  ];

  // Dynamic layout selection
  let displayedCameras = [];
  let effectiveGridClass = 'grid-single-hero';

  const totalCams = activeCameras.length;

  if (layoutMode === '1') {
    displayedCameras = [activeCameras[selectedHeroIndex] || activeCameras[0]];
    effectiveGridClass = 'grid-single-hero';
  } else if (layoutMode === 'grid') {
    displayedCameras = activeCameras;
    effectiveGridClass = totalCams === 1 ? 'grid-single-hero' : (totalCams === 2 ? 'grid-cols-2' : 'grid-cols-3');
  } else {
    // 'auto' mode: dynamically adapts to the exact number of detected cameras
    displayedCameras = activeCameras;
    if (totalCams <= 1) {
      effectiveGridClass = 'grid-single-hero';
    } else if (totalCams === 2) {
      effectiveGridClass = 'grid-cols-2';
    } else if (totalCams === 3) {
      effectiveGridClass = 'grid-cols-3';
    } else {
      effectiveGridClass = 'grid-cols-multi';
    }
  }

  const handleToggleSiren = () => {
    if (isSirenActive) {
      soundController.silence();
    } else {
      soundController.playSirenBurst(4.0);
    }
  };

  const platform = getDevicePlatform();

  return (
    <div className={`live-feeds-panel ${isFullscreen ? 'fullscreen-mode' : ''}`}>
      {/* Top Bar with Detected Camera Count and Actions */}
      <div className="live-feeds-header">
        <div className="live-feeds-title-group">
          <h2 className="live-feeds-title">Live Feeds</h2>
          
          {/* Dynamic Hardware Camera Detection Indicator */}
          <div className="live-status-indicator" title="Hardware video cameras dynamically detected on this device">
            <span className="live-dot"></span>
            <span className="live-count-text">
              {deviceCameras.length} {deviceCameras.length === 1 ? 'Camera' : 'Cameras'} Detected in Device
              {deviceCameras.length === 1 ? ' (Front Webcam)' : (platform.isMobile ? ' (Rear + Front)' : '')}
              {ipCameras.length > 0 && ` • ${ipCameras.length} IP ${ipCameras.length === 1 ? 'Camera' : 'Cameras'} Connected`}
            </span>
          </div>
        </div>

        <div className="live-feeds-actions">
          {/* Tactical Siren Trigger Button */}
          <button
            className={`siren-trigger-btn ${isSirenActive ? 'siren-pulsing' : ''}`}
            onClick={handleToggleSiren}
            title={isSirenActive ? "Stop Tactical Siren" : "Sound Dual-Tone Tactical Siren"}
          >
            {isSirenActive ? (
              <>
                <VolumeX size={15} />
                <span>SILENCE SIREN</span>
              </>
            ) : (
              <>
                <Volume2 size={15} />
                <span>🚨 SIREN</span>
              </>
            )}
          </button>

          {/* + Add IP Camera Button */}
          <button
            className="add-ip-camera-btn"
            onClick={() => setIsAddIpModalOpen(true)}
            title="Connect external IP Camera, RTSP stream, or Mobile Webcam"
          >
            <Plus size={15} />
            <span>Add IP Camera</span>
          </button>

          {/* Dynamic Layout Switcher */}
          <div className="layout-preset-switcher" title="Switch layout mode">
            <button
              className={`layout-btn ${layoutMode === 'auto' ? 'active' : ''}`}
              onClick={() => setLayoutMode('auto')}
              title="Auto Dynamic Layout (Adapts to detected cameras)"
            >
              <LayoutGrid size={13} />
              <span>Auto ({totalCams})</span>
            </button>
            <button
              className={`layout-btn ${layoutMode === '1' ? 'active' : ''}`}
              onClick={() => setLayoutMode('1')}
              title="Single Hero Camera View"
            >
              <Square size={13} />
              <span>Hero</span>
            </button>
            {totalCams > 1 && (
              <button
                className={`layout-btn ${layoutMode === 'grid' ? 'active' : ''}`}
                onClick={() => setLayoutMode('grid')}
                title="Grid View of All Connected Cameras"
              >
                <Grid size={13} />
                <span>Grid</span>
              </button>
            )}
          </div>

          {/* Fullscreen Toggle */}
          <button
            className="maximize-btn"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title="Toggle Fullscreen Grid"
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>

      {/* When in 1 Big Hero View with multiple cameras: selector strip */}
      {layoutMode === '1' && activeCameras.length > 1 && (
        <div className="hero-selector-strip">
          <span className="strip-label">SELECT CAMERA:</span>
          {activeCameras.map((cam, idx) => (
            <button
              key={`${cam.id || 'cam'}-${idx}`}
              className={`strip-cam-btn ${selectedHeroIndex === idx ? 'active' : ''}`}
              onClick={() => setSelectedHeroIndex(idx)}
            >
              {cam.isDeviceHardware ? (cam.isBack ? '● Rear Camera' : '● Front Webcam') : cam.name}
            </button>
          ))}
        </div>
      )}

      {/* DYNAMIC CAMERA GRID (Strictly detected hardware cameras + added IP cameras) */}
      <div className={`camera-grid-matrix ${effectiveGridClass}`}>
        {displayedCameras.map((cam, index) => (
          <CameraFeedItem
            key={`${cam.id || 'cam'}-${index}`}
            cam={cam}
            index={index}
            stream={streams[cam.id]}
            isSensorStandby={standbySensors[cam.id]}
            onActivateSensor={handleActivateSensor}
            onDetectionsUpdate={(dets) => setCameraDetections(prev => ({ ...prev, [cam.id]: dets }))}
            isSingleHero={displayedCameras.length === 1}
            isModalOpen={Boolean(activeModalCam)}
            onClick={() => {
              setActiveModalCam(cam);
              if (onSelectCamera) onSelectCamera(cam.id);
            }}
            sentinelDetections={sentinelDetections}
            sentinelTelemetry={sentinelTelemetry}
            isSentinelActive={isSentinelActive}
          />
        ))}
      </div>

      {/* Add IP Camera Modal */}
      {isAddIpModalOpen && (
        <AddIpCameraModal
          isOpen={isAddIpModalOpen}
          onClose={() => setIsAddIpModalOpen(false)}
          onCameraAdded={handleIpCameraAdded}
        />
      )}

      {/* Detailed Camera Inspection & PTZ Modal */}
      {activeModalCam && (
        <CameraDetailModal
          camera={{
            ...activeModalCam,
            location: activeModalCam.location || dynamicLocation,
            gps_coords: activeModalCam.gps_coords || dynamicCoords?.formatted,
          }}
          isWebcam={activeModalCam.isDeviceHardware}
          webcamStream={streams[activeModalCam.id]}
          webcamTelemetry={{
            location: dynamicLocation,
            gpsCoords: dynamicCoords?.formatted,
            ...(sentinelTelemetry || {}),
          }}
          liveDetections={(sentinelDetections && sentinelDetections.length > 0) ? sentinelDetections : (cameraDetections[activeModalCam.id] || [])}
          onDetectionsUpdate={(camId, dets) => setCameraDetections(prev => ({ ...prev, [camId]: dets }))}
          onClose={() => setActiveModalCam(null)}
        />
      )}
    </div>
  );
}
