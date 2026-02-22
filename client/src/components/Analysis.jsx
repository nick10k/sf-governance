import { useState, useEffect } from 'react';
import { getFindings } from '../api';

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };
const LAYER_ORDER = ['platform', 'quality', 'risk', 'housekeeping'];

export default function Analysis({ scan, runId, onBack, onRecommendationsSelect, embedded, onItemClick }) {
  const [findings, setFindings] = useState(null);
  const [error, setError] = useState(null);
  const [severityFilter, setSeverityFilter] = useState('');
  const [layerFilter, setLayerFilter] = useState('');
  const [objectFilter, setObjectFilter] = useState('');
  const [ruleFilter, setRuleFilter] = useState('');
  const [expandedLayers, setExpandedLayers] = useState(new Set());

  useEffect(() => {
    getFindings(scan.id, runId)
      .then((f) => {
        setFindings(
          [...f].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3))
        );
      })
      .catch(() => setError('Failed to load findings.'));
  }, [scan.id, runId]);

  const toggleLayer = (layer) => {
    setExpandedLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });
  };

  const layers = findings
    ? [...new Set(findings.map((f) => f.rule?.layer).filter(Boolean))].sort()
    : [];

  const objects = findings
    ? [...new Set(findings.map((f) => f.object_name).filter(Boolean))].sort()
    : [];

  const rules = findings
    ? [...new Map(findings.filter((f) => f.rule_id).map((f) => [f.rule_id, { id: f.rule_id, name: f.rule?.name }])).values()]
        .sort((a, b) => a.id.localeCompare(b.id))
    : [];

  const filtered = findings
    ? findings.filter((f) => {
        if (severityFilter && f.severity !== severityFilter) return false;
        if (layerFilter && f.rule?.layer !== layerFilter) return false;
        if (objectFilter === '--') {
          if (f.object_name) return false;
        } else if (objectFilter) {
          if (f.object_name !== objectFilter) return false;
        }
        if (ruleFilter && f.rule_id !== ruleFilter) return false;
        return true;
      })
    : [];

  const groupedFindings = filtered.reduce((acc, f) => {
    const layer = f.rule?.layer || 'other';
    if (!acc[layer]) acc[layer] = [];
    acc[layer].push(f);
    return acc;
  }, {});
  const sortedLayers = [
    ...LAYER_ORDER.filter((l) => groupedFindings[l]),
    ...Object.keys(groupedFindings).filter((l) => !LAYER_ORDER.includes(l)).sort(),
  ];

  return (
    <div className="analysis-page">
      {!embedded && (
        <button className="back-btn" onClick={onBack}>
          ← Scan #{scan.id}
        </button>
      )}

      <div className="scan-header">
        <div>
          {!embedded && <h2>Analysis Run #{runId}</h2>}
          {findings && (
            <p style={{ margin: '0.25rem 0 0' }}>
              {findings.length === 0
                ? 'No findings'
                : `${findings.length.toLocaleString()} finding${findings.length !== 1 ? 's' : ''}`}
            </p>
          )}
        </div>
        {!embedded && (
          <button className="primary-btn" onClick={onRecommendationsSelect}>
            View Recommendations
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {findings === null && !error && <p>Loading findings...</p>}

      {findings !== null && (
        <>
          <div className="inventory-filters">
            <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
              <option value="">All Severities</option>
              <option value="error">Error</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
            </select>
            <select value={layerFilter} onChange={(e) => setLayerFilter(e.target.value)}>
              <option value="">All Layers</option>
              {layers.map((l) => (
                <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>
              ))}
            </select>
            <select value={objectFilter} onChange={(e) => setObjectFilter(e.target.value)}>
              <option value="">All Objects</option>
              <option value="--">— (no object)</option>
              {objects.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            <select value={ruleFilter} onChange={(e) => setRuleFilter(e.target.value)}>
              <option value="">All Rules</option>
              {rules.map((r) => (
                <option key={r.id} value={r.id}>{r.id}{r.name ? ` — ${r.name}` : ''}</option>
              ))}
            </select>
          </div>

          {filtered.length === 0 && findings.length > 0 && (
            <p>No findings match the current filters.</p>
          )}

          {findings.length === 0 && (
            <p>No findings — this org looks clean!</p>
          )}

          {sortedLayers.map((layer) => {
            const items = groupedFindings[layer];
            const isExpanded = expandedLayers.has(layer);
            return (
              <div key={layer} className="inventory-group">
                <button className="inventory-group-header" onClick={() => toggleLayer(layer)}>
                  <span className="inventory-group-chevron">{isExpanded ? '▾' : '▸'}</span>
                  <span className="inventory-group-title">
                    {layer.charAt(0).toUpperCase() + layer.slice(1)}
                  </span>
                  <span className="inventory-group-count">{items.length.toLocaleString()}</span>
                </button>
                {isExpanded && (
                  <div className="finding-list">
                    {items.map((f, i) => (
                      <div key={i} className={`finding-item finding-item--${f.severity}`}>
                        <div className="finding-item-header">
                          <span className={`severity-badge severity-badge--${f.severity}`}>{f.severity}</span>
                          <code className="finding-rule-id">{f.rule_id}</code>
                          {f.rule?.name && <span className="finding-rule-name">{f.rule.name}</span>}
                        </div>
                        {(f.api_name || f.object_name) && (
                          <div className="finding-item-location">
                            {f.api_name && f.automation_inventory_id && onItemClick ? (
                              <button
                                className="finding-item-link"
                                onClick={() => onItemClick(f.automation_inventory_id)}
                              >
                                {f.api_name}
                              </button>
                            ) : (
                              f.api_name
                            )}
                            {f.api_name && f.object_name && ' · '}
                            {f.object_name}
                          </div>
                        )}
                        <p className="finding-item-message">{f.rule?.description || f.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
