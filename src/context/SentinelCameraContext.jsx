/**
 * IBVAP — Persistent Sentinel Camera Context
 * Keeps hardware/device camera continuously running in the background and identifying
 * threats (YOLOv8 pose, weapons, persons, vehicles, cyber-tamper) across the entire application,
 * unless and until the user explicitly turns it off.
 */

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { getDevicePlatform, enumerateDeviceCameras } from '../utils/deviceDetector';
import { soundController } from '../utils/audioAlert';

const SentinelCameraContext = createContext(null);

export const SentinelCameraProvider = ({ children }) => {
  // Check if user previously toggled sentinel off; defaults to true (always running in background)
  const [isSentinelActive, setIsSentinelActive] = useState(() => {
    return localStorage.getItem('ibvap_sentinel_active') !== 'false';
  });

  const [activeStream, setActiveStream] = useState(null);
  const [availableCameras, setAvailableCameras] = useState([]);
  const [activeDeviceId, setActiveDeviceId] = useState(null);
  const [activeCameraLabel, setActiveCameraLabel] = useState('Integrated HD Camera');
  const [latestAnnotatedFrame, setLatestAnnotatedFrame] = useState(null);
  const [liveDetections, setLiveDetections] = useState([]);

  const [telemetry, setTelemetry] = useState({
    fps: 0,
    latencyMs: 0,
    personsCount: 0,
    weaponsCount: 0,
    vehiclesCount: 0,
    unusualCount: 0,
    alertsCount: 0,
    lastIdentified: 'Scanning perimeter...',
    status: 'INITIALIZING',
  });

  // Persistent background DOM refs
  const videoRef = useRef(null);
  const offscreenCanvasRef = useRef(null);
  const isRunningRef = useRef(false);
  const isIngestingRef = useRef(false);
  const frameCountRef = useRef(0);
  const fpsTimerRef = useRef(Date.now());
  const lastWeaponSnapshotTimeRef = useRef(0);
  const streamRef = useRef(null);

  // Enumerate hardware cameras on boot
  useEffect(() => {
    const detectCameras = async () => {
      try {
        const cams = await enumerateDeviceCameras();
        setAvailableCameras(cams);
        if (cams.length > 0) {
          const p = getDevicePlatform();
          const preferred = p.isMobile ? (cams.find(c => c.isBack) || cams[0]) : cams[0];
          setActiveDeviceId(preferred.deviceId);
          setActiveCameraLabel(preferred.label || 'Integrated HD Camera');
        }
      } catch (err) {
        console.debug('Camera detection notice:', err);
      }
    };

    detectCameras();

    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', detectCameras);
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', detectCameras);
      };
    }
  }, []);

  // Frame processing and AI ingestion loop
  const processFrame = useCallback(async () => {
    if (!isRunningRef.current) return;

    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0) {
      // Retry in next animation frame
      if (isRunningRef.current) {
        requestAnimationFrame(() => setTimeout(processFrame, 60));
      }
      return;
    }

    if (!isIngestingRef.current) {
      isIngestingRef.current = true;

      if (!offscreenCanvasRef.current) {
        offscreenCanvasRef.current = document.createElement('canvas');
      }
      const canvas = offscreenCanvasRef.current;
      const vw = video.videoWidth || 1280;
      const vh = video.videoHeight || 720;

      // Downsample for high-performance edge streaming (480px wide for ~3x faster CPU inference)
      const scale = Math.min(1.0, 480 / Math.max(vw, 1));
      const targetW = Math.round(vw * scale);
      const targetH = Math.round(vh * scale);
      canvas.width = targetW;
      canvas.height = targetH;

      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.drawImage(video, 0, 0, targetW, targetH);

      const b64 = canvas.toDataURL('image/jpeg', 0.65);
      const t0 = performance.now();

      try {
        const res = await axios.post(
          '/api/v1/cameras/cam-01/ingest',
          {
            image: b64,
            location: 'Border Sector-4 HQ',
            gps: '34.1524° N, 74.8211° E',
          },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000,
          }
        );

        const dt = Math.round(performance.now() - t0);
        frameCountRef.current += 1;

        const now = Date.now();
        let currentFps = telemetry.fps;
        if (now - fpsTimerRef.current >= 1000) {
          currentFps = Math.round((frameCountRef.current * 1000) / (now - fpsTimerRef.current));
          frameCountRef.current = 0;
          fpsTimerRef.current = now;
        }

        if (res.data && res.data.success) {
          const dets = res.data.detections || [];
          const persons = dets.filter(d => d.class_id === 0 || d.class_name === 'person').length;
          const vehicles = dets.filter(d => ['car', 'truck', 'bus', 'motorcycle'].includes(d.class_name)).length;
          const weapons = dets.filter(d => d.is_weapon || d.held_item_type === 'WEAPON').length;
          const unusual = dets.filter(d => d.is_unusual).length;

          // Sound alarm if weapon detected
          if (weapons > 0) {
            soundController.triggerWeaponSiren(2000);
          }

          // Build human-readable identification summary
          let identifiedSummary = 'Perimeter Secure';
          if (weapons > 0) {
            identifiedSummary = `⚠️ ARMED THREAT DETECTED (${weapons})`;
          } else if (persons > 0) {
            const poses = dets
              .filter(d => d.pose_label)
              .map(d => d.pose_label)
              .join(', ');
            identifiedSummary = `${persons} Person(s) ${poses ? `[${poses}]` : ''}`;
          } else if (vehicles > 0) {
            identifiedSummary = `${vehicles} Vehicle(s) in sector`;
          }

          setLiveDetections(dets);
          if (res.data.annotated_frame) {
            setLatestAnnotatedFrame(res.data.annotated_frame);
          }

          setTelemetry({
            fps: currentFps,
            latencyMs: dt,
            personsCount: persons,
            weaponsCount: weapons,
            vehiclesCount: vehicles,
            unusualCount: unusual,
            alertsCount: res.data.alerts_count || 0,
            lastIdentified: identifiedSummary,
            status: 'ONLINE ⚡',
          });
        }
      } catch (err) {
        // Soft catch to prevent break in continuous loop
        setTelemetry(prev => ({ ...prev, status: 'INGESTING...' }));
      } finally {
        isIngestingRef.current = false;
        if (isRunningRef.current) {
          setTimeout(processFrame, 120);
        }
      }
    } else if (isRunningRef.current) {
      setTimeout(processFrame, 120);
    }
  }, [telemetry.fps]);

  // Start Hardware Camera Stream
  const startCamera = useCallback(async (deviceId = null) => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }

      const constraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      setActiveStream(stream);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(e => console.debug('Video play caught:', e));
      }

      isRunningRef.current = true;
      setIsSentinelActive(true);
      localStorage.setItem('ibvap_sentinel_active', 'true');

      // Begin continuous background AI processing loop
      setTimeout(processFrame, 300);
      console.log('🛡️ IBVAP Sentinel Camera started in background.');
    } catch (err) {
      console.warn('Could not start persistent camera stream:', err.message);
      setTelemetry(prev => ({ ...prev, status: 'ERROR: ' + err.message }));
    }
  }, [processFrame]);

  // Stop Hardware Camera Stream (Explicit user action)
  const stopCamera = useCallback(() => {
    isRunningRef.current = false;
    isIngestingRef.current = false;
    setIsSentinelActive(false);
    localStorage.setItem('ibvap_sentinel_active', 'false');

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setActiveStream(null);

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setTelemetry(prev => ({
      ...prev,
      fps: 0,
      status: 'STANDBY (OFF)',
      lastIdentified: 'Sentinel paused by operator',
    }));
    console.log('⏸️ IBVAP Sentinel Camera stopped by operator.');
  }, []);

  const toggleSentinel = useCallback(() => {
    if (isSentinelActive) {
      stopCamera();
    } else {
      startCamera(activeDeviceId);
    }
  }, [isSentinelActive, stopCamera, startCamera, activeDeviceId]);

  // Boot persistent camera on initial mount if sentinel is active
  useEffect(() => {
    if (isSentinelActive) {
      startCamera(activeDeviceId);
    }

    return () => {
      // Only tear down on whole app unmount
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []); // Run once on application boot

  return (
    <SentinelCameraContext.Provider
      value={{
        isSentinelActive,
        startCamera,
        stopCamera,
        toggleSentinel,
        activeStream,
        activeCameraLabel,
        activeDeviceId,
        availableCameras,
        latestAnnotatedFrame,
        liveDetections,
        telemetry,
        persistentVideoRef: videoRef,
      }}
    >
      {/* Persistent Hidden Video Element at App Root: Keeps streaming across all tab changes */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        style={{
          position: 'fixed',
          top: -9999,
          left: -9999,
          width: 320,
          height: 240,
          opacity: 0,
          pointerEvents: 'none',
          zIndex: -1,
        }}
      />
      {children}
    </SentinelCameraContext.Provider>
  );
};

export const useSentinelCamera = () => {
  const ctx = useContext(SentinelCameraContext);
  if (!ctx) {
    throw new Error('useSentinelCamera must be used within a SentinelCameraProvider');
  }
  return ctx;
};
