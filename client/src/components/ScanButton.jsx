import { useState } from 'react';
import { startScan } from '../api';

export default function ScanButton({ orgId, onComplete }) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      const result = await startScan(orgId);
      onComplete(result);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button onClick={handleClick} disabled={loading}>
      {loading ? 'Scanning...' : 'Run Scan'}
    </button>
  );
}
