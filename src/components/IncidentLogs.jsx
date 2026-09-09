import React, { useState } from 'react';
import { Clock, Search, Download, Filter, FileText, CheckCircle, ShieldAlert } from 'lucide-react';
import { exportIncidentsToCSV, exportIntelligenceSummaryJSON } from '../utils/reportExporter';

export default function IncidentLogs({ incidents, watchlistFRS, watchlistANPR }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [severityFilter, setSeverityFilter] = useState('ALL');

  const filteredIncidents = incidents.filter(item => {
    const matchesText =
      (item.title || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.description || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.cameraId || '').toLowerCase().includes(searchTerm.toLowerCase());

    const matchesSeverity = severityFilter === 'ALL' || item.severity === severityFilter;
    return matchesText && matchesSeverity;
  });

  return (
    <div className="space-y-6">
      
      {/* Header & Export Controls */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <Clock className="w-5 h-5 text-emerald-400" />
            <h2 className="text-lg font-bold text-slate-100 uppercase tracking-wider">
              Surveillance Incident Audit Logs
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Forensic Incident Database • Exportable Intelligence Audit Trail
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => exportIncidentsToCSV(incidents)}
            className="flex items-center space-x-1.5 px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold"
          >
            <Download className="w-4 h-4" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={() => exportIntelligenceSummaryJSON(incidents, watchlistFRS, watchlistANPR)}
            className="flex items-center space-x-1.5 px-3 py-2 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shadow-lg shadow-emerald-500/20"
          >
            <FileText className="w-4 h-4" />
            <span>Export JSON Briefing</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg flex flex-col sm:flex-row items-center justify-between gap-4 font-mono text-xs">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search incident logs..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <span className="text-slate-400">Severity:</span>
          {['ALL', 'CRITICAL', 'HIGH', 'MEDIUM'].map(sev => (
            <button
              key={sev}
              onClick={() => setSeverityFilter(sev)}
              className={`px-3 py-1 rounded font-bold transition-colors ${
                severityFilter === sev
                  ? 'bg-emerald-500 text-slate-950'
                  : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {sev}
            </button>
          ))}
        </div>
      </div>

      {/* Incident Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse font-mono text-xs">
            <thead>
              <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[11px]">
                <th className="p-3">Snapshot</th>
                <th className="p-3">Incident ID</th>
                <th className="p-3">Timestamp</th>
                <th className="p-3">BOP / Camera</th>
                <th className="p-3">Severity</th>
                <th className="p-3">Description</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredIncidents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-500">
                    No matching incident logs found.
                  </td>
                </tr>
              ) : (
                filteredIncidents.map(item => (
                  <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="p-3">
                      <img
                        src={item.snapshotUrl || 'https://images.unsplash.com/photo-1541872703-74c5e44368f9?w=100&auto=format&fit=crop&q=80'}
                        alt="Snapshot"
                        className="w-12 h-8 rounded object-cover border border-slate-700"
                      />
                    </td>
                    <td className="p-3 font-bold text-slate-200">{item.id}</td>
                    <td className="p-3 text-slate-400">{item.timestamp}</td>
                    <td className="p-3 text-cyan-400 font-bold">{item.cameraId}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        item.severity === 'CRITICAL'
                          ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                          : item.severity === 'HIGH'
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                          : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      }`}>
                        {item.severity}
                      </span>
                    </td>
                    <td className="p-3 text-slate-300 max-w-xs truncate">{item.description}</td>
                    <td className="p-3">
                      <span className="text-emerald-400 flex items-center space-x-1">
                        <CheckCircle className="w-3.5 h-3.5" />
                        <span>LOGGED</span>
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
