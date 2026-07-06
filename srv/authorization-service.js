'use strict';

/**
 * AuthorizationService — wiring layer
 *
 * This file is intentionally thin. Its only job is to wire up all handlers,
 * services, and OData actions into the CAP service instance.
 *
 * Business logic lives in:
 *   srv/handlers/      — entity CRUD event hooks (roles, assignments, restrictions)
 *   srv/services/      — domain services (HANA replication, BDC proxy, org generator, etc.)
 *   srv/lib/           — pure utility modules (hanaClient, bdcClient, urlUtils, etc.)
 */

const cds = require('@sap/cds');

// Lib
const HanaClient = require('./lib/hanaClient');
const BdcClient  = require('./lib/bdcClient');
const { syncDynamicRule, ALLOWED_ENTITIES } = require('./lib/dynamicSync');
const { resolveEffectiveRestrictions } = require('./lib/resolveEffectiveRestrictions');

// Services
const { syncAssignmentToHana, syncRoleAssignmentsToHana } = require('./services/hanaReplicationService');
const { queueReplication, checkAndUpdateRunningReplications, makeTriggerReplicationHandler } = require('./services/replicationQueueService');
const { makeGenerateOrgRoleHandler, makeGenerateAllOrgRolesHandler } = require('./services/orgRoleGeneratorService');
const { makeResolveEffectiveRestrictionsHandler, makeSimulateAccessHandler } = require('./services/accessActionService');
const {
  makeTestBdcConnectionHandler,
  makeFetchBdcSpacesHandler,
  makeFetchBdcAssetsHandler,
  makeFetchBdcRelationalValuesHandler,
  makeFetchBdcAssetColumnsHandler,
  makeFetchRawBdcSpacesHandler,
  makeFetchRawBdcAssetsHandler,
  makeFetchRawBdcRelationalValuesHandler,
  makeFetchRawBdcAssetColumnsHandler,
  makeFetchBdcAssociationsHandler,
  makeFetchRawHanaViewsHandler,
  makeRunBdcTaskChainHandler,
  makeFetchBdcTaskChainLogHandler,
  makeSearchLdapUsersHandler
} = require('./services/bdcActionService');

// Handlers
const { registerRoleHandlers }        = require('./handlers/roleHandlers');
const { registerAssignmentHandlers }  = require('./handlers/assignmentHandlers');
const { registerRestrictionHandlers } = require('./handlers/restrictionHandlers');

module.exports = cds.service.impl(async function () {
  const entities = this.entities;
  const {
    OrgNodes, OrgNodeAttributes, Roles, Restrictions,
    RoleAssignments, RoleInheritance, RestrictionFields,
    BdcSettings, AuditLogs, Replications, DynamicGenerationRules,
    AppAuthorizations
  } = entities;

  // ---------------------------------------------------------------------------
  // Centralized Authorization & Security Enforcement
  // ---------------------------------------------------------------------------
  const {
    getUserId,
    getSessionPermissions,
    requirePermission,
    requireEnvironment
  } = require('./lib/authGuard');

  // Action: getCurrentUserPermissions
  this.on('getCurrentUserPermissions', async (req) => {
    try {
      const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
      return perms;
    } catch (e) {
      return req.error(500, `Failed to retrieve session permissions: ${e.message}`);
    }
  });

  // Seed / Bootstrap Super Admin on startup
  cds.on('served', async () => {
    const superAdminId = process.env.SUPER_ADMIN_USER || 'admin';
    const db = await cds.connect.to('db');
    try {
      const existing = await db.run(SELECT.from(AppAuthorizations).where({ userId: superAdminId }));
      if (existing.length === 0) {
        await db.run(INSERT.into(AppAuthorizations).entries({
          ID: cds.utils.uuid(),
          userId: superAdminId,
          userName: 'System Administrator',
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
        }));
        console.log(`[auth] Successfully bootstrapped super admin user: ${superAdminId}`);
      }
    } catch (e) {
      console.error('[auth] Failed to bootstrap super admin user:', e.message);
    }
  });

  // AppAuthorizations CRUD protection
  this.before('*', 'AppAuthorizations', async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(perms, 'canManageAppUsers', req);
  });

  // AuditLogs protection
  this.before('READ', 'AuditLogs', async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(perms, 'canViewAuditLogs', req);
  });

  // Settings CRUD protection
  this.before(['CREATE', 'UPDATE', 'DELETE'], ['BdcSettings', 'RestrictionFields', 'Streams'], async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(perms, 'canManageSettings', req);
  });

  // Roles CRUD protection
  this.before(['CREATE', 'UPDATE', 'DELETE'], 'Roles', async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);

    let roleType = req.data.type;
    let envId = req.data.environment_ID;
    let roleId = req.data.ID;
    if (!roleId && req.params?.length > 0) {
      const p = req.params[0];
      roleId = typeof p === 'object' ? p.ID : p;
    }

    if (req.event === 'UPDATE' || req.event === 'DELETE') {
      if (roleId) {
        const existing = await cds.db.run(SELECT.one.from(Roles).where({ ID: roleId }));
        if (existing) {
          if (!roleType) roleType = existing.type;
          if (!envId) envId = existing.environment_ID;
        }
      }
    }

    if (envId) {
      requireEnvironment(perms, envId, req);
    }

    if (roleType === 'ORG_BASED') {
      requirePermission(perms, 'canManageOrgRoles', req);
    } else if (roleType === 'DERIVED') {
      requirePermission(perms, 'canManageDerivedRoles', req);
      
      // Enforce derived role parent scope checks
      if (!perms.isSuperAdmin && perms.managedDerivedRolesScope !== 'ALL') {
        let allowedParentIds = [];
        try {
          const scopeList = JSON.parse(perms.managedDerivedRolesScope);
          if (Array.isArray(scopeList)) {
            allowedParentIds = scopeList.map(s => s.roleId);
          }
        } catch (e) {
          allowedParentIds = perms.managedDerivedRolesScope.split(',').map(s => s.trim());
        }

        let parentIds = [];
        if (req.data.parentRoles && Array.isArray(req.data.parentRoles)) {
          req.data.parentRoles.forEach(pr => {
            if (pr.parent_ID) parentIds.push(pr.parent_ID);
          });
        }
        if (roleId && parentIds.length === 0) {
          const inherits = await cds.db.run(SELECT.from(RoleInheritance).where({ role_ID: roleId }));
          parentIds = inherits.map(i => i.parent_ID);
        }

        if (parentIds.length > 0) {
          const inScope = parentIds.every(pid => allowedParentIds.includes(pid));
          if (!inScope) {
            req.reject(403, 'Access Denied: One or more parent roles are outside your permitted scope.');
          }
        }
      }
    } else {
      requirePermission(perms, 'canManageSingleRoles', req);
    }
  });

  // RoleAssignments CRUD protection
  this.before(['CREATE', 'UPDATE', 'DELETE'], 'RoleAssignments', async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(perms, 'canAssignRoles', req);

    let roleId = req.data.role_ID;
    let assignmentId = req.data.ID;
    if (!assignmentId && req.params?.length > 0) {
      const p = req.params[0];
      assignmentId = typeof p === 'object' ? p.ID : p;
    }

    if (!roleId && assignmentId) {
      const existing = await cds.db.run(SELECT.one.from(RoleAssignments).where({ ID: assignmentId }));
      roleId = existing?.role_ID;
    }

    if (roleId) {
      const role = await cds.db.run(SELECT.one.from(Roles).where({ ID: roleId }));
      if (role?.environment_ID) {
        requireEnvironment(perms, role.environment_ID, req);
      }
    }
  });

  // Restrictions CRUD protection
  this.before(['CREATE', 'UPDATE', 'DELETE'], 'Restrictions', async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    let roleId = req.data.role_ID;
    let restrictionId = req.data.ID;
    if (!restrictionId && req.params?.length > 0) {
      const p = req.params[0];
      restrictionId = typeof p === 'object' ? p.ID : p;
    }

    if (!roleId && restrictionId) {
      const existing = await cds.db.run(SELECT.one.from(Restrictions).where({ ID: restrictionId }));
      roleId = existing?.role_ID;
    }

    if (roleId) {
      const role = await cds.db.run(SELECT.one.from(Roles).where({ ID: roleId }));
      if (role) {
        if (role.environment_ID) requireEnvironment(perms, role.environment_ID, req);
        if (role.type === 'ORG_BASED') requirePermission(perms, 'canManageOrgRoles', req);
        else if (role.type === 'DERIVED') requirePermission(perms, 'canManageDerivedRoles', req);
        else requirePermission(perms, 'canManageSingleRoles', req);
      }
    }
  });

  // Actions protection
  this.before('generateOrgRole', async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(perms, 'canManageOrgRoles', req);
  });
  this.before('generateAllOrgRoles', async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(perms, 'canManageOrgRoles', req);
  });
  this.before('syncDynamicRule', async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(perms, 'canManageSettings', req);
  });
  this.before([
    'testBdcConnection', 'fetchBdcSpaces', 'fetchBdcAssets',
    'fetchBdcRelationalValues', 'fetchBdcAssetColumns', 'fetchRawBdcSpaces',
    'fetchRawBdcAssets', 'fetchRawBdcRelationalValues', 'fetchRawBdcAssetColumns',
    'fetchBdcAssociations', 'runBdcTaskChain', 'fetchBdcTaskChainLog',
    'fetchRawHanaViews', 'triggerReplication', 'checkReplicationStatuses'
  ], async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(perms, 'canManageSettings', req);
  });
  this.before('searchLdapUsers', async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(perms, 'canManageAppUsers', req);
  });

  // Audit Logs for AppAuthorizations changes
  this.after(['CREATE', 'UPDATE', 'DELETE'], 'AppAuthorizations', async (result, req) => {
    try {
      const userId = getUserId(req);
      let targetName = result?.userId || req.data?.userId;
      let recordId = result?.ID || req.data?.ID;
      if (!recordId && req.params?.length > 0) {
        const p = req.params[0];
        recordId = typeof p === 'object' ? p.ID : p;
      }
      if (!targetName && recordId) {
        const target = await cds.db.run(SELECT.one.from(AppAuthorizations).where({ ID: recordId }));
        targetName = target?.userId;
      }

      await cds.db.run(INSERT.into(AuditLogs).entries({
        ID:         cds.utils.uuid(),
        entityName: 'AppAuthorizations',
        action:     req.event,
        recordId:   recordId || 'unknown',
        targetName: targetName || 'unknown',
        details:    JSON.stringify({ changedBy: userId, data: req.data || result })
      }));
    } catch (err) {
      console.error('[AuthService] Audit Log failed for AppAuthorizations changes:', err.message);
    }
  });

  // ---------------------------------------------------------------------------
  // Shared dependency bundles
  // ---------------------------------------------------------------------------

  /** Bound syncAssignmentToHana with cds + HanaClient + entities injected */
  const boundSyncAssignment = (assignmentId, userId, roleId, isDelete) =>
    syncAssignmentToHana(cds, HanaClient, entities, assignmentId, userId, roleId, isDelete);

  /** Bound syncRoleAssignmentsToHana */
  const boundSyncRoleAssignments = (roleId) =>
    syncRoleAssignmentsToHana(cds, HanaClient, entities, roleId);

  /** Bound queueReplication */
  const boundQueueReplication = (roleName, environmentId, user) =>
    queueReplication(cds, Replications, roleName, environmentId, user);

  // ---------------------------------------------------------------------------
  // DRAGE — Dynamic Role & Assignment Generation Engine
  // ---------------------------------------------------------------------------

  this.on('syncDynamicRule', async (req) => {
    const { ruleId } = req.data;
    try {
      await syncDynamicRule(ruleId, cds);
      return { success: true, message: 'Reconciliation rule execution completed successfully' };
    } catch (err) {
      return { success: false, message: err.message || 'Rule sync execution failed' };
    }
  });

  this.after(['CREATE', 'UPDATE', 'DELETE'], 'Customers', async (data, req) => {
    try {
      const activeRules = await cds.db.run(
        SELECT.from(DynamicGenerationRules)
          .where({ isActive: true, sourceEntity: { in: ALLOWED_ENTITIES } })
      );
      for (const rule of activeRules) {
        await syncDynamicRule(rule.ID, cds);
      }
    } catch (err) {
      console.error('[AuthService] Failed to trigger dynamic rules synchronization:', err.message);
    }
  });

  // ---------------------------------------------------------------------------
  // UUID auto-generation (consolidated — same for all entities below)
  // ---------------------------------------------------------------------------
  ['OrgNodes', 'BdcSettings', 'DynamicGenerationRules', 'GeneratedResourceMap'].forEach(entity => {
    this.before('CREATE', entity, (req) => {
      if (!req.data.ID) req.data.ID = cds.utils.uuid();
    });
  });

  // ---------------------------------------------------------------------------
  // Entity CRUD handlers (roles, assignments, restrictions)
  // ---------------------------------------------------------------------------

  const handlerDeps = {
    cds,
    queueReplication:          boundQueueReplication,
    syncAssignmentToHana:      boundSyncAssignment,
    syncRoleAssignmentsToHana: boundSyncRoleAssignments,
    resolveEffectiveRestrictions
  };

  registerRoleHandlers(this, entities, handlerDeps);
  registerAssignmentHandlers(this, entities, handlerDeps);
  registerRestrictionHandlers(this, entities, handlerDeps);

  // ---------------------------------------------------------------------------
  // Org Role Generation actions
  // ---------------------------------------------------------------------------

  this.on('generateOrgRole',    makeGenerateOrgRoleHandler(cds, entities));
  this.on('generateAllOrgRoles', makeGenerateAllOrgRolesHandler(cds, entities));

  // ---------------------------------------------------------------------------
  // Access Resolution actions
  // ---------------------------------------------------------------------------

  this.on('resolveEffectiveRestrictions', makeResolveEffectiveRestrictionsHandler(cds, entities));
  this.on('simulateAccess',               makeSimulateAccessHandler(cds, entities));

  // ---------------------------------------------------------------------------
  // BDC / HANA connection & data actions
  // ---------------------------------------------------------------------------

  this.on('testBdcConnection',              makeTestBdcConnectionHandler(cds, entities, HanaClient, BdcClient));
  this.on('fetchBdcSpaces',                 makeFetchBdcSpacesHandler(BdcClient));
  this.on('fetchBdcAssets',                 makeFetchBdcAssetsHandler(BdcClient));
  this.on('fetchBdcRelationalValues',       makeFetchBdcRelationalValuesHandler(BdcClient));
  this.on('fetchBdcAssetColumns',           makeFetchBdcAssetColumnsHandler(BdcClient));
  this.on('fetchRawBdcSpaces',              makeFetchRawBdcSpacesHandler(BdcClient));
  this.on('fetchRawBdcAssets',              makeFetchRawBdcAssetsHandler(BdcClient));
  this.on('fetchRawBdcRelationalValues',    makeFetchRawBdcRelationalValuesHandler(BdcClient));
  this.on('fetchRawBdcAssetColumns',        makeFetchRawBdcAssetColumnsHandler(BdcClient));
  this.on('fetchBdcAssociations',           makeFetchBdcAssociationsHandler(BdcClient));
  this.on('fetchRawHanaViews',              makeFetchRawHanaViewsHandler(cds, entities, HanaClient));
  this.on('runBdcTaskChain',                makeRunBdcTaskChainHandler(BdcClient));
  this.on('fetchBdcTaskChainLog',           makeFetchBdcTaskChainLogHandler(BdcClient));
  this.on('searchLdapUsers',                makeSearchLdapUsersHandler(cds));

  // ---------------------------------------------------------------------------
  // Replication actions
  // ---------------------------------------------------------------------------

  this.on('checkReplicationStatuses', async (req) => {
    try {
      return await checkAndUpdateRunningReplications(cds, entities, BdcClient);
    } catch (e) {
      return req.error(500, `Failed to check replication statuses: ${e.message}`);
    }
  });

  this.on('triggerReplication', makeTriggerReplicationHandler(cds, entities, BdcClient));
});
