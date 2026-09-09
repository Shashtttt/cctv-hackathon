import React, { useState } from 'react';
import { Shield, User, AlertOctagon, Plus, Search, CheckCircle2, UserCheck } from 'lucide-react';

export default function FRSModule({ watchlist, onAddWatchlist }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [newName, setNewName] = useState('');
  const [newAlias, setNewAlias] = useState('');
  const [newCategory, setNewCategory] = useState('High-Value Target');
  const [newThreat, setNewThreat] = useState('CRITICAL');
  const [newNotes, setNewNotes] = useState('');
  const [newAvatar, setNewAvatar] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  // Simulated live face detections
  const activeFaceDetections = [
    {
      id: 'FRS-109',
      detectedAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
      matchedSuspect: watchlist[0] || { name: 'Viktor K. Petrov', threatLevel: 'CRITICAL' },
      confidence: 0.94,
      timestamp: '21:01:05 IST',
      location: 'BOP-12 South Gate',
      status: 'CRITICAL_MATCH'
    },
    {
      id: 'FRS-110',
      detectedAvatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
      matchedSuspect: watchlist[1] || { name: 'Tariq Al-Mansoor', threatLevel: 'HIGH' },
      confidence: 0.89,
      timestamp: '20:55:12 IST',
      location: 'BOP-04 Marshland IR',
      status: 'HIGH_MATCH'
    }
  ];

  const handleAddSubmit = (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    onAddWatchlist({
      id: `W-${Date.now()}`,
      name: newName.trim(),
      alias: newAlias || 'N/A',
      category: newCategory,
      threatLevel: newThreat,
      avatar: newAvatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
      notes: newNotes || 'Added manually by security operator.',
      lastSeen: 'Unknown Staging Post'
    });
    setNewName('');
    setNewAlias('');
    setNewNotes('');
    setShowAddModal(false);
  };

  const filteredWatchlist = watchlist.filter(item =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.alias.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <Shield className="w-5 h-5 text-red-500 animate-pulse" />
            <h2 className="text-lg font-bold text-slate-100 uppercase tracking-wider">
              Facial Recognition System (FRS) Matrix
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            YuNet Deep Detector + SFace Embedding Matcher • Cosine Similarity Matching Against High-Value Target Watchlist
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-red-500 hover:bg-red-400 text-slate-950 font-bold text-xs shadow-lg shadow-red-500/20 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Enroll Suspect Profile</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Live FRS Match Feed */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg">
            <h3 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center justify-between">
              <span>Live Face Match Stream</span>
              <span className="text-cyan-400">Embedding Engine: Cosine Threshold &gt; 0.40</span>
            </h3>

            <div className="space-y-4">
              {activeFaceDetections.map(det => (
                <div key={det.id} className="bg-slate-950 border border-red-500/40 rounded-xl p-4 shadow-lg space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <div className="flex items-center space-x-2 text-xs font-mono text-slate-400">
                      <span className="text-red-400 font-bold">MATCH DETECTED</span>
                      <span>•</span>
                      <span>{det.location}</span>
                      <span>•</span>
                      <span>{det.timestamp}</span>
                    </div>

                    <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/40 font-mono text-xs font-bold uppercase">
                      {(det.confidence * 100).toFixed(1)}% Cosine Match
                    </span>
                  </div>

                  {/* Side-by-side Face Comparison */}
                  <div className="flex flex-col sm:flex-row items-center justify-around gap-4 py-2">
                    
                    {/* Live Stream Face Crop */}
                    <div className="flex flex-col items-center space-y-2">
                      <div className="relative w-24 h-24 rounded-lg overflow-hidden border-2 border-cyan-500 shadow-md">
                        <img src={det.detectedAvatar} alt="Live Crop" className="w-full h-full object-cover" />
                        <div className="absolute top-1 left-1 bg-cyan-500 text-slate-950 text-[9px] font-mono font-bold px-1 rounded">
                          LIVE CROP
                        </div>
                      </div>
                      <span className="text-xs font-mono text-slate-300">Target #{det.id}</span>
                    </div>

                    <div className="text-center font-mono text-slate-400 text-xs">
                      <div className="text-emerald-400 font-bold text-sm">VS</div>
                      <div>SFace Match</div>
                    </div>

                    {/* Enrolled Watchlist Face */}
                    <div className="flex flex-col items-center space-y-2">
                      <div className="relative w-24 h-24 rounded-lg overflow-hidden border-2 border-red-500 shadow-md">
                        <img src={det.matchedSuspect.avatar} alt="Database Profile" className="w-full h-full object-cover" />
                        <div className="absolute top-1 right-1 bg-red-500 text-white text-[9px] font-mono font-bold px-1 rounded">
                          ENROLLED
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs font-bold text-slate-100">{det.matchedSuspect.name}</div>
                        <div className="text-[10px] text-red-400 font-mono font-semibold uppercase">{det.matchedSuspect.threatLevel}</div>
                      </div>
                    </div>

                  </div>

                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Enrolled Suspects Database */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">
              Enrolled Suspects ({watchlist.length})
            </h3>

            <div className="relative w-36">
              <input
                type="text"
                placeholder="Search identity..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-red-500"
              />
            </div>
          </div>

          <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
            {filteredWatchlist.map((suspect, idx) => (
              <div key={idx} className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex items-center space-x-3">
                <img src={suspect.avatar} alt={suspect.name} className="w-12 h-12 rounded-lg object-cover border border-slate-700" />
                <div className="flex-1 min-w-0 font-mono">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-100 truncate">{suspect.name}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase border ${
                      suspect.threatLevel === 'CRITICAL'
                        ? 'bg-red-500/20 text-red-400 border-red-500/40'
                        : 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                    }`}>
                      {suspect.threatLevel}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400">Alias: {suspect.alias}</div>
                  <div className="text-[10px] text-slate-400 truncate">{suspect.notes}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Enroll Suspect Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleAddSubmit} className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-slate-100 uppercase tracking-wider">
              Enroll Suspect into FRS Database
            </h3>

            <div className="space-y-3 font-mono text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Full Legal Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Viktor K. Petrov"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 focus:border-red-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Alias / Codename</label>
                  <input
                    type="text"
                    placeholder="e.g. The Fox"
                    value={newAlias}
                    onChange={e => setNewAlias(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 focus:border-red-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Threat Level</label>
                  <select
                    value={newThreat}
                    onChange={e => setNewThreat(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 focus:border-red-500 focus:outline-none"
                  >
                    <option value="CRITICAL">CRITICAL</option>
                    <option value="HIGH">HIGH</option>
                    <option value="MEDIUM">MEDIUM</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Photo Image URL</label>
                <input
                  type="text"
                  placeholder="https://..."
                  value={newAvatar}
                  onChange={e => setNewAvatar(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 focus:border-red-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Intelligence Notes</label>
                <textarea
                  rows={2}
                  placeholder="Notes on movement, associated cells..."
                  value={newNotes}
                  onChange={e => setNewNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 focus:border-red-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded bg-red-500 hover:bg-red-400 text-slate-950 text-xs font-bold shadow-lg shadow-red-500/20"
              >
                Enroll Profile
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}
