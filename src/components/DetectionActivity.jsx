import React from 'react';
import { TrendingUp } from 'lucide-react';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip,
  ReferenceDot
} from 'recharts';
import './DetectionActivity.css';

const chartData = [
  { time: '22:00', persons: 4, vehicles: 2 },
  { time: '23:00', persons: 5, vehicles: 2 },
  { time: '00:00', persons: 7, vehicles: 3 },
  { time: '01:00', persons: 8, vehicles: 4 },
  { time: '02:00', persons: 11, vehicles: 4 },
  { time: '03:00 (NOW)', persons: 17, vehicles: 7 }
];

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="custom-chart-tooltip font-mono">
        <div className="tooltip-header">{label}</div>
        <div className="tooltip-item cyan-text">
          <span>Persons:</span> <strong>{payload[0].value}</strong>
        </div>
        {payload[1] && (
          <div className="tooltip-item white-text">
            <span>Vehicles:</span> <strong>{payload[1].value}</strong>
          </div>
        )}
      </div>
    );
  }
  return null;
};

const DetectionActivity = () => {
  return (
    <div className="tactical-card detection-activity-card">
      {/* Card Top Header */}
      <div className="card-header">
        <div className="card-title-group">
          <div className="card-title-row">
            <TrendingUp size={18} className="card-title-icon" />
            <h3 className="card-title">Detection Activity</h3>
          </div>
          <span className="card-subtitle">Automated object classification across last 6 hours</span>
        </div>

        {/* Legend */}
        <div className="chart-legend">
          <div className="legend-item">
            <span className="legend-box cyan-box"></span>
            <span>Persons Detected</span>
          </div>
          <div className="legend-item">
            <span className="legend-box white-box"></span>
            <span>Vehicles Detected</span>
          </div>
        </div>
      </div>

      {/* Chart Canvas Area */}
      <div className="chart-container-wrapper">
        {/* Callout Peak Badge matching mockup design */}
        <div className="peak-callout-badge">
          <span>PEAK 17 PERS</span>
        </div>

        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={chartData} margin={{ top: 25, right: 20, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="colorPersons" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#00f2fe" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#00f2fe" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorVehicles" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ffffff" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#ffffff" stopOpacity={0} />
              </linearGradient>
            </defs>

            <XAxis 
              dataKey="time" 
              tick={{ fill: '#64748b', fontSize: 11, fontFamily: 'JetBrains Mono' }} 
              axisLine={{ stroke: '#1e293b' }}
              tickLine={false}
            />
            <YAxis hide domain={[0, 20]} />
            <Tooltip content={<CustomTooltip />} />

            <Area 
              type="monotone" 
              dataKey="persons" 
              stroke="#00f2fe" 
              strokeWidth={2.5} 
              fillOpacity={1} 
              fill="url(#colorPersons)" 
              dot={{ r: 3, fill: '#00f2fe', stroke: '#0d121f', strokeWidth: 2 }}
              activeDot={{ r: 6, fill: '#ff3b3b', stroke: '#ffffff', strokeWidth: 2 }}
            />

            <Area 
              type="monotone" 
              dataKey="vehicles" 
              stroke="#cbd5e1" 
              strokeWidth={2} 
              fillOpacity={1} 
              fill="url(#colorVehicles)" 
              dot={{ r: 3, fill: '#cbd5e1', stroke: '#0d121f', strokeWidth: 2 }}
            />

            <ReferenceDot 
              x="03:00 (NOW)" 
              y={17} 
              r={6} 
              fill="#ff3b3b" 
              stroke="#ffffff" 
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default DetectionActivity;
