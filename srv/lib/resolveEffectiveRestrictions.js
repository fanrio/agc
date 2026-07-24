const { safeJsonParse } = require('./utils');


/**
 * resolveEffectiveRestrictions
 * Recursively walks the parentRole chain and accumulates all restrictions.
 * Tags each restriction with its source role.
 * Throws if a circular reference is detected.
 */
function resolveEffectiveRestrictions(roleId, allRoles, allRestrictions, allInheritances = []) {
  // Pre-index collections into Maps for O(1) lookups
  const rolesMap = new Map(allRoles.map(r => [r.ID, r]));

  const inheritanceMap = new Map();
  for (const i of allInheritances) {
    if (!inheritanceMap.has(i.role_ID)) inheritanceMap.set(i.role_ID, []);
    inheritanceMap.get(i.role_ID).push(i);
  }

  const restrictionsMap = new Map();
  for (const r of allRestrictions) {
    if (!restrictionsMap.has(r.role_ID)) restrictionsMap.set(r.role_ID, []);
    restrictionsMap.get(r.role_ID).push(r);
  }

  const visiting = new Set();
  const resolved = new Set();
  const result = [];

  function walk(currentRoleId, isOwn) {
    if (visiting.has(currentRoleId)) {
      const role = rolesMap.get(currentRoleId);
      throw new Error(`Circular inheritance detected at role: ${role ? role.name : currentRoleId}`);
    }
    if (resolved.has(currentRoleId)) {
      return;
    }
    visiting.add(currentRoleId);

    const role = rolesMap.get(currentRoleId);
    if (role) {
      const parents = inheritanceMap.get(currentRoleId) || [];
      for (const relation of parents) {
        walk(relation.parent_ID, false);
      }

      const ownRestrictions = restrictionsMap.get(currentRoleId) || [];
      for (const restriction of ownRestrictions) {
        result.push({
          restrictionId: restriction.ID,
          field: restriction.field,
          filterType: restriction.filterType,
          value: restriction.value,
          sourceRoleId: currentRoleId,
          sourceRoleName: role.name,
          isOwn: isOwn,
        });
      }
    }

    visiting.delete(currentRoleId);
    resolved.add(currentRoleId);
  }

  walk(roleId, true);

  // Filter out parent pattern/wildcard restrictions if a descendant has a restriction on the same field
  const finalResult = [];
  const fieldsRestrictedByDescendants = new Set();

  const isPatternRestriction = (r) => {
    if (!r) return false;
    const ft = (r.filterType || '').toUpperCase();
    const val = String(r.value || '').trim();
    if (ft === 'ALL' || ft === 'CP') return true;
    if (val === '*' || val.includes('*') || val.includes('?')) return true;
    return false;
  };

  for (let i = result.length - 1; i >= 0; i--) {
    const r = result[i];
    const fieldLower = r.field.toLowerCase();

    if (isPatternRestriction(r)) {
      if (fieldsRestrictedByDescendants.has(fieldLower)) {
        continue; // discard ancestor pattern/wildcard restriction
      }
    }

    fieldsRestrictedByDescendants.add(fieldLower);
    finalResult.unshift(r);
  }

  return finalResult;
}

/**
 * evaluateRestriction
 * Checks a single data value against a restriction.
 */
function evaluateRestriction(restriction, dataRow) {
  const rawValue = dataRow[restriction.field];
  if (rawValue === undefined || rawValue === null) {
    return { passed: false, reason: `Field '${restriction.field}' missing in data` };
  }

  const cellValue = String(rawValue);

  switch (restriction.filterType) {
    case 'SINGLE_VALUE':
    case 'EQ':
      if (cellValue !== restriction.value) {
        return { passed: false, reason: `${restriction.field} must be '${restriction.value}', got '${cellValue}'` };
      }
      break;

    case 'NE':
      if (cellValue === restriction.value) {
        return { passed: false, reason: `${restriction.field} must not be '${restriction.value}', got '${cellValue}'` };
      }
      break;

    case 'GT': {
      const numCell = parseFloat(cellValue);
      const numLimit = parseFloat(restriction.value);
      if (isNaN(numCell) || isNaN(numLimit) ? cellValue <= restriction.value : numCell <= numLimit) {
        return { passed: false, reason: `${restriction.field} must be > ${restriction.value}, got '${cellValue}'` };
      }
      break;
    }

    case 'GE': {
      const numCell = parseFloat(cellValue);
      const numLimit = parseFloat(restriction.value);
      if (isNaN(numCell) || isNaN(numLimit) ? cellValue < restriction.value : numCell < numLimit) {
        return { passed: false, reason: `${restriction.field} must be >= ${restriction.value}, got '${cellValue}'` };
      }
      break;
    }

    case 'LT': {
      const numCell = parseFloat(cellValue);
      const numLimit = parseFloat(restriction.value);
      if (isNaN(numCell) || isNaN(numLimit) ? cellValue >= restriction.value : numCell >= numLimit) {
        return { passed: false, reason: `${restriction.field} must be < ${restriction.value}, got '${cellValue}'` };
      }
      break;
    }

    case 'LE': {
      const numCell = parseFloat(cellValue);
      const numLimit = parseFloat(restriction.value);
      if (isNaN(numCell) || isNaN(numLimit) ? cellValue > restriction.value : numCell > numLimit) {
        return { passed: false, reason: `${restriction.field} must be <= ${restriction.value}, got '${cellValue}'` };
      }
      break;
    }

    case 'ALL':
      break;

    case 'N':
      if (rawValue !== null && rawValue !== undefined && String(rawValue).trim() !== '') {
        return { passed: false, reason: `${restriction.field} must be null, got '${cellValue}'` };
      }
      break;

    case 'NN':
      if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') {
        return { passed: false, reason: `${restriction.field} must not be null` };
      }
      break;

    case 'MULTI_VALUE': {
      const allowed = safeJsonParse(restriction.value, []);
      if (!Array.isArray(allowed) || !allowed.includes(cellValue)) {
        return { passed: false, reason: `${restriction.field} must be one of [${allowed.join(', ')}], got '${cellValue}'` };
      }
      break;
    }

    case 'RANGE':
    case 'BT': {
      const parsed = safeJsonParse(restriction.value, null);
      if (!parsed || parsed.from === undefined || parsed.to === undefined) {
        return { passed: false, reason: `Invalid range specification in restriction` };
      }
      const { from, to } = parsed;
      const num = parseFloat(cellValue);
      if (isNaN(num) || num < from || num > to) {
        return { passed: false, reason: `${restriction.field} must be between ${from} and ${to}, got '${cellValue}'` };
      }
      break;
    }

    case 'CP': {
      const pattern = restriction.value
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/%/g, '.*')
        .replace(/_/g, '.');
      const regex = new RegExp(`^${pattern}$`, 'i');
      if (!regex.test(cellValue)) {
        return { passed: false, reason: `${restriction.field} must match pattern '${restriction.value}', got '${cellValue}'` };
      }
      break;
    }

    case 'HIERARCHY':
      break;

    default:
      return { passed: false, reason: `Unknown filter type: ${restriction.filterType}` };
  }

  return { passed: true, reason: 'OK' };
}

module.exports = { resolveEffectiveRestrictions, evaluateRestriction };
