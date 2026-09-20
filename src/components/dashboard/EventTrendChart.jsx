import React, { useState, useEffect } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from 'recharts';
import { fetchAlerts } from '../../services/apiService';
import './EventTrendChart.css';

const DEFAULT_TIME_SLOTS = [
  { time: '00:00', human: 0, vehicle: 0, face: 0, anpr: 0 },
  { time: '04:00', human: 0, vehicle: 0, face: 0, anpr: 0 },
  { time: '08:00', human: 0, vehicle: 0, face: 0, anpr: 0 },
  { time: '12:00', human: 0, vehicle: 0, face: 0, anpr: 0 },
  { time: '16:00', human: 0, vehicle: 0, face: 0, anpr: 0 },
  { time: '20:00', human: 0, vehicle: 0, face: 0, anpr: 0 },
  { time: '24:00', human: 0, vehicle: 0, face: 0, anpr: 0 }
];

export default function EventTrendChart() {
  const [chartData, setChartData] = useState(DEFAULT_TIME_SLOTS);
  const [totalEventsFound, setTotalEventsFound] = useState(0);

  useEffect(() => {
    let isMounted = true;

    const queryAlertTrends = async () => {
      try {
        const res = await fetchAlerts({ limit: 100 });
        if (!isMounted || !res) return;

        const items = res.items || (Array.isArray(res) ? res : []);
        setTotalEventsFound(items.length);

        if (items.length === 0) {
          setChartData(DEFAULT_TIME_SLOTS);
          return;
        }

        // Deep copy slots
        const slots = [
          { time: '00:00', human: 0, vehicle: 0, face: 0, anpr: 0 },
          { time: '04:00', human: 0, vehicle: 0, face: 0, anpr: 0 },
          { time: '08:00', human: 0, vehicle: 0, face: 0, anpr: 0 },
          { time: '12:00', human: 0, vehicle: 0, face: 0, anpr: 0 },
          { time: '16:00', human: 0, vehicle: 0, face: 0, anpr: 0 },
          { time: '20:00', human: 0, vehicle: 0, face: 0, anpr: 0 },
          { time: '24:00', human: 0, vehicle: 0, face: 0, anpr: 0 }
        ];

        items.forEach((alert) => {
          const dt = alert.timestamp ? new Date(alert.timestamp) : new Date();
          const hour = dt.getHours();

          let slotIndex = 0;
          if (hour >= 22 || hour < 2) slotIndex = 0;
          else if (hour >= 2 && hour < 6) slotIndex = 1;
          else if (hour >= 6 && hour < 10) slotIndex = 2;
          else if (hour >= 10 && hour < 14) slotIndex = 3;
          else if (hour >= 14 && hour < 18) slotIndex = 4;
          else if (hour >= 18 && hour < 22) slotIndex = 5;
          else slotIndex = 6;

          const desc = (alert.description || '').toLowerCase();
          const cat = (alert.category || '').toUpperCase();

          if (cat.includes('INTRUSION') || cat.includes('LOITERING') || cat.includes('HUMAN') || cat.includes('CARRIER') || cat.includes('POSTURE') || desc.includes('person')) {
            slots[slotIndex].human += 1;
          }
          if (cat.includes('VEHICLE') || desc.includes('vehicle') || desc.includes('truck') || desc.includes('car')) {
            slots[slotIndex].vehicle += 1;
          }
          if (cat.includes('FACE') || alert.frs_match_name || desc.includes('face')) {
            slots[slotIndex].face += 1;
          }
          if (cat.includes('ANPR') || alert.plate_text || desc.includes('plate')) {
            slots[slotIndex].anpr += 1;
          }
        });

        setChartData(slots);
      } catch (err) {
        // Keep baseline
      }
    };

    queryAlertTrends();
    const timer = setInterval(queryAlertTrends, 5000);
    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, []);

  // Compute max domain dynamically based on verified events found
  const maxVal = Math.max(
    ...chartData.map((d) => Math.max(d.human, d.vehicle, d.face, d.anpr)),
    10
  );

  return (
    <div className="event-trend-card">
      {/* Header with Title, Status Tag and Series Legends */}
      <div className="trend-header">
        <div className="trend-title-group">
          <h3 className="trend-title">Event Trend</h3>
          <span className="trend-event-counter">
            {totalEventsFound > 0 ? `(${totalEventsFound} Events Verified)` : '(0 Events Found)'}
          </span>
        </div>

        <div className="trend-legend-row">
          <div className="legend-pill">
            <span className="legend-dot dot-human"></span>
            <span className="legend-name">Human</span>
          </div>
          <div className="legend-pill">
            <span className="legend-dot dot-vehicle"></span>
            <span className="legend-name">Vehicle</span>
          </div>
          <div className="legend-pill">
            <span className="legend-dot dot-face"></span>
            <span className="legend-name">Face</span>
          </div>
          <div className="legend-pill">
            <span className="legend-dot dot-anpr"></span>
            <span className="legend-name">ANPR</span>
          </div>
        </div>
      </div>

      {/* Chart Canvas: Only displays real data points when events are found */}
      <div className="trend-chart-container">
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1c2742" vertical={false} />
            <XAxis
              dataKey="time"
              stroke="#64748b"
              fontSize={10}
              tickLine={false}
              axisLine={{ stroke: '#1c2742' }}
            />
            <YAxis
              stroke="#64748b"
              fontSize={10}
              domain={[0, Math.ceil(maxVal * 1.2)]}
              tickLine={false}
              axisLine={{ stroke: '#1c2742' }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#0f172a',
                borderColor: '#1e293b',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '11px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
              }}
            />
            <Line
              type="monotone"
              dataKey="human"
              stroke="#ef4444"
              strokeWidth={2}
              dot={{ r: 3, fill: '#ef4444', strokeWidth: 1 }}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="vehicle"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ r: 3, fill: '#3b82f6', strokeWidth: 1 }}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="face"
              stroke="#a855f7"
              strokeWidth={2}
              dot={{ r: 3, fill: '#a855f7', strokeWidth: 1 }}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="anpr"
              stroke="#f59e0b"
              strokeWidth={2}
              dot={{ r: 3, fill: '#f59e0b', strokeWidth: 1 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
