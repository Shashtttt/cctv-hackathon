import React from 'react';
import LiveFeedsGrid from '../components/dashboard/LiveFeedsGrid';
import RecentAlertsPanel from '../components/dashboard/RecentAlertsPanel';
import DetectionsStats from '../components/dashboard/DetectionsStats';
import EventTrendChart from '../components/dashboard/EventTrendChart';
import QuickActions from '../components/dashboard/QuickActions';
import SystemStatus from '../components/dashboard/SystemStatus';
import CameraMapPanel from '../components/dashboard/CameraMapPanel';
import './MainDashboardView.css';

export default function MainDashboardView({ onNavigateTab }) {
  return (
    <div className="main-dashboard-container">
      {/* Top Row: 6-Camera Live Feeds Matrix (Left) + Recent Alerts (Right) */}
      <div className="dashboard-top-section">
        <div className="top-feeds-column">
          <LiveFeedsGrid onSelectCamera={() => onNavigateTab && onNavigateTab('cameras')} />
        </div>
        <div className="top-alerts-column">
          <RecentAlertsPanel onNavigateToAlerts={onNavigateTab} />
        </div>
      </div>

      {/* Bottom Section: Left Area (Detections + Trends, Actions + Status) + Right Area (Camera Map) */}
      <div className="dashboard-bottom-section">
        {/* Left Combined Operations Area */}
        <div className="bottom-ops-left-area">
          {/* Sub-row 1: Detections Stats & Event Trend */}
          <div className="ops-upper-grid">
            <DetectionsStats />
            <EventTrendChart />
          </div>

          {/* Sub-row 2: Quick Actions & System Status */}
          <div className="ops-lower-grid">
            <QuickActions onSelectAction={(act) => {
              if (act === 'record' || act === 'snapshot') {
                // Quick feedback handled inside
              } else if (act === 'reports' || act === 'settings') {
                onNavigateTab && onNavigateTab(act);
              }
            }} />
            <SystemStatus />
          </div>
        </div>

        {/* Right Area: Camera Tactical Map */}
        <div className="bottom-map-right-area">
          <CameraMapPanel onSelectCamera={() => onNavigateTab && onNavigateTab('cameras')} />
        </div>
      </div>
    </div>
  );
}
