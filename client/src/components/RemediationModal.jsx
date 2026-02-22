import { useState, useEffect, useCallback } from 'react';
import {
  initiateRemediation,
  getRemediationJob,
  approveRemediation,
  rejectRemediation,
  rollbackRemediation,
} from '../api';
import DiffViewer from './DiffViewer';

const APEX_PATTERNS = ['legacyToApex', 'apexFlowConsolidate'];

function isApexResult(job) {
  if (!job?.generated_metadata) return false;
  if (!APEX_PATTERNS.includes(job.pattern)) return false;
  try {
    const obj = JSON.parse(job.generated_metadata);
    return typeof obj === 'object' && ('trigger' in obj || 'handler' in obj);
  } catch {
    return false;
  }
}

export default function RemediationModal({ recommendation, onClose }) {
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [editedMetadata, setEditedMetadata] = useState(null);
  const [apexTab, setApexTab] = useState('trigger');
  const [apexEdits, setApexEdits] = useState({ trigger: '', handler: '' });
  const [notesOpen, setNotesOpen] = useState(false);
  const [rollbackConfirm, setRollbackConfirm] = useState(false);
  const [polling, setPolling] = useState(false);

  // ── Initiate on mount ──────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const j = await initiateRemediation(recommendation.id);
        if (!cancelled) {
          setJob(j);
          if (j.error) setError(j.error);
          if (isApexResult(j)) {
            const parsed = JSON.parse(j.generated_metadata);
            setApexEdits({ trigger: parsed.trigger || '', handler: parsed.handler || '' });
          } else {
            setEditedMetadata(j.generated_metadata || '');
          }
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [recommendation.id]);

  // ── Poll during deploying ──────────────────────────────────────────────────

  const pollJob = useCallback(async (jobId) => {
    setPolling(true);
    const TIMEOUT = 130_000;
    const INTERVAL = 4_000;
    const start = Date.now();
    while (Date.now() - start < TIMEOUT) {
      await sleep(INTERVAL);
      try {
        const j = await getRemediationJob(jobId);
        setJob(j);
        if (j.status !== 'deploying') { setPolling(false); return; }
      } catch { break; }
    }
    setPolling(false);
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────────

  async function handleApprove() {
    const finalMeta = isApexResult(job)
      ? JSON.stringify(apexEdits)
      : editedMetadata;
    try {
      const j = await approveRemediation(job.id, finalMeta);
      setJob(j);
      if (j.status === 'deploying') pollJob(j.id);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleReject() {
    try {
      const j = await rejectRemediation(job.id);
      setJob(j);
      onClose();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRollback() {
    setRollbackConfirm(false);
    try {
      const j = await rollbackRemediation(job.id);
      setJob(j);
    } catch (err) {
      setError(err.message);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  function renderBody() {
    if (!job) {
      return (
        <div className="remediation-status-deploying">
          <div className="remediation-spinner" />
          <span>Initiating remediation…</span>
        </div>
      );
    }

    if (job.status === 'generating') {
      return (
        <div className="remediation-status-deploying">
          <div className="remediation-spinner" />
          <span>Generating metadata…</span>
        </div>
      );
    }

    if (job.status === 'deploying') {
      return (
        <div className="remediation-status-deploying">
          <div className="remediation-spinner" />
          <span>Deploying to sandbox…</span>
        </div>
      );
    }

    if (job.status === 'deployed') {
      return (
        <div className="remediation-status-deployed">
          <div className="remediation-status-icon">✓</div>
          <p>Deployed successfully{job.deployed_at ? ` at ${new Date(job.deployed_at).toLocaleString()}` : ''}.</p>
          {!rollbackConfirm ? (
            <button className="secondary-btn" onClick={() => setRollbackConfirm(true)}>
              Rollback
            </button>
          ) : (
            <div className="remediation-rollback-confirm">
              <p>This will re-deploy the original metadata to the sandbox. Are you sure?</p>
              <button className="rec-action-btn rec-action-btn--dismiss" onClick={handleRollback}>Yes, rollback</button>
              <button className="secondary-btn" onClick={() => setRollbackConfirm(false)}>Cancel</button>
            </div>
          )}
        </div>
      );
    }

    if (job.status === 'failed') {
      return (
        <div className="remediation-status-failed">
          <p><strong>Deployment failed:</strong> {job.error_message || 'Unknown error'}</p>
          <button className="secondary-btn" onClick={handleReject}>Close &amp; Reset</button>
        </div>
      );
    }

    if (job.status === 'rolled_back') {
      return (
        <div className="remediation-status-deployed">
          <p>Rollback complete. Original metadata has been restored in the sandbox.</p>
        </div>
      );
    }

    // status === 'review' (or 'approved')
    const apex = isApexResult(job);

    return (
      <>
        {job.conflict_warning && (
          <div className="remediation-banner remediation-banner--conflict">
            Conflict detected — two or more source automations update the same field. Review required before approval.
          </div>
        )}
        {job.requires_manual_completion && (
          <div className="remediation-banner remediation-banner--warning">
            Scaffold only — this output requires manual completion before it can be activated. Do not approve without reviewing each TODO comment.
          </div>
        )}

        {apex ? renderApexEditor() : renderDiffView()}

        {job.generation_notes && (
          <div className="remediation-notes">
            <button
              className="remediation-notes-toggle"
              onClick={() => setNotesOpen((o) => !o)}
            >
              {notesOpen ? '▾' : '▸'} Generation Notes
            </button>
            {notesOpen && <p className="remediation-notes-body">{job.generation_notes}</p>}
          </div>
        )}

        <div className="remediation-actions">
          <button className="rec-action-btn rec-action-btn--accept" onClick={handleApprove}>
            Approve &amp; Deploy
          </button>
          <button className="rec-action-btn rec-action-btn--dismiss" onClick={handleReject}>
            Reject
          </button>
        </div>
      </>
    );
  }

  function renderDiffView() {
    const source = getSourceText();
    return (
      <DiffViewer
        sourceText={source}
        generatedText={editedMetadata || ''}
        onChange={setEditedMetadata}
      />
    );
  }

  function renderApexEditor() {
    return (
      <div className="remediation-apex-editor">
        <div className="remediation-tabs">
          <button
            className={`remediation-tab${apexTab === 'trigger' ? ' remediation-tab--active' : ''}`}
            onClick={() => setApexTab('trigger')}
          >
            Apex Trigger
          </button>
          <button
            className={`remediation-tab${apexTab === 'handler' ? ' remediation-tab--active' : ''}`}
            onClick={() => setApexTab('handler')}
          >
            Handler Class
          </button>
        </div>
        <textarea
          className="remediation-apex-textarea"
          value={apexEdits[apexTab] || ''}
          onChange={(e) => setApexEdits((prev) => ({ ...prev, [apexTab]: e.target.value }))}
          spellCheck={false}
        />
      </div>
    );
  }

  function getSourceText() {
    try {
      const sources = JSON.parse(job.source_metadata || '[]');
      if (!Array.isArray(sources) || sources.length === 0) return '';
      return sources.map((s) => {
        const raw = s.raw_json || s.parsed_data || {};
        return `/* Source: ${s.api_name} (${s.automation_type}) */\n${JSON.stringify(raw, null, 2)}`;
      }).join('\n\n');
    } catch {
      return '';
    }
  }

  const sourceItems = (() => {
    try { return JSON.parse(job?.source_metadata || '[]'); } catch { return []; }
  })();

  return (
    <div className="remediation-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="remediation-modal">
        <div className="remediation-header">
          <div>
            <span className="remediation-pattern-badge">{job?.pattern || 'Remediation'}</span>
            <h2 className="remediation-title">{recommendation.title}</h2>
            {sourceItems.length > 0 && (
              <ul className="remediation-source-list">
                {sourceItems.map((s) => (
                  <li key={s.id}>{s.api_name} <span className="remediation-source-type">({s.automation_type})</span></li>
                ))}
              </ul>
            )}
          </div>
          <button className="remediation-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {error && <div className="remediation-banner remediation-banner--conflict">{error}</div>}

        <div className="remediation-body">
          {renderBody()}
        </div>
      </div>
    </div>
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
