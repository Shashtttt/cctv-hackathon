import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import DashboardHeader from './components/DashboardHeader';
import SurveillanceMap from './components/SurveillanceMap';
import ActiveDetections from './components/ActiveDetections';
import DetectionActivity from './components/DetectionActivity';
import CameraHealth from './components/CameraHealth';
import RightAlertsPanel from './components/RightAlertsPanel';
import DashboardKPIs from './components/DashboardKPIs';
import LiveSurveillancePage from './pages/LiveSurveillancePage';
import AlertsEventsPage from './pages/AlertsEventsPage';
import CamerasPage from './pages/CamerasPage';
import AnalyticsPage from './pages/AnalyticsPage';
import SettingsPage from './pages/SettingsPage';
import SnapshotsPage from './pages/SnapshotsPage';
import LoginPage from './pages/LoginPage';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { useWebSocket } from './services/useWebSocket';
import './App.css';

function MainAppLayout() {
  const [activeTab, setActiveTab] = useState('surveillance');
  const { isAuthenticated, loading } = useAuth();
  const { isConnected, latency, lastPing, alerts } = useWebSocket();

  if (loading) {
    return (
      <div className="app-loading-screen font-mono">
        <div className="loading-spinner"></div>
        <div className="loading-text">INITIALIZING DEFENSE NETWORK...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <div className="app-container">
      {/* Left Sidebar */}
      <Sidebar activeTab={activeTab} onSelectTab={setActiveTab} />

      {/* Main Content Area */}
      <main className="main-layout">
        {/* Top Header */}
        <Header onSelectTab={setActiveTab} />

        {/* Inner Content Wrapper */}
        <div className="content-wrapper">
          {activeTab === 'surveillance' && (
            <LiveSurveillancePage onNavigateToAlerts={setActiveTab} />
          )}
          
          {activeTab === 'alerts' && <AlertsEventsPage />}

          {activeTab === 'cameras' && <CamerasPage />}

          {activeTab === 'analytics' && <AnalyticsPage />}

          {activeTab === 'snapshots' && <SnapshotsPage />}

          {activeTab === 'settings' && <SettingsPage />}

          {activeTab === 'dashboard' && (
            <>
              {/* Dashboard Title & Meta Row */}
              <DashboardHeader />

              {/* Top 4 KPI Summary Cards */}
              <DashboardKPIs />

              {/* Upper / Middle 2-Column Dashboard Grid */}
              <div className="dashboard-grid">
                {/* Left Main Column */}
                <div className="left-column">
                  <SurveillanceMap lastPing={lastPing} latency={latency} />
                  <ActiveDetections />
                </div>

                {/* Right Column Feed Panel */}
                <div className="right-column">
                  <RightAlertsPanel alerts={alerts} onNavigateToAlerts={setActiveTab} />
                </div>
              </div>

              {/* Bottom Row Grid */}
              <div className="bottom-row-grid">
                <DetectionActivity />
                <CameraHealth />
              </div>
            </>
          )}

          {activeTab !== 'dashboard' && activeTab !== 'surveillance' && activeTab !== 'alerts' && activeTab !== 'cameras' && activeTab !== 'analytics' && activeTab !== 'snapshots' && activeTab !== 'settings' && (
            <div className="tactical-card font-mono" style={{ padding: '40px', textAlign: 'center' }}>
              Module '{activeTab}' is currently active in L3 Ops Mode.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <MainAppLayout />
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
