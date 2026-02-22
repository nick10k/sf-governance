import { useState, useEffect, useRef } from 'react';
import { getOrgScans, deleteScan } from '../api';
import { updateOrg } from '../api';
import ScanButton from './ScanButton';

export default function OrgDetail({ org: initialOrg, onBack, onScanSelect, onProfileSelect, onOrgUpdate }) {
  const [org, setOrg] = useState(initialOrg);
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(initialOrg.name);
  const [saving, setSaving] = useState(false);
  const nameInputRef = useRef(null);

  const fetchScans = () =>
    getOrgScans(org.id).then((data) => {
      setScans(data);
      setLoading(false);
    });

  useEffect(() => {
    fetchScans();
  }, [org.id]);

  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [editingName]);

  const handleScanComplete = (result) => {
    fetchScans();
    onScanSelect({ id: result.id });
  };

  const handleDelete = async (e, scanId) => {
    e.stopPropagation();
    await deleteScan(scanId);
    fetchScans();
  };

  const startEdit = () => {
    setNameValue(org.name);
    setEditingName(true);
  };

  const cancelEdit = () => {
    setEditingName(false);
    setNameValue(org.name);
  };

  const saveName = async () => {
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === org.name) { cancelEdit(); return; }
    setSaving(true);
    const updated = await updateOrg(org.id, { name: trimmed });
    const merged = { ...org, ...updated };
    setOrg(merged);
    setEditingName(false);
    setSaving(false);
    if (onOrgUpdate) onOrgUpdate(merged);
  };

  const handleNameKeyDown = (e) => {
    if (e.key === 'Enter') saveName();
    if (e.key === 'Escape') cancelEdit();
  };

  const envDisplay = org.env_label || (org.env === 'sandbox' ? 'Sandbox' : 'Production');

  return (
    <div className="org-detail">
      <button className="back-btn" onClick={onBack}>
        ← Connected Orgs
      </button>

      <div className="org-name-row">
        {editingName ? (
          <div className="org-name-edit">
            <input
              ref={nameInputRef}
              className="org-name-input"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onKeyDown={handleNameKeyDown}
              disabled={saving}
            />
            <button className="org-name-save-btn" onClick={saveName} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="org-name-cancel-btn" onClick={cancelEdit} disabled={saving}>
              Cancel
            </button>
          </div>
        ) : (
          <>
            <h2>{org.name}</h2>
            <button className="org-name-edit-btn" onClick={startEdit} title="Rename org">
              ✎
            </button>
          </>
        )}
      </div>

      <p className="org-url">
        <span className={`env-badge env-badge--${org.env}`}>{envDisplay}</span>
        {' '}{org.instance_url}
      </p>

      <div className="org-actions">
        <ScanButton orgId={org.id} onComplete={handleScanComplete} />
        <button onClick={onProfileSelect}>Configure Profile</button>
      </div>

      <h3>Scan History</h3>
      {loading && <p>Loading scans…</p>}
      {!loading && scans.length === 0 && <p>No scans yet. Run a scan to get started.</p>}
      {!loading && scans.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Scan ID</th>
              <th>Status</th>
              <th>Items</th>
              <th>Started</th>
              <th>Completed</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {scans.map((scan) => (
              <tr
                key={scan.id}
                className="scan-row"
                onClick={() => onScanSelect({ id: scan.id })}
              >
                <td>#{scan.id}</td>
                <td>
                  <span className={`status-${scan.status}`}>{scan.status}</span>
                </td>
                <td>{scan.item_count?.toLocaleString()}</td>
                <td>{new Date(scan.started_at).toLocaleString()}</td>
                <td>{scan.completed_at ? new Date(scan.completed_at).toLocaleString() : '—'}</td>
                <td>
                  <button
                    className="delete-btn"
                    onClick={(e) => handleDelete(e, scan.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
