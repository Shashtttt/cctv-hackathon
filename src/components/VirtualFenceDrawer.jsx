import React, { useState, useRef, useEffect } from 'react';
import { Shield, X, RefreshCw, Check, AlertTriangle, PenTool } from 'lucide-react';

export default function VirtualFenceDrawer({ camera, onClose, onSaveFence }) {
  const [points, setPoints] = useState(camera.fencePoints || []);
  const canvasRef = useRef(null);

  useEffect(() => {
    drawCanvas();
  }, [points]);

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    if (points.length === 0) return;

    // Render Polygon Lines
    ctx.beginPath();
    ctx.moveTo(points[0].x * width, points[0].y * height);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x * width, points[i].y * height);
    }

    if (points.length >= 3) {
      ctx.closePath();
      ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
      ctx.fill();
    }

    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Render Corner Handles
    points.forEach((p, idx) => {
      ctx.beginPath();
      ctx.arc(p.x * width, p.y * height, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(`P${idx + 1}`, p.x * width + 8, p.y * height + 4);
    });
  };

  const handleCanvasClick = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    if (points.length < 8) {
      setPoints([...points, { x, y }]);
    }
  };

  const handleReset = () => {
    setPoints([]);
  };

  const handleApplyPreset = (presetType) => {
    if (presetType === 'PERIMETER') {
      setPoints([
        { x: 0.1, y: 0.2 },
        { x: 0.9, y: 0.2 },
        { x: 0.9, y: 0.8 },
        { x: 0.1, y: 0.8 }
      ]);
    } else if (presetType === 'CENTER_BUFFER') {
      setPoints([
        { x: 0.3, y: 0.3 },
        { x: 0.7, y: 0.3 },
        { x: 0.7, y: 0.7 },
        { x: 0.3, y: 0.7 }
      ]);
    }
  };

  const handleSave = () => {
    onSaveFence(camera.id, points);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full overflow-hidden shadow-2xl flex flex-col">
        
        {/* Header */}
        <div className="bg-slate-950 px-5 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Shield className="w-5 h-5 text-red-500" />
            <h3 className="text-base font-bold text-slate-100 uppercase tracking-wider">
              Virtual Fence Configuration • {camera.code}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Interactive Drawer Body */}
        <div className="p-5 flex flex-col md:flex-row gap-5">
          
          {/* Canvas Drawer View */}
          <div className="flex-1 relative aspect-video bg-slate-950 rounded-xl overflow-hidden border border-slate-800 shadow-inner">
            <img
              src="https://images.unsplash.com/photo-1541872703-74c5e44368f9?w=800&auto=format&fit=crop&q=80"
              alt="CCTV Background"
              className="w-full h-full object-cover opacity-60 pointer-events-none"
            />
            <canvas
              ref={canvasRef}
              width={800}
              height={450}
              onClick={handleCanvasClick}
              className="absolute inset-0 w-full h-full cursor-crosshair z-10"
            />
            <div className="absolute top-3 left-3 bg-slate-950/80 px-3 py-1 rounded text-xs font-mono text-slate-300 border border-slate-800">
              Click on the stream to place polygon boundary nodes (Points: {points.length}/8)
            </div>
          </div>

          {/* Controls Panel */}
          <div className="w-full md:w-72 flex flex-col justify-between space-y-4">
            <div>
              <h4 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center space-x-1">
                <PenTool className="w-3.5 h-3.5 text-cyan-400" />
                <span>Fence Presets</span>
              </h4>

              <div className="grid grid-cols-2 gap-2 mb-4">
                <button
                  onClick={() => handleApplyPreset('PERIMETER')}
                  className="px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200"
                >
                  Full Outer Box
                </button>
                <button
                  onClick={() => handleApplyPreset('CENTER_BUFFER')}
                  className="px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200"
                >
                  Center Zone
                </button>
              </div>

              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-xs space-y-2 font-mono text-slate-400">
                <div className="flex justify-between">
                  <span>Fence Status:</span>
                  <span className={points.length >= 3 ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
                    {points.length >= 3 ? 'ACTIVE ZONE' : 'INCOMPLETE'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Detection Mode:</span>
                  <span className="text-slate-200">INTRUSION & CRAWL</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <button
                onClick={handleReset}
                className="w-full flex items-center justify-center space-x-1 py-2 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-semibold"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Clear Points</span>
              </button>

              <button
                onClick={handleSave}
                disabled={points.length < 3 && points.length !== 0}
                className="w-full flex items-center justify-center space-x-1 py-2.5 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shadow-lg shadow-emerald-500/20 disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                <span>Save Perimeter Zone</span>
              </button>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
}
