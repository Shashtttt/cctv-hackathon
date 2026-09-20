import React, { useState, useEffect, useRef } from 'react';
import {
  Camera,
  Smartphone,
  Wifi,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Compass,
  MapPin,
  Shield,
  Zap,
  Radio,
  Sliders,
  Maximize2,
  Minimize2
} from 'lucide-react';
import axios from 'axios';
import './RemoteCameraPage.css';

export const RemoteCameraPage = () => {
  const params = new URLSearchParams(window.location.search);
  const camId = params.get('cam_id') || 'ip-cam-mobile-01';

  const [isStreaming, setIsStreaming] = useState(false);
  const [facingMode, setFacingMode] = useState('environment');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [telemetry, setTelemetry] = useState({
    fps: 0,
    latencyMs: 0,
    framesSent: 0,
    gps: null,
    detectionsCount: 0,
    alertsCount: 0,
    lastThreat: null,
  });

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const isSendingRef = useRef(false);
  const frameCountRef = useRef(0);
  const fpsTimerRef = useRef(Date.now());
  const geoRef = useRef(null);

  useEffect(() => {
    if ('geolocation' in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          const alt = pos.coords.altitude;
          const latDir = lat >= 0 ? 'N' : 'S';
          const lonDir = lon >= 0 ? 'E' : 'W';
          const formatted = `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lon).toFixed(4)}° ${lonDir}`;
          geoRef.current = {
            latitude: lat,
            longitude: lon,
            altitude: alt,
            formatted,
          };
          setTelemetry((prev) => ({ ...prev, gps: formatted }));
        },
        (err) => console.debug('Geo error:', err),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, []);

  const startStream = async () => {
    setErrorMsg(null);
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }

      const constraints = {
        video: {
          facingMode: facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = mediaStream;
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play();
      }
      setIsStreaming(true);
    } catch (err) {
      console.error('Camera open failed:', err);
      setErrorMsg(
        err.name === 'NotAllowedError'
          ? 'Camera permission denied. Please allow camera access in browser settings.'
          : `Failed to access camera: ${err.message}`
      );
    }
  };

  const stopStream = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsStreaming(false);
  };

  const toggleFacingMode = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    if (isStreaming) {
      startStream();
    }
  }, [facingMode]);

  useEffect(() => {
    if (!isStreaming) return;

    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const sendIntervalMs = 80;

    timerRef.current = setInterval(async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || isSendingRef.current) return;

      isSendingRef.current = true;
      const tStart = Date.now();

      try {
        const scale = 640 / (video.videoWidth || 640);
        canvas.width = 640;
        canvas.height = (video.videoHeight || 480) * scale;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const base64Data = canvas.toDataURL('image/jpeg', 0.68);

        const payload = {
          image: base64Data,
          location: `Mobile Unit (${camId.toUpperCase()})`,
          gps: geoRef.current?.formatted || 'Tactical Sector 04',
        };

        const res = await axios.post(`/api/v1/cameras/${camId}/ingest`, payload, {
          timeout: 2500,
          headers: { 'Content-Type': 'application/json' },
        });

        const roundTrip = Date.now() - tStart;
        frameCountRef.current += 1;

        if (Date.now() - fpsTimerRef.current >= 1000) {
          const actualFps = Math.round(
            (frameCountRef.current * 1000) / (Date.now() - fpsTimerRef.current)
          );
          frameCountRef.current = 0;
          fpsTimerRef.current = Date.now();

          setTelemetry((prev) => ({
            ...prev,
            fps: actualFps,
            latencyMs: roundTrip,
            framesSent: prev.framesSent + 1,
            detectionsCount: res.data?.detections_count || 0,
            alertsCount: res.data?.alerts_count || 0,
            lastThreat: res.data?.alerts_count > 0 ? 'ALERT TRIGGERED' : null,
          }));
        }
      } catch (err) {
        console.debug('Ingest skip/timeout:', err.message);
      } finally {
        isSendingRef.current = false;
      }
    }, sendIntervalMs);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isStreaming, camId]);

  return (
    <div className="remote-camera-container font-mono">
      <div className="remote-viewport">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="remote-video-feed"
        />

        <div className="hud-overlay">
          <div className="hud-corner top-left"></div>
          <div className="hud-corner top-right"></div>
          <div className="hud-corner bottom-left"></div>
          <div className="hud-corner bottom-right"></div>
          <div className="hud-center-cross"></div>

          <div className="hud-top-bar">
            <div className="hud-pill pill-cyan">
              <span className={`status-dot ${isStreaming ? 'pulse-active' : ''}`}></span>
              <span>{isStreaming ? 'TRANSMITTING' : 'STANDBY'}</span>
            </div>
            <div className="hud-pill pill-dark">
              <span>FEED: {camId.toUpperCase()}</span>
            </div>
            <button 
              type="button"
              className="hud-pill pill-dark hud-action-btn"
              onClick={toggleFullscreen}
              title="Toggle Fullscreen"
            >
              {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              <span>{isFullscreen ? 'EXIT' : 'FULLSCREEN'}</span>
            </button>
            <div className="hud-pill pill-green">
              <span>TLS / SECURE</span>
            </div>
          </div>

          <div className="hud-bottom-bar">
            <div className="telemetry-item">
              <MapPin size={13} className="text-cyan" />
              <span>GPS: {telemetry.gps || 'LOCATING...'}</span>
            </div>
            <div className="telemetry-item">
              <Zap size={13} className="text-cyan" />
              <span>{telemetry.fps} FPS ({telemetry.latencyMs}ms)</span>
            </div>
            {telemetry.lastThreat && (
              <div className="telemetry-item text-red pulse-fast">
                <AlertTriangle size={13} />
                <span>AI THREAT DETECTED</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="remote-controls-bar">
        {!isStreaming ? (
          <button className="ctrl-btn btn-launch" onClick={startStream}>
            <Radio size={18} /> START LIVE TRANSMISSION
          </button>
        ) : (
          <>
            <button className="ctrl-btn btn-switch" onClick={toggleFacingMode}>
              <Camera size={18} /> SWITCH LENS ({facingMode === 'environment' ? 'REAR' : 'FRONT'})
            </button>
            <button className="ctrl-btn btn-stop" onClick={stopStream}>
              DISCONNECT
            </button>
          </>
        )}
      </div>

      {errorMsg && (
        <div className="remote-error-card font-sans">
          <AlertTriangle size={18} className="text-red" />
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  );
};
