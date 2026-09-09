import React, { useState } from 'react';
import { Crosshair, Maximize2, Radio, AlertTriangle, ShieldCheck, CheckCircle2 } from 'lucide-react';
import './SurveillanceMap.css';

const SurveillanceMap = ({ lastPing = 3, latency = 14 }) => {
  const [selectedNode, setSelectedNode] = useState('C-06');

  const nodes = [
    { id: 'C-01', label: 'C-01 North Gate', status: 'online', cx: 380, cy: 190, color: '#10b981' },
    { id: 'C-06', label: 'C-06 Fence Line', status: 'alert', cx: 550, cy: 220, color: '#ff3b3b', locked: true },
    { id: 'E-02', label: 'E-02 Checkpoint Alpha', status: 'patrol', cx: 310, cy: 290, color: '#00f2fe' },
    { id: 'C-07', label: 'C-07 Ridge View [N]', status: 'online', cx: 650, cy: 160, color: '#cbd5e1' },
  ];

  return (
    <div className="tactical-card surveillance-map-card">
      {/* Card Top Header */}
      <div className="card-header">
        <div className="card-title-group">
          <div className="card-title-row">
            <Radio size={18} className="card-title-icon" />
            <h3 className="card-title">Surveillance Map</h3>
          </div>
          <span className="card-subtitle">Sector 4 Border Perimeter + 5 Monitored Sectors</span>
        </div>

        {/* Legend */}
        <div className="map-legend">
          <div className="legend-item">
            <span className="legend-dot green-dot"></span>
            <span>Online</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot red-square"></span>
            <span>Alert Active</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot white-dot"></span>
            <span>Patrol Gate</span>
          </div>
        </div>
      </div>

      {/* Radar Map Graphic Viewport */}
      <div className="radar-map-viewport scanlines">
        {/* Top Overlay Markers */}
        <div className="map-overlay-top-left">SECTOR AA // BUFFER ZONE</div>
        <div className="map-overlay-top-right">LAT 38.42' N LONG 74.25' E</div>

        {/* Tactical SVG Map Canvas */}
        <svg className="tactical-svg-canvas" viewBox="0 0 800 400" preserveAspectRatio="xMidYMid meet">
          <defs>
            {/* Sector Cone Gradients */}
            <radialGradient id="greenCone" cx="0.5" cy="0.5" r="0.5" fx="0.2" fy="0.5">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="redCone" cx="0.5" cy="0.5" r="0.5" fx="0.2" fy="0.5">
              <stop offset="0%" stopColor="#ff3b3b" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#ff3b3b" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="cyanCone" cx="0.5" cy="0.5" r="0.5" fx="0.2" fy="0.5">
              <stop offset="0%" stopColor="#00f2fe" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#00f2fe" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Grid Gridlines */}
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1" />
          </pattern>
          <rect width="100%" height="100%" fill="url(#grid)" />

          {/* Topographic Terrain Curves */}
          <path 
            d="M 50 120 Q 250 80 450 140 T 750 100" 
            fill="none" 
            stroke="rgba(0, 242, 254, 0.12)" 
            strokeWidth="1.5" 
            strokeDasharray="4 4"
          />
          <path 
            d="M 30 240 Q 280 200 500 280 T 780 220" 
            fill="none" 
            stroke="rgba(0, 242, 254, 0.15)" 
            strokeWidth="1.5"
          />

          {/* Perimeter Vector Paths */}
          <polyline 
            points="310,290 380,190 550,220 650,160" 
            fill="none" 
            stroke="rgba(0, 242, 254, 0.4)" 
            strokeWidth="2" 
          />

          {/* Sector Vision Arcs / Cones */}
          {/* C-01 North Gate Vision Sweep */}
          <polygon points="380,190 280,120 330,80" fill="url(#greenCone)" />
          
          {/* C-06 Fence Line Alert Field */}
          <polygon points="550,220 450,160 480,260" fill="url(#redCone)" />
          <circle cx="550" cy="220" r="55" fill="none" stroke="#ff3b3b" strokeWidth="1" strokeDasharray="3 3" className="rotating-alert-ring" />

          {/* E-02 Checkpoint Alpha Vision Arc */}
          <polygon points="310,290 200,240 240,340" fill="url(#cyanCone)" />

          {/* Node Connections & Labels */}
          {nodes.map((node) => (
            <g 
              key={node.id} 
              className={`map-node-group ${selectedNode === node.id ? 'selected' : ''}`}
              onClick={() => setSelectedNode(node.id)}
            >
              {/* Node Center Dot */}
              <circle cx={node.cx} cy={node.cy} r={node.status === 'alert' ? 8 : 6} fill={node.color} />
              <circle cx={node.cx} cy={node.cy} r={node.status === 'alert' ? 14 : 10} fill="none" stroke={node.color} strokeWidth="1.5" opacity="0.6" />

              {/* Node Tag Box */}
              <rect 
                x={node.cx - 50} 
                y={node.cy - (node.locked ? 44 : 32)} 
                width="100" 
                height="22" 
                rx="4" 
                fill="#0a0f1d" 
                stroke={node.color} 
                strokeWidth="1.5"
              />
              <text 
                x={node.cx} 
                y={node.cy - (node.locked ? 29 : 17)} 
                textAnchor="middle" 
                fill="#ffffff" 
                fontSize="11" 
                fontWeight="700" 
                fontFamily="JetBrains Mono"
              >
                {node.label}
              </text>

              {/* Target Lock Banner if Locked */}
              {node.locked && (
                <g>
                  <rect x={node.cx - 70} y={node.cy - 20} width="140" height="18" rx="3" fill="#ff3b3b" />
                  <text x={node.cx} y={node.cy - 7} textAnchor="middle" fill="#ffffff" fontSize="10" fontWeight="800" fontFamily="JetBrains Mono">
                    TARGET #TRK-8832 LOCKED
                  </text>
                  <line x1={node.cx} y1={node.cy - 2} x2={node.cx} y2={node.cy - 8} stroke="#ffffff" strokeWidth="2" />
                </g>
              )}
            </g>
          ))}

          {/* Animated Target Reticle at C-06 */}
          <g transform="translate(550, 220)" className="target-reticle-group">
            <circle r="22" fill="none" stroke="#ff3b3b" strokeWidth="1.5" />
            <line x1="-28" y1="0" x2="-16" y2="0" stroke="#ff3b3b" strokeWidth="2" />
            <line x1="16" y1="0" x2="28" y2="0" stroke="#ff3b3b" strokeWidth="2" />
            <line x1="0" y1="-28" x2="0" y2="-16" stroke="#ff3b3b" strokeWidth="2" />
            <line x1="0" y1="16" x2="0" y2="28" stroke="#ff3b3b" strokeWidth="2" />
          </g>
        </svg>

        {/* Bottom Demarcation Line Overlay */}
        <div className="map-demarcation-label">BORDER DEMARCATION LINE ALPHA-4</div>

        {/* Bottom Telemetry Bar */}
        <div className="map-telemetry-bar">
          <div className="telemetry-item">GRID-SCALE: <span>1:2500m</span></div>
          <div className="telemetry-divider">|</div>
          <div className="telemetry-item">ELEV: <span>+340m MSL</span></div>
          <div className="telemetry-divider">|</div>
          <div className="telemetry-item">RADAR: <span>2.4 GHz FMCW</span></div>
        </div>
      </div>

      {/* Card Footer Bar */}
      <div className="card-footer-bar">
        <div className="footer-status-info">
          <span className="dot-cyan status-dot pulse-ring"></span>
          <span className="footer-status-text">
            Last ping {lastPing}s ago <span className="text-sep">•</span> Latency {latency}ms <span className="text-sep">•</span> <strong className="cyan-highlight">AI Vision Pipeline Active</strong>
          </span>
        </div>

        <button className="btn-tactical btn-primary">
          <Maximize2 size={13} />
          <span>Expand Defense Map</span>
        </button>
      </div>
    </div>
  );
};

export default SurveillanceMap;
