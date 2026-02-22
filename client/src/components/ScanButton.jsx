import { useState } from 'react';
import { startScan } from '../api';

export default function ScanButton({ orgId, onComplete }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleClick = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await startScan(orgId);
      onComplete(result);
    } catch (err) {
      setError(err.message || 'Scan failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button onClick={handleClick} disabled={loading}>
        {loading ? 'Scanning...' : 'Run Scan'}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
