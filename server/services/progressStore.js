'use strict';

const { randomUUID } = require('crypto');

const store = new Map();

function create(id) {
  const jobId = id != null ? String(id) : randomUUID();
  store.set(jobId, { steps: [], status: 'running', error: null });
  return jobId;
}

function step(jobId, label) {
  const job = store.get(String(jobId));
  if (!job) return;
  for (const s of job.steps) {
    if (s.status === 'running') s.status = 'done';
  }
  job.steps.push({ label, status: 'running' });
}

function done(jobId) {
  const job = store.get(String(jobId));
  if (!job) return;
  for (const s of job.steps) {
    if (s.status === 'running') s.status = 'done';
  }
  job.status = 'done';
  setTimeout(() => store.delete(String(jobId)), 60_000);
}

function fail(jobId, message) {
  const job = store.get(String(jobId));
  if (!job) return;
  for (const s of job.steps) {
    if (s.status === 'running') s.status = 'error';
  }
  job.status = 'error';
  job.error = message;
  setTimeout(() => store.delete(String(jobId)), 60_000);
}

function get(jobId) {
  return store.get(String(jobId)) || null;
}

module.exports = { create, step, done, fail, get };
