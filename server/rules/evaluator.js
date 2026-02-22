const { CHECKS } = require('./checks');

function applyTemplate(template, item) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => item[key] ?? '');
}

// Evaluate JSONB conditions array against an inventory item (AND logic)
function evaluateConditions(item, conditions) {
  if (!conditions || conditions.length === 0) return false;
  return conditions.every(({ field, op, value }) => {
    const itemVal = item[field];
    switch (op) {
      case 'eq': return itemVal === value;
      case 'ne': return itemVal !== value;
      case 'in': return Array.isArray(value) && value.includes(itemVal);
      case 'not_in': return Array.isArray(value) && !value.includes(itemVal);
      default: return false;
    }
  });
}

function runAnalysis(inventory, rules, profile) {
  const activeRules = rules.filter(
    (r) =>
      profile.active_rule_layers.includes(r.layer) &&
      !profile.suppressed_rule_ids.includes(r.id)
  );

  const findings = [];

  for (const rule of activeRules) {
    const check = CHECKS[rule.id];

    if (rule.check_type === 'per_item') {
      for (const item of inventory) {
        if (rule.applies_to.length > 0 && !rule.applies_to.includes(item.automation_type)) continue;
        try {
          let triggered = false;
          if (check) {
            triggered = check(item, profile);
          } else if (rule.conditions) {
            triggered = evaluateConditions(item, rule.conditions);
          }
          if (triggered) {
            findings.push({
              rule_id: rule.id,
              severity: rule.severity,
              automation_inventory_id: item.id,
              api_name: item.api_name,
              object_name: item.object_name,
              message: applyTemplate(rule.recommendation_template, item),
            });
          }
        } catch (err) {
          console.warn(`Check ${rule.id} failed for item ${item.id}:`, err.message);
        }
      }
    } else {
      if (!check) continue; // cross_item rules require a hardcoded check function
      try {
        const results = check(inventory, profile);
        for (const result of results) {
          findings.push({
            rule_id: rule.id,
            severity: rule.severity,
            automation_inventory_id: result.item?.id ?? null,
            api_name: result.item?.api_name ?? null,
            object_name: result.item?.object_name ?? null,
            message: result.message,
          });
        }
      } catch (err) {
        console.warn(`Cross-item check ${rule.id} failed:`, err.message);
      }
    }
  }

  return findings;
}

module.exports = { runAnalysis };
