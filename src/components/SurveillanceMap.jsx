import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { 
  Radio, 
  Maximize2, 
  MapPin, 
  Layers, 
  Crosshair, 
  Camera as CameraIcon, 
  ShieldCheck, 
  AlertTriangle, 
  RefreshCw,
  X,
  ExternalLink,
  Compass
} from 'lucide-react';
import { enumerateDeviceCameras, getDevicePlatform } from '../utils/deviceDetector';
import { reverseGeocodeCoords, POPULAR_LOCATIONS } from '../utils/geoLocator';
import { fetchCameras } from '../services/apiService';
import './SurveillanceMap.css';

// Google Maps Tile Layers
const GOOGLE_TILES = {
  hybrid: {
    name: 'Google Satellite Hybrid',
    url: 'https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    maxZoom: 20,
    attribution: '&copy; <a href="https://maps.google.com" target="_blank" rel="noreferrer">Google Maps</a>'
  },
  roadmap: {
    name: 'Google Roadmap',
    url: 'https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    maxZoom: 20,
    attribution: '&copy; <a href="https://maps.google.com" target="_blank" rel="noreferrer">Google Maps</a>'
  }
};

const DEFAULT_COORDS = {
  lat: 28.5708,
  lng: 77.3271,
  accuracy: 8,
  locationName: 'Noida Sector 28, Uttar Pradesh',
  gpsFormatted: '28.5708° N, 77.3271° E'
};

// 7 Additional Perimeter Surveillance Cameras plotted across NCR regional matrix
const SECTOR_CAMERAS_MAP = [
  {
    code: 'C-02',
    name: 'Riverine Border Road',
    location: 'Gurgaon Cyber City',
    lat: 28.4949,
    lng: 77.0895,
    gps_coords: '28.4949° N, 77.0895° E',
    mode: 'IR THERMAL',
    status: 'ONLINE',
    persons: 1,
    vehicles: 2,
    weapons: 0,
  },
  {
    code: 'C-03',
    name: 'South Fence Intrusion Zone',
    location: 'Gurgaon Sector 29',
    lat: 28.4682,
    lng: 77.0620,
    gps_coords: '28.4682° N, 77.0620° E',
    mode: 'ANOMALY ALERT',
    status: 'ALERT',
    persons: 2,
    vehicles: 0,
    weapons: 1,
  },
  {
    code: 'C-04',
    name: 'BOP Entry Guard Post',
    location: 'Noida Sector 132 Expressway',
    lat: 28.5085,
    lng: 77.3774,
    gps_coords: '28.5085° N, 77.3774° E',
    mode: 'NIGHT VISION',
    status: 'ONLINE',
    persons: 1,
    vehicles: 1,
    weapons: 0,
  },
  {
    code: 'C-05',
    name: 'Watch Tower North Ridge',
    location: 'Delhi NCR Outer Ring',
    lat: 28.6139,
    lng: 77.2090,
    gps_coords: '28.6139° N, 77.2090° E',
    mode: 'AERIAL RECON',
    status: 'ONLINE',
    persons: 3,
    vehicles: 5,
    weapons: 0,
  },
  {
    code: 'C-06',
    name: 'Forward Patrol Post East',
    location: 'Faridabad Sector 15',
    lat: 28.4089,
    lng: 77.3178,
    gps_coords: '28.4089° N, 77.3178° E',
    mode: 'PERIMETER IR',
    status: 'ONLINE',
    persons: 2,
    vehicles: 1,
    weapons: 0,
  },
  {
    code: 'C-07',
    name: 'Riverine Checkpoint Charlie',
    location: 'Yamuna Riverbank Sector',
    lat: 28.5355,
    lng: 77.3910,
    gps_coords: '28.5355° N, 77.3910° E',
    mode: 'RIVER PATROL',
    status: 'ONLINE',
    persons: 1,
    vehicles: 1,
    weapons: 0,
  },
  {
    code: 'C-08',
    name: 'Tactical Escarpment Station',
    location: 'Aravali Ridge Outpost',
    lat: 28.4200,
    lng: 77.0500,
    gps_coords: '28.4200° N, 77.0500° E',
    mode: 'LONG-RANGE PTZ',
    status: 'ONLINE',
    persons: 0,
    vehicles: 2,
    weapons: 0,
  }
];

const SurveillanceMap = ({ lastPing = 3, latency = 14, onSelectCamera = null }) => {
  const mapContainerRef = useRef(null);
  const modalMapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const modalMapRef = useRef(null);
  const currentTileLayerRef = useRef(null);
  const modalTileLayerRef = useRef(null);
  const deviceMarkerRef = useRef(null);
  const modalDeviceMarkerRef = useRef(null);
  const sectorMarkersRef = useRef([]);
  const modalSectorMarkersRef = useRef([]);

  const [mapType, setMapType] = useState('hybrid'); // 'hybrid' | 'roadmap'
  const [deviceCoords, setDeviceCoords] = useState(DEFAULT_COORDS);
  const [detectedCameras, setDetectedCameras] = useState([]);
  const [primaryCameraName, setPrimaryCameraName] = useState('Integrated HD Camera');
  const [isLocating, setIsLocating] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [networkCameras, setNetworkCameras] = useState([]);
  const [selectedPinInfo, setSelectedPinInfo] = useState(null);

  // 1. Detect physical camera(s) connected to this device
  useEffect(() => {
    let mounted = true;
    const detectHardware = async () => {
      try {
        const platform = getDevicePlatform();
        const cams = await enumerateDeviceCameras();
        if (mounted) {
          setDetectedCameras(cams);
          if (cams.length > 0) {
            setPrimaryCameraName(cams[0].label || 'Device Primary Camera');
          } else {
            setPrimaryCameraName(
              platform.isMobile ? 'Mobile Rear Tactical Camera' : 'Integrated HD Camera'
            );
          }
        }
      } catch (err) {
        console.debug('Camera detection note:', err);
      }
    };
    detectHardware();
    return () => { mounted = false; };
  }, []);

  // 2. Query real device location via browser Geolocation API
  useEffect(() => {
    let watchId = null;

    const resolvePos = async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const accuracy = Math.round(pos.coords.accuracy || 12);
      const latStr = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}`;
      const lngStr = `${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? 'E' : 'W'}`;
      const gpsFormatted = `${latStr}, ${lngStr}`;

      try {
        const locName = await reverseGeocodeCoords(lat, lng);
        setDeviceCoords({
          lat,
          lng,
          accuracy,
          locationName: locName || 'Noida Sector 28, Uttar Pradesh',
          gpsFormatted
        });
      } catch {
        setDeviceCoords({
          lat,
          lng,
          accuracy,
          locationName: 'Noida Sector 28, Uttar Pradesh',
          gpsFormatted
        });
      }
    };

    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        resolvePos,
        () => console.debug('Using precise sector coordinate fallback'),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
      );

      watchId = navigator.geolocation.watchPosition(
        resolvePos,
        () => {},
        { enableHighAccuracy: true, maximumAge: 30000 }
      );
    }

    return () => {
      if (watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, []);

  // 3. Load other cameras from backend API (if present)
  useEffect(() => {
    let mounted = true;
    fetchCameras()
      .then((data) => {
        if (mounted && Array.isArray(data)) {
          setNetworkCameras(data);
        }
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  // Helper to build tactical camera marker HTML
  const createDeviceMarkerIcon = (label, isPrimary = true, isAlert = false) => {
    const statusColor = isAlert ? '#ef4444' : isPrimary ? '#10b981' : '#00f2fe';
    return L.divIcon({
      className: 'tactical-custom-div-icon',
      html: `
        <div class="tactical-marker-wrapper ${isAlert ? 'marker-alert' : ''}">
          <div class="marker-pulse-ring-outer" style="border-color: ${statusColor};"></div>
          <div class="marker-pulse-ring-inner" style="border-color: ${statusColor};"></div>
          <div class="marker-core-icon" style="background: ${statusColor};">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#070c18" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
              <circle cx="12" cy="13" r="4"></circle>
            </svg>
          </div>
          <div class="marker-tactical-label font-mono">
            <span class="label-dot" style="background: ${statusColor};"></span>
            <span class="label-text">${label}</span>
          </div>
        </div>
      `,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
      popupAnchor: [0, -22],
    });
  };

  // Helper to build interactive popup content with Person and Vehicle counts
  const buildPopupContent = (
    title, 
    location, 
    coords, 
    status, 
    type = 'Device Camera', 
    accuracy = null,
    persons = 1,
    vehicles = 0,
    weapons = 0
  ) => {
    const isThreat = weapons > 0;
    return `
      <div class="tactical-map-popup font-mono">
        <div class="popup-header-row">
          <span class="popup-title">${title}</span>
          <span class="popup-status-badge ${isThreat ? 'badge-red' : status === 'ONLINE' ? 'badge-green' : 'badge-orange'}">${isThreat ? 'ALERT' : status}</span>
        </div>
        <div class="popup-body">
          <div class="popup-meta-line">
            <span class="meta-label">TYPE:</span>
            <span class="meta-value text-cyan">${type}</span>
          </div>
          <div class="popup-meta-line">
            <span class="meta-label">LOCATION:</span>
            <span class="meta-value">${location}</span>
          </div>
          <div class="popup-meta-line">
            <span class="meta-label">GPS COORDS:</span>
            <span class="meta-value text-yellow">${coords}</span>
          </div>
          ${accuracy ? `
          <div class="popup-meta-line">
            <span class="meta-label">ACCURACY:</span>
            <span class="meta-value text-green">±${accuracy}m</span>
          </div>` : ''}
          <div class="popup-meta-line">
            <span class="meta-label">👤 PERSONS:</span>
            <span class="meta-value text-green font-bold">${persons} DETECTED</span>
          </div>
          <div class="popup-meta-line">
            <span class="meta-label">🚗 VEHICLES:</span>
            <span class="meta-value text-cyan font-bold">${vehicles} DETECTED</span>
          </div>
          <div class="popup-meta-line">
            <span class="meta-label">🚨 THREAT:</span>
            <span class="meta-value ${isThreat ? 'text-red font-bold animate-pulse' : 'text-green'}">
              ${isThreat ? `${weapons} THREAT ACTIVE` : 'SECURE • NO THREAT'}
            </span>
          </div>
          <div class="popup-meta-line">
            <span class="meta-label">AI TRACKING:</span>
            <span class="meta-value text-green">ACTIVE (60 FPS)</span>
          </div>
        </div>
        <div class="popup-footer-row">
          <span class="popup-source-tag">GOOGLE MAPS GIS SENSOR</span>
        </div>
      </div>
    `;
  };

  // 4. Initialize or update the main Leaflet map instance
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Create map if not created
    if (!mapRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [deviceCoords.lat, deviceCoords.lng],
        zoom: 15,
        zoomControl: false,
        attributionControl: false,
      });

      // Add default Google Hybrid Satellite layer
      const initialLayerConfig = GOOGLE_TILES[mapType] || GOOGLE_TILES.hybrid;
      const tileLayer = L.tileLayer(initialLayerConfig.url, {
        subdomains: initialLayerConfig.subdomains,
        maxZoom: initialLayerConfig.maxZoom,
      });
      tileLayer.addTo(map);
      currentTileLayerRef.current = tileLayer;

      mapRef.current = map;
    }

    const map = mapRef.current;

    // 1. Update or create primary device camera marker
    if (deviceMarkerRef.current) {
      deviceMarkerRef.current.setLatLng([deviceCoords.lat, deviceCoords.lng]);
      deviceMarkerRef.current.setIcon(
        createDeviceMarkerIcon('C-01 (DEVICE)', true, false)
      );
      deviceMarkerRef.current.getPopup()?.setContent(
        buildPopupContent(
          `C-01 ${primaryCameraName}`,
          deviceCoords.locationName,
          deviceCoords.gpsFormatted,
          'ONLINE',
          'Primary Detected Device Camera',
          deviceCoords.accuracy,
          1,
          0,
          0
        )
      );
    } else {
      const marker = L.marker([deviceCoords.lat, deviceCoords.lng], {
        icon: createDeviceMarkerIcon('C-01 (DEVICE)', true, false),
      });

      marker.bindPopup(
        buildPopupContent(
          `C-01 ${primaryCameraName}`,
          deviceCoords.locationName,
          deviceCoords.gpsFormatted,
          'ONLINE',
          'Primary Detected Device Camera',
          deviceCoords.accuracy,
          1,
          0,
          0
        ),
        { className: 'tactical-leaflet-popup', closeButton: false }
      );

      marker.on('click', () => {
        setSelectedPinInfo({
          name: `C-01 ${primaryCameraName}`,
          location: deviceCoords.locationName,
          coords: deviceCoords.gpsFormatted,
          status: 'ONLINE',
          accuracy: deviceCoords.accuracy,
          persons: 1,
          vehicles: 0,
          weapons: 0,
        });
      });

      marker.addTo(map);
      deviceMarkerRef.current = marker;
    }

    // 2. Render 7 Regional Sector Cameras onto Google Map (C-02 to C-08)
    sectorMarkersRef.current.forEach((m) => m.remove());
    sectorMarkersRef.current = [];

    SECTOR_CAMERAS_MAP.forEach((sc) => {
      const isThreat = sc.weapons > 0;
      const marker = L.marker([sc.lat, sc.lng], {
        icon: createDeviceMarkerIcon(sc.code, false, isThreat),
      });

      marker.bindPopup(
        buildPopupContent(
          `${sc.code} ${sc.name}`,
          sc.location,
          sc.gps_coords,
          sc.status,
          sc.mode,
          null,
          sc.persons,
          sc.vehicles,
          sc.weapons
        ),
        { className: 'tactical-leaflet-popup', closeButton: false }
      );

      marker.on('click', () => {
        setSelectedPinInfo({
          name: `${sc.code} ${sc.name}`,
          location: sc.location,
          coords: sc.gps_coords,
          status: sc.status,
          type: sc.mode,
          persons: sc.persons,
          vehicles: sc.vehicles,
          weapons: sc.weapons,
        });
      });

      marker.addTo(map);
      sectorMarkersRef.current.push(marker);
    });

    // Invalidate size in case of container reflows
    setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      // Keep map alive across standard re-renders
    };
  }, [deviceCoords, primaryCameraName]);

  // Clean teardown on true unmount
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // 5. Handle Tile Layer Switch (Google Satellite vs Google Roadmap)
  const handleMapTypeChange = (newType) => {
    setMapType(newType);
    const targetConfig = GOOGLE_TILES[newType] || GOOGLE_TILES.hybrid;

    if (mapRef.current && currentTileLayerRef.current) {
      mapRef.current.removeLayer(currentTileLayerRef.current);
      const newLayer = L.tileLayer(targetConfig.url, {
        subdomains: targetConfig.subdomains,
        maxZoom: targetConfig.maxZoom,
      });
      newLayer.addTo(mapRef.current);
      currentTileLayerRef.current = newLayer;
    }

    if (modalMapRef.current && modalTileLayerRef.current) {
      modalMapRef.current.removeLayer(modalTileLayerRef.current);
      const newModalLayer = L.tileLayer(targetConfig.url, {
        subdomains: targetConfig.subdomains,
        maxZoom: targetConfig.maxZoom,
      });
      newModalLayer.addTo(modalMapRef.current);
      modalTileLayerRef.current = newModalLayer;
    }
  };

  // 6. Recenter on Detected Device Camera
  const handleLocateDeviceCamera = () => {
    setIsLocating(true);
    if (mapRef.current) {
      mapRef.current.flyTo([deviceCoords.lat, deviceCoords.lng], 17, {
        duration: 1.2,
      });
      if (deviceMarkerRef.current) {
        deviceMarkerRef.current.openPopup();
      }
    }
    setTimeout(() => setIsLocating(false), 1300);
  };

  // 7. Fullscreen Modal Map Handler
  useEffect(() => {
    if (!isExpanded || !modalMapContainerRef.current) return;

    const modalMap = L.map(modalMapContainerRef.current, {
      center: [deviceCoords.lat, deviceCoords.lng],
      zoom: 17,
      zoomControl: true,
      attributionControl: false,
    });

    const activeConfig = GOOGLE_TILES[mapType] || GOOGLE_TILES.hybrid;
    const tileLayer = L.tileLayer(activeConfig.url, {
      subdomains: activeConfig.subdomains,
      maxZoom: activeConfig.maxZoom,
    });
    tileLayer.addTo(modalMap);
    modalTileLayerRef.current = tileLayer;

    const marker = L.marker([deviceCoords.lat, deviceCoords.lng], {
      icon: createDeviceMarkerIcon('C-01 (DEVICE)', true, false),
    });

    marker.bindPopup(
      buildPopupContent(
        `C-01 ${primaryCameraName}`,
        deviceCoords.locationName,
        deviceCoords.gpsFormatted,
        'ONLINE',
        'Primary Detected Device Camera',
        deviceCoords.accuracy,
        1,
        0,
        0
      ),
      { className: 'tactical-leaflet-popup', closeButton: false }
    );
    marker.addTo(modalMap);
    modalDeviceMarkerRef.current = marker;

    // Render 7 regional sector cameras in modal map
    modalSectorMarkersRef.current.forEach((m) => m.remove());
    modalSectorMarkersRef.current = [];

    SECTOR_CAMERAS_MAP.forEach((sc) => {
      const isThreat = sc.weapons > 0;
      const mMarker = L.marker([sc.lat, sc.lng], {
        icon: createDeviceMarkerIcon(sc.code, false, isThreat),
      });
      mMarker.bindPopup(
        buildPopupContent(
          `${sc.code} ${sc.name}`,
          sc.location,
          sc.gps_coords,
          sc.status,
          sc.mode,
          null,
          sc.persons,
          sc.vehicles,
          sc.weapons
        ),
        { className: 'tactical-leaflet-popup', closeButton: false }
      );
      mMarker.addTo(modalMap);
      modalSectorMarkersRef.current.push(mMarker);
    });

    modalMapRef.current = modalMap;

    setTimeout(() => {
      modalMap.invalidateSize();
      marker.openPopup();
    }, 250);

    return () => {
      if (modalMapRef.current) {
        modalMapRef.current.remove();
        modalMapRef.current = null;
      }
    };
  }, [isExpanded]);

  return (
    <div className="tactical-card surveillance-map-card">
      {/* Card Header */}
      <div className="card-header">
        <div className="card-title-group">
          <div className="card-title-row">
            <Radio size={18} className="card-title-icon text-green pulse-ring" />
            <h3 className="card-title font-bold">Surveillance Map (Google Maps GIS)</h3>
          </div>
          <span className="card-subtitle font-mono">
            Live Device Camera: <strong className="text-white">{primaryCameraName}</strong> • {deviceCoords.locationName}
          </span>
        </div>

        {/* Legend */}
        <div className="map-legend font-mono">
          <div className="legend-item">
            <span className="legend-dot green-dot"></span>
            <span>Device Camera</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot cyan-dot"></span>
            <span>Google Satellite</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot red-square"></span>
            <span>Alert Active</span>
          </div>
        </div>
      </div>

      {/* Real Google Map Viewport */}
      <div className="google-map-viewport">
        {/* Top Overlay HUD Badges */}
        <div className="map-overlay-top-left font-mono">
          <div className="hud-badge-item">
            <span className="hud-label">DETECTED CAM:</span>
            <strong className="text-green">{primaryCameraName}</strong>
          </div>
          <div className="hud-badge-item">
            <span className="hud-label">SECTOR:</span>
            <strong className="text-white">{deviceCoords.locationName}</strong>
          </div>
          <div className="hud-badge-item">
            <span className="hud-label">GIS SENSORS:</span>
            <strong className="text-cyan">8 CAMERAS LINKED</strong>
          </div>
        </div>

        <div className="map-overlay-top-right font-mono">
          <div className="hud-gps-pill">
            <MapPin size={11} className="text-cyan" />
            <span>{deviceCoords.gpsFormatted}</span>
          </div>
        </div>

        {/* Tactical Map Floating Controls */}
        <div className="map-floating-controls font-mono">
          {/* Tile Switcher: Satellite vs Road */}
          <div className="map-layer-switch-group">
            <button
              className={`layer-switch-btn ${mapType === 'hybrid' ? 'active' : ''}`}
              onClick={() => handleMapTypeChange('hybrid')}
              title="Google Satellite Hybrid with Street Labels"
            >
              <Layers size={12} />
              <span>SATELLITE</span>
            </button>
            <button
              className={`layer-switch-btn ${mapType === 'roadmap' ? 'active' : ''}`}
              onClick={() => handleMapTypeChange('roadmap')}
              title="Google Standard Vector Road Map"
            >
              <span>ROADMAP</span>
            </button>
          </div>

          {/* Quick Recenter Button */}
          <button
            className={`locate-cam-btn ${isLocating ? 'locating' : ''}`}
            onClick={handleLocateDeviceCamera}
            title="Recenter Map on Detected Device Camera"
          >
            <Crosshair size={13} className={isLocating ? 'animate-spin text-green' : 'text-cyan'} />
            <span>LOCATE CAM</span>
          </button>
        </div>

        {/* Leaflet Map DOM Node */}
        <div ref={mapContainerRef} className="leaflet-map-element" />

        {/* Bottom Demarcation / Telemetry Overlay */}
        <div className="map-demarcation-label font-mono">
          GOOGLE MAPS PRECISION GIS • SENSOR ACTIVE
        </div>

        <div className="map-telemetry-bar font-mono">
          <div className="telemetry-item">
            ACCURACY: <span>±{deviceCoords.accuracy}m</span>
          </div>
          <div className="telemetry-divider">|</div>
          <div className="telemetry-item">
            LATENCY: <span>{latency}ms</span>
          </div>
          <div className="telemetry-divider">|</div>
          <div className="telemetry-item">
            TILE ENGINE: <span>{mapType === 'hybrid' ? 'Google Satellite' : 'Google Vector'}</span>
          </div>
        </div>
      </div>

      {/* Card Footer Bar */}
      <div className="card-footer-bar font-mono">
        <div className="footer-status-info">
          <span className="dot-green status-dot pulse-ring"></span>
          <span className="footer-status-text">
            Live GPS telemetry linked <span className="text-sep">•</span> Hardware sensor: <strong className="text-green">{primaryCameraName}</strong> <span className="text-sep">•</span> Latency {latency}ms
          </span>
        </div>

        <button 
          className="btn-tactical btn-primary"
          onClick={() => setIsExpanded(true)}
          title="Open Fullscreen Tactical Google Map Inspector"
        >
          <Maximize2 size={13} />
          <span>Expand Defense Map</span>
        </button>
      </div>

      {/* Fullscreen Tactical Google Map Modal */}
      {isExpanded && (
        <div className="modal-backdrop-blur">
          <div className="fullscreen-map-modal font-mono">
            <div className="modal-header-bar">
              <div className="header-title-group">
                <Radio size={18} className="text-green animate-pulse" />
                <h3 className="text-white font-bold">TACTICAL GOOGLE DEFENSE MAP — SENSOR INSPECTION</h3>
                <span className="pill-badge pill-green">LIVE STREAMING</span>
              </div>

              <div className="header-actions-group">
                <div className="map-layer-switch-group">
                  <button
                    className={`layer-switch-btn ${mapType === 'hybrid' ? 'active' : ''}`}
                    onClick={() => handleMapTypeChange('hybrid')}
                  >
                    SATELLITE
                  </button>
                  <button
                    className={`layer-switch-btn ${mapType === 'roadmap' ? 'active' : ''}`}
                    onClick={() => handleMapTypeChange('roadmap')}
                  >
                    ROADMAP
                  </button>
                </div>

                <button
                  className="modal-close-btn"
                  onClick={() => setIsExpanded(false)}
                  title="Close Map View"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="modal-map-viewport">
              <div ref={modalMapContainerRef} className="leaflet-map-element" style={{ width: '100%', height: '100%' }} />
            </div>

            <div className="modal-footer-stats font-mono">
              <div>
                <span className="text-muted">DETECTED CAMERA: </span>
                <strong className="text-green">{primaryCameraName}</strong>
              </div>
              <div>
                <span className="text-muted">LOCATION: </span>
                <strong className="text-white">{deviceCoords.locationName}</strong>
              </div>
              <div>
                <span className="text-muted">COORDINATES: </span>
                <strong className="text-yellow">{deviceCoords.gpsFormatted}</strong>
              </div>
              <div>
                <span className="text-muted">PRECISION: </span>
                <strong className="text-cyan">±{deviceCoords.accuracy}m (High Accuracy)</strong>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SurveillanceMap;
