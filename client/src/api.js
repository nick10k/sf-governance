const API_BASE = import.meta.env.VITE_API_BASE || '';

export async function getOrgs() {
  const res = await fetch(`${API_BASE}/api/orgs`);
  return res.json();
}

export async function updateOrg(orgId, data) {
  const res = await fetch(`${API_BASE}/api/orgs/${orgId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function getOrgScans(orgId) {
  const res = await fetch(`${API_BASE}/api/orgs/${orgId}/scans`);
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

export async function deleteScan(scanId) {
  await fetch(`${API_BASE}/api/scans/${scanId}`, { method: 'DELETE' });
}

export async function getInventory(scanId) {
  const res = await fetch(`${API_BASE}/api/scans/${scanId}/inventory`);
  return res.json();
}

export async function getProfile(orgId) {
  const res = await fetch(`${API_BASE}/api/orgs/${orgId}/profile`);
  return res.json();
}

export async function updateProfile(orgId, data) {
  const res = await fetch(`${API_BASE}/api/orgs/${orgId}/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function getRules() {
  const res = await fetch(`${API_BASE}/api/rules`);
  return res.json();
}

export async function createRule(data) {
  const res = await fetch(`${API_BASE}/api/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function updateRule(id, data) {
  const res = await fetch(`${API_BASE}/api/rules/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function deleteRule(id) {
  const res = await fetch(`${API_BASE}/api/rules/${id}`, { method: 'DELETE' });
  if (!res.ok) return res.json();
  return null;
}

export async function runAnalysis(scanId) {
  const res = await fetch(`${API_BASE}/api/scans/${scanId}/analysis`, { method: 'POST' });
  return res.json(); // { run_id, finding_count, recommendation_count }
}

export async function getRecommendations(scanId, runId = null) {
  const url = runId
    ? `${API_BASE}/api/scans/${scanId}/recommendations?runId=${runId}`
    : `${API_BASE}/api/scans/${scanId}/recommendations`;
  const res = await fetch(url);
  return res.json();
}

export async function updateRecommendationStatus(recommendationId, status) {
  const res = await fetch(`${API_BASE}/api/recommendations/${recommendationId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  return res.json();
}

export async function getAnalysisRuns(scanId) {
  const res = await fetch(`${API_BASE}/api/scans/${scanId}/analysis-runs`);
  return res.json();
}

export async function getFindings(scanId, runId = null) {
  const url = runId
    ? `${API_BASE}/api/scans/${scanId}/findings?runId=${runId}`
    : `${API_BASE}/api/scans/${scanId}/findings`;
  const res = await fetch(url);
  return res.json();
}

export async function getAccounts() {
  const res = await fetch(`${API_BASE}/api/accounts`);
  return res.json();
}

export async function createAccount(name) {
  const res = await fetch(`${API_BASE}/api/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

export async function getAccount(id) {
  const res = await fetch(`${API_BASE}/api/accounts/${id}`);
  return res.json();
}

export function getLoginUrl(env = 'production', accountId = null, accountName = null, envLabel = null) {
  const params = new URLSearchParams({ env });
  if (accountId) params.set('accountId', accountId);
  if (accountName) params.set('accountName', accountName);
  if (envLabel) params.set('envLabel', envLabel);
  return `${API_BASE}/auth/login?${params}`;
}

export async function getProgress(jobId) {
  const res = await fetch(`${API_BASE}/api/progress/${jobId}`);
  if (!res.ok) return null;
  return res.json();
}

export async function explainAutomation(automationId) {
  const res = await fetch(`${API_BASE}/api/automations/${automationId}/explain`, {
    method: 'POST',
  });
  return res.json(); // { summary: string | null }
}

export async function initiateRemediation(recommendationId) {
  const res = await fetch(`${API_BASE}/api/recommendations/${recommendationId}/remediate`, {
    method: 'POST',
  });
  return res.json();
}

export async function getRemediationJob(jobId) {
  const res = await fetch(`${API_BASE}/api/remediation-jobs/${jobId}`);
  return res.json();
}

export async function approveRemediation(jobId, editedMetadata = null) {
  const res = await fetch(`${API_BASE}/api/remediation-jobs/${jobId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ editedMetadata }),
  });
  return res.json();
}

export async function rejectRemediation(jobId) {
  const res = await fetch(`${API_BASE}/api/remediation-jobs/${jobId}/reject`, {
    method: 'POST',
  });
  return res.json();
}

export async function rollbackRemediation(jobId) {
  const res = await fetch(`${API_BASE}/api/remediation-jobs/${jobId}/rollback`, {
    method: 'POST',
  });
  return res.json();
}
