import React from 'react';
import { ShieldAlert, AlertTriangle, CheckCircle, Radio, Send, BellOff, Volume2 } from 'lucide-react';
import { soundController } from '../utils/audioAlert';

export default function ThreatAlertPanel({ alerts, onAcknowledgeAlert, onDispatchQRT }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl flex flex-col h-full max-h-[700px]">
      
      {/* Panel Header */}
      <div className="border-b border-slate-800 pb-3 mb-3 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <ShieldAlert className="w-5 h-5 text-red-500 animate-pulse" />
          <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider">
            Live Threat & Incident Stream
          </h3>
        </div>
        <span className="bg-red-500/20 text-red-400 border border-red-500/40 text-xs font-mono px-2 py-0.5 rounded font-bold">
          {alerts.filter(a => a.status === 'NEW').length} Active Alerts
        </span>
      </div>

      {/* Alert Stream List */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {alerts.length === 0 ? (
          <div className="text-center py-10 text-slate-500 text-xs font-mono">
            No security perimeter breaches detected. Sector clear.
          </div>
        ) : (
          alerts.map(alert => (
            <div
              key={alert.id}
              className={`p-3 rounded-xl border transition-all space-y-2 ${
                alert.severity === 'CRITICAL'
                  ? 'bg-red-500/10 border-red-500/50 hover:border-red-500'
                  : alert.severity === 'HIGH'
                  ? 'bg-amber-500/10 border-amber-500/50 hover:border-amber-500'
                  : 'bg-slate-950 border-slate-800'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="space-y-0.5">
                  <div className="flex items-center space-x-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                      alert.severity === 'CRITICAL'
                        ? 'bg-red-500 text-white'
                        : alert.severity === 'HIGH'
                        ? 'bg-amber-500 text-slate-950'
                        : 'bg-emerald-500 text-slate-950'
                    }`}>
                      {alert.severity}
                    </span>
                    <span className="text-xs font-bold text-slate-100">{alert.title}</span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono">
                    {alert.cameraId} • {alert.timestamp}
                  </div>
                </div>

                {alert.status === 'NEW' && (
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                  </span>
                )}
              </div>

              <p className="text-xs text-slate-300">
                {alert.description}
              </p>

              {/* Action Buttons */}
              <div className="flex items-center justify-end space-x-2 pt-1 border-t border-slate-800/80">
                {alert.status === 'NEW' ? (
                  <>
                    <button
                      onClick={() => onAcknowledgeAlert(alert.id)}
                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center space-x-1"
                    >
                      <CheckCircle className="w-3 h-3 text-emerald-400" />
                      <span>Acknowledge</span>
                    </button>

                    <button
                      onClick={() => onDispatchQRT(alert)}
                      className="px-2.5 py-1 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-bold flex items-center space-x-1 shadow-md shadow-red-600/20"
                    >
                      <Send className="w-3 h-3" />
                      <span>Dispatch Patrol</span>
                    </button>
                  </>
                ) : (
                  <span className="text-[11px] font-mono text-emerald-400 flex items-center space-x-1">
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>Acknowledged & Dispatched</span>
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

    </div>
  );
}
