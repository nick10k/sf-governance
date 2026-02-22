import { useState, useEffect } from 'react';
import { getAccounts, createAccount } from './api';
import ConnectOrgButton from './components/ConnectOrgButton';
import AccountList from './components/AccountList';
import AccountDetail from './components/AccountDetail';
import OrgDetail from './components/OrgDetail';
import ScanStatus from './components/ScanStatus';
import ProfileEditor from './components/ProfileEditor';
import RuleLibrary from './components/RuleLibrary';
import RuleEditor from './components/RuleEditor';
import './App.css';

function App() {
  const [accounts, setAccounts] = useState([]);
  const [page, setPage] = useState({ view: 'home' });
  const [newAccountName, setNewAccountName] = useState('');
  const [showNewAccount, setShowNewAccount] = useState(false);

  const refreshAccounts = () => getAccounts().then(setAccounts);

  useEffect(() => {
    refreshAccounts();
  }, []);

  const navigate = (newPage) => setPage(newPage);

  const handleCreateAccount = async (e) => {
    e.preventDefault();
    if (!newAccountName.trim()) return;
    await createAccount(newAccountName.trim());
    setNewAccountName('');
    setShowNewAccount(false);
    refreshAccounts();
  };

  return (
    <div className="app">
      <header>
        <h1 className="site-title" onClick={() => navigate({ view: 'home' })}>
          10K Smart Automation Wizard
        </h1>
        <div className="header-actions">
          <button className="rules-btn" onClick={() => navigate({ view: 'rules' })}>
            Rule Library
          </button>
          <ConnectOrgButton />
        </div>
      </header>

      <main>
        {page.view === 'home' && (
          <section>
            <div className="section-header">
              <h2>Accounts</h2>
              <button onClick={() => setShowNewAccount((v) => !v)} className="refresh-btn">
                {showNewAccount ? 'Cancel' : 'New Account'}
              </button>
            </div>

            {showNewAccount && (
              <form className="new-account-form" onSubmit={handleCreateAccount}>
                <input
                  type="text"
                  className="text-input"
                  placeholder="Account name"
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  autoFocus
                />
                <button type="submit" className="primary-btn" disabled={!newAccountName.trim()}>
                  Create
                </button>
              </form>
            )}

            <AccountList
              accounts={accounts}
              onAccountSelect={(account) => navigate({ view: 'account', account })}
            />
          </section>
        )}

        {page.view === 'account' && (
          <AccountDetail
            account={page.account}
            onBack={() => navigate({ view: 'home' })}
            onOrgSelect={(org) => navigate({ view: 'org', account: page.account, org })}
          />
        )}

        {page.view === 'org' && (
          <OrgDetail
            org={page.org}
            onBack={() => navigate({ view: 'account', account: page.account })}
            onScanSelect={(scan) => navigate({ view: 'scan', account: page.account, org: page.org, scan })}
            onProfileSelect={() => navigate({ view: 'profile', account: page.account, org: page.org })}
            onOrgUpdate={(updated) => setPage((p) => ({ ...p, org: updated }))}
          />
        )}

        {page.view === 'scan' && (
          <ScanStatus
            scan={page.scan}
            org={page.org}
            onBack={() => navigate({ view: 'org', account: page.account, org: page.org })}
          />
        )}

        {page.view === 'profile' && (
          <ProfileEditor
            org={page.org}
            onBack={() => navigate({ view: 'org', account: page.account, org: page.org })}
          />
        )}

        {page.view === 'rules' && (
          <RuleLibrary
            onBack={() => navigate({ view: 'home' })}
            onNewRule={() => navigate({ view: 'rule-editor', rule: null })}
            onEditRule={(rule) => navigate({ view: 'rule-editor', rule })}
          />
        )}

        {page.view === 'rule-editor' && (
          <RuleEditor
            rule={page.rule}
            onBack={() => navigate({ view: 'rules' })}
            onSave={() => navigate({ view: 'rules' })}
          />
        )}
      </main>
    </div>
  );
}

export default App;
