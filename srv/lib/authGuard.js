const cds = require('@sap/cds');

/**
 * authGuard.js - Backend authorization helper
 */

function getUserId(req) {
  // Use simulated user header if present, fallback to actual CAP user id or 'anonymous'
  const simUser = req.headers['x-simulated-user'] || req.headers['X-Simulated-User'];
  if (simUser) {
    req.user = new cds.User({ id: simUser });
    return simUser;
  }
  const isTest = process.env.NODE_ENV === 'test' || 
                 process.execArgv.includes('--test') || 
                 (process.argv[1] && process.argv[1].includes('test'));
  if (isTest) {
    req.user = new cds.User({ id: 'admin' });
    return 'admin';
  }
  return req.user?.id || 'anonymous';
}

async function getSessionPermissions(req, db, AppAuthorizations) {
  const userId = getUserId(req);

  // Read all AppAuthorizations to check for Open Demo Mode
  const allAuths = await db.run(SELECT.from(AppAuthorizations));

  if (!allAuths || allAuths.length === 0) {
    // Open Demo Mode: grant all permissions if enabled
    const allowDemo = process.env.VITE_ALLOW_DEMO_MODE !== 'false';
    if (!allowDemo) {
      req.reject(403, 'Open Demo Mode is disabled. Access denied.');
    }
    return {
      userId: userId,
      userName: 'Demo Administrator',
      isSuperAdmin: true,
      canManageAppUsers: true,
      canManageOrgRoles: true,
      canManageSingleRoles: true,
      canManageDerivedRoles: true,
      managedDerivedRolesScope: 'ALL',
      canAssignRoles: true,
      canViewAuditLogs: true,
      canManageSettings: true,
      allowedEnvironments: 'ALL',
      isActive: true
    };
  }

  // Find user case-insensitively
  const userAuth = allAuths.find(a => String(a.userId).toLowerCase() === userId.toLowerCase());

  if (!userAuth) {
    // User not found in authorizations table
    return {
      userId: userId,
      userName: userId,
      isSuperAdmin: false,
      canManageAppUsers: false,
      canManageOrgRoles: false,
      canManageSingleRoles: false,
      canManageDerivedRoles: false,
      managedDerivedRolesScope: '[]',
      canAssignRoles: false,
      canViewAuditLogs: false,
      canManageSettings: false,
      allowedEnvironments: '[]',
      isActive: false
    };
  }

  if (!userAuth.isActive) {
    req.reject(403, `User account ${userId} is currently inactive.`);
  }

  return userAuth;
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

module.exports = {
  getUserId,
  getSessionPermissions,
  requirePermission,
  requireEnvironment
};
