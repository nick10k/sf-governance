import { useState, useEffect, useRef } from 'react';
import { getScan, getInventory, getAnalysisRuns, runAnalysis, explainAutomation } from '../api';
import ProgressTracker from './ProgressTracker';
import Analysis from './Analysis';
import Recommendations from './Recommendations';

const TERMINAL_STATUSES = ['completed', 'failed'];


export default function ScanStatus({ scan, org, onBack }) {
  const [details, setDetails] = useState(null);
  const [inventory, setInventory] = useState(null);
  const [runsLoading, setRunsLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('inventory');
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [objectFilter, setObjectFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [managedFilter, setManagedFilter] = useState('');
  const [analysisProgressId, setAnalysisProgressId] = useState(null);
  const [pendingRunId, setPendingRunId] = useState(null);
  const [expandedTypes, setExpandedTypes] = useState(new Set());
  const [highlightedItemId, setHighlightedItemId] = useState(null);

  // Explain modal state
  const [explainItem, setExplainItem] = useState(null); // the item being explained
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainSummary, setExplainSummary] = useState(null);

  const intervalRef = useRef(null);

  const fetchRuns = () => {
    setRunsLoading(true);
    getAnalysisRuns(scan.id)
      .then((runs) => {
        if (runs.length > 0) {
          const latest = runs.reduce((best, r) => (r.id > best.id ? r : best), runs[0]);
          setSelectedRunId((prev) => prev ?? latest.id);
        }
      })
      .catch(() => {})
      .finally(() => setRunsLoading(false));
  };

  useEffect(() => {
    if (!scan.id) return;

    const fetchDetails = async () => {
      try {
        const data = await getScan(scan.id);
        setDetails(data);
        if (TERMINAL_STATUSES.includes(data.scan.status)) {
          clearInterval(intervalRef.current);
          if (data.scan.status === 'completed') {
            getInventory(scan.id).then(setInventory).catch(() => {});
            fetchRuns();
          }
        }
      } catch (err) {
        setError(err.message || 'Failed to load scan results');
        clearInterval(intervalRef.current);
      }
    };

    fetchDetails();
    intervalRef.current = setInterval(fetchDetails, 2000);

    return () => clearInterval(intervalRef.current);
  }, [scan.id]);

  const handleNavigateToInventory = (inventoryId) => {
    const item = inventory?.find((i) => i.id === inventoryId);
    if (!item) return;
    setActiveTab('inventory');
    setExpandedTypes((prev) => new Set([...prev, item.automation_type]));
    setHighlightedItemId(inventoryId);
    setTimeout(() => {
      document.getElementById(`inv-item-${inventoryId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
    setTimeout(() => setHighlightedItemId(null), 2500);
  };

  const toggleType = (type) => {
    setExpandedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const handleRunAnalysis = async () => {
    setRunning(true);
    setAnalysisProgressId(null);
    setError(null);
    try {
      const { run_id, progressId } = await runAnalysis(scan.id);
      setPendingRunId(run_id);
      setAnalysisProgressId(progressId);
    } catch (err) {
      setError('Analysis failed: ' + (err.message || 'Unknown error'));
      setRunning(false);
    }
  };

  const handleAnalysisComplete = () => {
    setAnalysisProgressId(null);
    setRunning(false);
    setSelectedRunId(pendingRunId);
    fetchRuns();
  };

  const handleExplain = async (item) => {
    setExplainItem(item);
    setExplainSummary(item.llm_summary || null);

    if (!item.llm_summary) {
      setExplainLoading(true);
      try {
        const result = await explainAutomation(item.id);
        setExplainSummary(result.summary);
        // Update the local inventory so the next click is instant
        setInventory((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, llm_summary: result.summary } : i)),
        );
      } catch {
        setExplainSummary(null);
      } finally {
        setExplainLoading(false);
      }
    }
  };

  const closeModal = () => {
    setExplainItem(null);
    setExplainSummary(null);
    setExplainLoading(false);
  };

  if (error) return <p className="error">Error: {error}</p>;
  if (!details) return <p>Loading scan results...</p>;

  const inventoryObjects = inventory
    ? [...new Set(inventory.map((i) => i.object_name).filter(Boolean))].sort()
    : [];

  const inventoryTypes = inventory
    ? [...new Set(inventory.map((i) => i.automation_type))].sort()
    : [];

  const filteredInventory = inventory
    ? inventory.filter((item) => {
        if (typeFilter && item.automation_type !== typeFilter) return false;
        if (objectFilter === '--') {
          if (item.object_name) return false;
        } else if (objectFilter) {
          if (item.object_name !== objectFilter) return false;
        }
        if (activeFilter === 'yes' && !item.is_active) return false;
        if (activeFilter === 'no' && item.is_active) return false;
        if (managedFilter === 'yes' && !item.is_managed_package) return false;
        if (managedFilter === 'no' && item.is_managed_package) return false;
        return true;
      })
    : [];

  const groupedInventory = filteredInventory.reduce((acc, item) => {
    const type = item.automation_type;
    if (!acc[type]) acc[type] = [];
    acc[type].push(item);
    return acc;
  }, {});
  const sortedTypes = Object.keys(groupedInventory).sort();

  return (
    <div className="scan-results">
      {onBack && (
        <button className="back-btn" onClick={onBack}>
          ← Scan History
        </button>
      )}
      <div className="scan-header">
        <div>
          <h2>
            Scan #{details.scan.id} &mdash;{' '}
            <span className={`status-${details.scan.status}`}>
              {details.scan.status}
            </span>
          </h2>
          <p style={{ margin: '0.25rem 0 0' }}>Found {details.items.length.toLocaleString()} metadata items</p>
        </div>
      </div>
      {details.scan.status === 'failed' && details.scan.error_message && (
        <p className="error">Error: {details.scan.error_message}</p>
      )}

      {details.scan.status === 'running' && scan.progressId && (
        <div className="scan-progress-section">
          <ProgressTracker jobId={scan.progressId} />
        </div>
      )}

      {details.scan.status === 'completed' && (
        <div className="tab-bar">
          <button
            className={`tab-btn${activeTab === 'inventory' ? ' active' : ''}`}
            onClick={() => setActiveTab('inventory')}
          >
            Automation Inventory
          </button>
          <button
            className={`tab-btn${activeTab === 'analysis' ? ' active' : ''}`}
            onClick={() => setActiveTab('analysis')}
          >
            Analysis
          </button>
          <button
            className={`tab-btn${activeTab === 'recommendations' ? ' active' : ''}`}
            onClick={() => setActiveTab('recommendations')}
          >
            Recommendations
          </button>
        </div>
      )}

      {/* ── Inventory tab ── */}
      {activeTab === 'inventory' && inventory && (
        <div className="inventory">
          <div className="inventory-filters">
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">All Types</option>
              {inventoryTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select value={objectFilter} onChange={(e) => setObjectFilter(e.target.value)}>
              <option value="">All Objects</option>
              <option value="--">— (no object)</option>
              {inventoryObjects.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)}>
              <option value="">Active: All</option>
              <option value="yes">Active: Yes</option>
              <option value="no">Active: No</option>
            </select>
            <select value={managedFilter} onChange={(e) => setManagedFilter(e.target.value)}>
              <option value="">Managed: All</option>
              <option value="yes">Managed: Yes</option>
              <option value="no">Managed: No</option>
            </select>
          </div>

          {sortedTypes.length === 0 && filteredInventory.length === 0 && inventory.length > 0 && (
            <p>No items match the current filters.</p>
          )}

          {sortedTypes.map((type) => {
            const items = groupedInventory[type];
            const isExpanded = expandedTypes.has(type);
            return (
              <div key={type} className="inventory-group">
                <button className="inventory-group-header" onClick={() => toggleType(type)}>
                  <span className="inventory-group-chevron">{isExpanded ? '▾' : '▸'}</span>
                  <span className="inventory-group-title">{type}</span>
                  <span className="inventory-group-count">{items.length.toLocaleString()}</span>
                </button>
                {isExpanded && (
                  <div className="inventory-item-list">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        id={`inv-item-${item.id}`}
                        className={`inventory-item${item.is_active ? ' inventory-item--active' : ' inventory-item--inactive'}${highlightedItemId === item.id ? ' inventory-item--highlight' : ''}`}
                      >
                        <div className="inventory-item-title-row">
                          <span className="inventory-item-name">{item.api_name}</span>
                          <div className="inventory-item-badges">
                            {item.is_active
                              ? <span className="inv-badge inv-badge--active">active</span>
                              : <span className="inv-badge inv-badge--inactive">inactive</span>}
                            {item.is_managed_package && (
                              <span className="inv-badge inv-badge--managed">managed</span>
                            )}
                            <button className="explain-btn" onClick={() => handleExplain(item)}>
                              {item.llm_summary ? 'Summary' : 'Explain'}
                            </button>
                          </div>
                        </div>
                        {(item.object_name || item.trigger_events) && (
                          <div className="inventory-item-meta">
                            {[item.object_name, item.trigger_events].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Analysis tab ── */}
      {activeTab === 'analysis' && (
        <div className="analysis-runs">
          <div className="section-header">
            <h3>Analysis</h3>
            <button onClick={handleRunAnalysis} disabled={running} className="primary-btn">
              {running ? 'Running...' : 'Run New Analysis'}
            </button>
          </div>

          {analysisProgressId && (
            <ProgressTracker
              jobId={analysisProgressId}
              onComplete={handleAnalysisComplete}
              onError={(msg) => {
                setAnalysisProgressId(null);
                setRunning(false);
                setError('Analysis failed: ' + msg);
              }}
            />
          )}

          {!analysisProgressId && runsLoading && <p>Loading...</p>}

          {!analysisProgressId && !runsLoading && !selectedRunId && (
            <p>No analysis runs yet. Click "Run New Analysis" to evaluate this scan against the rule library.</p>
          )}

          {!analysisProgressId && selectedRunId && (
            <Analysis scan={scan} runId={selectedRunId} embedded onItemClick={handleNavigateToInventory} />
          )}
        </div>
      )}

      {/* ── Recommendations tab ── */}
      {activeTab === 'recommendations' && (
        <div>
          {!selectedRunId ? (
            <p style={{ marginTop: '1rem' }}>No analysis runs yet. Run an analysis first to see recommendations.</p>
          ) : (
            <Recommendations scan={scan} runId={selectedRunId} org={org} embedded />
          )}
        </div>
      )}

      {/* ── Explain modal ── */}
      {explainItem && (
        <div className="explain-overlay" onClick={closeModal}>
          <div className="explain-modal" onClick={(e) => e.stopPropagation()}>
            <div className="explain-modal-header">
              <div>
                <h3 className="explain-modal-title">{explainItem.api_name}</h3>
                <div className="explain-modal-meta">
                  <span>{explainItem.automation_type}</span>
                  {explainItem.object_name && <span> · {explainItem.object_name}</span>}
                  {explainItem.trigger_events && <span> · {explainItem.trigger_events}</span>}
                </div>
              </div>
              <button className="explain-modal-close" onClick={closeModal}>✕</button>
            </div>

            <div className="explain-modal-body">
              {explainLoading && <p className="explain-loading">Generating summary...</p>}

              {!explainLoading && explainSummary && (
                <p className="explain-summary">{explainSummary}</p>
              )}

              {!explainLoading && explainSummary === null && (
                <p className="explain-unavailable">
                  Summary unavailable — the LLM service is disabled or did not return a result.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
