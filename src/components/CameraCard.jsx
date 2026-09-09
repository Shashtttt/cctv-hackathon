import React, { useState, useEffect, useRef } from 'react';
import { Eye, ShieldAlert, Cpu, Maximize2, Camera, Sliders, Flame, Lock } from 'lucide-react';
import { VisionSimulationEngine } from '../utils/aiVisionEngine';

export default function CameraCard({ camera, onOpenVirtualFence, onTriggerAlert, isSelected }) {
  const [filterMode, setFilterMode] = useState(camera.mode || 'STANDARD'); // STANDARD, THERMAL, NIGHT_GREEN, LOW_LIGHT
  const [targets, setTargets] = useState([]);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);

  useEffect(() => {
    engineRef.current = new VisionSimulationEngine(camera.id);
    engineRef.current.updateFence(camera.fencePoints);

    engineRef.current.start(
      camera.fps || 25,
      (updatedTargets) => setTargets([...updatedTargets]),
      onTriggerAlert
    );

    return () => {
      if (engineRef.current) {
        engineRef.current.destroy();
      }
    };
  }, [camera.id, camera.fps, camera.fencePoints, onTriggerAlert]);

  // Render Canvas Overlays (Virtual Fence & AI Bounding Boxes)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    // 1. Render Virtual Fence Polygon
    if (camera.fencePoints && camera.fencePoints.length >= 3) {
      ctx.beginPath();
      const first = camera.fencePoints[0];
      ctx.moveTo(first.x * width, first.y * height);
      for (let i = 1; i < camera.fencePoints.length; i++) {
        const p = camera.fencePoints[i];
        ctx.lineTo(p.x * width, p.y * height);
      }
      ctx.closePath();
      
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.9)'; // Crimson Red
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
      ctx.fill();

      // Draw Virtual Fence Label
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 11px monospace';
      ctx.fillText('⚡ VIRTUAL PERIMETER FENCE', first.x * width + 5, first.y * height + 15);
    }

    // 2. Render AI Target Bounding Boxes & Identifiers
    targets.forEach(t => {
      const bx = t.x * width;
      const by = t.y * height;
      const bw = t.width * width;
      const bh = t.height * height;

      const isCritical = t.isBreaching || (t.faceMatch && t.faceMatch.threatLevel === 'CRITICAL') || t.isBlacklisted;
      const strokeColor = isCritical ? '#ef4444' : '#10b981';

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, bw, bh);

      // Corner Accents (Tactical Bounding Box Style)
      const cornerLen = Math.min(12, bw / 3);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      // Top-Left
      ctx.beginPath(); ctx.moveTo(bx, by + cornerLen); ctx.lineTo(bx, by); ctx.lineTo(bx + cornerLen, by); ctx.stroke();
      // Bottom-Right
      ctx.beginPath(); ctx.moveTo(bx + bw, by + bh - cornerLen); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw - cornerLen, by + bh); ctx.stroke();

      // Bounding Label Badge
      ctx.fillStyle = isCritical ? 'rgba(239, 68, 68, 0.9)' : 'rgba(16, 185, 129, 0.9)';
      ctx.fillRect(bx, by - 20, Math.max(120, bw), 20);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(`${t.label || t.type}`, bx + 4, by - 6);

      // Motion Trail Line
      ctx.beginPath();
      ctx.moveTo(bx + bw / 2, by + bh);
      ctx.lineTo(bx + bw / 2 + (t.vx || 0) * 1000, by + bh + (t.vy || 0) * 1000);
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.7)';
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    });

  }, [targets, camera.fencePoints, filterMode]);

  // CSS Filter Mapping for Night Vision Modes
  const getFilterStyle = () => {
    switch (filterMode) {
      case 'THERMAL':
        return 'filter-thermal';
      case 'NIGHT_GREEN':
        return 'filter-night-green';
      case 'LOW_LIGHT':
        return 'filter-low-light';
      default:
        return '';
    }
  };

  return (
    <div className={`relative bg-slate-900 rounded-xl overflow-hidden border transition-all shadow-xl flex flex-col ${
      isSelected ? 'border-emerald-500 ring-2 ring-emerald-500/20' : 'border-slate-800 hover:border-slate-700'
    }`}>
      
      {/* Camera Header Bar */}
      <div className="bg-slate-950 px-3 py-2 border-b border-slate-800 flex items-center justify-between z-10">
        <div className="flex items-center space-x-2">
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="font-mono text-xs font-bold text-slate-100 uppercase">{camera.code}</span>
          <span className="text-xs text-slate-400 border-l border-slate-800 pl-2 truncate max-w-[140px]">
            {camera.name}
          </span>
        </div>

        {/* Video Mode Selector */}
        <div className="flex items-center space-x-1.5 text-xs font-mono">
          <button
            onClick={() => setFilterMode(filterMode === 'THERMAL' ? 'STANDARD' : 'THERMAL')}
            className={`px-2 py-0.5 rounded border transition-colors flex items-center space-x-1 ${
              filterMode === 'THERMAL'
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title="Thermal Infrared Mode"
          >
            <Flame className="w-3 h-3" />
            <span>THERMAL</span>
          </button>

          <button
            onClick={() => setFilterMode(filterMode === 'NIGHT_GREEN' ? 'STANDARD' : 'NIGHT_GREEN')}
            className={`px-2 py-0.5 rounded border transition-colors flex items-center space-x-1 ${
              filterMode === 'NIGHT_GREEN'
                ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title="Green Phosphor Night Vision"
          >
            <Eye className="w-3 h-3" />
            <span>IR</span>
          </button>

          <button
            onClick={() => onOpenVirtualFence(camera)}
            className="p-1 rounded bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700"
            title="Configure Virtual Perimeter Fence"
          >
            <Lock className="w-3.5 h-3.5 text-red-400" />
          </button>
        </div>
      </div>

      {/* Live Video / Canvas Container */}
      <div className="relative aspect-video bg-slate-950 flex items-center justify-center overflow-hidden">
        
        {/* Background Stream Simulation Image */}
        <img
          src={
            camera.id === 'cam-01'
              ? 'https://images.unsplash.com/photo-1541872703-74c5e44368f9?w=800&auto=format&fit=crop&q=80'
              : camera.id === 'cam-02'
              ? 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&auto=format&fit=crop&q=80'
              : camera.id === 'cam-03'
              ? 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?w=800&auto=format&fit=crop&q=80'
              : 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800&auto=format&fit=crop&q=80'
          }
          alt="CCTV Stream"
          className={`w-full h-full object-cover transition-all ${getFilterStyle()}`}
        />

        {/* Real-Time AI Canvas Overlay */}
        <canvas
          ref={canvasRef}
          width={640}
          height={360}
          className="absolute inset-0 w-full h-full pointer-events-none z-10"
        />

        {/* Tactical Scanline & Camera Telemetry Watermark */}
        <div className="scanline-overlay absolute inset-0 z-20 pointer-events-none" />

        <div className="absolute top-2 left-2 z-20 bg-slate-950/80 backdrop-blur px-2 py-1 rounded border border-slate-800 text-[10px] font-mono text-slate-300 flex items-center space-x-2">
          <span className="text-emerald-400 font-bold">{camera.resolution}</span>
          <span>•</span>
          <span>{camera.fps} FPS</span>
          <span>•</span>
          <span className="text-slate-400">{camera.ip}</span>
        </div>

        {/* Active Breach Warning Banner */}
        {targets.some(t => t.isBreaching) && (
          <div className="absolute bottom-2 left-2 right-2 z-30 bg-red-600/90 text-white px-3 py-1.5 rounded-lg flex items-center justify-between text-xs font-bold shadow-lg alarm-pulse">
            <div className="flex items-center space-x-2">
              <ShieldAlert className="w-4 h-4 animate-bounce" />
              <span>PERIMETER BREACH IN PROGRESS</span>
            </div>
            <span className="font-mono text-[10px] uppercase bg-black/30 px-2 py-0.5 rounded">
              ALARM ACTIVE
            </span>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="bg-slate-950/90 px-3 py-2 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 font-mono">
        <div>
          <span>Target Count: </span>
          <span className="text-slate-200 font-bold">{targets.length}</span>
        </div>
        <div className="flex items-center space-x-1">
          <Cpu className="w-3.5 h-3.5 text-cyan-400" />
          <span>YOLOv8 + FRS + ANPR Active</span>
        </div>
      </div>

    </div>
  );
}
