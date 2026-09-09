import React, { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import axios from 'axios';
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

        const res = await axios.post(`/api/v1/cameras/cam-01/ingest`, { image: b64 }, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 2500,
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
        }
      } catch (err) {
        // Continue on single-frame drop
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

        realDetections.forEach((det) => {
          if (!det.bbox) return;

          const bx = det.bbox.x * cw;
          const by = det.bbox.y * ch;
          const bw = det.bbox.w * cw;
          const bh = det.bbox.h * ch;

          const isUnusual = det.is_unusual || det.unusual_item || det.threat_level === 'CRITICAL';
          const boxColor = isUnusual ? '#FF0033' : (det.class_id === 0 ? '#00F2FE' : '#FBBF24');

          ctx.save();
          ctx.strokeStyle = boxColor;
          ctx.lineWidth = isUnusual ? 3 : 2;
          ctx.shadowColor = boxColor;
          ctx.shadowBlur = isUnusual ? 14 : 6;
          ctx.strokeRect(bx, by, bw, bh);

          // Corner brackets
          const cornerLen = Math.min(14, bw / 3);
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(bx, by + cornerLen); ctx.lineTo(bx, by); ctx.lineTo(bx + cornerLen, by);
          ctx.moveTo(bx + bw - cornerLen, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by + cornerLen);
          ctx.moveTo(bx, by + bh - cornerLen); ctx.lineTo(bx, by + bh); ctx.lineTo(bx + cornerLen, by + bh);
          ctx.moveTo(bx + bw - cornerLen, by + bh); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw, by + bh - cornerLen);
          ctx.stroke();
          ctx.restore();

          // Label
          ctx.save();
          ctx.fillStyle = isUnusual ? 'rgba(255, 0, 51, 0.9)' : 'rgba(8, 14, 24, 0.9)';
          const text = isUnusual
            ? `⚠️ UNUSUAL: ${(det.unusual_item || det.class_name).toUpperCase()}`
            : `${(det.class_name || 'TARGET').toUpperCase()} [${((det.confidence || 0.9) * 100).toFixed(0)}%] ${det.pose_label ? `• ${det.pose_label}` : ''}`;
          
          ctx.font = 'bold 11px JetBrains Mono, monospace';
          const textWidth = ctx.measureText(text).width;
          const tagY = Math.max(by - 20, 4);

          ctx.fillRect(bx, tagY, textWidth + 12, 18);
          ctx.strokeStyle = boxColor;
          ctx.lineWidth = 1;
          ctx.strokeRect(bx, tagY, textWidth + 12, 18);

          ctx.fillStyle = '#FFFFFF';
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
            <span>YOLOv8 MPS GPU • {aiTelemetry.latencyMs}ms</span>
          </div>
          <div className="tv-hud-chip">
            <Activity size={12} className="text-cyan-400" />
            <span>TARGETS: {aiTelemetry.detectionsCount}</span>
          </div>
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
