import React from 'react';
import { Radio, Shield, Camera, Compass, AlertCircle } from 'lucide-react';

export default function TacticalMap({ cameras, alerts }) {
  const bopLocations = [
    { id: 'bop-01', name: 'BOP 01 North Ridge', top: '25%', left: '30%', status: 'ONLINE', cameraCode: 'BOP-01', lat: '34.1524° N', lng: '74.8211° E' },
    { id: 'bop-04', name: 'BOP 04 Riverine Marsh', top: '45%', left: '60%', status: 'BREACH', cameraCode: 'BOP-04', lat: '34.1102° N', lng: '74.8905° E' },
    { id: 'chk-02', name: 'Checkpoint Alpha Inspection', top: '70%', left: '40%', status: 'ONLINE', cameraCode: 'CHK-02', lat: '34.0891° N', lng: '74.7920° E' },
    { id: 'bop-12', name: 'BOP 12 South Gate FRS', top: '60%', left: '80%', status: 'ONLINE', cameraCode: 'BOP-12', lat: '34.0512° N', lng: '74.9310° E' }
  ];

  return (
    <div className="space-y-6">
      
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <Radio className="w-5 h-5 text-emerald-400 animate-pulse" />
            <h2 className="text-lg font-bold text-slate-100 uppercase tracking-wider">
              Tactical GIS Sector Map & Border Radar
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Real-time Geo-Spatial Tracking • BOP Coordinates & Camera FOV Radar Cones
          </p>
        </div>

        <div className="hidden sm:flex items-center space-x-4 font-mono text-xs text-slate-300">
          <div className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
            <span>Active Sector</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping"></span>
            <span>Intrusion Ping</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Interactive Tactical Radar Map */}
        <div className="lg:col-span-2 relative bg-slate-950 border border-slate-800 rounded-2xl h-[520px] overflow-hidden shadow-2xl bg-tactical-grid flex items-center justify-center">
          
          {/* Radar Sweep Effect */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-40">
            <div className="w-[450px] h-[450px] rounded-full border border-emerald-500/30 flex items-center justify-center relative">
              <div className="w-[300px] h-[300px] rounded-full border border-emerald-500/20 flex items-center justify-center">
                <div className="w-[150px] h-[150px] rounded-full border border-emerald-500/20"></div>
              </div>
              {/* Radar Line */}
              <div className="absolute w-[225px] h-[225px] bg-gradient-to-tr from-emerald-500/20 to-transparent rounded-tl-full animate-radar origin-bottom-right top-0 left-0"></div>
            </div>
          </div>

          {/* Compass Rose */}
          <div className="absolute top-4 right-4 bg-slate-900/80 backdrop-blur p-2 rounded-lg border border-slate-800 text-slate-400 font-mono text-xs flex items-center space-x-1">
            <Compass className="w-4 h-4 text-emerald-400 animate-spin" style={{ animationDuration: '20s' }} />
            <span>N 34° 08' 22"</span>
          </div>

          {/* Border Line Geometry Visualization */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            <path
              d="M 50 120 Q 250 80 450 180 T 800 320"
              fill="none"
              stroke="rgba(239, 68, 68, 0.6)"
              strokeWidth="2.5"
              strokeDasharray="8,6"
            />
            <text x="120" y="85" fill="#ef4444" fontSize="11" fontFamily="monospace" fontWeight="bold">
              ⚡ INTERNATIONAL BORDER FENCE LINE
            </text>
          </svg>

          {/* BOP Pins */}
          {bopLocations.map(bop => {
            const hasBreach = alerts.some(a => a.cameraId === bop.cameraCode && a.severity === 'CRITICAL');
            return (
              <div
                key={bop.id}
                style={{ top: bop.top, left: bop.left }}
                className="absolute -translate-x-1/2 -translate-y-1/2 group cursor-pointer"
              >
                {/* Ping Animation */}
                <div className={`relative flex items-center justify-center p-2 rounded-full border ${
                  hasBreach
                    ? 'bg-red-500/20 border-red-500 text-red-400 alarm-pulse'
                    : 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                }`}>
                  <Camera className="w-4 h-4" />
                </div>

                {/* Tooltip Card */}
                <div className="absolute left-1/2 -translate-x-1/2 top-10 hidden group-hover:block bg-slate-900 border border-slate-800 p-2.5 rounded-lg shadow-xl font-mono text-xs text-slate-200 z-30 min-w-[180px]">
                  <div className="font-bold text-slate-100">{bop.name}</div>
                  <div className="text-[10px] text-slate-400">{bop.lat} • {bop.lng}</div>
                  <div className="mt-1 pt-1 border-t border-slate-800 flex justify-between text-[10px]">
                    <span>Status:</span>
                    <span className={hasBreach ? 'text-red-400 font-bold' : 'text-emerald-400'}>
                      {hasBreach ? 'BREACH ALERT' : 'SECURE'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

        </div>

        {/* Sector Telemetry Sidebar */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg space-y-4 font-mono">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Sector Telemetry & Coordinates
          </h3>

          <div className="space-y-3">
            {bopLocations.map(bop => (
              <div key={bop.id} className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200">{bop.name}</span>
                  <span className="text-emerald-400 text-[10px] uppercase font-bold">{bop.status}</span>
                </div>
                <div className="text-[11px] text-slate-400">{bop.lat} • {bop.lng}</div>
              </div>
            ))}
          </div>
        </div>

      </div>

    </div>
  );
}
