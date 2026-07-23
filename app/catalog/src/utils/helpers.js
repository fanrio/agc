export const ENV_LABEL = {
  P: 'Production',
  Q: 'Quality Assurance',
  D: 'Development'
};

export const ENV_COLOR = {
  P: 'error',
  Q: 'warning',
  D: 'info'
};

// Helper to format ISO datetime strings
export function formatDateTime(isoString) {
  if (!isoString) return '—';
  const date = new Date(isoString);
  return date.toLocaleString(undefined, { 
    dateStyle: 'short', 
    timeStyle: 'short' 
  });
}

// Helper to determine if a specific restriction is critical
export function isCriticalRestriction(r, orgNodes = []) {
  const type = r.filterType;
  const val = r.value || '';
  if (type === 'SINGLE_VALUE') {
    return val.toUpperCase() === 'ALL';
  }
  if (type === 'MULTI_VALUE') {
    try {
      const arr = JSON.parse(val);
      if (Array.isArray(arr) && arr.some(v => String(v).toUpperCase() === 'ALL')) {
        return true;
      }
    } catch (e) {
      if (val.toUpperCase() === 'ALL') return true;
    }
  }
  if (type === 'CP') {
    return val.includes('*');
  }
  if (type === 'HIERARCHY') {
    const node = orgNodes.find(n => n.ID === val);
    if (node) {
      return !node.parent_ID && (!node.parent || !node.parent.ID);
    }
  }
  return false;
}

/**
 * Helper to check if a specific role ID/name is within the permitted scope.
 * Handles both JSON arrays and comma-separated string fallbacks.
 * @param {string} roleId
 * @param {string} roleName
 * @param {string} scope
 * @returns {boolean}
 */
export function isRoleInScope(roleId, roleName, scope) {
  if (!scope || scope.trim() === '' || scope.trim().toUpperCase() === 'ALL' || scope.trim() === '*') {
    return true;
  }
  
  try {
    const scopeList = JSON.parse(scope);
    if (Array.isArray(scopeList)) {
      return scopeList.some(s => s.roleId === roleId || (roleName && s.roleId === roleName));
    }
  } catch (e) {
    const terms = scope.split(',').map(s => s.trim().toLowerCase());
    return terms.includes((roleId || '').toLowerCase()) || terms.includes((roleName || '').toLowerCase());
  }
  return false;
}

export function filterRolesByPermissions(roles, permissions) {
  if (!roles) return [];
  if (!permissions) return roles;
  if (permissions.isSuperAdmin) return roles;

  // Filter by allowedEnvironments
  const parseEnvs = (val) => {
    if (!val || val === 'ALL' || val === '*') return 'ALL';
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      return val.split(',').map(s => s.trim().toUpperCase());
    }
    return [];
  };
  const allowedEnvs = parseEnvs(permissions.allowedEnvironments);

  // Filter by allowedAccessDomains
  const parseAccessDomains = (val) => {
    if (!val || val === 'ALL' || val === '*') return 'ALL';
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      return val.split(',').map(s => s.trim());
    }
    return [];
  };
  const allowedAccessDomains = parseAccessDomains(permissions.allowedAccessDomains);

  return roles.filter(role => {
    const isApprover = Array.isArray(role.approvers) && role.approvers.some(a => String(a.userId).toLowerCase() === permissions.userId?.toLowerCase());
    if (isApprover) return true;

    // Environment and Access Domain scope restrictions
    if (allowedEnvs !== 'ALL') {
      const roleEnv = (role.environment_ID || '').toUpperCase();
      if (!allowedEnvs.includes(roleEnv)) return false;
    }
    if (allowedAccessDomains !== 'ALL') {
      const roleAccessDomain = role.accessDomain_ID;
      if (!allowedAccessDomains.includes(roleAccessDomain)) return false;
    }

    // DRAGE roles are only visible to superadmins (who returned early above)
    if (role.type === 'DRAGE') return false;

    // Check specific role type permissions
    if (role.type === 'SINGLE') {
      if (permissions.canManageSingleRoles) return true;
      if (permissions.canManageDerivedRoles && isRoleInScope(role.ID, role.name, permissions.managedDerivedRolesScope)) {
        return true;
      }
      return false;
    }

    if (role.type === 'ORG_BASED') {
      if (permissions.canManageOrgRoles) return true;
      if (permissions.canManageDerivedRoles && isRoleInScope(role.ID, role.name, permissions.managedDerivedRolesScope)) {
        return true;
      }
      return false;
    }

    if (role.type === 'DERIVED') {
      if (!permissions.canManageDerivedRoles) return false;
      const scope = permissions.managedDerivedRolesScope;
      const hasParentInScope = Array.isArray(role.parentRoles) && role.parentRoles.some(pr => {
        const parentId = pr.parent_ID || pr.parent?.ID;
        return isRoleInScope(parentId, pr.parent?.name, scope);
      });
      return hasParentInScope;
    }

    return false;
  });
}

export function canDeriveFromRole(role, permissions) {
  if (permissions?.isSuperAdmin) return true;
  if (!permissions) return false;
  if (!permissions.canManageDerivedRoles) return false;
  return isRoleInScope(role.ID, role.name, permissions.managedDerivedRolesScope);
}

export function isPatternRestriction(r) {
  if (!r) return false;
  const ft = (r.filterType || '').toUpperCase();
  const val = String(r.value || '').trim();
  if (ft === 'ALL' || ft === 'CP' || ft === 'PATTERN') return true;
  if (val === '*' || val.includes('*') || val.includes('?')) return true;
  return false;
}
