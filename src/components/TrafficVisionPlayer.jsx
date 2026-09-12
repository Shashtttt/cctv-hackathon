import React, { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import axios from 'axios';
import { api } from '../services/apiService';
import {
  Globe,
  Sparkles,
  Maximize2,
  RefreshCw,
  Activity,
  Zap,
  Radio,
  Compass,
  CheckCircle2,
  Cpu
} from 'lucide-react';
import { TRAFFIC_VISION_SETTINGS, INDIA_TRAFFIC_CAMERAS } from '../services/trafficVisionCatalog';
import { soundController } from '../utils/audioAlert';
import './TrafficVisionPlayer.css';

export const TrafficVisionPlayer = ({
  activeCamera = INDIA_TRAFFIC_CAMERAS[0],
  onSelectCamera,
  showControls = true,
  enableAiOverlay = true,
  onExpand,
}) => {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const canvasRef = useRef(null);
  const offscreenCanvasRef = useRef(null);
  const isIngestingRef = useRef(false);

  const [currentCam, setCurrentCam] = useState(activeCamera);
  const [streamStatus, setStreamStatus] = useState('LIVE');
  const [aiOverlayActive, setAiOverlayActive] = useState(enableAiOverlay);
  const [realDetections, setRealDetections] = useState([]);
  const [aiTelemetry, setAiTelemetry] = useState({
    fps: 30,
    latencyMs: 14,
    detectionsCount: 0,
    engine: 'YOLOv8 + YuNet (Apple Silicon MPS)',
  });

  // Sync prop changes
  useEffect(() => {
    if (activeCamera && activeCamera.id !== currentCam.id) {
      setCurrentCam(activeCamera);
    }
  }, [activeCamera]);

  // Stream setup
  const initStream = useCallback(() => {
    const video = videoRef.current;
    if (!video || !currentCam) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isHls = currentCam.feedType === 'hls' || currentCam.streamUrl.endsWith('.m3u8');

    if (isHls && Hls.isSupported()) {
      const hls = new Hls(TRAFFIC_VISION_SETTINGS.hls);
      hlsRef.current = hls;

      hls.loadSource(currentCam.streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setStreamStatus('LIVE');
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          }
        }
      });
    } else {
      // Direct Local / MP4 stream
      video.crossOrigin = 'anonymous';
      video.src = currentCam.streamUrl;
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      video.loop = true;

      video.onloadeddata = () => {
        setStreamStatus('LIVE');
        video.play().catch(() => {});
      };

      video.onplay = () => {
        setStreamStatus('LIVE');
      };
      
      video.play().catch(() => {});
    }
  }, [currentCam]);

  useEffect(() => {
    initStream();
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [initStream]);

  // Real Backend AI Inference Call on Live Video Frames
  useEffect(() => {
    if (!aiOverlayActive) return;

    let timerId;
    const analyzeFrame = async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0 || isIngestingRef.current) {
        timerId = setTimeout(analyzeFrame, 200);
        return;
      }

      isIngestingRef.current = true;
      try {
        if (!offscreenCanvasRef.current) {
          offscreenCanvasRef.current = document.createElement('canvas');
        }
        const canvas = offscreenCanvasRef.current;
        canvas.width = 640;
        canvas.height = 360;

        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.drawImage(video, 0, 0, 640, 360);

        const b64 = canvas.toDataURL('image/jpeg', 0.70);
        const t0 = performance.now();

        const res = await api.post(`/cameras/cam-01/ingest`, { image: b64 }, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 4500,
        });

        const dt = Math.round(performance.now() - t0);
        if (res.data && res.data.success) {
          const dets = res.data.detections || [];
          setRealDetections(dets);
          setAiTelemetry((prev) => ({
            ...prev,
            latencyMs: dt,
            detectionsCount: dets.length,
          }));

          const hasWeapon = dets.some(
            (d) => d.is_weapon || 
                   (d.is_holding && d.held_item_type === 'WEAPON') ||
                   ['knife', 'gun', 'pistol', 'rifle', 'shotgun', 'firearm', 'weapon', 'scissors', 'blade', 'dagger', 'machete', 'sword'].some(w => 
                     (d.class_name || '').toLowerCase().includes(w) || 
                     (d.held_item || '').toLowerCase().includes(w)
                   )
          );
          if (hasWeapon) {
            soundController.triggerWeaponSiren(2000);
          }
        }
      } catch (err) {
        console.debug('[TrafficVision AI Frame Drop]:', err?.message);
      } finally {
        isIngestingRef.current = false;
        timerId = setTimeout(analyzeFrame, 250); // 4 FPS real backend AI inference
      }
    };

    analyzeFrame();
    return () => clearTimeout(timerId);
  }, [aiOverlayActive, currentCam]);

  // High-Speed 60 FPS Canvas Overlay Renderer
  useEffect(() => {
    if (!aiOverlayActive || !canvasRef.current || !videoRef.current) return;

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

        // 1. Draw Tether Lines between persons and held items
        realDetections.forEach((det) => {
          if (det.is_holding && det.held_item) {
            const heldObj = realDetections.find((o) => o.held_by_target_id === det.target_id && o.bbox);
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

              // Check if wrist keypoint is available
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

              const isWeaponHolding = det.held_item_type === 'WEAPON' || ['knife', 'gun', 'pistol', 'rifle', 'shotgun', 'firearm', 'weapon', 'scissors', 'blade', 'dagger', 'machete', 'sword'].some(w => (det.held_item || '').toLowerCase().includes(w));
              const tetherColor = isWeaponHolding ? '#FF0033' : '#10B981';
              ctx.save();
              ctx.strokeStyle = tetherColor;
              ctx.lineWidth = isWeaponHolding ? 2.5 : 1.5;
              ctx.setLineDash([4, 3]);
              ctx.shadowColor = tetherColor;
              ctx.shadowBlur = 8;
              ctx.beginPath();
              ctx.moveTo(startPt.x, startPt.y);
              ctx.lineTo(objCenter.x, objCenter.y);
              ctx.stroke();

              // Draw pulsating joint ring at held object center
              ctx.setLineDash([]);
              ctx.fillStyle = tetherColor;
              ctx.beginPath();
              ctx.arc(objCenter.x, objCenter.y, 4, 0, 2 * Math.PI);
              ctx.fill();
              ctx.restore();
            }
          }
        });

        // 2. Draw Target Bounding Boxes, Reticles & Labels
        realDetections.forEach((det) => {
          if (!det.bbox) return;

          const bx = det.bbox.x * cw;
          const by = det.bbox.y * ch;
          const bw = det.bbox.w * cw;
          const bh = det.bbox.h * ch;

          const cName = (det.class_name || '').toLowerCase();
          const heldItem = (det.held_item || '').toLowerCase();
          const isWeaponItem = det.is_weapon || ['knife', 'gun', 'pistol', 'rifle', 'shotgun', 'firearm', 'weapon', 'scissors', 'blade', 'dagger', 'machete', 'sword'].some(w => cName.includes(w) || heldItem.includes(w));
          const isArmed = det.is_holding && (det.held_item_type === 'WEAPON' || isWeaponItem);
          const isHoldingCasual = det.is_holding && det.held_item_type === 'CASUAL_OBJECT' && !isWeaponItem;
          const isPhone = cName.includes('phone') || cName.includes('cell') || heldItem.includes('phone');
          const isUnattendedBag = ['backpack', 'suitcase', 'handbag'].includes(cName) && !det.is_held;
          const isUnusual = det.is_unusual || det.unusual_item;
          const isWeapon = isArmed || isWeaponItem;

          // Strict User Rule: Red for weapons; Green for all casual objects, people, phones
          const boxColor = isWeapon ? '#FF0033' : '#10B981';

          ctx.save();
          ctx.strokeStyle = boxColor;
          ctx.lineWidth = isWeapon ? 3 : 2;
          ctx.shadowColor = boxColor;
          ctx.shadowBlur = isWeapon ? 16 : 6;
          ctx.strokeRect(bx, by, bw, bh);

          // Corner Reticle Brackets
          const cornerLen = Math.min(16, bw / 3);
          ctx.lineWidth = isWeapon ? 3.5 : 2.5;
          ctx.beginPath();
          ctx.moveTo(bx, by + cornerLen); ctx.lineTo(bx, by); ctx.lineTo(bx + cornerLen, by);
          ctx.moveTo(bx + bw - cornerLen, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by + cornerLen);
          ctx.moveTo(bx, by + bh - cornerLen); ctx.lineTo(bx, by + bh); ctx.lineTo(bx + cornerLen, by + bh);
          ctx.moveTo(bx + bw - cornerLen, by + bh); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw, by + bh - cornerLen);
          ctx.stroke();

          // Crosshair reticle on armed subjects or weapons
          if (isWeapon) {
            const cx = bx + bw / 2;
            const cy = by + bh / 2;
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy);
            ctx.moveTo(cx, cy - 10); ctx.lineTo(cx + 10, cy);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          ctx.restore();

          // Label
          ctx.save();
          const confStr = `${((det.confidence || 0.9) * 100).toFixed(0)}%`;
          let text = '';
          if (isArmed) {
            text = `🚨 ARMED SUBJECT: HOLDING ${det.held_item} (${(det.held_by_hand || 'HAND').replace('_', ' ')})`;
          } else if (isHoldingCasual) {
            const isHoldPhone = (det.held_item || '').toLowerCase().includes('phone') || (det.held_item || '').toLowerCase().includes('cell');
            text = isHoldPhone
              ? `📱 HOLDING PHONE (${(det.held_by_hand || 'HAND').replace('_', ' ')})`
              : `📦 HOLDING: ${det.held_item} (${(det.held_by_hand || 'HAND').replace('_', ' ')})`;
          } else if (isWeapon) {
            text = `🚨 WEAPON: ${(det.unusual_item || det.class_name).toUpperCase()} [${confStr}]`;
          } else if (isPhone) {
            text = `📱 CELL PHONE [${confStr}] ${det.is_held ? '• IN HAND' : '• DETECTED'}`;
          } else if (isUnattendedBag) {
            text = `⚠️ UNATTENDED BAGGAGE: ${det.class_name.toUpperCase()} [${confStr}]`;
          } else if (isUnusual) {
            text = `⚠️ UNUSUAL: ${(det.unusual_item || det.class_name).toUpperCase()} [${confStr}]`;
          } else if (det.class_id === 0) {
            text = `👤 ${(det.class_name || 'PERSON').toUpperCase()} [${confStr}] ${det.pose_label ? `• ${det.pose_label}` : ''}`;
          } else {
            const icon = cName.includes('bottle') ? '🍾 ' : cName.includes('laptop') ? '💻 ' : cName.includes('cup') ? '☕ ' : cName.includes('book') ? '📖 ' : cName.includes('car') || cName.includes('truck') || cName.includes('bus') ? '🚗 ' : '🎯 ';
            text = `${icon}${det.class_name.toUpperCase()} [${confStr}] ${det.is_held ? '• HELD' : ''}`;
          }

          ctx.font = 'bold 11px JetBrains Mono, monospace';
          const textWidth = ctx.measureText(text).width;
          const tagY = Math.max(by - 20, 4);

          ctx.fillStyle = isWeapon ? 'rgba(40, 5, 12, 0.94)' : 'rgba(5, 30, 20, 0.92)';
          ctx.fillRect(bx, tagY, textWidth + 12, 18);
          ctx.strokeStyle = boxColor;
          ctx.lineWidth = 1;
          ctx.strokeRect(bx, tagY, textWidth + 12, 18);

          ctx.fillStyle = boxColor;
          ctx.fillText(text, bx + 6, tagY + 13);
          ctx.restore();
        });
      }
      animId = requestAnimationFrame(renderOverlay);
    };

    animId = requestAnimationFrame(renderOverlay);
    return () => cancelAnimationFrame(animId);
  }, [aiOverlayActive, realDetections]);

  return (
    <div className="tv-player-container">
      {/* Header */}
      <div className="tv-player-header">
        <div className="tv-header-left">
          <div className="tv-brand-pill">
            <Globe size={15} className="text-cyan-400" />
            <span className="tv-brand-name">TRAFFICVISION.LIVE</span>
            <span className="tv-brand-country">🇮🇳 INDIA</span>
          </div>

          <div className="tv-cam-meta">
            <span className="tv-cam-title">{currentCam.name}</span>
            <span className="tv-cam-loc">{currentCam.location}</span>
          </div>
        </div>

        <div className="tv-header-right">
          <div className="tv-status-badge live">
            <span className="tv-status-dot"></span>
            <span>LIVE ⚡</span>
          </div>

          <button
            className={`tv-btn-icon ${aiOverlayActive ? 'active' : ''}`}
            onClick={() => setAiOverlayActive(!aiOverlayActive)}
            title="Toggle Real YOLOv8 AI Detection"
          >
            <Sparkles size={14} />
            <span>AI OVERLAY ({realDetections.length})</span>
          </button>

          {onExpand && (
            <button
              className="tv-btn-icon"
              onClick={() => onExpand(currentCam)}
              title="Expand Camera"
            >
              <Maximize2 size={14} />
              <span>EXPAND</span>
            </button>
          )}

          <button
            className="tv-btn-icon"
            onClick={initStream}
            title="Refresh Stream"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Main Video Viewport */}
      <div className="tv-video-wrapper">
        <video
          ref={videoRef}
          className="tv-native-video"
          crossOrigin="anonymous"
          playsInline
          muted
          autoPlay
          loop
        />

        {aiOverlayActive && (
          <canvas ref={canvasRef} className="tv-ai-canvas-overlay" />
        )}

        {/* HUD Chips */}
        <div className="tv-hud-osd">
          <div className="tv-hud-chip">
            <Cpu size={12} className="text-emerald-400" />
            <span>YOLOv8 Dual Engine • {aiTelemetry.latencyMs}ms</span>
          </div>
          <div className="tv-hud-chip">
            <Activity size={12} className="text-cyan-400" />
            <span>TARGETS: {aiTelemetry.detectionsCount}</span>
          </div>
          {realDetections.some((d) => d.is_holding && d.held_item_type === 'WEAPON') && (
            <div className="tv-hud-chip" style={{ background: 'rgba(255, 0, 51, 0.25)', borderColor: '#FF0033' }}>
              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping"></span>
              <span className="text-red-400 font-bold">ARMED SUBJECT DETECTED</span>
            </div>
          )}
          {realDetections.some((d) => d.is_weapon) && (
            <div className="tv-hud-chip" style={{ background: 'rgba(255, 0, 51, 0.15)', borderColor: '#FF0033' }}>
              <span className="text-red-400 font-bold">WEAPON CONFIRMED</span>
            </div>
          )}
          <div className="tv-hud-chip">
            <Radio size={12} className="text-yellow-400" />
            <span>{currentCam.viewers || 1420} VIEWERS</span>
          </div>
        </div>
      </div>

      {/* Camera Corridor Selector */}
      {showControls && (
        <div className="tv-cam-selector-bar">
          <div className="tv-selector-title">
            <Compass size={13} />
            <span>SELECT LIVE TRAFFIC CORRIDOR:</span>
          </div>

          <div className="tv-cam-scroll-list">
            {INDIA_TRAFFIC_CAMERAS.map((cam) => {
              const isSelected = cam.id === currentCam.id;
              return (
                <button
                  key={cam.id}
                  className={`tv-cam-chip ${isSelected ? 'selected' : ''}`}
                  onClick={() => {
                    setCurrentCam(cam);
                    if (onSelectCamera) onSelectCamera(cam);
                  }}
                >
                  <div className="tv-chip-top">
                    <span className="tv-chip-flag">{cam.countryCode === 'IN' ? '🇮🇳' : '🌐'}</span>
                    <span className="tv-chip-name">{cam.name}</span>
                  </div>
                  <div className="tv-chip-sub">
                    <span className="tv-chip-loc">{cam.location}</span>
                    <span className="tv-chip-badge">{cam.resolution}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default TrafficVisionPlayer;
