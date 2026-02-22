import { diffLines } from 'diff';

export default function DiffViewer({ sourceText, generatedText, onChange }) {
  const changes = diffLines(sourceText || '', generatedText || '');

  return (
    <div className="diff-viewer">
      <div className="diff-panel diff-panel--source">
        <div className="diff-panel-header">Source (original)</div>
        <pre className="diff-panel-content">
          {changes.map((part, i) => (
            <span
              key={i}
              className={
                part.removed
                  ? 'diff-line diff-line--removed'
                  : part.added
                  ? 'diff-line diff-line--hidden'
                  : 'diff-line'
              }
            >
              {!part.added ? part.value : ''}
            </span>
          ))}
        </pre>
      </div>
      <div className="diff-panel diff-panel--generated">
        <div className="diff-panel-header">Generated (editable)</div>
        <textarea
          className="diff-panel-textarea"
          value={generatedText || ''}
          onChange={(e) => onChange && onChange(e.target.value)}
          spellCheck={false}
        />
        <div className="diff-panel-highlights" aria-hidden="true">
          {changes.map((part, i) => (
            <span
              key={i}
              className={
                part.added
                  ? 'diff-line diff-line--added'
                  : part.removed
                  ? 'diff-line diff-line--hidden'
                  : 'diff-line'
              }
            >
              {!part.removed ? part.value : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
