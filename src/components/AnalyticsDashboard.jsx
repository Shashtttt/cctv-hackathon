import React from 'react';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Shield, TrendingUp, Users, Car, Eye, AlertTriangle } from 'lucide-react';

export default function AnalyticsDashboard({ incidents }) {
  const incidentHourlyData = [
    { hour: '00:00', intrusions: 12, vehicleBreaches: 4 },
    { hour: '04:00', intrusions: 19, vehicleBreaches: 6 },
    { hour: '08:00', intrusions: 5, vehicleBreaches: 12 },
    { hour: '12:00', intrusions: 8, vehicleBreaches: 15 },
    { hour: '16:00', intrusions: 14, vehicleBreaches: 9 },
    { hour: '20:00', intrusions: 24, vehicleBreaches: 11 },
  ];

  const threatCategoryData = [
    { name: 'Virtual Fence Breaches', value: 45, color: '#ef4444' },
    { name: 'ANPR Blacklisted Vehicle', value: 25, color: '#f59e0b' },
    { name: 'FRS Suspect Match', value: 18, color: '#06b6d4' },
    { name: 'Night Thermal Motion', value: 12, color: '#10b981' },
  ];

  const bopDensityData = [
    { bop: 'BOP-01', count: 34 },
    { bop: 'BOP-04 (IR)', count: 58 },
    { bop: 'CHK-02 (ANPR)', count: 28 },
    { bop: 'BOP-12 (FRS)', count: 19 },
  ];

  return (
    <div className="space-y-6">
      
      {/* Top Telemetry KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Incidents Logged', value: '139', change: '+14% vs yesterday', icon: Shield, color: 'text-red-400', bg: 'bg-red-500/10' },
          { label: 'Perimeter Intrusions', value: '78', change: 'Peak at 22:00 IST', icon: Eye, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
          { label: 'ANPR Blacklist Hits', value: '29', change: '98.4% OCR Acc.', icon: Car, color: 'text-amber-400', bg: 'bg-amber-500/10' },
          { label: 'FRS Suspect Matches', value: '32', change: 'SFace Similarity > 0.40', icon: Users, color: 'text-cyan-400', bg: 'bg-cyan-500/10' }
        ].map((card, idx) => {
          const Icon = card.icon;
          return (
            <div key={idx} className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-lg flex items-center justify-between">
              <div>
                <div className="text-xs font-mono text-slate-400">{card.label}</div>
                <div className="text-2xl font-black text-slate-100 mt-1 font-mono">{card.value}</div>
                <div className="text-[10px] text-slate-400 mt-0.5 font-mono">{card.change}</div>
              </div>
              <div className={`p-3 rounded-xl border border-slate-800 ${card.bg} ${card.color}`}>
                <Icon className="w-6 h-6" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Analytics Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Incident Frequency Trend */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg space-y-4">
          <h3 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>24-Hour Threat Frequency Trend</span>
            <span className="text-emerald-400">Real-Time Data</span>
          </h3>

          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={incidentHourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="hour" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip contentStyle={{ backgroundColor: '#090c15', borderColor: '#334155', borderRadius: '8px' }} />
                <Line type="monotone" dataKey="intrusions" stroke="#ef4444" strokeWidth={3} dot={{ r: 4 }} name="Human Intrusions" />
                <Line type="monotone" dataKey="vehicleBreaches" stroke="#06b6d4" strokeWidth={2} dot={{ r: 4 }} name="Vehicle Breaches" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Threat Category Breakdown */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg space-y-4">
          <h3 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">
            Threat Category Distribution
          </h3>

          <div className="h-64 flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={threatCategoryData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {threatCategoryData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#090c15', borderColor: '#334155', borderRadius: '8px' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

    </div>
  );
}
