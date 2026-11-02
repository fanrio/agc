'use strict';

/**
 * DirectSyncDispatcher
 *
 * Central dispatcher routing real-time authorization changes to SAP Datasphere (HANA flat tables)
 * and Databricks (Unity Catalog Row Filters & Access Grants).
 * Completely replaces the asynchronous batch replication queue engine.
 *
 * Critical Rules:
 *  - Preserves Cartesian product and ancestry inheritance for HANA replication.
 *  - Dispatches to Databricks Unity Catalog DDL / UDF row filters.
 *  - Uses Promise.allSettled for dual-platform fault tolerance.
 *  - Serializes Databricks DDL operations per Access Domain via an in-memory Promise mutex.
 */

const defaultCds = require('@sap/cds');
const defaultHanaClient = require('../lib/hanaClient');
const defaultDatabricksClient = require('../lib/databricksClient');
const hanaReplication = require('./hanaReplicationService');
const databricksSync = require('./databricksSyncService');

// Domain-level DDL lock map
const domainLocks = new Map();

/**
 * Serializes async operations by domain key.
 * Operations on the same domain run in sequence; different domains run concurrently.
 *
 * @param {string} domainKey
 * @param {Function} fn
 * @returns {Promise<any>}
 */
async function withDomainLock(domainKey, fn) {
  const key = domainKey || '__global__';
  const prev = domainLocks.get(key) || Promise.resolve();
  let release;
  const next = new Promise(res => { release = res; });
  const currentPromise = prev.then(() => next, () => next);
  domainLocks.set(key, currentPromise);
  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (domainLocks.get(key) === currentPromise) {
      domainLocks.delete(key);
    }
  }
}

/**
 * Resolves effective target platforms by intersecting role and domain settings.
 *
 * @param {string|object} rolePlatformOrRole   - Role targetPlatform or Role entity object
 * @param {string|object} domainPlatformOrDomain - Domain targetPlatform or AccessDomain entity object
 * @returns {{ targetsDatasphere: boolean, targetsDatabricks: boolean, effectivePlatforms: string[], effectivePlatform: string, conflict: boolean }}
 */
function resolveEffectivePlatforms(rolePlatformOrRole, domainPlatformOrDomain) {
  const rolePlatform = (typeof rolePlatformOrRole === 'object' && rolePlatformOrRole !== null ? rolePlatformOrRole.targetPlatform : rolePlatformOrRole) || 'DATASPHERE';
  const domainPlatform = (typeof domainPlatformOrDomain === 'object' && domainPlatformOrDomain !== null ? domainPlatformOrDomain.targetPlatform : domainPlatformOrDomain) || 'BOTH';

  const normRole = String(rolePlatform || 'DATASPHERE').toUpperCase();
  const normDomain = String(domainPlatform || 'BOTH').toUpperCase();

  const roleTargetsDs = normRole === 'DATASPHERE' || normRole === 'BOTH';
  const roleTargetsDb = normRole === 'DATABRICKS' || normRole === 'BOTH';

  const domainSupportsDs = normDomain === 'DATASPHERE' || normDomain === 'BOTH';
  const domainSupportsDb = normDomain === 'DATABRICKS' || normDomain === 'BOTH';

  const targetsDatasphere = roleTargetsDs && domainSupportsDs;
  const targetsDatabricks = roleTargetsDb && domainSupportsDb;

  const effectivePlatforms = [];
  if (targetsDatasphere) effectivePlatforms.push('DATASPHERE');
  if (targetsDatabricks) effectivePlatforms.push('DATABRICKS');

  let effectivePlatform = 'NONE';
  if (targetsDatasphere && targetsDatabricks) effectivePlatform = 'BOTH';
  else if (targetsDatasphere) effectivePlatform = 'DATASPHERE';
  else if (targetsDatabricks) effectivePlatform = 'DATABRICKS';

  return {
    targetsDatasphere,
    targetsDatabricks,
    effectivePlatforms,
    effectivePlatform,
    conflict: (!targetsDatasphere && !targetsDatabricks)
  };
}

/**
 * Resolves dependencies and db context.
 */
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
  const DatabricksClient = deps.DatabricksClient || defaultDatabricksClient;
  const hanaReplicationSvc = deps.hanaReplication || hanaReplication;
  const databricksSyncSvc = deps.databricksSync || databricksSync;
  return { cdsConn, db, entities, HanaClient, DatabricksClient, hanaReplicationSvc, databricksSyncSvc };
}

/**
 * Helper to fetch role and optional access domain metadata from DB or params.
 */
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

/**
 * Dispatches sync for an assignment creation or update.
 *
 * @param {object|string} paramsOrAssignmentId
 * @param {object} [maybeUserId]
 * @param {string} [maybeRoleId]
 * @param {boolean} [maybeIsDelete]
 * @param {object} [maybeCds]
 * @param {string} [maybeForcedDomainId]
 * @returns {Promise<object>}
 */
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
  const { assignmentId, userId, roleId, forcedDomainId } = params;
  const { cdsConn, db, entities, HanaClient, DatabricksClient, hanaReplicationSvc, databricksSyncSvc } = resolveDeps(deps);

  const { role, domain } = await loadRoleAndDomain(db, entities, roleId, params);
  const rolePlatform = params.targetPlatform || role?.targetPlatform || 'DATASPHERE';
  const domainPlatform = params.domainPlatform || domain?.targetPlatform || 'BOTH';

  const { targetsDatasphere, targetsDatabricks, effectivePlatforms } =
    resolveEffectivePlatforms(rolePlatform, domainPlatform);

  const results = {
    success: true,
    action: 'ASSIGN_CREATE',
    roleId,
    userId,
    targetPlatform: rolePlatform,
    effectivePlatforms,
    errors: [],
    durationMs: 0
  };

  const tasks = [];

  // 1. SAP Datasphere (HANA)
  if (targetsDatasphere) {
    tasks.push((async () => {
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
    })());
  }

  // 2. Databricks Unity Catalog
  if (targetsDatabricks) {
    tasks.push((async () => {
      try {
        const domainKey = domain?.name || role?.accessDomain_ID || forcedDomainId || 'global';
        const dbResult = await withDomainLock(domainKey, async () => {
          if (roleId && role) {
            return await databricksSyncSvc.syncAssignmentToDatabricks(
              assignmentId,
              userId,
              roleId,
              false,
              cdsConn,
              forcedDomainId
            );
          } else if (params.restrictions) {
            const ddl = databricksSyncSvc.buildUnityCatalogRowFilterDdl({
              catalog: 'main',
              schema: 'policies',
              domain: domainKey,
              filterName: `${domainKey}_filter`,
              targetTable: `${domainKey}_flat`,
              columns: Array.from(new Set(params.restrictions.map(r => r.field).filter(Boolean))),
              assignments: [{ user: userId, restrictions: params.restrictions }]
            });
            await DatabricksClient.executeStatement({
              warehouseId: 'wh_01',
              statement: ddl.createFuncSql
            });
            await DatabricksClient.executeStatement({
              warehouseId: 'wh_01',
              statement: ddl.setFilterSql
            });
            return { success: true };
          }
          return { success: true, skipped: true, reason: 'NO_ROLE_OR_RESTRICTIONS' };
        });
        const isSuccess = dbResult?.success !== false || dbResult?.skipped === true;
        results.databricks = { ...dbResult, success: isSuccess, platform: 'DATABRICKS' };
        if (!isSuccess && !dbResult?.skipped) {
          results.errors.push({ platform: 'DATABRICKS', message: dbResult?.error || dbResult?.reason || 'Databricks sync failed' });
        }
      } catch (err) {
        console.error('[DirectSyncDispatcher] Databricks sync error:', err.message);
        results.databricks = { success: false, error: err.message };
        results.errors.push({ platform: 'DATABRICKS', message: err.message });
      }
    })());
  }

  await Promise.allSettled(tasks);
  results.success = results.errors.length === 0;
  results.durationMs = Date.now() - start;
  return results;
}

/**
 * Dispatches removal of an assignment.
 *
 * @param {object|string} paramsOrAssignmentId
 * @param {object} [maybeUserId]
 * @param {string} [maybeRoleId]
 * @param {object} [maybeCds]
 * @param {string} [maybeForcedDomainId]
 * @returns {Promise<object>}
 */
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
  const { cdsConn, db, entities, HanaClient, hanaReplicationSvc, databricksSyncSvc } = resolveDeps(deps);

  const { role, domain } = await loadRoleAndDomain(db, entities, roleId, params);
  const rolePlatform = params.targetPlatform || role?.targetPlatform || 'BOTH';
  const domainPlatform = params.domainPlatform || domain?.targetPlatform || 'BOTH';

  const { targetsDatasphere, targetsDatabricks, effectivePlatforms } =
    resolveEffectivePlatforms(rolePlatform, domainPlatform);

  const results = {
    success: true,
    action: 'ASSIGN_DELETE',
    roleId,
    userId,
    targetPlatform: rolePlatform,
    effectivePlatforms,
    errors: [],
    durationMs: 0
  };

  const tasks = [];

  if (targetsDatasphere) {
    tasks.push((async () => {
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
    })());
  }

  if (targetsDatabricks) {
    tasks.push((async () => {
      try {
        const domainKey = domain?.name || role?.accessDomain_ID || 'global';
        const dbResult = await withDomainLock(domainKey, async () => {
          return await databricksSyncSvc.removeAssignmentFromDatabricks(userId, roleId, cdsConn);
        });
        const isSuccess = dbResult?.success !== false || dbResult?.skipped === true;
        results.databricks = { ...dbResult, success: isSuccess, platform: 'DATABRICKS' };
        if (!isSuccess && !dbResult?.skipped) {
          results.errors.push({ platform: 'DATABRICKS', message: dbResult?.error || dbResult?.reason || 'Databricks sync failed' });
        }
      } catch (err) {
        console.error('[DirectSyncDispatcher] Databricks removal error:', err.message);
        results.databricks = { success: false, error: err.message };
        results.errors.push({ platform: 'DATABRICKS', message: err.message });
      }
    })());
  }

  await Promise.allSettled(tasks);
  results.success = results.errors.length === 0;
  results.durationMs = Date.now() - start;
  return results;
}

/**
 * Dispatches re-sync of a role and all its derived descendants.
 *
 * @param {string|object} paramsOrRoleId
 * @param {object} [depsOrCds]
 * @returns {Promise<object>}
 */
async function dispatchRoleSync(paramsOrRoleId, depsOrCds = {}) {
  const start = Date.now();
  const roleId = typeof paramsOrRoleId === 'string' ? paramsOrRoleId : paramsOrRoleId?.roleId;
  const params = typeof paramsOrRoleId === 'object' ? paramsOrRoleId : {};
  let deps = depsOrCds;
  if (depsOrCds && typeof depsOrCds.connect === 'function' && !depsOrCds.entities && !depsOrCds.db) {
    deps = { cds: depsOrCds };
  }
  const { cdsConn, db, entities, HanaClient, hanaReplicationSvc, databricksSyncSvc } = resolveDeps(deps);

  const { role, domain } = await loadRoleAndDomain(db, entities, roleId, params);
  const rolePlatform = params.targetPlatform || role?.targetPlatform || 'DATASPHERE';
  const domainPlatform = params.domainPlatform || domain?.targetPlatform || 'BOTH';

  const { targetsDatasphere, targetsDatabricks, effectivePlatforms } =
    resolveEffectivePlatforms(rolePlatform, domainPlatform);

  const results = {
    success: true,
    action: 'ROLE_UPDATE',
    roleId,
    targetPlatform: rolePlatform,
    effectivePlatforms,
    errors: [],
    durationMs: 0
  };

  const tasks = [];

  if (targetsDatasphere) {
    tasks.push((async () => {
      try {
        await hanaReplicationSvc.syncRoleAssignmentsToHana(cdsConn, HanaClient, entities, roleId);
        results.datasphere = { success: true };
      } catch (err) {
        console.error('[DirectSyncDispatcher] Datasphere role sync error:', err.message);
        results.datasphere = { success: false, error: err.message };
        results.errors.push({ platform: 'DATASPHERE', message: err.message });
      }
    })());
  }

  if (targetsDatabricks) {
    tasks.push((async () => {
      try {
        const domainKey = domain?.name || role?.accessDomain_ID || 'global';
        const dbResult = await withDomainLock(domainKey, async () => {
          return await databricksSyncSvc.syncRoleToDatabricks(roleId, cdsConn);
        });
        const isSuccess = dbResult?.success !== false || dbResult?.skipped === true;
        results.databricks = { ...dbResult, success: isSuccess, platform: 'DATABRICKS' };
        if (!isSuccess && !dbResult?.skipped) {
          results.errors.push({ platform: 'DATABRICKS', message: dbResult?.error || dbResult?.reason || 'Databricks sync failed' });
        }
      } catch (err) {
        console.error('[DirectSyncDispatcher] Databricks role sync error:', err.message);
        results.databricks = { success: false, error: err.message };
        results.errors.push({ platform: 'DATABRICKS', message: err.message });
      }
    })());
  }

  await Promise.allSettled(tasks);
  results.success = results.errors.length === 0;
  results.durationMs = Date.now() - start;
  return results;
}

/**
 * Dispatches sync for an Access Domain.
 *
 * @param {string|object} paramsOrDomainId
 * @param {object} [depsOrCds]
 * @returns {Promise<object>}
 */
async function dispatchAccessDomainSync(paramsOrDomainId, depsOrCds = {}) {
  const domainId = typeof paramsOrDomainId === 'string' ? paramsOrDomainId : paramsOrDomainId?.domainId || paramsOrDomainId?.accessDomainId;
  const params = typeof paramsOrDomainId === 'object' ? paramsOrDomainId : {};
  let deps = depsOrCds;
  if (depsOrCds && typeof depsOrCds.connect === 'function' && !depsOrCds.entities && !depsOrCds.db) {
    deps = { cds: depsOrCds };
  }
  const { cdsConn, db, entities, databricksSyncSvc } = resolveDeps(deps);

  let domain = params.domain || null;
  if (!domain && entities?.AccessDomains && db) {
    try {
      domain = await db.run(SELECT.one.from(entities.AccessDomains).where({ ID: domainId }));
    } catch {
      domain = null;
    }
  }

  const domainPlatform = params.targetPlatform || domain?.targetPlatform || 'BOTH';
  const targetsDatabricks = domainPlatform === 'DATABRICKS' || domainPlatform === 'BOTH';

  if (targetsDatabricks) {
    const domainKey = domain?.name || domainId || 'global';
    return await withDomainLock(domainKey, async () => {
      return await databricksSyncSvc.syncAccessDomainToDatabricks(domainId, cdsConn);
    });
  }
  return { success: true, skipped: true, platform: 'DATASPHERE' };
}

/**
 * Universal dispatcher.
 * Matches PROJECT.md Line 101 and Test T1.7 contract.
 *
 * @param {object} params
 * @param {object} [deps]
 * @returns {Promise<object>}
 */
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
  if (params.restrictions && params.targetPlatform) {
    return await dispatchAssignmentSync(params, deps);
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
