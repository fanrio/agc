'use strict';

/**
 * DirectSyncDispatcher
 *
 * Central dispatcher routing real-time authorization changes directly to
 * SAP Datasphere (HANA flat tables).
 */

const defaultCds = require('@sap/cds');
const defaultHanaClient = require('../lib/hanaClient');
const hanaReplication = require('./hanaReplicationService');

function resolveEffectivePlatforms() {
  return {
    targetsDatasphere: true,
    effectivePlatforms: ['DATASPHERE'],
    effectivePlatform: 'DATASPHERE',
    conflict: false
  };
}

async function withDomainLock(domainKey, fn) {
  return await fn();
}

function resolveDeps(deps = {}) {
  const cdsConn = deps.cds || (deps.db ? { db: deps.db } : defaultCds);
  const db = deps.db || cdsConn.db;
  let entities = deps.entities;
  if (!entities) {
    if (cdsConn.entities && typeof cdsConn.entities === 'function') {
      try { entities = cdsConn.entities('fanrio.auth'); } catch { entities = null; }
    }
    if (!entities) {
      entities = (typeof db?.entities === 'function' ? db.entities('fanrio.auth') : db?.entities) || {};
    }
  }
  const HanaClient = deps.HanaClient || defaultHanaClient;
  const hanaReplicationSvc = deps.hanaReplication || hanaReplication;
  return { cdsConn, db, entities, HanaClient, hanaReplicationSvc };
}

async function loadRoleAndDomain(db, entities, roleId, params = {}) {
  if (params.role) {
    return { role: params.role, domain: params.domain || null };
  }
  if (!roleId || !db) return { role: null, domain: null };
  let role = null;
  const RolesEntity = entities?.Roles || 'fanrio.auth.Roles';
  const AccessDomainsEntity = entities?.AccessDomains || 'fanrio.auth.AccessDomains';
  try {
    role = await db.run(SELECT.one.from(RolesEntity).where({ ID: roleId }));
  } catch {
    role = null;
  }
  let domain = params.domain || null;
  if (!domain && role?.accessDomain_ID) {
    try {
      domain = await db.run(SELECT.one.from(AccessDomainsEntity).where({ ID: role.accessDomain_ID }));
    } catch {
      domain = null;
    }
  }
  return { role, domain };
}

async function dispatchAssignmentSync(paramsOrAssignmentId, maybeUserId, maybeRoleId, maybeIsDelete, maybeCds, maybeForcedDomainId) {
  let params;
  let deps = {};
  if (typeof paramsOrAssignmentId === 'object' && paramsOrAssignmentId !== null) {
    params = paramsOrAssignmentId;
    deps = (typeof maybeUserId === 'object' && maybeUserId !== null) ? maybeUserId : {};
  } else {
    params = {
      assignmentId: paramsOrAssignmentId,
      userId: maybeUserId,
      roleId: maybeRoleId,
      isDelete: !!maybeIsDelete,
      forcedDomainId: maybeForcedDomainId
    };
    if (maybeCds) deps.cds = maybeCds;
  }

  if (params.isDelete) {
    return await dispatchAssignmentRemoval(params, deps);
  }

  const start = Date.now();
  const { assignmentId, userId, roleId } = params;
  const { cdsConn, db, entities, HanaClient, hanaReplicationSvc } = resolveDeps(deps);

  const { role } = await loadRoleAndDomain(db, entities, roleId, params);

  const results = {
    success: true,
    action: 'ASSIGN_CREATE',
    roleId,
    userId,
    errors: [],
    durationMs: 0
  };

  try {
    if (roleId && role) {
      await hanaReplicationSvc.syncAssignmentToHana(
        cdsConn,
        HanaClient,
        entities,
        assignmentId,
        userId,
        roleId,
        false,
        deps.preloaded
      );
    } else if (params.restrictions) {
      await HanaClient.syncAssignment(
        { username: 'MOCK_SCHEMA', systemName: 'MOCK_HANA' },
        roleId,
        false,
        params.restrictions
      );
    }
    results.datasphere = { success: true };
  } catch (err) {
    console.error('[DirectSyncDispatcher] Datasphere sync error:', err.message);
    results.datasphere = { success: false, error: err.message };
    results.errors.push({ platform: 'DATASPHERE', message: err.message });
  }

  results.success = results.errors.length === 0;
  results.durationMs = Date.now() - start;
  return results;
}

async function dispatchAssignmentRemoval(paramsOrAssignmentId, maybeUserId, maybeRoleId, maybeCds, maybeForcedDomainId) {
  let params;
  let deps = {};
  if (typeof paramsOrAssignmentId === 'object' && paramsOrAssignmentId !== null) {
    params = paramsOrAssignmentId;
    deps = (typeof maybeUserId === 'object' && maybeUserId !== null) ? maybeUserId : {};
  } else {
    params = {
      assignmentId: paramsOrAssignmentId,
      userId: maybeUserId,
      roleId: maybeRoleId,
      forcedDomainId: maybeForcedDomainId
    };
    if (maybeCds) deps.cds = maybeCds;
  }

  const start = Date.now();
  const { assignmentId, userId, roleId } = params;
  const { cdsConn, entities, HanaClient, hanaReplicationSvc } = resolveDeps(deps);

  const results = {
    success: true,
    action: 'ASSIGN_DELETE',
    roleId,
    userId,
    errors: [],
    durationMs: 0
  };

  try {
    await hanaReplicationSvc.syncAssignmentToHana(
      cdsConn,
      HanaClient,
      entities,
      assignmentId,
      userId,
      roleId,
      true,
      deps.preloaded
    );
    results.datasphere = { success: true };
  } catch (err) {
    console.error('[DirectSyncDispatcher] Datasphere removal error:', err.message);
    results.datasphere = { success: false, error: err.message };
    results.errors.push({ platform: 'DATASPHERE', message: err.message });
  }

  results.success = results.errors.length === 0;
  results.durationMs = Date.now() - start;
  return results;
}

async function dispatchRoleSync(paramsOrRoleId, depsOrCds = {}) {
  const start = Date.now();
  const roleId = typeof paramsOrRoleId === 'string' ? paramsOrRoleId : paramsOrRoleId?.roleId;
  const params = typeof paramsOrRoleId === 'object' ? paramsOrRoleId : {};
  let deps = depsOrCds;
  if (depsOrCds && typeof depsOrCds.connect === 'function' && !depsOrCds.entities && !depsOrCds.db) {
    deps = { cds: depsOrCds };
  }
  const { cdsConn, entities, HanaClient, hanaReplicationSvc } = resolveDeps(deps);

  const results = {
    success: true,
    action: 'ROLE_UPDATE',
    roleId,
    errors: [],
    durationMs: 0
  };

  try {
    await hanaReplicationSvc.syncRoleAssignmentsToHana(cdsConn, HanaClient, entities, roleId);
    results.datasphere = { success: true };
  } catch (err) {
    console.error('[DirectSyncDispatcher] Datasphere role sync error:', err.message);
    results.datasphere = { success: false, error: err.message };
    results.errors.push({ platform: 'DATASPHERE', message: err.message });
  }

  results.success = results.errors.length === 0;
  results.durationMs = Date.now() - start;
  return results;
}

async function dispatchAccessDomainSync(paramsOrDomainId, depsOrCds = {}) {
  return { success: true, skipped: true, platform: 'DATASPHERE' };
}

async function dispatchSync(params = {}, deps = {}) {
  const { action, isDelete } = params;
  if (action === 'ASSIGN_DELETE' || isDelete) {
    return await dispatchAssignmentRemoval(params, deps);
  }
  if (action === 'ASSIGN_CREATE') {
    return await dispatchAssignmentSync(params, deps);
  }
  if (action === 'ROLE_UPDATE') {
    return await dispatchRoleSync(params, deps);
  }
  if (action === 'DOMAIN_SYNC') {
    return await dispatchAccessDomainSync(params, deps);
  }
  if (params.roleId && !params.userId) {
    return await dispatchRoleSync(params, deps);
  }
  return await dispatchAssignmentSync(params, deps);
}

module.exports = {
  withDomainLock,
  resolveEffectivePlatforms,
  resolveEffectivePlatform: resolveEffectivePlatforms,
  dispatchAssignmentSync,
  dispatchAssignmentRemoval,
  dispatchRoleSync,
  dispatchAccessDomainSync,
  dispatchSync
};
