import React, { useState, useEffect, useRef } from 'react';
import { 
  Radio, 
  Maximize2, 
  Minimize2, 
  Layers, 
  MapPin, 
  ShieldAlert, 
  Eye, 
  Camera, 
  Cpu, 
  Activity, 
  Compass, 
  Crosshair, 
  Wifi, 
  CheckCircle2, 
  AlertTriangle,
  RefreshCw,
  Sliders,
  ExternalLink
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import './SurveillanceMap.css';

// Master Border Defense Perimeter & Device Topology
const PERIMETER_SECTORS = {
  gurgaonCyberCity: {
    id: 'gurgaonCyberCity',
    name: 'Gurgaon DLF Cyber City Line',
    region: 'Gurgaon DLF Phase 2, Haryana (Delhi NCR)',
    center: [28.4949, 77.0895],
    zoom: 16,
    device: {
      id: 'DEV-GGN-EDGE-01',
      name: 'Gurgaon Cyber City Edge Hub',
      model: 'NVIDIA Jetson AGX Orin 64GB Industrial',
      ip: '192.168.26.1',
      coords: [28.4949, 77.0895],
      status: 'online',
      uplink: '10G Fiber SFP+ / 5G NSA Dual Relay',
      power: '100% Grid + Solar Backup',
      connectedCams: ['CAM-GGN-01', 'CAM-GGN-02', 'CAM-GGN-03', 'CAM-GGN-04', 'CAM-GGN-05'],
      gpsFormatted: '28.4949° N, 77.0895° E',
      elevation: '+220m MSL'
    },
    cameras: [
      {
        id: 'CAM-GGN-01',
        name: 'Cyber City North Gateway Tower',
        coords: [28.4975, 77.0870],
        status: 'online',
        type: '4K Optical PTZ',
        bearing: 45,
        fovAngle: 70,
        fovDistance: 320,
        targetLock: null,
        resolution: '4K @ 30fps',
        connectedDevice: 'DEV-GGN-EDGE-01',
        chainIndex: 1,
        gpsFormatted: '28.4975° N, 77.0870° E',
        elevation: '+222m MSL'
      },
      {
        id: 'CAM-GGN-02',
        name: 'Cyber Hub Walkway Corridor',
        coords: [28.4960, 77.0885],
        status: 'alert',
        type: 'AI Thermal + 4K Optical',
        bearing: 60,
        fovAngle: 75,
        fovDistance: 350,
        targetLock: 'TARGET #TRK-8832 LOCKED',
        targetType: 'PERSON-01 [CROUCHING]',
        targetConfidence: '95%',
        resolution: '4K @ 30fps',
        connectedDevice: 'DEV-GGN-EDGE-01',
        chainIndex: 2,
        gpsFormatted: '28.4960° N, 77.0885° E',
        elevation: '+220m MSL'
      },
      {
        id: 'CAM-GGN-03',
        name: 'Rapid Metro Central Station Post',
        coords: [28.4949, 77.0895],
        status: 'online',
        type: 'Wide-Angle Fixed 4K',
        bearing: 90,
        fovAngle: 80,
        fovDistance: 300,
        targetLock: null,
        resolution: '4K @ 30fps',
        connectedDevice: 'DEV-GGN-EDGE-01',
        chainIndex: 3,
        gpsFormatted: '28.4949° N, 77.0895° E',
        elevation: '+220m MSL'
      },
      {
        id: 'CAM-GGN-04',
        name: 'DLF Phase 2 East Entry Post',
        coords: [28.4935, 77.0910],
        status: 'patrol',
        type: '1080p 60fps Night Vision',
        bearing: 120,
        fovAngle: 65,
        fovDistance: 330,
        targetLock: null,
        resolution: '1080p @ 60fps',
        connectedDevice: 'DEV-GGN-EDGE-01',
        chainIndex: 4,
        gpsFormatted: '28.4935° N, 77.0910° E',
        elevation: '+218m MSL'
      },
      {
        id: 'CAM-GGN-05',
        name: 'NH-48 Express Checkpoint Post',
        coords: [28.4920, 77.0925],
        status: 'online',
        type: 'ANPR + Optical PTZ',
        bearing: 135,
        fovAngle: 70,
        fovDistance: 340,
        targetLock: null,
        resolution: '4K @ 30fps',
        connectedDevice: 'DEV-GGN-EDGE-01',
        chainIndex: 5,
        gpsFormatted: '28.4920° N, 77.0925° E',
        elevation: '+217m MSL'
      }
    ]
  },
  gurgaonSec29: {
    id: 'gurgaonSec29',
    name: 'Gurgaon Sector 29 Leisure Valley Line',
    region: 'Sector 29, Gurgaon, Haryana',
    center: [28.4682, 77.0620],
    zoom: 16,
    device: {
      id: 'DEV-GGN-SEC29',
      name: 'Sector 29 Master Node',
      model: 'Industrial AI Gateway 32GB',
      ip: '192.168.29.1',
      coords: [28.4682, 77.0620],
      status: 'online',
      uplink: 'Fiber High-Speed Relay',
      power: '99% Active',
      connectedCams: ['CAM-S29-01', 'CAM-S29-02', 'CAM-S29-03'],
      gpsFormatted: '28.4682° N, 77.0620° E',
      elevation: '+215m MSL'
    },
    cameras: [
      {
        id: 'CAM-S29-01',
        name: 'Leisure Valley North Post',
        coords: [28.4700, 77.0600],
        status: 'online',
        type: '1080p Optical',
        bearing: 45,
        fovAngle: 75,
        fovDistance: 260,
        targetLock: null,
        resolution: '1080p @ 30fps',
        connectedDevice: 'DEV-GGN-SEC29',
        chainIndex: 1,
        gpsFormatted: '28.4700° N, 77.0600° E',
        elevation: '+216m MSL'
      },
      {
        id: 'CAM-S29-02',
        name: 'Sector 29 Central Plaza',
        coords: [28.4682, 77.0620],
        status: 'alert',
        type: '4K AI Optical',
        bearing: 90,
        fovAngle: 80,
        fovDistance: 310,
        targetLock: 'ACTIVITY FLAGGED',
        targetType: 'STATIONARY CROWD',
        targetConfidence: '93%',
        resolution: '4K @ 30fps',
        connectedDevice: 'DEV-GGN-SEC29',
        chainIndex: 2,
        gpsFormatted: '28.4682° N, 77.0620° E',
        elevation: '+215m MSL'
      },
      {
        id: 'CAM-S29-03',
        name: 'IFFCO Chowk Approach Post',
        coords: [28.4664, 77.0640],
        status: 'online',
        type: '1080p PTZ',
        bearing: 135,
        fovAngle: 70,
        fovDistance: 280,
        targetLock: null,
        resolution: '1080p @ 30fps',
        connectedDevice: 'DEV-GGN-SEC29',
        chainIndex: 3,
        gpsFormatted: '28.4664° N, 77.0640° E',
        elevation: '+214m MSL'
      }
    ]
  },
  sector4: {
    id: 'sector4',
    name: 'Sector 4 Border Demarcation Line',
    region: 'Northern Border Demarcation // Zone Alpha',
    center: [34.0837, 74.7973],
    zoom: 15,
    device: {
      id: 'DEV-GW-01',
      name: 'Edge Gateway Hub Alpha',
      model: 'NVIDIA Jetson AGX Orin 64GB',
      ip: '192.168.10.1',
      coords: [34.0837, 74.7973],
      status: 'online',
      uplink: '10G Fiber SFP+ / Microwave Relay',
      power: '98% Dual Solar + UPS',
      connectedCams: ['CAM-01', 'CAM-02', 'CAM-03', 'CAM-04', 'CAM-05'],
      gpsFormatted: '34.0837° N, 74.7973° E',
      elevation: '+340m MSL'
    },
    // Cameras deployed in a continuous linear perimeter array
    cameras: [
      {
        id: 'CAM-01',
        name: 'CAM-01 North Gate Tower',
        coords: [34.0865, 74.7925],
        status: 'online',
        type: 'PTZ Optical 4K',
        bearing: 45, // Direction camera is pointing
        fovAngle: 65,
        fovDistance: 380, // meters
        targetLock: null,
        resolution: '4K @ 30fps',
        connectedDevice: 'DEV-GW-01',
        chainIndex: 1,
        gpsFormatted: '34.0865° N, 74.7925° E',
        elevation: '+362m MSL'
      },
      {
        id: 'CAM-02',
        name: 'CAM-02 Fence Line West',
        coords: [34.0851, 74.7949],
        status: 'alert',
        type: 'Thermal FLIR + 4K Visible',
        bearing: 55,
        fovAngle: 70,
        fovDistance: 420,
        targetLock: 'TARGET #TRK-8832 LOCKED',
        targetType: 'PERSON-01 [CROUCHING]',
        targetConfidence: '95%',
        resolution: '4K @ 30fps',
        connectedDevice: 'DEV-GW-01',
        chainIndex: 2,
        gpsFormatted: '34.0851° N, 74.7949° E',
        elevation: '+351m MSL'
      },
      {
        id: 'CAM-03',
        name: 'CAM-03 Central Demarcation',
        coords: [34.0837, 74.7973],
        status: 'online',
        type: 'Fixed 4K Wide-Angle',
        bearing: 60,
        fovAngle: 80,
        fovDistance: 340,
        targetLock: null,
        resolution: '4K @ 30fps',
        connectedDevice: 'DEV-GW-01',
        chainIndex: 3,
        gpsFormatted: '34.0837° N, 74.7973° E',
        elevation: '+340m MSL'
      },
      {
        id: 'CAM-04',
        name: 'CAM-04 Ridge Lookout East',
        coords: [34.0823, 74.7997],
        status: 'patrol',
        type: 'PTZ Night-Vision',
        bearing: 65,
        fovAngle: 60,
        fovDistance: 450,
        targetLock: null,
        resolution: '1080p @ 60fps',
        connectedDevice: 'DEV-GW-01',
        chainIndex: 4,
        gpsFormatted: '34.0823° N, 74.7997° E',
        elevation: '+375m MSL'
      },
      {
        id: 'CAM-05',
        name: 'CAM-05 Checkpoint Alpha South',
        coords: [34.0809, 74.8021],
        status: 'online',
        type: 'ANPR + Optical PTZ',
        bearing: 70,
        fovAngle: 65,
        fovDistance: 360,
        targetLock: null,
        resolution: '4K @ 30fps',
        connectedDevice: 'DEV-GW-01',
        chainIndex: 5,
        gpsFormatted: '34.0809° N, 74.8021° E',
        elevation: '+338m MSL'
      }
    ]
  },
  noidaSec28: {
    id: 'noidaSec28',
    name: 'Noida Sector 28 Corridor',
    region: 'NCR Perimeter & Traffic Corridor',
    center: [28.5708, 77.3271],
    zoom: 16,
    device: {
      id: 'DEV-NCR-HUB-02',
      name: 'Noida Sec 28 Edge Node Hub',
      model: 'Industrial AI Gateway 32GB',
      ip: '10.28.1.1',
      coords: [28.5708, 77.3271],
      status: 'online',
      uplink: '5G NSA / Fiber Dual-Link',
      power: 'Grid + Generator Active',
      connectedCams: ['TV-IN-01', 'TV-IN-02', 'TV-IN-03'],
      gpsFormatted: '28.5708° N, 77.3271° E',
      elevation: '+205m MSL'
    },
    cameras: [
      {
        id: 'TV-IN-01',
        name: 'Sector 28 North Approach',
        coords: [28.5730, 77.3250],
        status: 'online',
        type: '1080p Traffic FHD',
        bearing: 135,
        fovAngle: 75,
        fovDistance: 280,
        targetLock: null,
        resolution: '1080p @ 30fps',
        connectedDevice: 'DEV-NCR-HUB-02',
        chainIndex: 1,
        gpsFormatted: '28.5730° N, 77.3250° E',
        elevation: '+204m MSL'
      },
      {
        id: 'TV-IN-02',
        name: 'Atta Market Central Junction',
        coords: [28.5708, 77.3271],
        status: 'alert',
        type: '4K AI Optical Stream',
        bearing: 90,
        fovAngle: 85,
        fovDistance: 320,
        targetLock: 'HIGH DENSITY ANOMALY',
        targetType: 'LOITERING CROWD',
        targetConfidence: '91%',
        resolution: '1080p @ 30fps',
        connectedDevice: 'DEV-NCR-HUB-02',
        chainIndex: 2,
        gpsFormatted: '28.5708° N, 77.3271° E',
        elevation: '+205m MSL'
      },
      {
        id: 'TV-IN-03',
        name: 'Sector 28 South Corridor',
        coords: [28.5686, 77.3292],
        status: 'online',
        type: '1080p ANPR PTZ',
        bearing: 45,
        fovAngle: 70,
        fovDistance: 300,
        targetLock: null,
        resolution: '1080p @ 30fps',
        connectedDevice: 'DEV-NCR-HUB-02',
        chainIndex: 3,
        gpsFormatted: '28.5686° N, 77.3292° E',
        elevation: '+206m MSL'
      }
    ]
  }
};

// Calculate destination point given distance (m) and bearing (deg)
function calculateDestination(lat, lon, distanceMeters, bearingDegrees) {
  const R = 6378137; // Earth radius in meters
  const dByR = distanceMeters / R;
  const radBearing = (bearingDegrees * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(dByR) +
    Math.cos(lat1) * Math.sin(dByR) * Math.cos(radBearing)
  );

  const lon2 = lon1 + Math.atan2(
    Math.sin(radBearing) * Math.sin(dByR) * Math.cos(lat1),
    Math.cos(dByR) - Math.sin(lat1) * Math.sin(lat2)
  );

  return [(lat2 * 180) / Math.PI, (lon2 * 180) / Math.PI];
}

// Generate an SVG Field-of-View wedge coordinates polygon
function generateFovPolygon(centerLat, centerLon, bearing, fovAngle, distanceMeters) {
  const points = [[centerLat, centerLon]];
  const halfFov = fovAngle / 2;
  const step = 5; // steps in degrees
  for (let b = bearing - halfFov; b <= bearing + halfFov; b += step) {
    points.push(calculateDestination(centerLat, centerLon, distanceMeters, b));
  }
  points.push(calculateDestination(centerLat, centerLon, distanceMeters, bearing + halfFov));
  return points;
}

export const SurveillanceMap = ({ lastPing = 3, latency = 14 }) => {
  const { theme } = useTheme();
  const mapContainerRef = useRef(null);
  const leafletMapRef = useRef(null);
  const layersGroupRef = useRef(null);

  const [currentSectorId, setCurrentSectorId] = useState('gurgaonCyberCity');
  const [userLiveLocation, setUserLiveLocation] = useState(() => {
    try {
      const saved = localStorage.getItem('ibvap_live_device_gps');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Automatically attempt browser geolocation on mount
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude, altitude } = pos.coords;
          const latStr = `${Math.abs(latitude).toFixed(4)}° ${latitude >= 0 ? 'N' : 'S'}`;
          const lonStr = `${Math.abs(longitude).toFixed(4)}° ${longitude >= 0 ? 'E' : 'W'}`;
          const formatted = `${latStr}, ${lonStr}`;
          const userLoc = { latitude, longitude, altitude: altitude ? Math.round(altitude) : null, formatted };
          setUserLiveLocation(userLoc);
          try {
            localStorage.setItem('ibvap_live_device_gps', JSON.stringify(userLoc));
          } catch (e) {}
          // Automatically switch to user's real live device GPS position!
          setCurrentSectorId('myLiveDevice');
        },
        (err) => {
          console.debug('Browser Geolocation fallback to Gurgaon Cyber City:', err?.message);
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
      );
    }
  }, []);
  const [mapLayerType, setMapLayerType] = useState('google_hybrid'); // google_hybrid | google_roads | dark_matter | positron | radar_grid
  const [selectedItem, setSelectedItem] = useState(null);
  const [showFovCones, setShowFovCones] = useState(true);
  const [showDeviceLinks, setShowDeviceLinks] = useState(true);
  const [showPerimeterLine, setShowPerimeterLine] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLeafletReady, setIsLeafletReady] = useState(false);

  // Dynamic sector: if myLiveDevice is chosen, generate real perimeter coordinates around user's GPS
  const getSectorData = () => {
    if (currentSectorId === 'myLiveDevice' && userLiveLocation) {
      const lat = userLiveLocation.latitude;
      const lon = userLiveLocation.longitude;
      return {
        id: 'myLiveDevice',
        name: 'My Hardware Device (Live GPS)',
        region: 'Hardware Optical Sensor Matrix',
        center: [lat, lon],
        zoom: 17,
        device: {
          id: 'DEV-USER-HARDWARE',
          name: 'HP Wide Vision HD Camera (Host)',
          model: 'Active Local Edge Hardware Node',
          ip: '127.0.0.1 (Local Host)',
          coords: [lat, lon],
          status: 'online',
          uplink: 'Direct PCI/USB High-Speed Bus',
          power: '100% AC Powered',
          connectedCams: ['CAM-MY-01', 'CAM-MY-02', 'CAM-MY-03'],
          gpsFormatted: userLiveLocation.formatted,
          elevation: userLiveLocation.altitude ? `+${userLiveLocation.altitude}m MSL` : '+210m MSL'
        },
        cameras: [
          {
            id: 'CAM-MY-01',
            name: 'Local Webcam 01 (North)',
            coords: [lat + 0.0008, lon - 0.0008],
            status: 'online',
            type: 'HP Wide Vision 720p',
            bearing: 45,
            fovAngle: 75,
            fovDistance: 120,
            targetLock: null,
            resolution: '720p @ 60fps',
            connectedDevice: 'DEV-USER-HARDWARE',
            chainIndex: 1,
            gpsFormatted: `${(lat + 0.0008).toFixed(4)}° N, ${(lon - 0.0008).toFixed(4)}° E`,
            elevation: '+212m MSL'
          },
          {
            id: 'CAM-MY-02',
            name: 'Local Webcam 02 (Center Hub)',
            coords: [lat, lon],
            status: 'alert',
            type: 'Active USB Optical Sensor',
            bearing: 90,
            fovAngle: 80,
            fovDistance: 140,
            targetLock: 'REALTIME TARGET LOCKED',
            targetType: 'ACTIVE USER WEBCAM',
            targetConfidence: '99%',
            resolution: '1080p @ 60fps',
            connectedDevice: 'DEV-USER-HARDWARE',
            chainIndex: 2,
            gpsFormatted: userLiveLocation.formatted,
            elevation: '+210m MSL'
          },
          {
            id: 'CAM-MY-03',
            name: 'Local Webcam 03 (South)',
            coords: [lat - 0.0008, lon + 0.0008],
            status: 'online',
            type: 'ANPR Perimeter Node',
            bearing: 135,
            fovAngle: 70,
            fovDistance: 130,
            targetLock: null,
            resolution: '720p @ 30fps',
            connectedDevice: 'DEV-USER-HARDWARE',
            chainIndex: 3,
            gpsFormatted: `${(lat - 0.0008).toFixed(4)}° N, ${(lon + 0.0008).toFixed(4)}° E`,
            elevation: '+208m MSL'
          }
        ]
      };
    }
    return PERIMETER_SECTORS[currentSectorId] || PERIMETER_SECTORS.sector4;
  };

  const currentSector = getSectorData();

  // Set default selected item
  useEffect(() => {
    if (!selectedItem) {
      setSelectedItem(currentSector.cameras.find(c => c.status === 'alert') || currentSector.cameras[0]);
    }
  }, [currentSectorId, userLiveLocation]);

  // Ensure Leaflet is loaded
  useEffect(() => {
    const checkLeaflet = () => {
      if (typeof window !== 'undefined' && window.L) {
        setIsLeafletReady(true);
        return true;
      }
      return false;
    };

    if (checkLeaflet()) return;

    const timer = setInterval(() => {
      if (checkLeaflet()) {
        clearInterval(timer);
      }
    }, 200);

    return () => clearInterval(timer);
  }, []);

  // Initialize and update Leaflet Map
  useEffect(() => {
    if (!isLeafletReady || !mapContainerRef.current) return;
    const L = window.L;

    // Destroy previous instance if any
    if (leafletMapRef.current) {
      leafletMapRef.current.remove();
      leafletMapRef.current = null;
    }

    // Initialize Map
    const map = L.map(mapContainerRef.current, {
      center: currentSector.center,
      zoom: currentSector.zoom,
      zoomControl: false,
      attributionControl: false,
    });

    leafletMapRef.current = map;

    // Add zoom controls on top right
    L.control.zoom({ position: 'topright' }).addTo(map);

    // Apply base tile layer
    let tileUrl = 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'; // Google Satellite Hybrid default
    let tileOptions = { maxZoom: 20 };

    if (mapLayerType === 'google_roads') {
      tileUrl = 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}';
    } else if (mapLayerType === 'dark_matter') {
      tileUrl = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
      tileOptions = { subdomains: 'abcd', maxZoom: 19 };
    } else if (mapLayerType === 'positron') {
      tileUrl = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
      tileOptions = { subdomains: 'abcd', maxZoom: 19 };
    }

    const tileLayer = L.tileLayer(tileUrl, tileOptions).addTo(map);

    // Create a layer group for vector elements (lines, markers, cones)
    const layerGroup = L.layerGroup().addTo(map);
    layersGroupRef.current = layerGroup;

    // 1. Draw continuous Border Perimeter Line connecting all cameras in the line
    const cameraLinePoints = currentSector.cameras.map(cam => cam.coords);

    if (showPerimeterLine && cameraLinePoints.length > 1) {
      // Background glow line
      L.polyline(cameraLinePoints, {
        color: '#00f2fe',
        weight: 6,
        opacity: 0.35,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(layerGroup);

      // Foreground dashed demarcation line
      L.polyline(cameraLinePoints, {
        color: '#00f2fe',
        weight: 2.5,
        opacity: 0.9,
        dashArray: '8, 8',
        lineCap: 'round',
      }).addTo(layerGroup);
    }

    // 2. Draw Device -> Camera Link Cables (shows device working with multiple cameras in the same line)
    if (showDeviceLinks && currentSector.device) {
      const devCoord = currentSector.device.coords;
      currentSector.cameras.forEach(cam => {
        L.polyline([devCoord, cam.coords], {
          color: cam.status === 'alert' ? '#ff3b3b' : '#f59e0b',
          weight: 1.5,
          opacity: 0.75,
          dashArray: '4, 6',
        }).addTo(layerGroup);
      });
    }

    // 3. Draw Camera FOV (Field of View) visual cones
    if (showFovCones) {
      currentSector.cameras.forEach(cam => {
        const fovCoords = generateFovPolygon(
          cam.coords[0],
          cam.coords[1],
          cam.bearing,
          cam.fovAngle,
          cam.fovDistance
        );

        const isAlert = cam.status === 'alert';
        const isPatrol = cam.status === 'patrol';
        const coneColor = isAlert ? '#ff3b3b' : isPatrol ? '#00f2fe' : '#10b981';

        L.polygon(fovCoords, {
          color: coneColor,
          weight: 1,
          opacity: 0.8,
          fillColor: coneColor,
          fillOpacity: isAlert ? 0.35 : 0.16,
        }).addTo(layerGroup);
      });
    }

    // 4. Place Edge Processing Device Hub Marker (Master Hub in center)
    if (currentSector.device) {
      const dev = currentSector.device;
      const isSelected = selectedItem?.id === dev.id;

      const deviceIcon = L.divIcon({
        className: 'custom-leaflet-marker',
        html: `
          <div class="device-marker-wrapper ${isSelected ? 'marker-selected' : ''}">
            <div class="device-diamond-icon">
              <span class="device-icon-symbol">📡</span>
            </div>
            <div class="device-label-pill font-mono">
              <span class="device-name-badge">HUB</span>
              <span class="device-name-text">${dev.name}</span>
            </div>
          </div>
        `,
        iconSize: [140, 50],
        iconAnchor: [70, 25],
      });

      const devMarker = L.marker(dev.coords, { icon: deviceIcon, zIndexOffset: 900 }).addTo(layerGroup);
      devMarker.on('click', () => {
        setSelectedItem(dev);
      });
    }

    // 5. Place Camera Markers along the perimeter line
    currentSector.cameras.forEach((cam, idx) => {
      const isSelected = selectedItem?.id === cam.id;
      const isAlert = cam.status === 'alert';
      const isPatrol = cam.status === 'patrol';
      const statusClass = isAlert ? 'status-alert' : isPatrol ? 'status-patrol' : 'status-online';

      const camIcon = L.divIcon({
        className: 'custom-leaflet-marker',
        html: `
          <div class="cam-marker-wrapper ${statusClass} ${isSelected ? 'marker-selected' : ''}">
            <div class="cam-dot-pulse">
              ${isAlert ? '<div class="alert-radar-ring"></div>' : ''}
              <div class="cam-center-dot"></div>
            </div>
            <div class="cam-label-tag font-mono">
              <span class="cam-seq-badge">#${idx + 1}</span>
              <span class="cam-code-text">${cam.id}</span>
              ${isAlert ? '<span class="cam-alert-flag">⚠️ ALERT</span>' : ''}
            </div>
            ${cam.targetLock ? `
              <div class="cam-locked-banner font-mono">
                ${cam.targetLock}
              </div>
            ` : ''}
          </div>
        `,
        iconSize: [120, 48],
        iconAnchor: [60, 24],
      });

      const marker = L.marker(cam.coords, { icon: camIcon, zIndexOffset: isAlert ? 800 : 700 }).addTo(layerGroup);
      marker.on('click', () => {
        setSelectedItem(cam);
      });
    });

    return () => {
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
    };
  }, [
    isLeafletReady,
    currentSectorId,
    mapLayerType,
    showFovCones,
    showDeviceLinks,
    showPerimeterLine,
    selectedItem?.id,
    isExpanded,
  ]);

  // Recenter Map Helper
  const handleRecenter = () => {
    if (leafletMapRef.current && currentSector) {
      leafletMapRef.current.setView(currentSector.center, currentSector.zoom, { animate: true });
    }
  };

  // Locate User's Real Active Hardware Device GPS
  const handleLocateDevice = () => {
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude, altitude } = pos.coords;
          const latStr = `${Math.abs(latitude).toFixed(4)}° ${latitude >= 0 ? 'N' : 'S'}`;
          const lonStr = `${Math.abs(longitude).toFixed(4)}° ${longitude >= 0 ? 'E' : 'W'}`;
          const formatted = `${latStr}, ${lonStr}`;
          const userLoc = { latitude, longitude, altitude: altitude ? Math.round(altitude) : null, formatted };
          setUserLiveLocation(userLoc);
          try {
            localStorage.setItem('ibvap_live_device_gps', JSON.stringify(userLoc));
          } catch (e) {}
          setCurrentSectorId('myLiveDevice');
        },
        (err) => alert(`Browser Location: ${err.message || 'Please enable browser GPS permission'}`),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      alert('Geolocation is not supported by your browser environment.');
    }
  };

  return (
    <div className={`tactical-card surveillance-map-card ${isExpanded ? 'surveillance-map-expanded-modal' : ''}`}>
      {/* Card Header */}
      <div className="card-header">
        <div className="card-title-group">
          <div className="card-title-row">
            <Radio size={16} className="card-title-icon text-cyan" />
            <h3 className="card-title">Perimeter Surveillance Map</h3>
            <span className="perimeter-count-badge font-mono">
              {currentSector.cameras?.length || 5} CAMERAS ON LINE • 1 EDGE HUB
            </span>
          </div>
          <span className="card-subtitle">
            Exact GPS Positioning & Multi-Camera Edge Line Topology • {currentSector.name}
          </span>
        </div>

        {/* Header Right Controls */}
        <div className="map-header-controls font-mono">
          {/* Sector Selector */}
          <select 
            value={currentSectorId}
            onChange={(e) => {
              if (e.target.value === 'locate_gps') {
                handleLocateDevice();
              } else {
                setCurrentSectorId(e.target.value);
              }
            }}
            className="map-sector-select font-mono"
            title="Switch Perimeter Sector"
          >
            <option value="gurgaonCyberCity">Gurgaon DLF Cyber City Line (Default)</option>
            <option value="gurgaonSec29">Gurgaon Sector 29 Leisure Valley Line</option>
            <option value="noidaSec28">Noida Sector 28 Corridor Line</option>
            <option value="sector4">Sector 4 Border Demarcation Line (Kashmir)</option>
            {userLiveLocation && (
              <option value="myLiveDevice">📍 My Device (Live GPS: {userLiveLocation.formatted})</option>
            )}
            <option value="locate_gps">🛰️ Detect My Live Location (Browser GPS)...</option>
          </select>

          {/* Map Layer Switcher */}
          <div className="map-layer-selector">
            <button 
              className={`layer-btn ${mapLayerType === 'google_hybrid' ? 'active' : ''}`}
              onClick={() => setMapLayerType('google_hybrid')}
              title="Google Maps Satellite Hybrid"
            >
              Google Satellite
            </button>
            <button 
              className={`layer-btn ${mapLayerType === 'google_roads' ? 'active' : ''}`}
              onClick={() => setMapLayerType('google_roads')}
              title="Google Maps Roadmap / Terrain"
            >
              Google Roads
            </button>
            <button 
              className={`layer-btn ${mapLayerType === 'dark_matter' ? 'active' : ''}`}
              onClick={() => setMapLayerType('dark_matter')}
              title="Tactical Dark Cyber Grid"
            >
              Dark Grid
            </button>
            <button 
              className={`layer-btn ${mapLayerType === 'positron' ? 'active' : ''}`}
              onClick={() => setMapLayerType('positron')}
              title="Tactical Daylight View"
            >
              Daylight
            </button>
          </div>

          {/* Fullscreen Expand Button */}
          <button 
            className="btn-map-icon"
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? "Collapse Map" : "Expand Defense Map"}
          >
            {isExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </div>
      </div>

      {/* Map Viewport Container */}
      <div className="radar-map-viewport">
        {/* Leaflet Google Map Container */}
        <div ref={mapContainerRef} className="leaflet-map-canvas" />

        {/* Floating Top Telemetry Overlays */}
        <div className="map-overlay-top-left font-mono">
          <span className="overlay-pill">
            <Compass size={11} className="text-cyan" /> {currentSector.region}
          </span>
        </div>

        <div className="map-overlay-top-right font-mono">
          <span className="overlay-pill">
            <Crosshair size={11} className="text-coral" /> LAT {currentSector.center[0]}° N • LONG {currentSector.center[1]}° E
          </span>
        </div>

        {/* Floating In-Map Quick Layer Toggles */}
        <div className="map-floating-toolbar font-mono">
          <button 
            className={`map-tool-btn ${showPerimeterLine ? 'active' : ''}`}
            onClick={() => setShowPerimeterLine(!showPerimeterLine)}
            title="Toggle Perimeter Fence Chain Line"
          >
            <span className="tool-dot cyan-dot"></span>
            <span>Perimeter Line</span>
          </button>

          <button 
            className={`map-tool-btn ${showDeviceLinks ? 'active' : ''}`}
            onClick={() => setShowDeviceLinks(!showDeviceLinks)}
            title="Toggle Device-to-Camera Fiber Links"
          >
            <span className="tool-dot amber-dot"></span>
            <span>Device Links</span>
          </button>

          <button 
            className={`map-tool-btn ${showFovCones ? 'active' : ''}`}
            onClick={() => setShowFovCones(!showFovCones)}
            title="Toggle Visual Field of View (FOV) Cones"
          >
            <span className="tool-dot green-dot"></span>
            <span>Camera FOV</span>
          </button>

          <button 
            className="map-tool-btn"
            onClick={handleRecenter}
            title="Recenter Map View"
          >
            <RefreshCw size={11} />
            <span>Recenter</span>
          </button>
        </div>

        {/* Selected Node HUD Tactical Telemetry Inspector Card */}
        {selectedItem && (
          <div className="map-selected-hud-card font-mono">
            <div className="hud-header-row">
              <div className="hud-title-left">
                {selectedItem.type?.includes('Gateway') || selectedItem.model ? (
                  <Cpu size={14} className="text-amber-400" />
                ) : (
                  <Camera size={14} className={selectedItem.status === 'alert' ? 'text-coral' : 'text-cyan'} />
                )}
                <span className="hud-title-name font-bold">{selectedItem.name || selectedItem.id}</span>
              </div>
              <span className={`pill-badge font-bold ${selectedItem.status === 'alert' ? 'tag-coral' : selectedItem.status === 'patrol' ? 'tag-cyan' : 'tag-green'}`}>
                {selectedItem.status?.toUpperCase()}
              </span>
            </div>

            <div className="hud-meta-grid">
              <div className="hud-meta-item">
                <span className="hud-meta-label">EXACT GPS:</span>
                <span className="hud-meta-val text-cyan font-bold">{selectedItem.gpsFormatted}</span>
              </div>
              <div className="hud-meta-item">
                <span className="hud-meta-label">ELEVATION:</span>
                <span className="hud-meta-val">{selectedItem.elevation}</span>
              </div>
              <div className="hud-meta-item">
                <span className="hud-meta-label">HARDWARE:</span>
                <span className="hud-meta-val">{selectedItem.type || selectedItem.model}</span>
              </div>
              <div className="hud-meta-item">
                <span className="hud-meta-label">DEVICE LINK:</span>
                <span className="hud-meta-val text-amber-400">
                  {selectedItem.connectedDevice ? `Linked to ${selectedItem.connectedDevice} (PoE+)` : `${selectedItem.connectedCams?.length} Cams Connected`}
                </span>
              </div>
            </div>

            {selectedItem.targetLock && (
              <div className="hud-threat-alert font-mono">
                <AlertTriangle size={13} className="text-coral" />
                <span>{selectedItem.targetLock} • {selectedItem.targetType} ({selectedItem.targetConfidence})</span>
              </div>
            )}
          </div>
        )}

        {/* Bottom Demarcation Legend Bar */}
        <div className="map-telemetry-bar font-mono">
          <div className="telemetry-item">
            DEMARCATION: <span className="text-cyan">LINE ALPHA-4 (5 NODES IN SERIES)</span>
          </div>
          <div className="telemetry-divider">|</div>
          <div className="telemetry-item">
            EDGE DEVICE: <span className="text-amber-400">{currentSector.device?.name}</span>
          </div>
          <div className="telemetry-divider">|</div>
          <div className="telemetry-item">
            MAP SOURCE: <span className="text-main uppercase">{mapLayerType.replace('_', ' ')}</span>
          </div>
        </div>
      </div>

      {/* Card Footer Bar */}
      <div className="card-footer-bar font-mono">
        <div className="footer-status-info">
          <span className="dot-cyan status-dot pulse-ring"></span>
          <span className="footer-status-text">
            Ping {lastPing}s <span className="text-sep">•</span> Latency {latency}ms <span className="text-sep">•</span> <strong className="cyan-highlight">All Perimeter Nodes In Sync</strong>
          </span>
        </div>

        <div className="footer-right-actions">
          <div className="map-legend">
            <div className="legend-item">
              <span className="legend-dot green-dot"></span>
              <span>Online Cam</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot red-square pulse-ring"></span>
              <span>Alert Active</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot amber-diamond"></span>
              <span>Edge Device Hub</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SurveillanceMap;
