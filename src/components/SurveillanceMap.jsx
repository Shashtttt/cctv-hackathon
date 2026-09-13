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
  ExternalLink,
  LocateFixed,
  Navigation
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useLocation, formatGpsCoords } from '../context/LocationContext';
import './SurveillanceMap.css';

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
  const step = 6;
  for (let b = bearing - halfFov; b <= bearing + halfFov; b += step) {
    points.push(calculateDestination(centerLat, centerLon, distanceMeters, b));
  }
  points.push(calculateDestination(centerLat, centerLon, distanceMeters, bearing + halfFov));
  return points;
}

export const SurveillanceMap = ({ lastPing = 3, latency = 14 }) => {
  const { theme } = useTheme();
  const { 
    coords, 
    locationName, 
    isLiveGps, 
    isLoading: isLocLoading, 
    detectLocation, 
    setManualLocation, 
    connectedCameras 
  } = useLocation();

  const mapContainerRef = useRef(null);
  const leafletMapRef = useRef(null);
  const layersGroupRef = useRef(null);

  const [mapLayerType, setMapLayerType] = useState('google_hybrid'); // google_hybrid | google_roads | dark_matter | positron
  const [selectedItem, setSelectedItem] = useState(null);
  const [showFovCones, setShowFovCones] = useState(true);
  const [showDeviceLinks, setShowDeviceLinks] = useState(true);
  const [showPerimeterLine, setShowPerimeterLine] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLeafletReady, setIsLeafletReady] = useState(false);
  const [clickToPlaceMode, setClickToPlaceMode] = useState(false);

  // Active Device details dynamically centered at current coordinates
  const activeDevice = {
    id: 'DEV-EDGE-MASTER',
    name: `${locationName || 'Live Location'} Edge Hub`,
    model: 'NVIDIA Jetson AGX Orin 64GB Industrial',
    ip: '192.168.1.1 (Dynamic Edge Node)',
    coords: [coords.latitude, coords.longitude],
    status: 'online',
    uplink: isLiveGps ? 'Direct Hardware Sensor GPS / Fiber' : 'Network Geolocation / Dual-Link',
    power: '100% Active',
    connectedCams: connectedCameras.map(c => c.id),
    gpsFormatted: coords.formatted,
    elevation: '+215m MSL'
  };

  // Set default selected item
  useEffect(() => {
    if (!selectedItem || selectedItem.id === 'DEV-EDGE-MASTER') {
      setSelectedItem(connectedCameras.find(c => c.status === 'alert') || connectedCameras[0] || activeDevice);
    }
  }, [coords.latitude, coords.longitude]);

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
      if (checkLeaflet()) clearInterval(timer);
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

    // Initialize Map at dynamic coords
    const map = L.map(mapContainerRef.current, {
      center: [coords.latitude, coords.longitude],
      zoom: 16,
      zoomControl: false,
      attributionControl: false,
    });

    leafletMapRef.current = map;

    // Add zoom controls on top right
    L.control.zoom({ position: 'topright' }).addTo(map);

    // Map Click Listener to move device anywhere dynamically
    map.on('click', (e) => {
      const { lat, lng } = e.latlng;
      setManualLocation(lat, lng);
    });

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

    L.tileLayer(tileUrl, tileOptions).addTo(map);

    // Create a layer group for vector elements (lines, markers, cones)
    const layerGroup = L.layerGroup().addTo(map);
    layersGroupRef.current = layerGroup;

    // 1. Draw continuous Perimeter Demarcation Line connecting all cameras
    const cameraLinePoints = connectedCameras.map(cam => cam.coords);

    if (showPerimeterLine && cameraLinePoints.length > 1) {
      L.polyline(cameraLinePoints, {
        color: '#00f2fe',
        weight: 6,
        opacity: 0.35,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(layerGroup);

      L.polyline(cameraLinePoints, {
        color: '#00f2fe',
        weight: 2.5,
        opacity: 0.9,
        dashArray: '8, 8',
        lineCap: 'round',
      }).addTo(layerGroup);
    }

    // 2. Draw Device -> Camera Link Cables (same line topology)
    if (showDeviceLinks) {
      const devCoord = [coords.latitude, coords.longitude];
      connectedCameras.forEach(cam => {
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
      connectedCameras.forEach(cam => {
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

    // 4. Place Master Edge Processing Device Marker (Draggable)
    const isDevSelected = selectedItem?.id === activeDevice.id;
    const deviceIcon = L.divIcon({
      className: 'custom-leaflet-marker',
      html: `
        <div class="device-marker-wrapper ${isDevSelected ? 'marker-selected' : ''}">
          <div class="device-diamond-icon">
            <span class="device-icon-symbol">📡</span>
          </div>
          <div class="device-label-pill font-mono">
            <span class="device-name-badge">${isLiveGps ? 'LIVE GPS' : 'EDGE HUB'}</span>
            <span class="device-name-text">${locationName ? locationName.split(',')[0] : 'Device Node'}</span>
          </div>
        </div>
      `,
      iconSize: [150, 50],
      iconAnchor: [75, 25],
    });

    const devMarker = L.marker([coords.latitude, coords.longitude], { 
      icon: deviceIcon, 
      zIndexOffset: 900,
      draggable: true,
    }).addTo(layerGroup);

    devMarker.on('dragend', (e) => {
      const pos = e.target.getLatLng();
      setManualLocation(pos.lat, pos.lng);
    });

    devMarker.on('click', () => {
      setSelectedItem(activeDevice);
    });

    // 5. Place Camera Markers along the perimeter line
    connectedCameras.forEach((cam, idx) => {
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
    coords.latitude,
    coords.longitude,
    locationName,
    mapLayerType,
    showFovCones,
    showDeviceLinks,
    showPerimeterLine,
    selectedItem?.id,
    isExpanded,
  ]);

  // Recenter Map Helper
  const handleRecenter = () => {
    if (leafletMapRef.current) {
      leafletMapRef.current.setView([coords.latitude, coords.longitude], 16, { animate: true });
    }
  };

  return (
    <div className={`tactical-card surveillance-map-card ${isExpanded ? 'surveillance-map-expanded-modal' : ''}`}>
      {/* Card Header */}
      <div className="card-header">
        <div className="card-title-group">
          <div className="card-title-row">
            <Radio size={16} className="card-title-icon text-cyan" />
            <h3 className="card-title">Dynamic Perimeter Surveillance Map</h3>
            <span className="perimeter-count-badge font-mono">
              {connectedCameras.length} CAMERAS IN LINE • 1 EDGE HUB
            </span>
          </div>
          <span className="card-subtitle">
            📍 Real-Time Location: <strong className="text-cyan">{locationName}</strong> ({coords.formatted})
          </span>
        </div>

        {/* Header Right Controls */}
        <div className="map-header-controls font-mono">
          {/* Live GPS / Detect Button */}
          <button
            onClick={detectLocation}
            className={`map-tool-btn ${isLiveGps ? 'active' : ''}`}
            title="Detect real device hardware GPS / IP location"
          >
            <LocateFixed size={12} className={isLiveGps ? "text-green-400 animate-spin" : "text-cyan"} />
            <span>{isLiveGps ? 'LIVE GPS ACTIVE' : 'DETECT MY LOCATION'}</span>
          </button>

          {/* Quick Location Teleport Dropdown */}
          <select 
            onChange={(e) => {
              const val = e.target.value;
              if (val === 'current_gps') {
                detectLocation();
              } else if (val === 'gurgaon_cybercity') {
                setManualLocation(28.4949, 77.0895, 'DLF Cyber City, Gurgaon, Haryana');
              } else if (val === 'gurgaon_sec29') {
                setManualLocation(28.4682, 77.0620, 'Sector 29, Gurgaon, Haryana');
              } else if (val === 'noida_sec28') {
                setManualLocation(28.5708, 77.3271, 'Noida Sector 28, Uttar Pradesh');
              } else if (val === 'delhi_cp') {
                setManualLocation(28.6315, 77.2167, 'Connaught Place, New Delhi');
              }
            }}
            className="map-sector-select font-mono"
            title="Switch Location Corridor"
            defaultValue=""
          >
            <option value="" disabled>Jump Location...</option>
            <option value="current_gps">🛰️ Auto-Detect My Live Location</option>
            <option value="gurgaon_cybercity">📍 Gurgaon DLF Cyber City</option>
            <option value="gurgaon_sec29">📍 Gurgaon Sector 29 Leisure Valley</option>
            <option value="noida_sec28">📍 Noida Sector 28 Corridor</option>
            <option value="delhi_cp">📍 New Delhi Connaught Place</option>
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
            <Compass size={11} className="text-cyan" /> {locationName}
          </span>
        </div>

        <div className="map-overlay-top-right font-mono">
          <span className="overlay-pill">
            <Crosshair size={11} className="text-coral" /> LAT {coords.latitude.toFixed(4)}° N • LONG {coords.longitude.toFixed(4)}° E
          </span>
        </div>

        {/* Floating In-Map Quick Layer Toggles & Instructions */}
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
            title="Recenter Map View on Device"
          >
            <RefreshCw size={11} />
            <span>Recenter</span>
          </button>

          <div className="map-hint-text">
            <span>💡 Click map to move device & cameras</span>
          </div>
        </div>

        {/* Selected Node HUD Tactical Telemetry Inspector Card */}
        {selectedItem && (
          <div className="map-selected-hud-card font-mono">
            <div className="hud-header-row">
              <div className="hud-title-left">
                {selectedItem.id === 'DEV-EDGE-MASTER' || selectedItem.model ? (
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
                <span className="hud-meta-label">LOCATION:</span>
                <span className="hud-meta-val">{locationName}</span>
              </div>
              <div className="hud-meta-item">
                <span className="hud-meta-label">HARDWARE:</span>
                <span className="hud-meta-val">{selectedItem.type || selectedItem.model}</span>
              </div>
              <div className="hud-meta-item">
                <span className="hud-meta-label">TOPOLOGY:</span>
                <span className="hud-meta-val text-amber-400">
                  {selectedItem.connectedDevice ? `Linked to ${selectedItem.connectedDevice}` : `${connectedCameras.length} Cams in Linear Chain`}
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
            AREA: <span className="text-cyan font-bold">{locationName}</span>
          </div>
          <div className="telemetry-divider">|</div>
          <div className="telemetry-item">
            COORDINATES: <span className="text-cyan font-bold">{coords.formatted}</span>
          </div>
          <div className="telemetry-divider">|</div>
          <div className="telemetry-item">
            SOURCE: <span className={isLiveGps ? "text-green-400 font-bold" : "text-amber-400 font-bold"}>
              {isLiveGps ? 'LIVE HARDWARE GPS' : 'NETWORK/USER DEFINED'}
            </span>
          </div>
          <div className="telemetry-divider">|</div>
          <div className="telemetry-item">
            TILES: <span className="text-main uppercase">{mapLayerType.replace('_', ' ')}</span>
          </div>
        </div>
      </div>

      {/* Card Footer Bar */}
      <div className="card-footer-bar font-mono">
        <div className="footer-status-info">
          <span className="dot-cyan status-dot pulse-ring"></span>
          <span className="footer-status-text">
            Ping {lastPing}s <span className="text-sep">•</span> Latency {latency}ms <span className="text-sep">•</span> <strong className="cyan-highlight">Dynamic Linear Perimeter Active</strong>
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
