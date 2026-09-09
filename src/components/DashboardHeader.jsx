import React, { useState, useEffect } from 'react';
import { Radio, Clock, Snowflake } from 'lucide-react';
import './DashboardHeader.css';

const DashboardHeader = () => {
  const [dateTimeStr, setDateTimeStr] = useState('08 Sep 2026 • 16:18:44 UTC');

  useEffect(() => {
    const updateDateTime = () => {
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
      const hours = String(now.getUTCHours()).padStart(2, '0');
      const minutes = String(now.getUTCMinutes()).padStart(2, '0');
      const seconds = String(now.getUTCSeconds()).padStart(2, '0');
      setDateTimeStr(`${dateStr} • ${hours}:${minutes}:${seconds} UTC`);
    };

    updateDateTime();
    const interval = setInterval(updateDateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="dashboard-title-row">
      <div className="title-text-group">
        <h2 className="dashboard-main-title">Command Dashboard</h2>
        <p className="dashboard-sub-title">
          Intelligent Border Video Analytics Platform <span className="subtitle-sep">•</span> Sector 4 Surveillance Zone
        </p>
      </div>

      <div className="dashboard-pills-row">
        <span className="pill-badge pill-cyan">
          <Radio size={12} /> SEC-4 LIVELINK
        </span>

        <span className="pill-badge pill-green">
          <span className="status-dot dot-green pulse-ring"></span> System Status: Online
        </span>

        <span className="pill-badge pill-muted">
          <Clock size={12} /> {dateTimeStr}
        </span>

        <span className="pill-badge pill-purple">
          <Snowflake size={12} /> DEFENSE NETWORK NODE #09
        </span>
      </div>
    </div>
  );
};

export default DashboardHeader;
