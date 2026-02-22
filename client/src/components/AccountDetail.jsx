import { useState, useEffect } from 'react';
import { getAccount } from '../api';
import ConnectOrgButton from './ConnectOrgButton';

export default function AccountDetail({ account, onBack, onOrgSelect }) {
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAccount(account.id).then(({ orgs }) => {
      setOrgs(orgs);
      setLoading(false);
    });
  }, [account.id]);

  return (
    <div className="org-detail">
      <button className="back-btn" onClick={onBack}>
        ← Accounts
      </button>

      <div className="scan-header">
        <h2>{account.name}</h2>
        <ConnectOrgButton defaultAccountId={account.id} />
      </div>

      <h3>Connected Orgs</h3>
      {loading && <p>Loading...</p>}
      {!loading && orgs.length === 0 && (
        <p>No orgs connected yet. Click "Connect Org" to add one.</p>
      )}
      {!loading && orgs.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Instance URL</th>
              <th>Connected</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((org) => (
              <tr key={org.id} className="org-row" onClick={() => onOrgSelect(org)}>
                <td>{org.name}</td>
                <td>{org.instance_url}</td>
                <td>{new Date(org.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
