import React, { useState } from 'react';
import { Radio, AlertTriangle, CheckCircle, ShieldAlert, Plus, Search, Filter, Car } from 'lucide-react';

export default function ANPRModule({ watchlist, onAddWatchlist, onTriggerAlert }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [newPlate, setNewPlate] = useState('');
  const [newOwner, setNewOwner] = useState('');
  const [newStatus, setNewStatus] = useState('WANTED');
  const [newVehicleType, setNewVehicleType] = useState('Heavy Utility Truck');
  const [showAddModal, setShowAddModal] = useState(false);

  // Simulated live ANPR scans
  const recentScans = [
    {
      id: 'ANPR-881',
      plate: 'JK-02-AX-8912',
      vehicleType: 'Heavy Utility Truck',
      color: 'Dark Olive / Camo',
      confidence: 0.98,
      timestamp: '21:00:14 IST',
      location: 'Checkpoint Alpha Inspection',
      status: 'WANTED',
      isFlagged: true
    },
    {
      id: 'ANPR-882',
      plate: 'PB-10-CZ-4401',
      vehicleType: 'Armored SUV / 4x4',
      color: 'Black Metallic',
      confidence: 0.95,
      timestamp: '20:58:30 IST',
      location: 'Checkpoint Alpha Inspection',
      status: 'SUSPICIOUS',
      isFlagged: true
    },
    {
      id: 'ANPR-883',
      plate: 'HR-26-BQ-7719',
      vehicleType: 'Cargo Supply Truck',
      color: 'White Container',
      confidence: 0.99,
      timestamp: '20:52:10 IST',
      location: 'Gate 2 Staging Area',
      status: 'PERMITTED',
      isFlagged: false
    },
    {
      id: 'ANPR-884',
      plate: 'DL-01-ET-3022',
      vehicleType: 'Civilian Sedan',
      color: 'Silver Metallic',
      confidence: 0.92,
      timestamp: '20:45:05 IST',
      location: 'Buffer Zone Access Road',
      status: 'PERMITTED',
      isFlagged: false
    }
  ];

  const handleAddSubmit = (e) => {
    e.preventDefault();
    if (!newPlate.trim()) return;
    onAddWatchlist({
      plate: newPlate.toUpperCase().trim(),
      owner: newOwner || 'Unknown Entity',
      status: newStatus,
      vehicleType: newVehicleType,
      threatLevel: newStatus === 'WANTED' ? 'CRITICAL' : 'HIGH',
      notes: 'Added manually by C2 Security Operator',
      flaggedDate: new Date().toISOString().substring(0, 10)
    });
    setNewPlate('');
    setNewOwner('');
    setShowAddModal(false);
  };

  const filteredWatchlist = watchlist.filter(item =>
    item.plate.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.owner.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <Radio className="w-5 h-5 text-cyan-400 animate-pulse" />
            <h2 className="text-lg font-bold text-slate-100 uppercase tracking-wider">
              Automatic Number Plate Recognition (ANPR)
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Software OCR & License Plate Extraction Pipeline • Connected to Stolen & Unauthorized Vehicle Watchlist
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shadow-lg shadow-cyan-500/20 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Add Blacklisted Plate</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Real-time ANPR Scanner Feeds */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg">
            <h3 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center justify-between">
              <span>Live License Plate Scans</span>
              <span className="text-emerald-400">OCR Engine: 98.4% Accuracy</span>
            </h3>

            <div className="space-y-3">
              {recentScans.map(scan => (
                <div
                  key={scan.id}
                  className={`p-4 rounded-xl border transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                    scan.isFlagged
                      ? 'bg-red-500/10 border-red-500/40 hover:border-red-500/60'
                      : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center space-x-4">
                    {/* Simulated Plate Crop Thumbnail */}
                    <div className="bg-amber-400 text-slate-950 border-2 border-slate-900 font-mono font-black text-sm px-3 py-1.5 rounded shadow-md tracking-widest uppercase">
                      {scan.plate}
                    </div>

                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-bold text-slate-100">{scan.vehicleType}</span>
                        <span className="text-xs text-slate-400">({scan.color})</span>
                      </div>
                      <div className="text-xs text-slate-400 font-mono mt-0.5">
                        {scan.location} • {scan.timestamp}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3 self-end sm:self-center">
                    <span className={`px-2.5 py-1 rounded text-xs font-mono font-bold uppercase border ${
                      scan.status === 'WANTED'
                        ? 'bg-red-500/20 border-red-500/50 text-red-400'
                        : scan.status === 'SUSPICIOUS'
                        ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                        : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                    }`}>
                      {scan.status}
                    </span>

                    <div className="text-right font-mono text-[11px] text-slate-400">
                      <div>OCR Match</div>
                      <div className="text-cyan-400 font-bold">{(scan.confidence * 100).toFixed(1)}%</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Blacklisted License Plate Watchlist Database */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">
              Vehicle Watchlist ({watchlist.length})
            </h3>

            <div className="relative w-36">
              <input
                type="text"
                placeholder="Search plate..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
            {filteredWatchlist.map((item, idx) => (
              <div key={idx} className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1.5 font-mono text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-400 tracking-wider">{item.plate}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold border ${
                    item.status === 'WANTED'
                      ? 'bg-red-500/20 border-red-500 text-red-400'
                      : 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                  }`}>
                    {item.status}
                  </span>
                </div>
                <div className="text-slate-300 text-[11px]">{item.owner}</div>
                <div className="text-slate-400 text-[10px]">{item.vehicleType} • {item.notes}</div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Add Watchlist Plate Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleAddSubmit} className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-slate-100 uppercase tracking-wider">
              Add Vehicle to ANPR Watchlist
            </h3>

            <div className="space-y-3 font-mono text-xs">
              <div>
                <label className="block text-slate-400 mb-1">License Plate Number</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. JK-02-AX-8912"
                  value={newPlate}
                  onChange={e => setNewPlate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Registered Owner / Entity</label>
                <input
                  type="text"
                  placeholder="e.g. Unknown Staging Group"
                  value={newOwner}
                  onChange={e => setNewOwner(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Status</label>
                  <select
                    value={newStatus}
                    onChange={e => setNewStatus(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 focus:border-cyan-500 focus:outline-none"
                  >
                    <option value="WANTED">WANTED</option>
                    <option value="SUSPICIOUS">SUSPICIOUS</option>
                    <option value="PERMITTED">PERMITTED</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Vehicle Classification</label>
                  <select
                    value={newVehicleType}
                    onChange={e => setNewVehicleType(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 focus:border-cyan-500 focus:outline-none"
                  >
                    <option value="Heavy Utility Truck">Heavy Truck</option>
                    <option value="Armored SUV / 4x4">Armored SUV</option>
                    <option value="Cargo Supply Truck">Cargo Truck</option>
                    <option value="Civilian Sedan">Civilian Sedan</option>
                  </select>
                </div>
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
                className="px-4 py-2 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold shadow-lg shadow-cyan-500/20"
              >
                Enroll Vehicle
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}
