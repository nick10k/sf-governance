function envDisplay(org) {
  return org.env_label || (org.env === 'sandbox' ? 'Sandbox' : 'Production');
}

export default function OrgList({ orgs, onOrgSelect }) {
  if (orgs.length === 0) {
    return <p>No orgs connected yet. Click "Connect Salesforce Org" to get started.</p>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Environment</th>
          <th>Instance URL</th>
          <th>Connected</th>
        </tr>
      </thead>
      <tbody>
        {orgs.map((org) => (
          <tr key={org.id} className="org-row" onClick={() => onOrgSelect(org)}>
            <td>{org.name}</td>
            <td>
              <span className={`env-badge env-badge--${org.env}`}>
                {envDisplay(org)}
              </span>
            </td>
            <td>{org.instance_url}</td>
            <td>{new Date(org.created_at).toLocaleDateString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
