import { useState, useEffect } from 'react';
import { getRules, deleteRule } from '../api';

const LAYER_ORDER = ['platform', 'quality', 'risk', 'housekeeping'];
const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };

export default function RuleLibrary({ onBack, onNewRule, onEditRule }) {
  const [rules, setRules] = useState([]);
  const [layerFilter, setLayerFilter] = useState('');
  const [deleteError, setDeleteError] = useState(null);

  const fetchRules = () => getRules().then(setRules);

  useEffect(() => {
    fetchRules();
  }, []);

  const handleDelete = async (rule) => {
    if (!confirm(`Delete custom rule "${rule.name}"?`)) return;
    setDeleteError(null);
    const result = await deleteRule(rule.id);
    if (result?.error) { setDeleteError(result.error); return; }
    fetchRules();
  };

  const layers = [...new Set(rules.map((r) => r.layer))];

  const filtered = rules
    .filter((r) => !layerFilter || r.layer === layerFilter)
    .sort((a, b) => {
      const la = LAYER_ORDER.indexOf(a.layer);
      const lb = LAYER_ORDER.indexOf(b.layer);
      if (la !== lb) return la - lb;
      return (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3);
    });

  return (
    <div className="rule-library">
      <button className="back-btn" onClick={onBack}>← Home</button>

      <div className="scan-header">
        <div>
          <h2>Rule Library</h2>
          <p style={{ margin: '0.25rem 0 0' }}>
            {rules.length.toLocaleString()} rule{rules.length !== 1 ? 's' : ''} across {layers.length.toLocaleString()} layer{layers.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button className="primary-btn" onClick={onNewRule}>+ New Rule</button>
      </div>

      {deleteError && <p className="error">{deleteError}</p>}

      <div className="library-filters">
        <select value={layerFilter} onChange={(e) => setLayerFilter(e.target.value)}>
          <option value="">All Layers</option>
          {layers.map((l) => (
            <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>
          ))}
        </select>
      </div>

      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Layer</th>
            <th>Severity</th>
            <th>Name</th>
            <th>Description</th>
            <th>Active</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((rule) => (
            <tr key={rule.id} style={{ opacity: rule.is_active ? 1 : 0.5 }}>
              <td><code>{rule.id}</code></td>
              <td>{rule.layer}</td>
              <td><span className={`severity-${rule.severity}`}>{rule.severity}</span></td>
              <td>{rule.name}</td>
              <td className="rule-description">{rule.description}</td>
              <td>{rule.is_active ? 'Yes' : 'No'}</td>
              <td>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button onClick={() => onEditRule(rule)}>Edit</button>
                  {!rule.is_builtin && (
                    <button className="delete-btn" onClick={() => handleDelete(rule)}>Delete</button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
