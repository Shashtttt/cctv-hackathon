import React, { useState, useEffect } from 'react';
import { Shield, ShieldAlert, Volume2, VolumeX, Eye, Radio, Lock, Clock, FileText } from 'lucide-react';
import { soundController } from '../utils/audioAlert';

export default function Navbar({
  threatLevel,
  activeCameraCount,
  criticalAlertCount,
  activeTab,
  setActiveTab,
  onEmergencyLockdown,
  onExportReport
}) {
  const [isMuted, setIsMuted] = useState(false);
  const [timeUtc, setTimeUtc] = useState('');
  const [timeIst, setTimeIst] = useState('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeUtc(now.toISOString().substring(11, 19) + ' UTC');
      setTimeIst(now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }) + ' IST');
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleMuteToggle = () => {
    const muted = soundController.toggleMute();
    setIsMuted(muted);
  };

  return (
    <header className="bg-slate-900/90 border-b border-slate-800 backdrop-blur-md sticky top-0 z-50 px-4 py-2.5">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-3">
        
        {/* Brand & Platform Identifier */}
        <div className="flex items-center space-x-3">
          <div className="bg-emerald-500/10 border border-emerald-500/40 p-2 rounded-lg text-emerald-400 flex items-center justify-center shadow-lg shadow-emerald-500/10">
            <Shield className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-lg font-bold tracking-wider text-slate-100 uppercase">
                IBVAP
              </h1>
              <span className="bg-emerald-500/20 text-emerald-300 text-[10px] font-mono px-2 py-0.5 rounded border border-emerald-500/30 uppercase tracking-widest">
                Software AI Engine v2.4
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium">
              Intelligent Border Video Analytics Platform • BSF Command & Control
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center bg-slate-950/80 p-1 rounded-lg border border-slate-800/80 text-xs font-semibold">
          {[
            { id: 'grid', label: 'Live Grid', icon: Eye },
            { id: 'anpr', label: 'ANPR Scanner', icon: Radio },
            { id: 'frs', label: 'FRS Matrix', icon: Shield },
            { id: 'map', label: 'Tactical GIS Map', icon: Radio },
            { id: 'logs', label: 'Incident Logs', icon: Clock },
            { id: 'analytics', label: 'Analytics', icon: FileText }
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  soundController.playClick();
                  setActiveTab(tab.id);
                }}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md transition-all ${
                  isActive
                    ? 'bg-emerald-500 text-slate-950 font-bold shadow-md shadow-emerald-500/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Tactical Telemetry & Quick Action Controls */}
        <div className="flex items-center space-x-3">
          
          {/* Real-time Threat Level Badge */}
          <div className={`flex items-center space-x-1.5 px-2.5 py-1 rounded border font-mono text-xs font-bold uppercase tracking-wider ${
            criticalAlertCount > 0
              ? 'bg-red-500/20 border-red-500/50 text-red-400 alarm-pulse'
              : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
          }`}>
            <ShieldAlert className="w-4 h-4" />
            <span>THREAT: {criticalAlertCount > 0 ? 'CRITICAL BREACH' : 'NORMAL (DEFCON 4)'}</span>
          </div>

          {/* UTC & IST Dual Clock */}
          <div className="hidden lg:flex flex-col text-[11px] font-mono text-slate-400 border-l border-slate-800 pl-3">
            <span className="text-slate-200">{timeIst}</span>
            <span className="text-slate-400">{timeUtc}</span>
          </div>

          {/* Sound Mute Toggle */}
          <button
            onClick={handleMuteToggle}
            title={isMuted ? "Unmute Alarm Sounds" : "Mute Alarm Sounds"}
            className={`p-2 rounded-lg border transition-colors ${
              isMuted
                ? 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
          </button>

          {/* Report Export Button */}
          <button
            onClick={onExportReport}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-semibold"
          >
            <FileText className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export Report</span>
          </button>

          {/* Emergency Sector Lockdown */}
          <button
            onClick={onEmergencyLockdown}
            className="flex items-center space-x-1 px-3 py-1.5 rounded border border-red-600/60 bg-red-600/20 text-red-300 hover:bg-red-600 hover:text-white text-xs font-bold transition-all shadow-md shadow-red-600/20"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>LOCKDOWN</span>
          </button>

        </div>

      </div>
    </header>
  );
}
