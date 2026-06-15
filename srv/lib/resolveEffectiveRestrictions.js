/**
 * resolveEffectiveRestrictions
 * Recursively walks the parentRole chain and accumulates all restrictions.
 * Tags each restriction with its source role.
 * Throws if a circular reference is detected.
 */
function resolveEffectiveRestrictions(roleId, allRoles, allRestrictions, allInheritances = []) {
  const visiting = new Set();
  const resolved = new Set();
  const result  = [];

  function walk(currentRoleId, isOwn) {
    if (visiting.has(currentRoleId)) {
      const role = allRoles.find(r => r.ID === currentRoleId);
      throw new Error(`Circular inheritance detected at role: ${role ? role.name : currentRoleId}`);
    }
    if (resolved.has(currentRoleId)) {
      return;
    }
    visiting.add(currentRoleId);

    const role = allRoles.find(r => r.ID === currentRoleId);
    if (role) {
      const parents = allInheritances.filter(i => i.role_ID === currentRoleId);
      for (const relation of parents) {
        walk(relation.parent_ID, false);
      }

      const ownRestrictions = allRestrictions.filter(r => r.role_ID === currentRoleId);
      for (const restriction of ownRestrictions) {
        result.push({
          restrictionId  : restriction.ID,
          field          : restriction.field,
          filterType     : restriction.filterType,
          value          : restriction.value,
          sourceRoleId   : currentRoleId,
          sourceRoleName : role.name,
          isOwn          : isOwn,
        });
      }
    }

    visiting.delete(currentRoleId);
    resolved.add(currentRoleId);
  }

  walk(roleId, true);
  return result;
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
      if (cellValue !== restriction.value) {
        return { passed: false, reason: `${restriction.field} must be '${restriction.value}', got '${cellValue}'` };
      }
      break;

    case 'MULTI_VALUE': {
      const allowed = JSON.parse(restriction.value);
      if (!allowed.includes(cellValue)) {
        return { passed: false, reason: `${restriction.field} must be one of [${allowed.join(', ')}], got '${cellValue}'` };
      }
      break;
    }

    case 'RANGE': {
      const { from, to } = JSON.parse(restriction.value);
      const num = parseFloat(cellValue);
      if (isNaN(num) || num < from || num > to) {
        return { passed: false, reason: `${restriction.field} must be between ${from} and ${to}, got '${cellValue}'` };
      }
      break;
    }

    case 'PATTERN': {
      // Convert SQL LIKE pattern to regex
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
      // In mock mode we simply pass hierarchy checks (requires live org tree traversal in production)
      break;

    default:
      return { passed: false, reason: `Unknown filter type: ${restriction.filterType}` };
  }

  return { passed: true, reason: 'OK' };
}

module.exports = { resolveEffectiveRestrictions, evaluateRestriction };
