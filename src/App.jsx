import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import MainDashboardView from './pages/MainDashboardView';
import LiveSurveillancePage from './pages/LiveSurveillancePage';
import AlertsEventsPage from './pages/AlertsEventsPage';
import CamerasPage from './pages/CamerasPage';
import AnalyticsPage from './pages/AnalyticsPage';
import SettingsPage from './pages/SettingsPage';
import SnapshotsPage from './pages/SnapshotsPage';
import BlockchainPage from './pages/BlockchainPage';
import LoginPage from './pages/LoginPage';
import { RemoteCameraPage } from './pages/RemoteCameraPage';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { LocationProvider } from './context/LocationContext';
import { SentinelCameraProvider } from './context/SentinelCameraContext';
import './App.css';

function MainAppLayout() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="app-loading-screen">
        <div className="loading-spinner"></div>
        <div className="loading-text">INITIALIZING DEFENSE NETWORK...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <div className="app-root-wrapper">
      {/* Full-width Top Header matching reference image */}
      <Header onSelectTab={setActiveTab} />

      {/* Main Body with Sidebar on left and Content on right */}
      <div className="app-body-container">
        {/* Left Sidebar */}
        <Sidebar activeTab={activeTab} onSelectTab={setActiveTab} />

        {/* Main Content Viewport */}
        <main className="main-layout">
          <div className="content-wrapper">
            {(activeTab === 'dashboard' || activeTab === 'surveillance') && (
              <MainDashboardView onNavigateTab={setActiveTab} />
            )}

            {activeTab === 'alerts' && <AlertsEventsPage />}

            {activeTab === 'blockchain' && <BlockchainPage />}

            {activeTab === 'cameras' && <CamerasPage />}

            {activeTab === 'analytics' && <AnalyticsPage />}

            {activeTab === 'snapshots' && <SnapshotsPage />}

            {activeTab === 'settings' && <SettingsPage />}
          </div>
        </main>
      </div>
    </div>
  );
}

function App() {
  const urlParams = new URLSearchParams(window.location.search);
  const isRemoteCam = urlParams.get('mode') === 'remote-cam' || urlParams.get('mode') === 'camera';

  if (isRemoteCam) {
    return <RemoteCameraPage />;
  }

  return (
    <ThemeProvider>
      <LocationProvider>
        <AuthProvider>
          <SentinelCameraProvider>
            <MainAppLayout />
          </SentinelCameraProvider>
        </AuthProvider>
      </LocationProvider>
    </ThemeProvider>
  );
}

export default App;
