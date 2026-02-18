import { useState, useEffect } from 'react';
import { getOrgs } from './api';
import ConnectOrgButton from './components/ConnectOrgButton';
import OrgList from './components/OrgList';
import ScanStatus from './components/ScanStatus';
import './App.css';

function App() {
  const [orgs, setOrgs] = useState([]);
  const [selectedScan, setSelectedScan] = useState(null);

  useEffect(() => {
    getOrgs().then(setOrgs);
  }, []);

  const refreshOrgs = () => getOrgs().then(setOrgs);

  return (
    <div className="app">
      <header>
        <h1>SF Governance</h1>
        <ConnectOrgButton />
      </header>

      <main>
        <section>
          <h2>Connected Orgs</h2>
          <button onClick={refreshOrgs} className="refresh-btn">
            Refresh
          </button>
          <OrgList orgs={orgs} onScanComplete={setSelectedScan} />
        </section>

        {selectedScan && (
          <section>
            <ScanStatus scan={selectedScan} />
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
