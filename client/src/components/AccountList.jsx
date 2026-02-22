export default function AccountList({ accounts, onAccountSelect }) {
  if (accounts.length === 0) {
    return <p>No accounts yet. Create an account to get started.</p>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Account</th>
          <th>Connected Orgs</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        {accounts.map((account) => (
          <tr key={account.id} className="org-row" onClick={() => onAccountSelect(account)}>
            <td>{account.name}</td>
            <td>{account.org_count?.toLocaleString()}</td>
            <td>{new Date(account.created_at).toLocaleDateString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
