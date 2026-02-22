import { useState } from 'react';
import { createRule, updateRule } from '../api';

const LAYERS = ['platform', 'quality', 'risk', 'housekeeping'];
const SEVERITIES = ['error', 'warning', 'info'];
const AUTOMATION_TYPES = [
  'Apex Class', 'Apex Trigger', 'Autolaunched Flow', 'Process Builder',
  'Record-Triggered Flow', 'Screen Flow', 'Workflow Rule',
];
const CONDITION_FIELDS = [
  { value: 'automation_type', label: 'Automation Type', type: 'enum' },
  { value: 'is_active', label: 'Is Active', type: 'boolean' },
  { value: 'is_managed_package', label: 'Is Managed Package', type: 'boolean' },
  { value: 'has_description', label: 'Has Description', type: 'boolean' },
  { value: 'object_name', label: 'Object Name', type: 'string' },
];
const OPS_BY_TYPE = {
  boolean: [{ value: 'eq', label: 'is' }],
  enum: [
    { value: 'eq', label: 'is' },
    { value: 'ne', label: 'is not' },
    { value: 'in', label: 'is one of' },
    { value: 'not_in', label: 'is not one of' },
  ],
  string: [
    { value: 'eq', label: 'equals' },
    { value: 'ne', label: 'does not equal' },
  ],
};

function emptyCondition() {
  return { field: 'automation_type', op: 'eq', value: '' };
}

function ConditionRow({ condition, onChange, onRemove }) {
  const fieldDef = CONDITION_FIELDS.find((f) => f.value === condition.field);
  const ops = OPS_BY_TYPE[fieldDef?.type || 'string'];
  const isMulti = condition.op === 'in' || condition.op === 'not_in';

  const handleFieldChange = (field) => {
    const newFieldDef = CONDITION_FIELDS.find((f) => f.value === field);
    const newOp = OPS_BY_TYPE[newFieldDef?.type || 'string'][0].value;
    onChange({ field, op: newOp, value: newFieldDef?.type === 'boolean' ? true : '' });
  };

  const handleValueChange = (raw) => {
    const type = fieldDef?.type;
    if (type === 'boolean') onChange({ ...condition, value: raw === 'true' });
    else onChange({ ...condition, value: raw });
  };

  const handleMultiChange = (val, checked) => {
    const current = Array.isArray(condition.value) ? condition.value : [];
    const next = checked ? [...current, val] : current.filter((v) => v !== val);
    onChange({ ...condition, value: next });
  };

  return (
    <div className="condition-row">
      <select value={condition.field} onChange={(e) => handleFieldChange(e.target.value)}>
        {CONDITION_FIELDS.map((f) => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>
      <select value={condition.op} onChange={(e) => onChange({ ...condition, op: e.target.value, value: '' })}>
        {ops.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {fieldDef?.type === 'boolean' && (
        <select value={String(condition.value)} onChange={(e) => handleValueChange(e.target.value)}>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      )}
      {fieldDef?.type === 'enum' && !isMulti && (
        <select value={condition.value} onChange={(e) => onChange({ ...condition, value: e.target.value })}>
          <option value="">— select —</option>
          {AUTOMATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      )}
      {fieldDef?.type === 'enum' && isMulti && (
        <div className="condition-multi">
          {AUTOMATION_TYPES.map((t) => (
            <label key={t} className="checkbox-label">
              <input
                type="checkbox"
                checked={Array.isArray(condition.value) && condition.value.includes(t)}
                onChange={(e) => handleMultiChange(t, e.target.checked)}
              />
              {t}
            </label>
          ))}
        </div>
      )}
      {fieldDef?.type === 'string' && (
        <input
          type="text"
          className="text-input"
          value={condition.value}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}
          placeholder="value"
        />
      )}
      <button className="delete-btn" onClick={onRemove}>✕</button>
    </div>
  );
}

export default function RuleEditor({ rule, onBack, onSave }) {
  const isNew = !rule;
  const isBuiltin = rule?.is_builtin ?? false;

  const [id, setId] = useState(rule?.id ?? '');
  const [layer, setLayer] = useState(rule?.layer ?? 'quality');
  const [name, setName] = useState(rule?.name ?? '');
  const [description, setDescription] = useState(rule?.description ?? '');
  const [severity, setSeverity] = useState(rule?.severity ?? 'warning');
  const [checkType, setCheckType] = useState(rule?.check_type ?? 'per_item');
  const [appliesTo, setAppliesTo] = useState(rule?.applies_to ?? []);
  const [template, setTemplate] = useState(rule?.recommendation_template ?? '');
  const [conditions, setConditions] = useState(rule?.conditions ?? []);
  const [isActive, setIsActive] = useState(rule?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const toggleAppliesTo = (type) => {
    setAppliesTo((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const addCondition = () => setConditions((prev) => [...prev, emptyCondition()]);
  const updateCondition = (i, updated) =>
    setConditions((prev) => prev.map((c, idx) => (idx === i ? updated : c)));
  const removeCondition = (i) =>
    setConditions((prev) => prev.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        layer, name, description, severity,
        check_type: checkType, applies_to: appliesTo,
        recommendation_template: template,
        conditions: (!isBuiltin && checkType === 'per_item' && conditions.length > 0) ? conditions : null,
        is_active: isActive,
      };
      let saved;
      if (isNew) {
        saved = await createRule({ ...payload, id });
      } else {
        saved = await updateRule(rule.id, payload);
      }
      if (saved.error) { setError(saved.error); return; }
      onSave(saved);
    } catch (err) {
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rule-editor">
      <button className="back-btn" onClick={onBack}>← Rule Library</button>

      <div className="scan-header">
        <h2>{isNew ? 'New Rule' : isBuiltin ? `Edit Rule: ${rule.id}` : `Edit Rule: ${rule.id}`}</h2>
        {isBuiltin && (
          <span className="builtin-badge">Built-in</span>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      <div className="rule-editor-form">
        <div className="rule-editor-field">
          <label>Rule ID</label>
          {isNew ? (
            <input type="text" className="text-input" value={id}
              onChange={(e) => setId(e.target.value.toUpperCase().replace(/\s/g, '_'))}
              placeholder="e.g. MYORG001" />
          ) : (
            <span className="field-readonly">{rule.id}</span>
          )}
        </div>

        <div className="rule-editor-field">
          <label>Name</label>
          <input type="text" className="text-input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="rule-editor-row">
          <div className="rule-editor-field">
            <label>Layer</label>
            <select value={layer} onChange={(e) => setLayer(e.target.value)} disabled={isBuiltin}>
              {LAYERS.map((l) => <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>)}
            </select>
          </div>
          <div className="rule-editor-field">
            <label>Severity</label>
            <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
              {SEVERITIES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
          <div className="rule-editor-field">
            <label>Active</label>
            <select value={String(isActive)} onChange={(e) => setIsActive(e.target.value === 'true')}>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
        </div>

        <div className="rule-editor-field">
          <label>Description</label>
          <textarea className="text-area" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </div>

        {!isBuiltin && (
          <div className="rule-editor-field">
            <label>Check Type</label>
            <select value={checkType} onChange={(e) => setCheckType(e.target.value)}>
              <option value="per_item">Per Item</option>
              <option value="cross_item">Cross Item</option>
            </select>
            <p className="section-hint">Cross-item rules require a built-in check function and cannot use conditions.</p>
          </div>
        )}

        <div className="rule-editor-field">
          <label>Applies To</label>
          {isBuiltin ? (
            <span className="field-readonly">{rule.applies_to.length === 0 ? 'All types' : rule.applies_to.join(', ')}</span>
          ) : (
            <div className="layer-checkboxes" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
              {AUTOMATION_TYPES.map((t) => (
                <label key={t} className="checkbox-label">
                  <input type="checkbox" checked={appliesTo.includes(t)}
                    onChange={() => toggleAppliesTo(t)} />
                  {t}
                </label>
              ))}
            </div>
          )}
          {!isBuiltin && <p className="section-hint">Leave all unchecked to apply to every type.</p>}
        </div>

        <div className="rule-editor-field">
          <label>Recommendation Template</label>
          <input type="text" className="text-input" value={template}
            onChange={(e) => setTemplate(e.target.value)}
            placeholder="Use {{api_name}} and {{object_name}} as placeholders" />
        </div>

        {!isBuiltin && checkType === 'per_item' && (
          <div className="rule-editor-field">
            <div className="section-header">
              <label>Conditions <span style={{ fontWeight: 'normal', color: '#666' }}>(all must match)</span></label>
              <button onClick={addCondition}>+ Add Condition</button>
            </div>
            {conditions.length === 0 && (
              <p className="section-hint">No conditions — rule will never fire. Add at least one condition.</p>
            )}
            {conditions.map((cond, i) => (
              <ConditionRow
                key={i}
                condition={cond}
                onChange={(updated) => updateCondition(i, updated)}
                onRemove={() => removeCondition(i)}
              />
            ))}
          </div>
        )}

        <div className="rule-editor-actions">
          <button className="primary-btn" onClick={handleSave} disabled={saving || !name.trim() || (isNew && !id.trim())}>
            {saving ? 'Saving...' : 'Save Rule'}
          </button>
          <button onClick={onBack}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
