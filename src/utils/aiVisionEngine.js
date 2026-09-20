/**
 * Software-Defined AI Computer Vision Engine for IBVAP
 * Simulates and processes real-time video analytics for human, vehicle,
 * face, ANPR, loitering, and intrusion detection.
 *
 * FIX HISTORY:
 * - [HIGH] Added destroy() method + clearInterval cleanup to prevent memory leaks
 * - [HIGH] fence insideFenceTriggered now resets on fence geometry change
 * - [HIGH] Tick interval is now dynamic based on camera FPS (was hardcoded 200ms)
 * - [MEDIUM] Alert de-duplication throttle (2s min between same-target alerts)
 * - [MEDIUM] Callback accepted per-step (not captured in constructor)
 * - [MEDIUM] loiterSeconds incremented each tick (was static constant)
 * - [MEDIUM] step() returns new array reference to force React re-renders
 */

// Default Watchlist Databases
export const INITIAL_FRS_WATCHLIST = [
  {
    id: 'W-901',
    name: 'Viktor K. Petrov',
    threatLevel: 'CRITICAL',
    alias: 'The Fox',
    category: 'High-Value Target',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    notes: 'Wanted for unauthorized border crossing & reconnaissance.',
    lastSeen: 'BOP-04 Marshland'
  },
  {
    id: 'W-902',
    name: 'Tariq Al-Mansoor',
    threatLevel: 'HIGH',
    alias: 'Falcon',
    category: 'Smuggling Suspect',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
    notes: 'Associated with night perimeter breaches.',
    lastSeen: 'BOP-12 South Gate'
  },
  {
    id: 'W-903',
    name: 'Elena Rostova',
    threatLevel: 'MEDIUM',
    alias: 'Shadow',
    category: 'Persons of Interest',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    notes: 'Frequent movement around Sector 7 buffer zone.',
    lastSeen: 'CHK-02 Checkpoint'
  }
];

export const INITIAL_ANPR_WATCHLIST = [
  {
    plate: 'JK-02-AX-8912',
    owner: 'Unknown / Suspicious',
    status: 'WANTED',
    vehicleType: 'Heavy Utility Truck',
    threatLevel: 'CRITICAL',
    notes: 'Reported stolen from border staging warehouse.',
    flaggedDate: '2026-09-02'
  },
  {
    plate: 'PB-10-CZ-4401',
    owner: 'Ramanjit Singh',
    status: 'SUSPICIOUS',
    vehicleType: 'Armored SUV / 4x4',
    threatLevel: 'HIGH',
    notes: 'Unregistered border transit route.',
    flaggedDate: '2026-09-05'
  },
  {
    plate: 'HR-26-BQ-7719',
    owner: 'Defense Logistics Corp',
    status: 'PERMITTED',
    vehicleType: 'Cargo Supply Truck',
    threatLevel: 'LOW',
    notes: 'Cleared supply convoy clearance.',
    flaggedDate: '2026-09-01'
  }
];

export const INITIAL_CAMERAS = [
  {
    id: 'cam-01',
    code: 'BOP-01',
    name: 'North Ridge Perimeter',
    location: 'Sector 4 - High Altitude Post',
    ip: '192.168.1.101',
    status: 'ONLINE',
    fps: 30,
    resolution: '1080p FHD',
    mode: 'STANDARD',
    activeIntrusions: 0,
    hasVirtualFence: true,
    fencePoints: [
      { x: 0.15, y: 0.35 },
      { x: 0.85, y: 0.35 },
      { x: 0.90, y: 0.85 },
      { x: 0.10, y: 0.85 }
    ]
  },
  {
    id: 'cam-02',
    code: 'BOP-04',
    name: 'Riverine Marshland IR',
    location: 'Sector 7 - Marshland Crossing',
    ip: '192.168.1.104',
    status: 'ONLINE',
    fps: 25,
    resolution: '1080p FHD',
    mode: 'THERMAL',
    activeIntrusions: 1,
    hasVirtualFence: true,
    fencePoints: [
      { x: 0.20, y: 0.40 },
      { x: 0.80, y: 0.40 },
      { x: 0.75, y: 0.90 },
      { x: 0.25, y: 0.90 }
    ]
  },
  {
    id: 'cam-03',
    code: 'CHK-02',
    name: 'Checkpoint Alpha Inspection',
    location: 'Gate 2 - Highway Entry',
    ip: '192.168.1.108',
    status: 'ONLINE',
    fps: 60,
    resolution: '4K Ultra HD',
    mode: 'ANPR_FOCUS',
    activeIntrusions: 0,
    hasVirtualFence: false,
    fencePoints: []
  },
  {
    id: 'cam-04',
    code: 'BOP-12',
    name: 'South Gate FRS Scanner',
    location: 'Sector 12 - Infantry Gate',
    ip: '192.168.1.112',
    status: 'ONLINE',
    fps: 30,
    resolution: '1080p FHD',
    mode: 'FRS_FOCUS',
    activeIntrusions: 0,
    hasVirtualFence: true,
    fencePoints: [
      { x: 0.30, y: 0.20 },
      { x: 0.70, y: 0.20 },
      { x: 0.70, y: 0.80 },
      { x: 0.30, y: 0.80 }
    ]
  }
];

export function isPointInPolygon(point, polygon) {
  if (!polygon || polygon.length < 3) return false;
  let { x, y } = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    let xi = polygon[i].x, yi = polygon[i].y;
    let xj = polygon[j].x, yj = polygon[j].y;
    let intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi + 0.00001) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

const ALERT_THROTTLE_MS = 2000;

export class VisionSimulationEngine {
  constructor(camId) {
    this.camId = camId;
    this.ticks = 0;
    this.targets = [];
    // Per-target last alert timestamp map for deduplication
    this._lastAlertTime = {};
    this._intervalId = null;
    this._initTargets();
  }


  /**
   * Start the engine tick loop at the correct FPS.
   * @param {number} fps - Camera FPS (determines tick interval)
   * @param {Function} onFrame - Called each tick with (targets, fencePoints)
   * @param {Function} onAlert - Called when a new alert fires
   */
  start(fps, onFrame, onAlert) {
    this._onAlert = onAlert;
    const intervalMs = Math.max(50, Math.floor(1000 / Math.min(fps, 15))); // cap at 15fps for simulation
    this._intervalId = setInterval(() => {
      const updated = this._step(this._currentFence);
      if (onFrame) onFrame(updated);
    }, intervalMs);
  }

  /**
   * Stop the engine. Call in React useEffect cleanup to prevent memory leaks.
   */
  destroy() {
    if (this._intervalId !== null) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    this._lastAlertTime = {};
  }

  /**
   * Update the virtual fence geometry.
   * Resets all target insideFenceTriggered flags so re-entry is re-detected.
   */
  updateFence(newFencePoints) {
    this._currentFence = newFencePoints;
    // Reset triggered state so targets re-evaluate against new fence
    this.targets.forEach(t => {
      t.insideFenceTriggered = false;
    });
  }


  _step(cameraFence) {
    this.ticks++;

    const updated = this.targets.map(t => {
      // Deep-clone so React always sees a new object reference
      const target = { ...t };

      // Move target
      target.x += target.vx;
      target.y += target.vy;

      // Bounce at boundaries
      if (target.x < 0.05 || target.x + target.width > 0.95) target.vx *= -1;
      if (target.y < 0.15 || target.y + target.height > 0.85) target.vy *= -1;

      // Increment loiter counter if stationary-ish
      if (Math.abs(target.vx) < 0.001 && Math.abs(target.vy) < 0.001) {
        target.loiterSeconds = (target.loiterSeconds || 0) + (1 / 5); // approx per tick
      }

      // Fence check
      const center = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
      const insideFence = cameraFence && cameraFence.length >= 3 &&
        isPointInPolygon(center, cameraFence);

      if (insideFence && !target.insideFenceTriggered) {
        target.insideFenceTriggered = true;
        target.isBreaching = true;
        this._fireAlert(target, 'VIRTUAL_FENCE_INTRUSION', 'CRITICAL',
          `Perimeter Breach at ${this.camId}`,
          `${target.label} breached Virtual Fence boundary.`);
      }

      // Loitering check
      if ((target.loiterSeconds || 0) > 10 && !target._loiterAlerted) {
        target._loiterAlerted = true;
        this._fireAlert(target, 'LOITERING', 'HIGH',
          `Loitering Detected at ${this.camId}`,
          `${target.label} has been in zone for ${Math.round(target.loiterSeconds)}s.`);
      }

      // Reset loitering alert if target exits zone
      if (!insideFence) {
        target._loiterAlerted = false;
      }

      return target;
    });

    // Store updated targets immutably
    this.targets = updated;
    return [...updated];
  }

  _fireAlert(target, category, severity, title, description) {
    const now = Date.now();
    const key = `${target.id}:${category}`;
    const last = this._lastAlertTime[key] || 0;

    // Throttle: skip if we fired the same alert for this target recently
    if (now - last < ALERT_THROTTLE_MS) return;
    this._lastAlertTime[key] = now;

    if (this._onAlert) {
      this._onAlert({
        id: `ALT-${now}-${Math.floor(Math.random() * 1000)}`,
        cameraId: this.camId,
        timestamp: new Date().toLocaleTimeString(),
        category,
        severity,
        title,
        description,
        targetId: target.id,
        snapshotUrl: 'https://images.unsplash.com/photo-1541872703-74c5e44368f9?w=300&auto=format&fit=crop&q=80',
        status: 'NEW'
      });
    }
  }


  _initTargets() {
    if (this.camId === 'cam-01') {
      this.targets = [
        {
          id: 'T-101', type: 'HUMAN',
          x: 0.25, y: 0.45, vx: 0.003, vy: 0.001,
          width: 0.06, height: 0.16,
          label: 'Infiltrator (Prone/Crawling)', pose: 'CRAWLING',
          confidence: 0.94, loiterSeconds: 14, isBreaching: true
        },
        {
          id: 'T-102', type: 'HUMAN',
          x: 0.65, y: 0.50, vx: -0.002, vy: 0.0005,
          width: 0.07, height: 0.18,
          label: 'Suspicious Individual', pose: 'STANDING',
          confidence: 0.91, loiterSeconds: 8, isBreaching: false
        }
      ];
    } else if (this.camId === 'cam-02') {
      this.targets = [
        {
          id: 'T-201', type: 'HUMAN',
          x: 0.40, y: 0.60, vx: 0.0015, vy: -0.002,
          width: 0.08, height: 0.20,
          label: 'Thermal Signature (Night Motion)', pose: 'RUNNING',
          confidence: 0.96, loiterSeconds: 32, isBreaching: true
        },
        {
          id: 'T-202', type: 'OBJECT',
          x: 0.45, y: 0.65, vx: 0, vy: 0,
          width: 0.05, height: 0.06,
          label: 'Unattended Baggage / Payload', pose: 'STATIC',
          confidence: 0.88, loiterSeconds: 120, isBreaching: true
        }
      ];
    } else if (this.camId === 'cam-03') {
      this.targets = [
        {
          id: 'T-301', type: 'VEHICLE', subType: 'Heavy Utility Truck',
          x: 0.35, y: 0.40, vx: 0, vy: 0,
          width: 0.30, height: 0.35,
          label: 'Truck [JK-02-AX-8912]', plate: 'JK-02-AX-8912',
          plateConfidence: 0.97, isBlacklisted: true,
          confidence: 0.98, isBreaching: false
        }
      ];
    } else {
      this.targets = [
        {
          id: 'T-401', type: 'HUMAN',
          x: 0.42, y: 0.25, vx: 0.001, vy: 0.002,
          width: 0.16, height: 0.40,
          label: 'Subject: Viktor K. Petrov (Match: 94%)',
          faceMatch: {
            name: 'Viktor K. Petrov', score: 0.94,
            threatLevel: 'CRITICAL', watchlistId: 'W-901'
          },
          confidence: 0.95, isBreaching: true
        }
      ];
    }

    this._currentFence = [];
  }
}
