import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';

export const useWebcamBridge = (cameraId = 'cam-01', targetFps = 25, externalVideoRef = null) => {
  const [isWebcamActive, setIsWebcamActive] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [latestAnnotatedFrame, setLatestAnnotatedFrame] = useState(null);
  const [liveDetections, setLiveDetections] = useState([]);
  const [telemetry, setTelemetry] = useState({
    detectionsCount: 0,
    unusualCount: 0,
    alertsCount: 0,
    detections: [],
    actualFps: 0,
    lastLatencyMs: 0,
    deviceMode: 'MPS GPU Accelerated',
  });
  const [webcamError, setWebcamError] = useState(null);

  const internalVideoRef = useRef(null);
  const offscreenCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const isRunningRef = useRef(false);
  const isIngestingRef = useRef(false);
  const frameCountRef = useRef(0);
  const fpsTimerRef = useRef(Date.now());

  const getVideoElement = () => {
    if (externalVideoRef && externalVideoRef.current) {
      return externalVideoRef.current;
    }
    return internalVideoRef.current;
  };

  const stopWebcam = useCallback(() => {
    isRunningRef.current = false;
    isIngestingRef.current = false;
    setIsWebcamActive(false);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setLocalStream(null);
    const video = getVideoElement();
    if (video) {
      video.srcObject = null;
    }
  }, [externalVideoRef]);

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
      const targetW = 640;
      const targetH = 360;
      canvas.width = targetW;
      canvas.height = targetH;

      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.drawImage(video, 0, 0, targetW, targetH);

      const b64 = canvas.toDataURL('image/jpeg', 0.70);
      const t0 = performance.now();

      axios.post(`/api/v1/cameras/${cameraId}/ingest`, { image: b64 }, {
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
          const unusualCount = dets.filter((d) => d.is_unusual || d.unusual_item || d.threat_level === 'CRITICAL').length;
          setLiveDetections(dets);
          if (res.data.annotated_frame) {
            setLatestAnnotatedFrame(res.data.annotated_frame);
          }
          setTelemetry((prev) => ({
            ...prev,
            detectionsCount: dets.length,
            unusualCount,
            alertsCount: res.data.alerts_count || 0,
            detections: dets,
            lastLatencyMs: Math.round(dt),
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
  }, [cameraId, targetFps, externalVideoRef]);

  const startWebcam = useCallback(async () => {
    setWebcamError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 360 },
          frameRate: { ideal: 30, max: 60 },
          facingMode: 'user',
        },
        audio: false,
      });

      streamRef.current = stream;
      setLocalStream(stream);

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

      sendFrame();
    } catch (err) {
      console.error('Camera permission or device error:', err);
      setWebcamError(err.message || 'Unable to access camera.');
      setIsWebcamActive(false);
    }
  }, [sendFrame, externalVideoRef]);

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
    liveDetections,
    latestAnnotatedFrame,
    telemetry,
    webcamError,
  };
};
