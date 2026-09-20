import React, { useState, useEffect } from 'react';
import { User, Car, Smile, CreditCard } from 'lucide-react';
import { fetchAlerts } from '../../services/apiService';
import './DetectionsStats.css';

export default function DetectionsStats() {
  const [stats, setStats] = useState({
    human: 0,
    vehicles: 0,
    faces: 0,
    anpr: 0
  });

  useEffect(() => {
    let isMounted = true;

    const queryRealDetections = async () => {
      try {
        const res = await fetchAlerts({ limit: 100 });
        if (!isMounted || !res) return;

        const items = res.items || (Array.isArray(res) ? res : []);

        let humans = 0;
        let vehicles = 0;
        let faces = 0;
        let anpr = 0;

        items.forEach((alert) => {
          const desc = (alert.description || '').toLowerCase();
          const title = (alert.title || '').toLowerCase();
          const cat = (alert.category || '').toUpperCase();

          if (cat.includes('INTRUSION') || cat.includes('LOITERING') || cat.includes('HUMAN') || cat.includes('CARRIER') || cat.includes('POSTURE') || desc.includes('person')) {
            humans += 1;
          }
          if (cat.includes('VEHICLE') || desc.includes('vehicle') || desc.includes('truck') || desc.includes('car')) {
            vehicles += 1;
          }
          if (cat.includes('FACE') || alert.frs_match_name || desc.includes('face')) {
            faces += 1;
          }
          if (cat.includes('ANPR') || alert.plate_text || desc.includes('plate')) {
            anpr += 1;
          }
        });

        setStats({
          human: humans,
          vehicles: vehicles,
          faces: faces,
          anpr: anpr
        });
      } catch (err) {
        // Leave at 0 if no real events
      }
    };

    queryRealDetections();
    const timer = setInterval(queryRealDetections, 4000);
    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, []);

  const STATS_DATA = [
    {
      id: 'human',
      label: 'Human',
      value: stats.human,
      change: stats.human > 0 ? `↑ ${stats.human} found` : 'All Clear',
      color: 'red',
      icon: User
    },
    {
      id: 'vehicles',
      label: 'Vehicles',
      value: stats.vehicles,
      change: stats.vehicles > 0 ? `↑ ${stats.vehicles} found` : 'All Clear',
      color: 'blue',
      icon: Car
    },
    {
      id: 'faces',
      label: 'Faces',
      value: stats.faces,
      change: stats.faces > 0 ? `↑ ${stats.faces} found` : 'All Clear',
      color: 'purple',
      icon: Smile
    },
    {
      id: 'anpr',
      label: 'ANPR',
      value: stats.anpr,
      change: stats.anpr > 0 ? `↑ ${stats.anpr} found` : 'All Clear',
      color: 'gold',
      icon: CreditCard
    }
  ];

  return (
    <div className="detections-stats-card">
      <div className="stats-header-row">
        <h3 className="detections-card-title">Detections (Verified Found)</h3>
        <span className="stats-live-tag">● REAL-TIME AI</span>
      </div>

      <div className="stats-cards-row">
        {STATS_DATA.map((item) => {
          const IconComponent = item.icon;
          return (
            <div key={item.id} className="stat-tile">
              <div className={`stat-icon-circle icon-circle-${item.color}`}>
                <IconComponent size={16} />
              </div>
              <span className="stat-label">{item.label}</span>
              <div className="stat-numbers">
                <span className="stat-value">{item.value}</span>
                <span className={`stat-change ${item.value > 0 ? 'text-red' : 'text-green'}`}>
                  {item.change}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
