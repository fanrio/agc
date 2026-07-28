/**
 * authGuard.js - Backend authorization helper
 */

function getUserId(req) {
  const cds = global.cds || require('@sap/cds');
  const isTest = process.env.NODE_ENV === 'test' ||
    process.execArgv.includes('--test') ||
    (process.argv[1] && process.argv[1].includes('test'));

  // Use simulated user header if present in non-production or test environment
  if (process.env.NODE_ENV !== 'production' || isTest) {
    const simUser = req.headers['x-simulated-user'] || req.headers['X-Simulated-User'];
    if (simUser) {
      req.user = new cds.User({ id: simUser, roles: ['authenticated-user'] });
      return simUser;
    }
  }
  if (isTest) {
    req.user = new cds.User({ id: 'admin', roles: ['authenticated-user'] });
    return 'admin';
  }
  return req.user?.id || 'anonymous';
}


async function getSessionPermissions(req, db, AppAuthorizations) {
  const userId = getUserId(req);

  const userAuth = await db.run(
    SELECT.one.from(AppAuthorizations).where({ userId, isActive: true })
  );

  if (userAuth) {
    return userAuth;
  }

  const err = new Error('Access Denied: You must have authorizations to access the system.');
  err.status = 403;
  throw err;
}

function requirePermission(permissions, flag, req) {
  if (permissions.isSuperAdmin) return; // SuperAdmin bypasses all checks
  if (!permissions[flag]) {
    req.reject(403, `Access Denied: You do not have permission to perform this action (${flag}).`);
  }
}

function requireEnvironment(permissions, envId, req) {
  if (permissions.isSuperAdmin) return; // SuperAdmin bypasses all checks
  const allowed = permissions.allowedEnvironments || 'ALL';
  if (allowed === 'ALL' || allowed === '*') return;

  try {
    const envs = JSON.parse(allowed);
    if (Array.isArray(envs) && envs.includes(envId)) return;
  } catch (e) {
    // Fallback: comma separated list
    const envs = allowed.split(',').map(s => s.trim().toUpperCase());
    if (envs.includes(String(envId).toUpperCase())) return;
  }

  req.reject(403, `Access Denied: You are not authorized to manage resources in environment ${envId || 'unspecified'}.`);
}


const parseAccessDomains = (val) => {
  const parsed = JSON.parse(val);
  return parsed.lenght === 0 ? 'ALL' : parsed;

};
function requireAccessDomain(permissions, accessDomainId, req) {
  if (permissions.isSuperAdmin) return; // SuperAdmin bypasses all checks

  const allowedAccessDomains = parseAccessDomains(permissions.allowedAccessDomains);

  if (allowedAccessDomains.length === 0) return;

  try {

    if (allowedAccessDomains.includes(accessDomainId)) return;
  } catch (e) {
    // Fallback: comma separated list
    const domains = allowed.split(',').map(s => s.trim());
    if (domains.includes(String(accessDomainId).trim())) return;
  }

  req.reject(403, `Access Denied: You are not authorized to manage roles in access domain ${accessDomainId || 'unspecified'}.`);
}

/**
 * Safe parser for scope strings (JSON array or comma-separated list).
 * Returns array of normalized scope strings.
 */
function parseRoleScope(scope) {
  if (!scope || scope === 'ALL' || scope === '*') return ['*'];
  try {
    const parsed = JSON.parse(scope);
    if (Array.isArray(parsed)) {
      return parsed.map(item => {
        if (typeof item === 'object' && item !== null) {
          return String(item.roleId || item.id || item.name || item).trim();
        }
        return String(item).trim();
      });
    }
  } catch (e) {
    return scope.split(',').map(s => s.trim());
  }
  return [String(scope).trim()];
}

/**
 * Checks if a given roleId/roleName is allowed within scope.
 */
function isRoleInScope(roleId, roleName, scope) {
  if (!scope) return false;

  const parsedScope = parseRoleScope(scope);
  if (parsedScope.includes('*')) return true;
  const lowerId = String(roleId || '').toLowerCase();
  const lowerName = String(roleName || '').toLowerCase();
  return parsedScope.some(s => {
    const lowerS = s.toLowerCase();


    return lowerId === lowerS;
  });
}

/**
 * Backend role permission filter for READ Roles (catalog, wizard derivation, browsing).
 * Allows users with canManageDerivedRoles to see SINGLE / ORG_BASED parent roles within scope so they can derive from them,
 * and also see DERIVED children inheriting from those parent roles.
 */
function filterRolesByBackendPermissions(roles, permissions, inheritances = []) {



  // roles = roles.filter(role => role.name === 'ZCON_ES01_ALL_CENT_CONT_CUSTOM');

  if (!roles || !Array.isArray(roles)) return [];
  if (!permissions) return roles;
  if (permissions.isSuperAdmin) return roles;


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

  // Access Domain scoping

  const allowedAccessDomains = parseAccessDomains(permissions.allowedAccessDomains);

  filteredRoles = roles.filter(role => {

    if (role.approvers?.some(a => String(a.userId).toLowerCase() === permissions.userId?.toLowerCase())) {
      return true;
    }

    // Environment check
    if (allowedEnvs !== 'ALL') {
      const roleEnv = (role.environment_ID || '').toUpperCase();
      if (!allowedEnvs.includes(roleEnv)) return false;
    }
    // Access Domain check



    if (allowedAccessDomains.length !== 0) {
      const roleAccessDomain = role.accessDomain_ID;
      if (!allowedAccessDomains.includes(roleAccessDomain)) return false;
    }


    // DRAGE internal generated roles only visible to superadmins
    if (role.type === 'DRAGE') return false;

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

    if (role.type === 'DERIVED' && permissions.canManageDerivedRoles) {
      const scope = permissions.managedDerivedRolesScope;

      if (isRoleInScope(role.ID, role.name, scope)) return true;

      // Check if any parent role ID/name is in scope
      let parentIds = [];
      if (Array.isArray(role.parentRoles)) {
        role.parentRoles.forEach(pr => {
          if (pr.parent_ID) parentIds.push(pr.parent_ID);
          if (pr.parent && pr.parent.ID) parentIds.push(pr.parent.ID);
          if (pr.parent && pr.parent.name) parentIds.push(pr.parent.name);
        });
      }
      if (parentIds.length === 0 && Array.isArray(inheritances)) {
        inheritances.filter(i => i.role_ID === role.ID).forEach(i => {
          if (i.parent_ID) parentIds.push(i.parent_ID);
        });
      }

      return parentIds.some(pid => isRoleInScope(pid, null, scope));
    }

    if (permissions.canAssignRoles) return true;

    return false;
  });


  return filteredRoles;

}

/**
 * Backend role permission filter specifically for User Role Assignments (assignable roles).
 * If user has canManageDerivedRoles ONLY (and single/org flags false), they can ONLY assign DERIVED roles to users.
 */
function filterAssignableRolesByBackendPermissions(roles, permissions, inheritances = []) {

  console.log("DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD");
  const visibleRoles = filterRolesByBackendPermissions(roles, permissions, inheritances);

  if (!permissions || permissions.isSuperAdmin) return visibleRoles;



  return visibleRoles;
}

module.exports = {
  getUserId,
  getSessionPermissions,
  requirePermission,
  requireEnvironment,
  requireAccessDomain,
  parseRoleScope,
  isRoleInScope,
  filterRolesByBackendPermissions,
  filterAssignableRolesByBackendPermissions
};
