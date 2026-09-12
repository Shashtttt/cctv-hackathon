import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { getDevicePlatform, enumerateDeviceCameras } from '../utils/deviceDetector';
import { soundController } from '../utils/audioAlert';

export const useWebcamBridge = (cameraId = 'cam-01', targetFps = 25, externalVideoRef = null) => {
  const [isWebcamActive, setIsWebcamActive] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [latestAnnotatedFrame, setLatestAnnotatedFrame] = useState(null);
  const [liveDetections, setLiveDetections] = useState([]);
  
  // Dynamic Device & Physical Hardware State
  const [deviceInfo, setDeviceInfo] = useState(() => getDevicePlatform());
  const [availableCameras, setAvailableCameras] = useState([]);
  const [activeDeviceId, setActiveDeviceId] = useState(null);
  const [facingMode, setFacingMode] = useState(() => (getDevicePlatform().isMobile ? 'environment' : 'user'));
  const [activeCameraLabel, setActiveCameraLabel] = useState(
    getDevicePlatform().isMobile ? 'Mobile Rear Camera' : 'Integrated HD Camera'
  );

  const [geoPosition, setGeoPosition] = useState(null);
  const geoWatchIdRef = useRef(null);
  const geoPositionRef = useRef(null);

  const [telemetry, setTelemetry] = useState({
    detectionsCount: 0,
    unusualCount: 0,
    weaponsCount: 0,
    armedCount: 0,
    holdingCount: 0,
    casualCount: 0,
    phoneCount: 0,
    objectsCount: 0,
    alertsCount: 0,
    detections: [],
    actualFps: 0,
    lastLatencyMs: 0,
    deviceMode: 'MPS GPU Accelerated',
    deviceType: getDevicePlatform().deviceType,
    platformName: getDevicePlatform().platformName,
    location: 'Sector 4 - High Altitude Post',
    gpsCoords: '34.1524° N, 74.8211° E',
  });
  const [webcamError, setWebcamError] = useState(null);

  const internalVideoRef = useRef(null);
  const offscreenCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const isRunningRef = useRef(false);
  const isIngestingRef = useRef(false);
  const frameCountRef = useRef(0);
  const fpsTimerRef = useRef(Date.now());

  // Enumerate hardware cameras on mount
  useEffect(() => {
    const detect = async () => {
      const p = getDevicePlatform();
      setDeviceInfo(p);
      const cams = await enumerateDeviceCameras();
      setAvailableCameras(cams);
      if (cams.length > 0) {
        // Pick optimal default camera
        const preferred = p.isMobile ? cams.find((c) => c.isBack) || cams[0] : cams[0];
        setActiveDeviceId(preferred.deviceId);
        setActiveCameraLabel(preferred.label);
      }
    };
    detect();

    // Listen for device connects/disconnects (e.g. plugging in a USB camera)
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', detect);
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', detect);
      };
    }
  }, []);

  const getVideoElement = () => {
    if (externalVideoRef && externalVideoRef.current) {
      return externalVideoRef.current;
    }
    return internalVideoRef.current;
  };

  const startGeolocation = useCallback(() => {
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      try {
        const watchId = navigator.geolocation.watchPosition(
          (pos) => {
            const { latitude, longitude, altitude, accuracy, speed, heading } = pos.coords;
            const latStr = `${Math.abs(latitude).toFixed(4)}° ${latitude >= 0 ? 'N' : 'S'}`;
            const lonStr = `${Math.abs(longitude).toFixed(4)}° ${longitude >= 0 ? 'E' : 'W'}`;
            const formatted = `${latStr}, ${lonStr}`;
            const data = {
              latitude,
              longitude,
              altitude: altitude ? Math.round(altitude) : null,
              accuracy: Math.round(accuracy || 0),
              speed: speed ? Math.round(speed * 3.6) : 0,
              heading: heading ? Math.round(heading) : null,
              formatted,
              timestamp: pos.timestamp,
            };
            geoPositionRef.current = data;
            setGeoPosition(data);
            setTelemetry((prev) => ({
              ...prev,
              location: `Device Position (${formatted})`,
              gpsCoords: formatted,
            }));
          },
          (err) => {
            console.debug('Geolocation notice:', err?.message);
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
        );
        geoWatchIdRef.current = watchId;
      } catch (e) {
        console.debug('Geolocation watch failed:', e);
      }
    }
  }, []);

  const stopGeolocation = useCallback(() => {
    if (geoWatchIdRef.current !== null && typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(geoWatchIdRef.current);
      geoWatchIdRef.current = null;
    }
  }, []);

  const stopWebcam = useCallback(() => {
    isRunningRef.current = false;
    isIngestingRef.current = false;
    setIsWebcamActive(false);
    stopGeolocation();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setLocalStream(null);
    const video = getVideoElement();
    if (video) {
      video.srcObject = null;
    }
  }, [externalVideoRef, stopGeolocation]);

  const sendFrame = useCallback(async () => {
    if (!isRunningRef.current) return;

    const video = getVideoElement();
    if (!video || video.readyState < 2 || video.videoWidth === 0) {
      if (isRunningRef.current) {
        requestAnimationFrame(() => setTimeout(sendFrame, 1000 / targetFps));
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
      // High-definition frame ingestion (preserving aspect ratio, max 960 width for sharpness)
      const scale = Math.min(1.0, 960 / Math.max(vw, 1));
      const targetW = Math.round(vw * scale);
      const targetH = Math.round(vh * scale);
      canvas.width = targetW;
      canvas.height = targetH;

      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.drawImage(video, 0, 0, targetW, targetH);

      const b64 = canvas.toDataURL('image/jpeg', 0.82);
      const t0 = performance.now();

      axios.post(`/api/v1/cameras/${cameraId}/ingest`, {
        image: b64,
        gps: geoPositionRef.current || null,
        location: geoPositionRef.current ? geoPositionRef.current.formatted : null,
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 3000,
      }).then((res) => {
        const dt = performance.now() - t0;
        frameCountRef.current += 1;

        const now = Date.now();
        if (now - fpsTimerRef.current >= 1000) {
          const fps = Math.round((frameCountRef.current * 1000) / (now - fpsTimerRef.current));
          frameCountRef.current = 0;
          fpsTimerRef.current = now;
          setTelemetry((prev) => ({ ...prev, actualFps: fps }));
        }

        if (res.data && res.data.success) {
          const dets = res.data.detections || [];
          const isWeaponItem = (d) => {
            const name = (d.class_name || '').toLowerCase();
            const held = (d.held_item || '').toLowerCase();
            const unusual = (d.unusual_item || '').toLowerCase();
            const isNamed = ['knife', 'gun', 'pistol', 'rifle', 'shotgun', 'firearm', 'weapon', 'dagger', 'blade', 'machete', 'sword'].some(
              (w) => name.includes(w) || held.includes(w) || unusual.includes(w)
            );
            const isArmed = d.is_holding && d.held_item_type === 'WEAPON';
            return Boolean(d.is_weapon || isNamed || isArmed);
          };

          const weaponsCount = dets.filter(isWeaponItem).length;
          const armedCount = dets.filter((d) => d.is_holding && d.held_item_type === 'WEAPON').length;
          const holdingCount = dets.filter((d) => d.is_holding).length;
          const casualCount = dets.filter((d) => !isWeaponItem(d) && d.class_id !== 0).length;
          const phoneCount = dets.filter((d) => (d.class_name || '').toLowerCase().includes('phone') || (d.held_item || '').toLowerCase().includes('phone')).length;
          const objectsCount = dets.filter((d) => d.class_id !== 0 && !isWeaponItem(d)).length;

          // PLAY SIREN ONLY WHEN WEAPON DETECTED (knife, pistol, gun, firearm, weapon, etc.)
          if (weaponsCount > 0 || armedCount > 0) {
            soundController.triggerWeaponSiren(2000);
          }

          setLiveDetections(dets);
          if (res.data.annotated_frame) {
            setLatestAnnotatedFrame(res.data.annotated_frame);
          }
          setTelemetry((prev) => ({
            ...prev,
            detectionsCount: dets.length,
            unusualCount: weaponsCount,
            weaponsCount,
            armedCount,
            holdingCount,
            casualCount,
            phoneCount,
            objectsCount,
            alertsCount: res.data.alerts_count || 0,
            detections: dets,
            lastLatencyMs: Math.round(dt),
            deviceType: deviceInfo.deviceType,
            platformName: deviceInfo.platformName,
          }));
        }
      }).catch(() => {
        // Continue on single-frame drop
      }).finally(() => {
        isIngestingRef.current = false;
      });
    }

    if (isRunningRef.current) {
      setTimeout(sendFrame, Math.max(15, 1000 / targetFps));
    }
  }, [cameraId, targetFps, externalVideoRef, deviceInfo]);

  const startWebcam = useCallback(async (preferredDeviceId = null, preferredFacingMode = null) => {
    setWebcamError(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (window.location.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
          throw new Error(
            `Mobile browser security requires HTTPS to stream camera over LAN. Switch to https://${window.location.host} to enable mobile camera.`
          );
        }
        throw new Error("Camera API not supported or disabled in this browser.");
      }

      // Stop existing stream if changing cameras
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }

      const targetDevice = preferredDeviceId || activeDeviceId;
      const targetFacing = preferredFacingMode || facingMode;

      // Video constraints: match exact deviceId if available, fallback to facingMode
      const videoConstraints = {
        width: { ideal: 1280, min: 640 },
        height: { ideal: 720, min: 360 },
        frameRate: { ideal: 30, max: 60 },
      };

      if (targetDevice) {
        videoConstraints.deviceId = { exact: targetDevice };
      } else if (deviceInfo.isMobile) {
        videoConstraints.facingMode = { ideal: targetFacing };
      } else {
        videoConstraints.facingMode = 'user';
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false,
      });

      streamRef.current = stream;
      setLocalStream(stream);

      // Track active camera label
      const activeTrack = stream.getVideoTracks()[0];
      if (activeTrack) {
        const label = activeTrack.label;
        if (label) {
          setActiveCameraLabel(label);
        }
        const settings = activeTrack.getSettings ? activeTrack.getSettings() : {};
        if (settings.deviceId) {
          setActiveDeviceId(settings.deviceId);
        }
        if (settings.facingMode) {
          setFacingMode(settings.facingMode);
        }
      }

      // Re-enumerate cameras now that permission has been granted (labels are populated)
      const refreshedCams = await enumerateDeviceCameras();
      if (refreshedCams.length > 0) {
        setAvailableCameras(refreshedCams);
      }

      if (!internalVideoRef.current) {
        const v = document.createElement('video');
        v.autoplay = true;
        v.playsInline = true;
        v.muted = true;
        internalVideoRef.current = v;
      }

      internalVideoRef.current.srcObject = stream;
      await internalVideoRef.current.play().catch(() => {});

      if (externalVideoRef && externalVideoRef.current) {
        externalVideoRef.current.srcObject = stream;
        await externalVideoRef.current.play().catch(() => {});
      }

      isRunningRef.current = true;
      isIngestingRef.current = false;
      setIsWebcamActive(true);
      frameCountRef.current = 0;
      fpsTimerRef.current = Date.now();
      startGeolocation();

      sendFrame();
    } catch (err) {
      console.error('Camera permission or device error:', err);
      let msg = err.message || 'Unable to access camera on this device.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg = 'Camera permission was denied. Please tap the lock icon in your browser address bar and allow camera access.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        msg = 'No physical camera device was detected on this hardware.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        msg = 'Camera hardware is currently in use by another application or browser tab.';
      }
      setWebcamError(msg);
      setIsWebcamActive(false);
    }
  }, [activeDeviceId, facingMode, deviceInfo, sendFrame, externalVideoRef, startGeolocation]);

  // Flip or switch between available cameras
  const switchCamera = useCallback(async () => {
    if (availableCameras.length > 1) {
      const currentIndex = availableCameras.findIndex((c) => c.deviceId === activeDeviceId);
      const nextIndex = (currentIndex + 1) % availableCameras.length;
      const nextCam = availableCameras[nextIndex];
      setActiveDeviceId(nextCam.deviceId);
      setActiveCameraLabel(nextCam.label);
      setFacingMode(nextCam.facingMode);
      if (isWebcamActive) {
        await startWebcam(nextCam.deviceId, nextCam.facingMode);
      }
    } else {
      // Toggle facingMode if device IDs aren't distinct
      const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
      setFacingMode(nextFacing);
      setActiveCameraLabel(nextFacing === 'environment' ? 'Mobile Rear Camera' : 'Front User Camera');
      if (isWebcamActive) {
        await startWebcam(null, nextFacing);
      }
    }
  }, [availableCameras, activeDeviceId, facingMode, isWebcamActive, startWebcam]);

  const selectCamera = useCallback(async (deviceId) => {
    const target = availableCameras.find((c) => c.deviceId === deviceId);
    if (target) {
      setActiveDeviceId(target.deviceId);
      setActiveCameraLabel(target.label);
      setFacingMode(target.facingMode);
      if (isWebcamActive) {
        await startWebcam(target.deviceId, target.facingMode);
      }
    }
  }, [availableCameras, isWebcamActive, startWebcam]);

  useEffect(() => {
    return () => {
      stopWebcam();
    };
  }, [stopWebcam]);

  return {
    isWebcamActive,
    localStream,
    startWebcam,
    stopWebcam,
    switchCamera,
    selectCamera,
    liveDetections,
    latestAnnotatedFrame,
    telemetry,
    webcamError,
    deviceInfo,
    availableCameras,
    activeDeviceId,
    activeCameraLabel,
    facingMode,
    geoPosition,
  };
};
