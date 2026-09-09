/**
 * Report Exporter for IBVAP
 * Generates formatted CSV and JSON intelligence summary reports.
 */

export function exportIncidentsToCSV(incidents) {
  if (!incidents || incidents.length === 0) {
    console.warn("[IBVAP] No incident log records available to export.");
    return;
  }

  const headers = ["Alert ID", "Timestamp", "BOP / Camera", "Severity", "Category", "Description", "Status"];
  const rows = incidents.map(item => [
    `"${item.id || ''}"`,
    `"${item.timestamp || ''}"`,
    `"${item.cameraId || ''}"`,
    `"${item.severity || ''}"`,
    `"${item.category || ''}"`,
    `"${(item.description || '').replace(/"/g, '""')}"`,
    `"${item.status || ''}"`
  ]);

  const csvContent = [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `IBVAP_Border_Surveillance_Report_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // FIX [MEDIUM-71]: Revoke blob URL to prevent memory leak on long sessions
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportIntelligenceSummaryJSON(incidents, watchlistFRS, watchlistANPR) {
  const summaryData = {
    platform: "IBVAP - Intelligent Border Video Analytics Platform",
    generatedAt: new Date().toISOString(),
    totalIncidents: incidents.length,
    threatBreakdown: {
      CRITICAL: incidents.filter(i => i.severity === 'CRITICAL').length,
      HIGH: incidents.filter(i => i.severity === 'HIGH').length,
      MEDIUM: incidents.filter(i => i.severity === 'MEDIUM').length,
      LOW: incidents.filter(i => i.severity === 'LOW').length,
    },
    watchlistCounts: {
      frsSuspects: watchlistFRS.length,
      anprBlacklist: watchlistANPR.length
    },
    incidents: incidents
  };

  const jsonContent = JSON.stringify(summaryData, null, 2);
  const blob = new Blob([jsonContent], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `IBVAP_Intelligence_Briefing_${Date.now()}.json`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // FIX [MEDIUM-71]: Revoke blob URL to prevent memory leak
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
