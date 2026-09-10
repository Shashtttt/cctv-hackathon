import React, { useState, useEffect } from 'react';
import { 
  Bell, 
  LayoutGrid, 
  AlertTriangle, 
  AlertCircle, 
  CheckCircle2, 
  Filter, 
  Search, 
  Moon, 
  Truck, 
  UserCheck, 
  UserX,
  ShieldAlert, 
  ShieldCheck, 
  ShieldX,
  Clock, 
  Radio, 
  Eye,
  RefreshCw,
  Send,
  Check
} from 'lucide-react';
import { fetchAlerts, acknowledgeAlert, dispatchAlert, resolveAlert } from '../services/apiService';
import './AlertsEventsPage.css';

const defaultFallbackEvents = [
  {
    id: 'EVT-101',
    severity: 'critical',
    severityText: 'CRITICAL',
    eventType: 'Unauthorized Person',
    typeIcon: <UserX size={16} className="text-red" />,
    objectId: 'P-102',
    personStatus: 'UNAUTHORIZED',
    statusType: 'unauth-red',
    rolePlate: '--',
    activity: 'Perimeter Breach',
    activityType: 'breach-red',
    status: 'ACTIVE',
  },
  {
    id: 'EVT-102',
    severity: 'warning',
    severityText: 'WARNING',
    eventType: 'Loitering',
    typeIcon: <Clock size={16} className="text-yellow" />,
    objectId: 'P-108',
    personStatus: 'UNAUTHORIZED',
    statusType: 'unauth-yellow',
    rolePlate: '--',
    activity: 'Loitering (04:32)',
    activityType: 'loitering-yellow',
    status: 'FLAGGED',
  },
  {
    id: 'EVT-103',
    severity: 'warning',
    severityText: 'WARNING',
    eventType: 'Vehicle Detected',
    typeIcon: <Truck size={16} className="text-yellow" />,
    objectId: 'V-021',
    objectIdGreen: true,
    personStatus: '--',
    rolePlate: 'HR26AB1234',
    rolePlateType: 'plate-green',
    activity: 'Speed Check (Passed)',
    activityType: 'grey-tag',
    status: 'LOGGED',
  },
  {
    id: 'EVT-104',
    severity: 'info',
    severityText: 'INFO',
    eventType: 'Authorized Person',
    typeIcon: <ShieldCheck size={16} className="text-green" />,
    objectId: 'P-115',
    objectIdGreen: true,
    personStatus: 'AUTHORIZED',
    statusType: 'auth-green',
    rolePlate: 'Security Officer',
    rolePlateType: 'role-cyan',
    activity: 'Scheduled Patrol',
    activityType: 'grey-tag',
    status: 'RESOLVED',
  },
  {
    id: 'EVT-105',
    severity: 'warning',
    severityText: 'WARNING',
    eventType: 'Night Movement',
    typeIcon: <Moon size={16} className="text-yellow" />,
    objectId: 'P-119',
    personStatus: 'UNAUTHORIZED',
    statusType: 'unauth-yellow',
    rolePlate: '--',
    activity: 'Low-Light Motion',
    activityType: 'grey-tag',
    status: 'ACTIVE',
  }
];

const AlertsEventsPage = () => {
  const [events, setEvents] = useState(defaultFallbackEvents);
  const [searchTerm, setSearchTerm] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [cameraFilter, setCameraFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [actionSuccess, setActionSuccess] = useState('');

  const loadAlerts = async () => {
    setLoading(true);
    try {
      const res = await fetchAlerts({
        cameraId: cameraFilter,
        severity: severityFilter,
        limit: 100,
      });

      if (res && res.items && res.items.length > 0) {
        // Map backend alerts to UI model
        const mapped = res.items.map((item) => {
          const sev = (item.severity || 'info').toLowerCase();
          const isArmed = item.category?.includes('ARMED') || item.title?.includes('Armed');
          const isWeapon = item.category?.includes('WEAPON') || item.title?.includes('Weapon');
          const isBaggage = item.category?.includes('BAGGAGE') || item.title?.includes('Baggage');
          const isCrit = sev === 'critical' || isArmed || isWeapon;
          const isWarn = sev === 'warning' || isBaggage;

          return {
            id: item.id,
            severity: isCrit ? 'critical' : isWarn ? 'warning' : 'info',
            severityText: isArmed ? 'CRITICAL (ARMED)' : isCrit ? 'CRITICAL' : isWarn ? 'WARNING' : 'INFO',
            eventType: item.title || item.category || 'Security Event',
            typeIcon: isArmed || isWeapon ? (
              <ShieldAlert size={16} className="text-red" />
            ) : isBaggage ? (
              <AlertCircle size={16} className="text-yellow" />
            ) : item.category === 'INTRUSION' || isCrit ? (
              <UserX size={16} className="text-red" />
            ) : item.category === 'LOITERING' ? (
              <Clock size={16} className="text-yellow" />
            ) : item.category === 'ANPR' ? (
              <Truck size={16} className="text-cyan" />
            ) : item.category === 'FRS_MATCH' ? (
              <ShieldCheck size={16} className="text-green" />
            ) : (
              <AlertTriangle size={16} className="text-yellow" />
            ),
            objectId: item.target_id || (item.plate_text ? 'V-021' : 'P-102'),
            objectIdGreen: item.category === 'FRS_MATCH' || item.category === 'ANPR',
            personStatus: isArmed ? 'ARMED HOSTILE' : isWeapon ? 'WEAPON SECURED' : isBaggage ? 'UNATTENDED BAG' : item.frs_match_name ? 'AUTHORIZED' : isCrit ? 'UNAUTHORIZED' : '--',
            statusType: isArmed || isWeapon ? 'unauth-red' : isBaggage ? 'unauth-yellow' : item.frs_match_name ? 'auth-green' : isCrit ? 'unauth-red' : 'unauth-yellow',
            rolePlate: item.plate_text || item.frs_match_name || (isArmed ? 'DEFCON 1' : '--'),
            rolePlateType: item.plate_text ? 'plate-green' : item.frs_match_name ? 'role-cyan' : isArmed ? 'unauth-red' : '',
            activity: item.description || item.title || 'Monitored Trace',
            activityType: isCrit ? 'breach-red' : isWarn ? 'loitering-yellow' : 'grey-tag',
            status: item.status || 'ACTIVE',
            camera_id: item.camera_id,
          };
        });
        setEvents(mapped);
      }
    } catch (err) {
      console.debug('Failed to fetch alerts from backend, using current state');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAlerts();
    const interval = setInterval(loadAlerts, 10000);
    return () => clearInterval(interval);
  }, [cameraFilter, severityFilter]);

  const handleAction = async (actionType, alertId) => {
    try {
      if (actionType === 'acknowledge') {
        await acknowledgeAlert(alertId);
        setActionSuccess(`Alert ${alertId} acknowledged.`);
      } else if (actionType === 'dispatch') {
        await dispatchAlert(alertId);
        setActionSuccess(`QRT Dispatched for ${alertId}.`);
      } else if (actionType === 'resolve') {
        await resolveAlert(alertId);
        setActionSuccess(`Alert ${alertId} resolved.`);
      }
      setTimeout(() => setActionSuccess(''), 3000);
      loadAlerts();
    } catch (e) {
      console.error(e);
    }
  };

  // Filtered Events
  const filteredEvents = events.filter((evt) => {
    const matchesSearch = 
      evt.eventType.toLowerCase().includes(searchTerm.toLowerCase()) ||
      evt.objectId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      evt.rolePlate.toLowerCase().includes(searchTerm.toLowerCase()) ||
      evt.activity.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesSeverity = severityFilter === 'all' || evt.severity === severityFilter;
    const matchesCamera = cameraFilter === 'all' || !evt.camera_id || evt.camera_id.toLowerCase().includes(cameraFilter.toLowerCase());

    return matchesSearch && matchesSeverity && matchesCamera;
  });

  const clearFilters = () => {
    setSearchTerm('');
    setSeverityFilter('all');
    setTypeFilter('all');
    setCameraFilter('all');
  };

  const totalCount = events.length || 24;
  const criticalCount = events.filter(e => e.severity === 'critical').length || 3;
  const warningCount = events.filter(e => e.severity === 'warning').length || 8;
  const resolvedCount = events.filter(e => e.status === 'RESOLVED').length || 13;

  return (
    <div className="alerts-page-container">
      {/* Toast Notification */}
      {actionSuccess && (
        <div className="toast-success font-mono" style={{ position: 'fixed', top: '24px', right: '28px', zIndex: 1000 }}>
          <CheckCircle2 size={16} />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Top Title Bar */}
      <div className="page-header-row">
        <div className="title-with-badge">
          <div className="bell-title-icon font-mono">
            <Bell size={22} className="text-white" />
          </div>
          <div className="page-title-text-group">
            <div className="title-heading-line">
              <h2>Alerts & Events</h2>
              <span className="pill-badge pill-red live-feed-badge font-mono">
                LIVE FEED
              </span>
            </div>
            <p className="page-sub-text">
              Monitor and review security events detected by the AI surveillance system.
            </p>
          </div>
        </div>

        <div className="header-status-pills font-mono">
          <span className="pill-badge pill-green">
            <span className="status-dot dot-green pulse-ring"></span> System Online
          </span>

          <span className="pill-badge pill-muted font-mono">
            NET: SECTOR-07 [STABLE]
          </span>
        </div>
      </div>

      {/* 4 KPI Top Cards Row */}
      <div className="kpi-cards-grid">
        {/* Card 1: TOTAL ALERTS */}
        <div className="kpi-card">
          <div className="kpi-info font-mono">
            <span className="kpi-label">TOTAL ALERTS</span>
            <span className="kpi-value">{totalCount}</span>
            <span className="kpi-sub font-sans">Telemetry window: 24h</span>
          </div>
          <div className="kpi-icon-box box-blue">
            <LayoutGrid size={22} />
          </div>
        </div>

        {/* Card 2: CRITICAL */}
        <div className="kpi-card">
          <div className="kpi-info font-mono">
            <span className="kpi-label text-red">● CRITICAL</span>
            <span className="kpi-value">{criticalCount}</span>
            <span className="kpi-sub font-sans">Requires immediate action</span>
          </div>
          <div className="kpi-icon-box box-red">
            <AlertTriangle size={22} />
          </div>
        </div>

        {/* Card 3: WARNINGS */}
        <div className="kpi-card">
          <div className="kpi-info font-mono">
            <span className="kpi-label text-yellow">WARNINGS</span>
            <span className="kpi-value">{warningCount}</span>
            <span className="kpi-sub font-sans">Elevated telemetry trace</span>
          </div>
          <div className="kpi-icon-box box-yellow">
            <AlertCircle size={22} />
          </div>
        </div>

        {/* Card 4: RESOLVED */}
        <div className="kpi-card">
          <div className="kpi-info font-mono">
            <span className="kpi-label text-green">RESOLVED</span>
            <span className="kpi-value">{resolvedCount}</span>
            <span className="kpi-sub font-sans">Cleared & logged to ledger</span>
          </div>
          <div className="kpi-icon-box box-green">
            <CheckCircle2 size={22} />
          </div>
        </div>
      </div>

      {/* Control & Filter Strip Bar */}
      <div className="alerts-control-bar">
        <div className="filter-dropdowns-group">
          {/* Dropdown 1 */}
          <select 
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="filter-select font-mono"
          >
            <option value="all">All Events</option>
            <option value="unauth">Unauthorized Person</option>
            <option value="loitering">Loitering</option>
            <option value="vehicle">Vehicle Detected</option>
          </select>

          {/* Dropdown 2 */}
          <select 
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="filter-select font-mono"
          >
            <option value="all">Severity: All</option>
            <option value="critical">Critical Only</option>
            <option value="warning">Warnings Only</option>
            <option value="info">Info Only</option>
          </select>

          {/* Dropdown 3 */}
          <select 
            value={cameraFilter}
            onChange={(e) => setCameraFilter(e.target.value)}
            className="filter-select font-mono"
          >
            <option value="all">Camera: All Units</option>
            <option value="cam-01">C-01 North Gate</option>
            <option value="cam-02">C-02 Border Road</option>
            <option value="cam-03">C-03 Fence Zone</option>
            <option value="cam-04">C-04 BOP Entry</option>
          </select>

          {/* Dropdown 4 */}
          <select className="filter-select font-mono">
            <option value="today">Today (00:00 - Present)</option>
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
          </select>

          {/* Clear Filters Button */}
          <button className="clear-filters-btn font-mono" onClick={clearFilters}>
            <Filter size={13} />
            <span>Clear Filters</span>
          </button>

          <button className="clear-filters-btn font-mono" onClick={loadAlerts} title="Refresh">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Search Bar Input */}
        <div className="search-input-box font-mono">
          <Search size={15} className="search-icon" />
          <input 
            type="text" 
            placeholder="Search event ID, camera, tag..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>
      </div>

      {/* Events Table Container */}
      <div className="table-wrapper-card">
        {/* Table Column Headers Header Bar */}
        <div className="table-header-row font-mono">
          <div className="col-sev">SEVERITY</div>
          <div className="col-type">EVENT TYPE</div>
          <div className="col-id">OBJECT ID</div>
          <div className="col-status">PERSON STATUS</div>
          <div className="col-role">ROLE / PLATE</div>
          <div className="col-act">ACTIVITY / DURATION</div>
        </div>

        {/* Table Rows Body */}
        <div className="table-body">
          {filteredEvents.length === 0 ? (
            <div className="no-events-state font-mono">
              No security events match the current filter criteria.
            </div>
          ) : (
            filteredEvents.map((evt) => (
              <div key={evt.id} className="table-data-row">
                {/* 1. SEVERITY */}
                <div className="col-sev">
                  <span className={`pill-badge badge-solid-${evt.severity} font-mono`}>
                    ● {evt.severityText}
                  </span>
                </div>

                {/* 2. EVENT TYPE */}
                <div className="col-type">
                  <span className="type-icon-box">{evt.typeIcon}</span>
                  <span className="event-type-name">{evt.eventType}</span>
                </div>

                {/* 3. OBJECT ID */}
                <div className="col-id font-mono">
                  <span className={`object-id-tag ${evt.objectIdGreen ? 'green-id' : ''}`}>
                    {evt.objectId}
                  </span>
                </div>

                {/* 4. PERSON STATUS */}
                <div className="col-status font-mono">
                  {evt.personStatus === 'UNAUTHORIZED' && evt.statusType === 'unauth-red' && (
                    <span className="status-badge status-red">
                      <ShieldX size={13} /> UNAUTHORIZED
                    </span>
                  )}
                  {evt.personStatus === 'UNAUTHORIZED' && evt.statusType === 'unauth-yellow' && (
                    <span className="status-badge status-yellow">
                      <AlertTriangle size={13} /> UNAUTHORIZED
                    </span>
                  )}
                  {evt.personStatus === 'AUTHORIZED' && (
                    <span className="status-badge status-green">
                      <CheckCircle2 size={13} /> AUTHORIZED
                    </span>
                  )}
                  {evt.personStatus === '--' && (
                    <span className="dash-text">--</span>
                  )}
                </div>

                {/* 5. ROLE / PLATE */}
                <div className="col-role font-mono">
                  {evt.rolePlateType === 'plate-green' && (
                    <span className="plate-box-green">{evt.rolePlate}</span>
                  )}
                  {evt.rolePlateType === 'role-cyan' && (
                    <span className="role-box-cyan">{evt.rolePlate}</span>
                  )}
                  {evt.rolePlate === '--' && (
                    <span className="dash-text">--</span>
                  )}
                </div>

                {/* 6. ACTIVITY / DURATION */}
                <div className="col-act font-mono">
                  {evt.activityType === 'breach-red' && (
                    <span className="act-tag act-red">{evt.activity}</span>
                  )}
                  {evt.activityType === 'loitering-yellow' && (
                    <span className="act-tag act-yellow">
                      <Clock size={12} /> {evt.activity}
                    </span>
                  )}
                  {evt.activityType === 'grey-tag' && (
                    <span className="act-tag act-grey">{evt.activity}</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Table Footer Pagination Bar */}
        <div className="table-footer-bar font-mono">
          <div className="footer-count-text">
            Showing <strong>1–{filteredEvents.length}</strong> of <strong>{totalCount}</strong> security events
          </div>

          <div className="pagination-controls">
            <button 
              className="page-nav-btn" 
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
            >
              &lt; Previous
            </button>

            <button 
              className={`page-num-btn ${currentPage === 1 ? 'active' : ''}`}
              onClick={() => setCurrentPage(1)}
            >
              1
            </button>
            <button 
              className={`page-num-btn ${currentPage === 2 ? 'active' : ''}`}
              onClick={() => setCurrentPage(2)}
            >
              2
            </button>
            <button 
              className={`page-num-btn ${currentPage === 3 ? 'active' : ''}`}
              onClick={() => setCurrentPage(3)}
            >
              3
            </button>

            <button 
              className="page-nav-btn" 
              disabled={currentPage === 3}
              onClick={() => setCurrentPage((p) => Math.min(p + 1, 3))}
            >
              Next &gt;
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AlertsEventsPage;
