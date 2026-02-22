import { useState, useEffect } from 'react';
import { getProfile, updateProfile, getRules } from '../api';

const LAYERS = ['platform', 'quality', 'risk', 'housekeeping'];

const PREFERENCE_LABELS = {
  flow_first: 'Flow First',
  apex_first: 'Apex First',
  balanced: 'Balanced',
};

export default function ProfileEditor({ org, onBack }) {
  const [profile, setProfile] = useState(null);
  const [rules, setRules] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([getProfile(org.id), getRules()]).then(([p, r]) => {
      setProfile(p);
      setRules(r);
    });
  }, [org.id]);

  const toggleLayer = (layer) => {
    setProfile((prev) => ({
      ...prev,
      active_rule_layers: prev.active_rule_layers.includes(layer)
        ? prev.active_rule_layers.filter((l) => l !== layer)
        : [...prev.active_rule_layers, layer],
    }));
  };

  const toggleRule = (ruleId) => {
    setProfile((prev) => ({
      ...prev,
      suppressed_rule_ids: prev.suppressed_rule_ids.includes(ruleId)
        ? prev.suppressed_rule_ids.filter((id) => id !== ruleId)
        : [...prev.suppressed_rule_ids, ruleId],
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    await updateProfile(org.id, {
      automation_preference: profile.automation_preference,
      active_rule_layers: profile.active_rule_layers,
      suppressed_rule_ids: profile.suppressed_rule_ids,
      naming_convention_pattern: profile.naming_convention_pattern || null,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!profile) return <p>Loading profile...</p>;

  return (
    <div className="profile-editor">
      <button className="back-btn" onClick={onBack}>
        ← {org.name}
      </button>
      <h2>Customer Profile</h2>
      <p className="org-url">{org.instance_url}</p>

      <section className="profile-section">
        <h3>Automation Preference</h3>
        <p className="section-hint">Guides remediation recommendations toward your preferred automation style.</p>
        <select
          value={profile.automation_preference}
          onChange={(e) => setProfile((prev) => ({ ...prev, automation_preference: e.target.value }))}
        >
          {Object.entries(PREFERENCE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </section>

      <section className="profile-section">
        <h3>Active Rule Layers</h3>
        <p className="section-hint">Only rules in active layers will be evaluated during analysis.</p>
        <div className="layer-checkboxes">
          {LAYERS.map((layer) => (
            <label key={layer} className="checkbox-label">
              <input
                type="checkbox"
                checked={profile.active_rule_layers.includes(layer)}
                onChange={() => toggleLayer(layer)}
              />
              {layer.charAt(0).toUpperCase() + layer.slice(1)}
            </label>
          ))}
        </div>
      </section>

      <section className="profile-section">
        <h3>Naming Convention</h3>
        <p className="section-hint">Optional regex pattern. Automations whose API names don't match will trigger the NAME001 rule.</p>
        <input
          type="text"
          className="text-input"
          placeholder="e.g. ^[A-Z][a-zA-Z0-9_]+"
          value={profile.naming_convention_pattern || ''}
          onChange={(e) => setProfile((prev) => ({ ...prev, naming_convention_pattern: e.target.value }))}
        />
      </section>

      <section className="profile-section">
        <h3>Suppressed Rules</h3>
        <p className="section-hint">Suppressed rules are skipped during analysis.</p>
        <table>
          <thead>
            <tr>
              <th>Suppress</th>
              <th>ID</th>
              <th>Layer</th>
              <th>Name</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={profile.suppressed_rule_ids.includes(rule.id)}
                    onChange={() => toggleRule(rule.id)}
                  />
                </td>
                <td>{rule.id}</td>
                <td>{rule.layer}</td>
                <td>{rule.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="profile-actions">
        <button onClick={handleSave} disabled={saving} className="primary-btn">
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Profile'}
        </button>
      </div>
    </div>
  );
}
