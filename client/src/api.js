const API_BASE = 'http://localhost:3001';

export async function getOrgs() {
  const res = await fetch(`${API_BASE}/api/orgs`);
  return res.json();
}

export async function startScan(orgId) {
  const res = await fetch(`${API_BASE}/api/orgs/${orgId}/scans`, {
    method: 'POST',
  });
  return res.json();
}

export async function getScan(scanId) {
  const res = await fetch(`${API_BASE}/api/scans/${scanId}`);
  return res.json();
}

export function getLoginUrl() {
  return `${API_BASE}/auth/login`;
}
