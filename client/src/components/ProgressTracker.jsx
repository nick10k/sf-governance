import { useState, useEffect, useRef } from 'react';
import { getProgress } from '../api';

export default function ProgressTracker({ jobId, onComplete, onError }) {
  const [job, setJob] = useState(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!jobId) return;

    const poll = async () => {
      const data = await getProgress(jobId);
      if (!data) return;
      setJob(data);
      if (data.status === 'done') {
        clearInterval(intervalRef.current);
        onComplete?.();
      } else if (data.status === 'error') {
        clearInterval(intervalRef.current);
        onError?.(data.error || 'Unknown error');
      }
    };

    poll();
    intervalRef.current = setInterval(poll, 500);
    return () => clearInterval(intervalRef.current);
  }, [jobId]);

  if (!job) {
    return (
      <div className="progress-tracker">
        <div className="progress-bar-track">
          <div className="progress-bar-indeterminate" />
        </div>
      </div>
    );
  }

  const doneCount = job.steps.filter((s) => s.status === 'done').length;
  const totalCount = job.steps.length;
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  const currentStep = job.steps.find((s) => s.status === 'running');

  return (
    <div className="progress-tracker">
      <div className="progress-bar-track">
        {job.status === 'running' ? (
          totalCount === 0 ? (
            <div className="progress-bar-indeterminate" />
          ) : (
            <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
          )
        ) : job.status === 'done' ? (
          <div className="progress-bar-fill" style={{ width: '100%' }} />
        ) : (
          <div className="progress-bar-fill progress-bar-fill--error" style={{ width: `${pct}%` }} />
        )}
      </div>

      {currentStep && (
        <p className="progress-current-label">{currentStep.label}</p>
      )}

      {job.steps.length > 0 && (
        <ol className="progress-step-list">
          {job.steps.map((s, i) => (
            <li key={i} className={`progress-step progress-step--${s.status}`}>
              <span className="progress-step-icon" aria-hidden="true">
                {s.status === 'done' ? '✓' : s.status === 'running' ? '▶' : s.status === 'error' ? '✗' : '○'}
              </span>
              <span className="progress-step-label">{s.label}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
