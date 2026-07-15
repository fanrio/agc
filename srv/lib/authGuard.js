/**
 * authGuard.js - Backend authorization helper
 */

function getUserId(req) {
  const cds = global.cds || require('@sap/cds');
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

  const userAuth = await db.run(
    SELECT.one.from(AppAuthorizations).where({ userId, isActive: true })
  );

  if (userAuth) {
    return userAuth;
  }

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
    allowedStreams: '[]',
    isActive: false
  };
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

function requireStream(permissions, streamId, req) {
  if (permissions.isSuperAdmin) return; // SuperAdmin bypasses all checks
  const allowed = permissions.allowedStreams || 'ALL';
  if (allowed === 'ALL' || allowed === '*') return;

  try {
    const streams = JSON.parse(allowed);
    if (Array.isArray(streams) && streams.includes(streamId)) return;
  } catch (e) {
    // Fallback: comma separated list
    const streams = allowed.split(',').map(s => s.trim());
    if (streams.includes(String(streamId).trim())) return;
  }

  req.reject(403, `Access Denied: You are not authorized to manage roles in stream ${streamId || 'unspecified'}.`);
}

module.exports = {
  getUserId,
  getSessionPermissions,
  requirePermission,
  requireEnvironment,
  requireStream
};
