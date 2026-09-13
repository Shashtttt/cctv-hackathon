import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { reverseGeocodeCoords } from '../utils/geoLocator';
import { syncCamerasGeolocation } from '../services/apiService';

const LocationContext = createContext({
  coords: { latitude: 28.4949, longitude: 77.0895, formatted: '28.4949° N, 77.0895° E' },
  locationName: 'Detecting Location...',
  isLiveGps: false,
  isLoading: true,
  error: null,
  detectLocation: () => {},
  setManualLocation: () => {},
  connectedCameras: [],
});

// Helper to format lat/lon into standard GPS string
export function formatGpsCoords(latitude, longitude) {
  if (!latitude || !longitude || isNaN(latitude) || isNaN(longitude)) {
    return '0.0000° N, 0.0000° E';
  }
  const latStr = `${Math.abs(latitude).toFixed(4)}° ${latitude >= 0 ? 'N' : 'S'}`;
  const lonStr = `${Math.abs(longitude).toFixed(4)}° ${longitude >= 0 ? 'E' : 'W'}`;
  return `${latStr}, ${lonStr}`;
}

// Dynamically generate multi-camera linear perimeter chain around any coordinate
export function generatePerimeterLine(centerLat, centerLon, deviceName = 'Edge Hub') {
  const delta = 0.0008; // ~85-90 meters spacing along line
  return [
    {
      id: 'CAM-LINE-01',
      name: 'Perimeter Camera 01 (North Post)',
      coords: [centerLat + delta * 2, centerLon - delta * 2],
      bearing: 45,
      fovAngle: 70,
      fovDistance: 180,
      status: 'online',
      type: '4K Optical PTZ',
      chainIndex: 1,
      gpsFormatted: formatGpsCoords(centerLat + delta * 2, centerLon - delta * 2),
      elevation: '+214m MSL',
      resolution: '4K @ 30fps',
      connectedDevice: deviceName,
      targetLock: null,
    },
    {
      id: 'CAM-LINE-02',
      name: 'Perimeter Camera 02 (Approach Corridor)',
      coords: [centerLat + delta, centerLon - delta],
      bearing: 60,
      fovAngle: 75,
      fovDistance: 220,
      status: 'alert',
      type: 'AI Thermal + Visible',
      chainIndex: 2,
      gpsFormatted: formatGpsCoords(centerLat + delta, centerLon - delta),
      elevation: '+212m MSL',
      resolution: '4K @ 30fps',
      connectedDevice: deviceName,
      targetLock: 'TARGET #TRK-8832 LOCKED',
      targetType: 'PERSON-01 [CROUCHING]',
      targetConfidence: '95%',
    },
    {
      id: 'CAM-LINE-03',
      name: 'Central Optical Hub Camera',
      coords: [centerLat, centerLon],
      bearing: 90,
      fovAngle: 80,
      fovDistance: 200,
      status: 'online',
      type: 'Active Hardware Webcam',
      chainIndex: 3,
      gpsFormatted: formatGpsCoords(centerLat, centerLon),
      elevation: '+210m MSL',
      resolution: '1080p @ 60fps',
      connectedDevice: deviceName,
      targetLock: null,
    },
    {
      id: 'CAM-LINE-04',
      name: 'Perimeter Camera 04 (South Sector)',
      coords: [centerLat - delta, centerLon + delta],
      bearing: 120,
      fovAngle: 65,
      fovDistance: 190,
      status: 'patrol',
      type: 'Night-Vision PTZ',
      chainIndex: 4,
      gpsFormatted: formatGpsCoords(centerLat - delta, centerLon + delta),
      elevation: '+208m MSL',
      resolution: '1080p @ 60fps',
      connectedDevice: deviceName,
      targetLock: null,
    },
    {
      id: 'CAM-LINE-05',
      name: 'Perimeter Camera 05 (Checkpoint Gate)',
      coords: [centerLat - delta * 2, centerLon + delta * 2],
      bearing: 135,
      fovAngle: 70,
      fovDistance: 210,
      status: 'online',
      type: 'ANPR + Optical PTZ',
      chainIndex: 5,
      gpsFormatted: formatGpsCoords(centerLat - delta * 2, centerLon + delta * 2),
      elevation: '+206m MSL',
      resolution: '4K @ 30fps',
      connectedDevice: deviceName,
      targetLock: null,
    }
  ];
}

export const LocationProvider = ({ children }) => {
  const [coords, setCoords] = useState(() => {
    try {
      const saved = localStorage.getItem('ibvap_dynamic_location');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.latitude && parsed.longitude) return parsed;
      }
    } catch {}
    return { latitude: 28.4949, longitude: 77.0895, formatted: '28.4949° N, 77.0895° E' };
  });

  const [locationName, setLocationName] = useState(() => {
    try {
      return localStorage.getItem('ibvap_dynamic_location_name') || 'Resolving Location...';
    } catch {
      return 'Resolving Location...';
    }
  });

  const [isLiveGps, setIsLiveGps] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Apply location update to state and storage
  const updateLocationState = useCallback(async (latitude, longitude, sourceLabel = null, isHardwareGps = false) => {
    const formatted = formatGpsCoords(latitude, longitude);
    const newCoords = { latitude, longitude, formatted };
    
    setCoords(newCoords);
    setIsLiveGps(isHardwareGps);
    setIsLoading(false);

    try {
      localStorage.setItem('ibvap_dynamic_location', JSON.stringify(newCoords));
      localStorage.setItem('ibvap_live_device_gps', JSON.stringify(newCoords));
    } catch {}

    // Reverse-geocode to get real address
    let finalLocationLabel = sourceLabel || 'Live Device Location';
    try {
      const resolvedName = sourceLabel || await reverseGeocodeCoords(latitude, longitude);
      if (resolvedName) {
        finalLocationLabel = resolvedName;
        setLocationName(resolvedName);
        try {
          localStorage.setItem('ibvap_dynamic_location_name', resolvedName);
        } catch {}
      }
    } catch (e) {
      if (sourceLabel) setLocationName(sourceLabel);
    }

    // Keep backend cameras in sync with live coordinates
    try {
      syncCamerasGeolocation(latitude, longitude, finalLocationLabel).catch(() => {});
    } catch {}
  }, []);

  // Primary Detection Function: Browser GPS -> IP Geolocation Fallback
  const detectLocation = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    // 1. Try Browser High-Accuracy Geolocation API
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      try {
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            resolve,
            reject,
            { enableHighAccuracy: true, timeout: 7000, maximumAge: 30000 }
          );
        });

        const { latitude, longitude } = position.coords;
        await updateLocationState(latitude, longitude, null, true);
        return;
      } catch (geoErr) {
        console.debug('Browser GPS notice:', geoErr.message, 'Falling back to live IP geolocation...');
      }
    }

    // 2. Fallback to Live IP Geolocation (e.g. ipwho.is)
    try {
      const res = await fetch('https://ipwho.is/');
      if (res.ok) {
        const data = await res.json();
        if (data && data.success && data.latitude && data.longitude) {
          const areaName = [data.city, data.region, data.country].filter(Boolean).join(', ');
          await updateLocationState(data.latitude, data.longitude, areaName, false);
          return;
        }
      }
    } catch (ipErr) {
      console.debug('IP Geolocation fallback notice:', ipErr);
    }

    // 3. If all fails, keep existing coords but mark loading false
    setIsLoading(false);
  }, [updateLocationState]);

  // Set Manual Location (e.g. User clicks map or enters location)
  const setManualLocation = useCallback(async (latitude, longitude, customLabel = null) => {
    setIsLoading(true);
    await updateLocationState(latitude, longitude, customLabel, false);
  }, [updateLocationState]);

  // Initial detection on mount
  useEffect(() => {
    detectLocation();
  }, [detectLocation]);

  // Generated linear cameras based on active location
  const connectedCameras = generatePerimeterLine(coords.latitude, coords.longitude, locationName);

  return (
    <LocationContext.Provider
      value={{
        coords,
        locationName,
        isLiveGps,
        isLoading,
        error,
        detectLocation,
        setManualLocation,
        connectedCameras,
        formatGpsCoords,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
};

export const useLocation = () => useContext(LocationContext);
export default LocationContext;
