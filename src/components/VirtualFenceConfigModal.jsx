import React, { useState, useRef, useEffect } from 'react';
import {
  Shield,
  X,
  RefreshCw,
  Check,
  AlertTriangle,
  Play,
  Pause,
  Video,
  Radio,
  Sliders,
  Sparkles,
  Trash2,
  Eye,
  CheckCircle2,
  Cpu,
  Lock,
  ArrowRight,
  Sun,
  CloudFog
} from 'lucide-react';
import { updateCameraFence, updateCamera, getCameraStreamUrl } from '../services/apiService';
import './VirtualFenceConfigModal.css';

const PRESET_STREAMS = [
  { name: '🇮🇳 India NH-48 TrafficVision', url: '/videos/mumbai_traffic.mp4', mode: 'AUTO' },
  { name: '🛡️ BOP-01 North Border Gate', url: 'rtsp://10.0.1.20:554/live', mode: 'CLAHE' },
  { name: '🏔️ North Ridge Perimeter IR', url: '/videos/delhi_traffic.mp4', mode: 'THERMAL' },
  { name: '🌫️ Marshland Fog Cam 3', url: '/videos/bangalore_traffic.mp4', mode: 'DEHAZE' },
  { name: '🎥 Local USB Webcam (Dev 0)', url: '0', mode: 'AUTO' },
  { name: '⚡ Synthetic Simulator Stream', url: 'synthetic', mode: 'AUTO' },
];

export const VirtualFenceConfigModal = ({ camera, onClose, onSaveSuccess }) => {
  // Normalize points format (ensure array of {x, y})
  const initialPoints = (camera?.fence_points || camera?.fencePoints || []).map(p => ({
    x: typeof p.x === 'number' ? p.x : 0.5,
    y: typeof p.y === 'number' ? p.y : 0.5,
  }));

  const [points, setPoints] = useState(initialPoints);
  const [streamUrl, setStreamUrl] = useState(camera?.rtsp_url || camera?.streamUrl || 'rtsp://10.0.1.20:554/live');
  const [prepMode, setPrepMode] = useState(camera?.mode || 'AUTO');
  const [dwellSeconds, setDwellSeconds] = useState(3);
  const [breachDirection, setBreachDirection] = useState('BOTH'); // BOTH | ENTRY | EXIT
  const [isPlaying, setIsPlaying] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null); // { type: 'success'|'error', message }
  const [dragIndex, setDragIndex] = useState(null);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const videoRef = useRef(null);

  // Redraw canvas whenever points or drag change
  useEffect(() => {
    drawCanvas();
  }, [points, dragIndex, cursorPos]);

  // Toast auto-clear
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    if (points.length === 0) return;

    // 1. Draw Shaded Polygon Zone
    ctx.beginPath();
    ctx.moveTo(points[0].x * width, points[0].y * height);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x * width, points[i].y * height);
    }

    if (points.length >= 3) {
      ctx.closePath();
      // Tactical red danger zone fill with alpha
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, 'rgba(239, 68, 68, 0.28)');
      gradient.addColorStop(1, 'rgba(185, 28, 28, 0.16)');
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    // 2. Draw Glowing Border Stroke
    ctx.shadowColor = 'rgba(239, 68, 68, 0.85)';
    ctx.shadowBlur = 12;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.setLineDash(points.length >= 3 ? [] : [8, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;

    // 3. Draw Polygon Node Handles
    points.forEach((p, idx) => {
      const px = p.x * width;
      const py = p.y * height;
      const isDraggingThis = dragIndex === idx;

      // Outer ring
      ctx.beginPath();
      ctx.arc(px, py, isDraggingThis ? 11 : 8, 0, Math.PI * 2);
      ctx.fillStyle = isDraggingThis ? '#00f2fe' : '#ffffff';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = isDraggingThis ? '#00f2fe' : '#ef4444';
      ctx.stroke();

      // Inner tactical dot
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#060b13';
      ctx.fill();

      // Node Label Badge
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = '#060b13';
      const label = `P${idx + 1}`;
      const textWidth = ctx.measureText(label).width;

      ctx.fillStyle = isDraggingThis ? 'rgba(0, 242, 254, 0.95)' : 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(px + 10, py - 8, textWidth + 8, 16);
      ctx.strokeStyle = isDraggingThis ? '#00f2fe' : 'rgba(239, 68, 68, 0.8)';
      ctx.strokeRect(px + 10, py - 8, textWidth + 8, 16);

      ctx.fillStyle = isDraggingThis ? '#060b13' : '#ffffff';
      ctx.fillText(label, px + 14, py + 4);
    });

    // 4. Coordinates Readout at cursor
    if (cursorPos.x > 0 && cursorPos.y > 0) {
      ctx.font = '10px monospace';
      ctx.fillStyle = '#00f2fe';
      ctx.fillText(`X:${Math.round(cursorPos.x * 100)}% Y:${Math.round(cursorPos.y * 100)}%`, cursorPos.x * width + 12, cursorPos.y * height - 8);
    }
  };

  const getCanvasCoords = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return { x, y };
  };

  const handleMouseDown = (e) => {
    const { x, y } = getCanvasCoords(e);
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Check if clicked close to an existing handle (hit radius: 0.04 in normalized space)
    const threshold = 0.04;
    let hitIndex = -1;
    for (let i = 0; i < points.length; i++) {
      const dist = Math.hypot(points[i].x - x, points[i].y - y);
      if (dist < threshold) {
        hitIndex = i;
        break;
      }
    }

    if (hitIndex !== -1) {
      setDragIndex(hitIndex);
    } else {
      // Clicked on empty space: Add node if under limit
      if (points.length < 12) {
        setPoints([...points, { x, y }]);
      }
    }
  };

  const handleMouseMove = (e) => {
    const coords = getCanvasCoords(e);
    setCursorPos(coords);

    if (dragIndex !== null) {
      const updated = [...points];
      updated[dragIndex] = coords;
      setPoints(updated);
    }
  };

  const handleMouseUp = () => {
    setDragIndex(null);
  };

  const handleRemovePoint = (index) => {
    setPoints(points.filter((_, i) => i !== index));
  };

  const handleApplyPreset = (type) => {
    if (type === 'PERIMETER') {
      setPoints([
        { x: 0.1, y: 0.15 },
        { x: 0.9, y: 0.15 },
        { x: 0.9, y: 0.85 },
        { x: 0.1, y: 0.85 },
      ]);
    } else if (type === 'CORRIDOR') {
      setPoints([
        { x: 0.15, y: 0.3 },
        { x: 0.85, y: 0.3 },
        { x: 0.95, y: 0.85 },
        { x: 0.05, y: 0.85 },
      ]);
    } else if (type === 'CENTER') {
      setPoints([
        { x: 0.3, y: 0.3 },
        { x: 0.7, y: 0.3 },
        { x: 0.7, y: 0.7 },
        { x: 0.3, y: 0.7 },
      ]);
    } else if (type === 'CLEAR') {
      setPoints([]);
    }
  };

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      // 1. Save Virtual Fence Points to Database
      await updateCameraFence(camera.id, points);

      // 2. Update Camera RTSP Stream URL and Preprocessing Mode
      await updateCamera(camera.id, {
        rtsp_url: streamUrl,
        mode: prepMode,
      });

      setToast({
        type: 'success',
        message: 'Virtual fence boundary & RTSP stream saved to SQLite database. Pipeline reloaded.',
      });

      if (onSaveSuccess) {
        onSaveSuccess({
          ...camera,
          fence_points: points,
          rtsp_url: streamUrl,
          mode: prepMode,
        });
      }
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err) {
      console.error('Failed to save fence/camera configuration:', err);
      setToast({
        type: 'error',
        message: `Save error: ${err.message || 'Check database connectivity.'}`,
      });
    } finally {
      setSaving(false);
    }
  };

  // Determine stream source for preview
  const isVideoFile = streamUrl.endsWith('.mp4') || streamUrl.includes('/videos/');
  const previewImgSrc = !isVideoFile ? getCameraStreamUrl(camera.id) : null;

  return (
    <div className="vfence-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="vfence-modal-dialog">
        
        {/* Header */}
        <div className="vfence-header">
          <div className="vfence-title-group">
            <Shield className="w-5 h-5 text-red-500 animate-pulse" />
            <span className="vfence-cam-badge">{camera.code || 'CAM-01'}</span>
            <h2 className="vfence-title">
              Dynamic Stream & Virtual Fence Configuration • {camera.name || 'Border Station'}
            </h2>
          </div>
          <button onClick={onClose} className="vfence-close-btn" title="Close Panel (Esc)">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="vfence-body">
          
          {/* Canvas Interactive Viewport */}
          <div className="vfence-canvas-area" ref={containerRef}>
            <div className="vfence-media-container">
              {isVideoFile ? (
                <video
                  ref={videoRef}
                  src={streamUrl}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="vfence-video-element"
                />
              ) : (
                <img
                  src={previewImgSrc || '/assets/cam1.png'}
                  alt="Camera Stream Background"
                  className="vfence-bg-img"
                  onError={(e) => {
                    e.target.src = '/assets/cam1.png';
                  }}
                />
              )}

              {/* Dynamic Interactive Drawing Canvas */}
              <canvas
                ref={canvasRef}
                width={960}
                height={540}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                className="vfence-interactive-canvas"
              />

              {/* Top HUD Overlay */}
              <div className="vfence-top-hud">
                <div className="vfence-hud-pill">
                  <Radio className="w-3.5 h-3.5 text-emerald-400 animate-ping" />
                  <span>RTSP STREAM ACTIVE</span>
                  <span className="text-slate-400">|</span>
                  <span className="text-cyan-300 font-bold">{prepMode} ENHANCEMENT</span>
                </div>

                <div className="vfence-hud-pill">
                  <span className="text-slate-400">Nodes:</span>
                  <span className={points.length >= 3 ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                    {points.length} / 12 {points.length >= 3 ? '(VALID ZONE)' : '(MIN 3 NEEDED)'}
                  </span>
                </div>
              </div>

              {/* Canvas Bottom Quick Toolbar */}
              <div className="vfence-canvas-toolbar">
                <button
                  onClick={() => handleApplyPreset('PERIMETER')}
                  className="vfence-tool-btn"
                  title="Preset: Full Frame Boundary"
                >
                  Full Outer Box
                </button>
                <button
                  onClick={() => handleApplyPreset('CORRIDOR')}
                  className="vfence-tool-btn"
                  title="Preset: Highway / Road Corridor"
                >
                  Corridor Trap
                </button>
                <button
                  onClick={() => handleApplyPreset('CENTER')}
                  className="vfence-tool-btn"
                  title="Preset: Central High-Security Zone"
                >
                  Center Buffer
                </button>
                <button
                  onClick={() => handleApplyPreset('CLEAR')}
                  className="vfence-tool-btn danger"
                  title="Reset Boundary Points"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear All
                </button>
              </div>

            </div>
          </div>

          {/* Right Sidebar Configuration Controls */}
          <div className="vfence-sidebar">
            
            {/* 1. RTSP Stream Ingestion Card */}
            <div className="vfence-section-card">
              <div className="vfence-section-title">
                <Video className="w-4 h-4 text-cyan-400" />
                <span>RTSP Stream Ingestion</span>
              </div>

              <div className="vfence-input-group">
                <label className="vfence-label">Camera Stream URL (RTSP / HLS / Device ID):</label>
                <div className="vfence-input-row">
                  <input
                    type="text"
                    value={streamUrl}
                    onChange={(e) => setStreamUrl(e.target.value)}
                    placeholder="rtsp://user:pass@192.168.1.100:554/live"
                    className="vfence-text-input"
                  />
                  <button
                    onClick={() => {
                      if (videoRef.current) {
                        videoRef.current.load();
                        videoRef.current.play().catch(() => {});
                      }
                      setToast({ type: 'success', message: 'Stream preview updated.' });
                    }}
                    className="vfence-btn-secondary"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Reload</span>
                  </button>
                </div>
              </div>

              {/* Stream Presets */}
              <div className="vfence-input-group">
                <label className="vfence-label">Quick Stream Presets:</label>
                <div className="vfence-chips-grid">
                  {PRESET_STREAMS.map((ps, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setStreamUrl(ps.url);
                        setPrepMode(ps.mode);
                      }}
                      className={`vfence-chip ${streamUrl === ps.url ? 'active' : ''}`}
                    >
                      {ps.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 2. Image Preprocessing Filter Card */}
            <div className="vfence-section-card">
              <div className="vfence-section-title">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <span>Night & Fog Preprocessing Filter</span>
              </div>

              <div className="vfence-input-group">
                <label className="vfence-label">Active Pre-Inference Enhancement Pipeline:</label>
                <select
                  value={prepMode}
                  onChange={(e) => setPrepMode(e.target.value)}
                  className="vfence-text-input"
                >
                  <option value="AUTO">AUTO (Dynamic CLAHE + Dark Channel Dehazing)</option>
                  <option value="CLAHE">CLAHE (Night-Vision Contrast-Limited Equalization)</option>
                  <option value="DEHAZE">DEHAZE (Dark Channel Fog/Smoke Clearing)</option>
                  <option value="LOW_LIGHT">LOW_LIGHT (Multi-Stage Denoise + Gamma 0.42)</option>
                  <option value="THERMAL">THERMAL (Pseudo-FLIR Infrared Color-Map)</option>
                  <option value="NIGHT_GREEN">NIGHT_GREEN (Military Phosphor Green Boost)</option>
                  <option value="STANDARD">STANDARD (Raw Unfiltered Passthrough)</option>
                </select>
                <span className="text-xs text-slate-400 font-mono mt-1">
                  Applied prior to YOLOv8 & YuNet detection to eliminate night-blindness and mountain fog false negatives.
                </span>
              </div>
            </div>

            {/* 3. Virtual Fence Parameters Card */}
            <div className="vfence-section-card">
              <div className="vfence-section-title">
                <Shield className="w-4 h-4 text-red-400" />
                <span>Intrusion Zone Settings</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="vfence-input-group">
                  <label className="vfence-label">Breach Direction:</label>
                  <select
                    value={breachDirection}
                    onChange={(e) => setBreachDirection(e.target.value)}
                    className="vfence-text-input"
                  >
                    <option value="BOTH">Bi-Directional (All)</option>
                    <option value="ENTRY">Ingress Only (Entry)</option>
                    <option value="EXIT">Egress Only (Exit)</option>
                  </select>
                </div>

                <div className="vfence-input-group">
                  <label className="vfence-label">Dwell Alert Threshold:</label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="range"
                      min={1}
                      max={20}
                      value={dwellSeconds}
                      onChange={(e) => setDwellSeconds(Number(e.target.value))}
                      className="w-full accent-cyan-400"
                    />
                    <span className="text-xs font-mono text-cyan-300 font-bold w-10 text-right">
                      {dwellSeconds}s
                    </span>
                  </div>
                </div>
              </div>

              {/* Coordinate Nodes Table */}
              <div className="vfence-input-group mt-1">
                <div className="flex justify-between items-center mb-1">
                  <label className="vfence-label">Boundary Vertex Coordinates:</label>
                  <span className="text-xs font-mono text-slate-400">Click & Drag handles to reposition</span>
                </div>

                <div className="vfence-points-hud">
                  {points.length === 0 ? (
                    <div className="p-3 text-center text-xs text-slate-500">
                      No points placed. Click anywhere on the stream preview to add vertex nodes.
                    </div>
                  ) : (
                    points.map((pt, idx) => (
                      <div key={idx} className="vfence-point-row">
                        <span className="text-slate-300 font-bold">Node P{idx + 1}</span>
                        <span className="text-cyan-400">
                          X: {(pt.x * 100).toFixed(1)}% | Y: {(pt.y * 100).toFixed(1)}%
                        </span>
                        <button
                          onClick={() => handleRemovePoint(idx)}
                          className="vfence-point-remove"
                          title="Remove node"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>

            {/* Toast feedback */}
            {toast && (
              <div className={`vfence-toast ${toast.type}`}>
                {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                <span>{toast.message}</span>
              </div>
            )}

            {/* Footer Action */}
            <div className="vfence-footer">
              <button
                onClick={handleSaveAll}
                disabled={saving || (points.length > 0 && points.length < 3)}
                className="vfence-save-btn"
              >
                {saving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Committing to SQLite DB & Reloading Workers...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Save Virtual Fence & RTSP to Database</span>
                  </>
                )}
              </button>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
};
