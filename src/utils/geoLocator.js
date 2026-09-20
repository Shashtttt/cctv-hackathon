/**
 * High-Accuracy Reverse Geolocation & Sector Location Resolver
 * Formats human-readable Indian city & sector names (e.g. "Noida Sector 28", "Gurgaon Cyber City")
 * and pairs them with high-precision GPS telemetry.
 */

export const POPULAR_LOCATIONS = [
  {
    id: 'noida_sec28',
    name: 'Noida Sector 28',
    fullName: 'Noida Sector 28, Gautam Buddha Nagar, Uttar Pradesh',
    shortName: 'Noida Sec 28',
    city: 'Noida',
    state: 'Uttar Pradesh',
    latitude: 28.5708,
    longitude: 77.3271,
    gps: '28.5708° N, 77.3271° E',
  },
  {
    id: 'gurgaon_cybercity',
    name: 'Gurgaon Cyber City',
    fullName: 'DLF Cyber City, Phase 2, Gurgaon, Haryana',
    shortName: 'Gurgaon Cyber City',
    city: 'Gurgaon',
    state: 'Haryana',
    latitude: 28.4949,
    longitude: 77.0895,
    gps: '28.4949° N, 77.0895° E',
  },
  {
    id: 'gurgaon_sec29',
    name: 'Gurgaon Sector 29',
    fullName: 'Sector 29, Leisure Valley, Gurgaon, Haryana',
    shortName: 'Gurgaon Sec 29',
    city: 'Gurgaon',
    state: 'Haryana',
    latitude: 28.4682,
    longitude: 77.0620,
    gps: '28.4682° N, 77.0620° E',
  },
  {
    id: 'noida_sec132',
    name: 'Noida Sector 132 Expressway',
    fullName: 'Sector 132, Noida Expressway, Uttar Pradesh',
    shortName: 'Noida Sec 132',
    city: 'Noida',
    state: 'Uttar Pradesh',
    latitude: 28.5085,
    longitude: 77.3774,
    gps: '28.5085° N, 77.3774° E',
  },
  {
    id: 'delhi_cp',
    name: 'New Delhi Connaught Place',
    fullName: 'Connaught Place, Inner Circle, New Delhi',
    shortName: 'New Delhi CP',
    city: 'New Delhi',
    state: 'Delhi',
    latitude: 28.6315,
    longitude: 77.2167,
    gps: '28.6315° N, 77.2167° E',
  },
  {
    id: 'gurgaon_sohna',
    name: 'Gurgaon Sohna Road',
    fullName: 'Sector 48, Sohna Road, Gurgaon, Haryana',
    shortName: 'Gurgaon Sohna Rd',
    city: 'Gurgaon',
    state: 'Haryana',
    latitude: 28.4198,
    longitude: 77.0401,
    gps: '28.4198° N, 77.0401° E',
  },
];

// In-memory geocode cache keyed by lat_lon rounded to 3 decimal places (~100m)
const geocodeCache = new Map();

/**
 * Fast geometric match for Delhi NCR & prominent Indian sectors
 */
function fastLocalMatch(lat, lon) {
  // Noida Sector 28 & surrounding sectors (Sector 27, 28, 29, Atta Market)
  if (lat >= 28.560 && lat <= 28.585 && lon >= 77.315 && lon <= 77.345) {
    return 'Noida Sector 28, Uttar Pradesh';
  }
  // Noida Expressway & Sector 128-135
  if (lat >= 28.490 && lat <= 28.530 && lon >= 77.360 && lon <= 77.400) {
    return 'Noida Sector 132, Expressway';
  }
  // Gurgaon Cyber City & DLF Phase 2 / Phase 3
  if (lat >= 28.485 && lat <= 28.520 && lon >= 77.075 && lon <= 77.110) {
    return 'Gurgaon - Cyber City, Haryana';
  }
  // Gurgaon Sector 29 / IFFCO Chowk / MG Road
  if (lat >= 28.455 && lat <= 28.484 && lon >= 77.050 && lon <= 77.074) {
    return 'Gurgaon Sector 29, Haryana';
  }
  // Gurgaon Golf Course Road / Sector 54
  if (lat >= 28.430 && lat <= 28.460 && lon >= 77.090 && lon <= 77.120) {
    return 'Gurgaon - Golf Course Road, Haryana';
  }
  // New Delhi Connaught Place
  if (lat >= 28.618 && lat <= 28.645 && lon >= 77.205 && lon <= 77.235) {
    return 'Connaught Place, New Delhi';
  }
  // IGI Airport Delhi
  if (lat >= 28.540 && lat <= 28.580 && lon >= 77.070 && lon <= 77.130) {
    return 'IGI Airport, New Delhi';
  }
  return null;
}

/**
 * Reverse-geocode latitude and longitude into human-readable city/area/sector name
 * @param {number} latitude
 * @param {number} longitude
 * @returns {Promise<string>} e.g. "Noida Sector 28, Uttar Pradesh" or "Gurgaon, Cyber City"
 */
export async function reverseGeocodeCoords(latitude, longitude) {
  if (!latitude || !longitude || isNaN(latitude) || isNaN(longitude)) {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('ibvap_dynamic_location_name') : null;
      if (saved) return saved;
    } catch {}
    return 'Noida Sector 28, Uttar Pradesh';
  }

  const cacheKey = `${latitude.toFixed(3)}_${longitude.toFixed(3)}`;
  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey);
  }

  // 1. Try instant fast local bounding box match
  const localMatch = fastLocalMatch(latitude, longitude);
  if (localMatch) {
    geocodeCache.set(cacheKey, localMatch);
    return localMatch;
  }

  // 2. Fetch live reverse geocode from OpenStreetMap Nominatim with 3.5s timeout
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=16&addressdetails=1`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'IBVAP-Surveillance-Platform/1.0',
      },
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      const addr = data.address || {};

      // Extract most specific locality
      const sectorOrSub = addr.suburb || addr.neighbourhood || addr.residential || addr.road || '';
      const cityOrTown = addr.city || addr.town || addr.city_district || addr.county || '';
      const state = addr.state || '';

      const parts = [];
      if (sectorOrSub) parts.push(sectorOrSub);
      if (cityOrTown && !parts.includes(cityOrTown)) parts.push(cityOrTown);
      if (state && !parts.includes(state)) parts.push(state);

      const resolved = parts.length > 0 ? parts.join(', ') : (data.display_name?.split(',').slice(0, 3).join(', ') || null);

      if (resolved) {
        // Normalise Gurugram -> Gurgaon if desired
        const cleanName = resolved.replace(/Gurugram/i, 'Gurgaon');
        geocodeCache.set(cacheKey, cleanName);
        return cleanName;
      }
    }
  } catch (err) {
    // Network timeout or blocked — fallback gracefully
  }

  // 3. Fallback: Find nearest popular location
  let nearest = POPULAR_LOCATIONS[0];
  let minD = Infinity;
  for (const loc of POPULAR_LOCATIONS) {
    const d = Math.hypot(loc.latitude - latitude, loc.longitude - longitude);
    if (d < minD) {
      minD = d;
      nearest = loc;
    }
  }

  const fallback = nearest.name;
  geocodeCache.set(cacheKey, fallback);
  return fallback;
}
