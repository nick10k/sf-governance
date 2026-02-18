import { useState, useEffect } from 'react';
import { getScan } from '../api';

export default function ScanStatus({ scan }) {
  const [details, setDetails] = useState(null);

  useEffect(() => {
    if (scan.scanId) {
      getScan(scan.scanId).then(setDetails);
    }
  }, [scan.scanId]);

  if (!details) return <p>Loading scan results...</p>;

  return (
    <div className="scan-results">
      <h2>
        Scan #{details.scan.id} &mdash;{' '}
        <span className={`status-${details.scan.status}`}>
          {details.scan.status}
        </span>
      </h2>
      <p>Found {details.items.length} metadata items</p>
      {details.items.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>API Name</th>
            </tr>
          </thead>
          <tbody>
            {details.items.map((item) => (
              <tr key={item.id}>
                <td>{item.type}</td>
                <td>{item.api_name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
