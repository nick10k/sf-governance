import ScanButton from './ScanButton';

export default function OrgList({ orgs, onScanComplete }) {
  if (orgs.length === 0) {
    return <p>No orgs connected yet. Click "Connect Salesforce Org" to get started.</p>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Instance URL</th>
          <th>Connected</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {orgs.map((org) => (
          <tr key={org.id}>
            <td>{org.name}</td>
            <td>{org.instance_url}</td>
            <td>{new Date(org.created_at).toLocaleDateString()}</td>
            <td>
              <ScanButton orgId={org.id} onComplete={onScanComplete} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
