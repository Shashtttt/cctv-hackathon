import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Plus, Minus, Navigation, Layers, Video, AlertTriangle, Crosshair, MapPin } from 'lucide-react';
import { useLocation } from '../../context/LocationContext';
import { fetchCameras } from '../../services/apiService';
import './CameraMapPanel.css';

// Google Maps Satellite and Roadmap Tile Providers
const GOOGLE_TILES = {
  satellite: {
    url: 'https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    maxZoom: 20,
    attribution: '&copy; Google Maps'
  },
  roadmap: {
    url: 'https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    maxZoom: 20,
    attribution: '&copy; Google Maps'
  }
};

export default function CameraMapPanel({ onSelectCamera }) {
  const { coords, locationName, isLiveGps, detectLocation, connectedCameras } = useLocation();
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const markersGroupRef = useRef(null);
  const alertZoneGroupRef = useRef(null);
  const borderLineRef = useRef(null);

  const [mapLayerType, setMapLayerType] = useState('satellite'); // 'satellite' | 'roadmap'
  const [selectedCamInfo, setSelectedCamInfo] = useState(null);
  const [dbCameras, setDbCameras] = useState([]);

  useEffect(() => {
    let isMounted = true;
    const load = () => {
      fetchCameras()
        .then((cams) => {
          if (!isMounted) return;
          if (Array.isArray(cams)) {
            const real = cams.filter((c) => !c.rtsp_url || !c.rtsp_url.startsWith('synthetic://'));
            setDbCameras(real);
          }
        })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, 5000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const center = [coords.latitude || 28.4949, coords.longitude || 77.0895];
      const map = L.map(mapContainerRef.current, {
        center,
        zoom: 15,
        zoomControl: false,
        attributionControl: false
      });

      // Add Satellite Tile Layer
      const tileConfig = GOOGLE_TILES[mapLayerType];
      const tileLayer = L.tileLayer(tileConfig.url, {
        subdomains: tileConfig.subdomains,
        maxZoom: tileConfig.maxZoom
      }).addTo(map);

      tileLayerRef.current = tileLayer;
      markersGroupRef.current = L.layerGroup().addTo(map);
      alertZoneGroupRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update Tile Layer when user toggles layer
  useEffect(() => {
    if (!mapInstanceRef.current || !tileLayerRef.current) return;
    const tileConfig = GOOGLE_TILES[mapLayerType];
    tileLayerRef.current.setUrl(tileConfig.url);
  }, [mapLayerType]);

  // Update Markers & Polyline dynamically based on real live coordinates and cameras
  useEffect(() => {
    if (!mapInstanceRef.current || !markersGroupRef.current) return;

    const map = mapInstanceRef.current;
    markersGroupRef.current.clearLayers();
    if (alertZoneGroupRef.current) alertZoneGroupRef.current.clearLayers();
    if (borderLineRef.current) {
      borderLineRef.current.remove();
      borderLineRef.current = null;
    }

    const centerLat = coords.latitude || 28.4949;
    const centerLng = coords.longitude || 77.0895;

    // Recenter map smoothly if coordinates change
    map.panTo([centerLat, centerLng], { animate: true, duration: 1 });

    // 1. Live Device GPS Location Marker
    const deviceIconHtml = `
      <div class="live-device-gps-marker">
        <span class="device-pulse-ring"></span>
        <span class="device-center-dot"></span>
      </div>
    `;
    const deviceIcon = L.divIcon({
      html: deviceIconHtml,
      className: 'custom-leaflet-div-icon',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    L.marker([centerLat, centerLng], { icon: deviceIcon })
      .addTo(markersGroupRef.current)
      .bindTooltip(`📍 LIVE GPS: ${locationName}`, { permanent: false, direction: 'top' });

    // 2. Plot Dynamic Cameras around the live location
    const cams = dbCameras.length > 0
      ? dbCameras.map((c, idx) => ({
          id: c.id,
          name: c.name || `Camera ${idx + 1}`,
          coords: (c.latitude && c.longitude) ? [c.latitude, c.longitude] : [
            centerLat + (idx % 2 === 0 ? 0.0012 : -0.0012) * Math.ceil((idx + 1) / 2),
            centerLng + (idx % 3 === 0 ? 0.0016 : -0.0016) * Math.ceil((idx + 1) / 2)
          ],
          status: (c.is_running || c.is_active || c.status === 'online') ? 'online' : 'offline',
          hasAlert: false,
        }))
      : (connectedCameras && connectedCameras.length > 0 ? connectedCameras : [
          { id: 'cam-01', name: 'Optical Sensor 01', coords: [centerLat, centerLng] }
        ]);


    const polylineCoords = [];

    cams.forEach((cam, idx) => {
      const camCoords = cam.coords || [
        centerLat + (idx % 2 === 0 ? 0.0015 : -0.0015) * Math.ceil((idx + 1) / 2),
        centerLng + (idx % 3 === 0 ? 0.002 : -0.002) * Math.ceil((idx + 1) / 2)
      ];

      polylineCoords.push(camCoords);

      const isAlert = cam.hasAlert || cam.status === 'alert' || idx === 4;
      const camLabel = `Cam 0${idx + 1}`;

      const camIconHtml = `
        <div class="camera-leaflet-marker ${isAlert ? 'cam-marker-alert' : ''}">
          <div class="cam-marker-icon-box">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="m22 8-6 4 6 4V8Z"/>
              <rect width="14" height="12" x="2" y="6" rx="2"/>
            </svg>
          </div>
          <span class="cam-marker-text">${camLabel}</span>
        </div>
      `;

      const camIcon = L.divIcon({
        html: camIconHtml,
        className: 'custom-leaflet-div-icon',
        iconSize: [64, 22],
        iconAnchor: [32, 11]
      });

      const marker = L.marker(camCoords, { icon: camIcon })
        .addTo(markersGroupRef.current)
        .on('click', () => {
          setSelectedCamInfo({
            id: cam.id,
            name: cam.name || camLabel,
            gps: `${camCoords[0].toFixed(4)}° N, ${camCoords[1].toFixed(4)}° E`,
            status: isAlert ? 'ALERT ACTIVE' : 'ONLINE'
          });
          if (onSelectCamera) onSelectCamera(cam.id);
        });

      // 3. Alert Zone around alert camera (Cam 05)
      if (isAlert && alertZoneGroupRef.current) {
        L.circle(camCoords, {
          radius: 120,
          color: '#ef4444',
          dashArray: '4, 4',
          weight: 1.5,
          fillColor: '#ef4444',
          fillOpacity: 0.22
        }).addTo(alertZoneGroupRef.current);

        const alertSymbolHtml = `
          <div class="alert-radar-pulse-icon">
            <span class="radar-ping-ring"></span>
            <span class="alert-warn-triangle">▲</span>
          </div>
        `;
        const alertSymbolIcon = L.divIcon({
          html: alertSymbolHtml,
          className: 'custom-leaflet-div-icon',
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        });
        L.marker(camCoords, { icon: alertSymbolIcon }).addTo(alertZoneGroupRef.current);
      }
    });

    // 4. Dashed Red Border Line connecting the perimeter
    if (polylineCoords.length > 1) {
      borderLineRef.current = L.polyline(polylineCoords, {
        color: '#ef4444',
        weight: 2,
        dashArray: '6, 5',
        opacity: 0.85
      }).addTo(map);
    }
  }, [coords, connectedCameras, locationName]);

  // Controls
  const handleZoomIn = () => mapInstanceRef.current?.zoomIn();
  const handleZoomOut = () => mapInstanceRef.current?.zoomOut();
  const handleRecenter = () => {
    detectLocation();
    if (mapInstanceRef.current && coords.latitude) {
      mapInstanceRef.current.flyTo([coords.latitude, coords.longitude], 15, { duration: 1.2 });
    }
  };
  const handleToggleLayer = () => {
    setMapLayerType((t) => (t === 'satellite' ? 'roadmap' : 'satellite'));
  };

  return (
    <div className="camera-map-panel">
      {/* Header */}
      <div className="camera-map-header">
        <div className="map-title-row">
          <h3 className="camera-map-title">Camera Map</h3>
          <div className="map-gps-live-tag" title={coords.formatted}>
            <span className="live-gps-dot"></span>
            <span className="live-gps-text">{isLiveGps ? 'GPS ACTIVE' : 'IP GEO'}</span>
          </div>
        </div>
        <div className="map-location-breadcrumb" title={locationName}>
          <MapPin size={11} className="text-cyan" />
          <span>{locationName}</span>
        </div>
      </div>

      {/* Map Viewport Area */}
      <div className="camera-map-viewport">
        {/* Real Leaflet Map Container */}
        <div ref={mapContainerRef} className="leaflet-map-target"></div>

        {/* Selected Camera Quick Info Bubble */}
        {selectedCamInfo && (
          <div className="map-cam-detail-bubble">
            <div className="bubble-header">
              <span className="bubble-title">{selectedCamInfo.name}</span>
              <button className="bubble-close" onClick={() => setSelectedCamInfo(null)}>×</button>
            </div>
            <div className="bubble-coords">{selectedCamInfo.gps}</div>
            <div className={`bubble-status ${selectedCamInfo.status.includes('ALERT') ? 'status-alert' : 'status-ok'}`}>
              {selectedCamInfo.status}
            </div>
          </div>
        )}

        {/* Top-Right Zoom Controls */}
        <div className="map-controls-top-right">
          <button className="map-ctrl-btn" onClick={handleZoomIn} title="Zoom In">
            <Plus size={14} />
          </button>
          <button className="map-ctrl-btn" onClick={handleZoomOut} title="Zoom Out">
            <Minus size={14} />
          </button>
        </div>

        {/* Bottom-Right Compass & Layer Controls */}
        <div className="map-controls-bottom-right">
          <button className="map-ctrl-btn" onClick={handleRecenter} title="Recenter to Live GPS Location">
            <Crosshair size={13} className="text-cyan" />
          </button>
          <button className="map-ctrl-btn" onClick={handleToggleLayer} title={`Switch to ${mapLayerType === 'satellite' ? 'Roadmap' : 'Satellite'}`}>
            <Layers size={13} />
          </button>
        </div>
      </div>

      {/* Bottom Map Legend */}
      <div className="camera-map-legend">
        <div className="legend-item">
          <span className="legend-dot-cam"></span>
          <span>Camera</span>
        </div>
        <div className="legend-item">
          <span className="legend-triangle-alert">▲</span>
          <span>Alert Zone</span>
        </div>
        <div className="legend-item">
          <span className="legend-line-border"></span>
          <span>Border Line</span>
        </div>
      </div>
    </div>
  );
}
