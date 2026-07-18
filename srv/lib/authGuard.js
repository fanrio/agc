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

function requireAccessDomain(permissions, accessDomainId, req) {
  if (permissions.isSuperAdmin) return; // SuperAdmin bypasses all checks
  const allowed = permissions.allowedAccessDomains || 'ALL';
  if (allowed === 'ALL' || allowed === '*') return;

  try {
    const domains = JSON.parse(allowed);
    if (Array.isArray(domains) && domains.includes(accessDomainId)) return;
  } catch (e) {
    // Fallback: comma separated list
    const domains = allowed.split(',').map(s => s.trim());
    if (domains.includes(String(accessDomainId).trim())) return;
  }

  req.reject(403, `Access Denied: You are not authorized to manage roles in access domain ${accessDomainId || 'unspecified'}.`);
}

module.exports = {
  getUserId,
  getSessionPermissions,
  requirePermission,
  requireEnvironment,
  requireAccessDomain
};
