import { useState, useEffect, useRef } from 'react';
import { getAccounts, getLoginUrl } from '../api';

// Maps each specific Salesforce environment type to the OAuth login URL host.
// env_label is stored in the DB for display; oauthEnv drives login.salesforce.com vs test.salesforce.com.
const ENV_OPTIONS = [
  { value: 'production',          label: 'Production',            oauthEnv: 'production' },
  { value: 'developer_sandbox',   label: 'Developer Sandbox',     oauthEnv: 'sandbox'    },
  { value: 'developer_pro',       label: 'Developer Pro Sandbox', oauthEnv: 'sandbox'    },
  { value: 'partial_sandbox',     label: 'Partial Sandbox',       oauthEnv: 'sandbox'    },
  { value: 'full_sandbox',        label: 'Full Sandbox',          oauthEnv: 'sandbox'    },
  { value: 'scratch_org',         label: 'Scratch Org',           oauthEnv: 'sandbox'    },
];

export default function ConnectOrgButton({ defaultAccountId = null }) {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [accountMode, setAccountMode] = useState('existing');
  const [selectedAccountId, setSelectedAccountId] = useState(
    defaultAccountId ? String(defaultAccountId) : ''
  );
  const [newAccountName, setNewAccountName] = useState('');
  const [envType, setEnvType] = useState('production');
  const containerRef = useRef(null);

  useEffect(() => {
    if (open && !defaultAccountId) {
      getAccounts().then(setAccounts).catch(() => {});
    }
  }, [open, defaultAccountId]);

  // Close panel when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selectedEnv = ENV_OPTIONS.find((o) => o.value === envType) || ENV_OPTIONS[0];

  const loginUrl = (() => {
    const { oauthEnv, label } = selectedEnv;
    if (defaultAccountId) return getLoginUrl(oauthEnv, defaultAccountId, null, label);
    if (accountMode === 'new' && newAccountName.trim()) {
      return getLoginUrl(oauthEnv, null, newAccountName.trim(), label);
    }
    if (accountMode === 'existing' && selectedAccountId) {
      return getLoginUrl(oauthEnv, parseInt(selectedAccountId), null, label);
    }
    return null;
  })();

  return (
    <div className="connect-org" ref={containerRef}>
      <button className="connect-btn" onClick={() => setOpen((v) => !v)}>
        Connect Org
      </button>

      {open && (
        <div className="connect-panel">
          {!defaultAccountId && (
            <div className="connect-field">
              <label>Account</label>
              <div className="connect-account-row">
                <select value={accountMode} onChange={(e) => setAccountMode(e.target.value)}>
                  <option value="existing">Existing</option>
                  <option value="new">New</option>
                </select>
                {accountMode === 'existing' ? (
                  <select
                    value={selectedAccountId}
                    onChange={(e) => setSelectedAccountId(e.target.value)}
                  >
                    <option value="">— Select —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    className="text-input"
                    placeholder="Account name"
                    value={newAccountName}
                    onChange={(e) => setNewAccountName(e.target.value)}
                    autoFocus
                  />
                )}
              </div>
            </div>
          )}

          <div className="connect-field">
            <label>Environment</label>
            <select value={envType} onChange={(e) => setEnvType(e.target.value)}>
              {ENV_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="connect-panel-actions">
            {loginUrl ? (
              <a href={loginUrl} className="connect-btn">Connect</a>
            ) : (
              <span className="connect-btn connect-btn-disabled">Connect</span>
            )}
            <button onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
