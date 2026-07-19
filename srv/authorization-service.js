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
const BdcClient = require('./lib/bdcClient');
const { syncDynamicRule } = require('./services/dynamicSyncService');

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
  makeFetchBdcAssetKeyColumnsHandler,
  makeFetchRawBdcSpacesHandler,
  makeFetchRawBdcAssetsHandler,
  makeFetchRawBdcRelationalValuesHandler,
  makeFetchRawBdcAssetColumnsHandler,
  makeFetchRawBdcUsersHandler,
  makeFetchBdcAssociationsHandler,
  makeFetchRawHanaViewsHandler,
  makeRunBdcTaskChainHandler,
  makeFetchBdcTaskChainLogHandler,
  makeSearchScimUsersHandler
} = require('./services/bdcActionService');

// Handlers
const { registerRoleHandlers } = require('./handlers/roleHandlers');
const { registerAssignmentHandlers } = require('./handlers/assignmentHandlers');
const { registerRestrictionHandlers } = require('./handlers/restrictionHandlers');
const { registerAccessDomainHandlers } = require('./handlers/accessDomainHandlers');
const { registerAppAuthorizationsHandlers } = require('./handlers/appAuthorizationsHandlers');
const { registerSystemHandlers } = require('./handlers/systemHandlers');

module.exports = cds.service.impl(async function () {
  const entities = this.entities;
  const {
    OrgNodes, OrgNodeAttributes, Roles, Restrictions,
    RoleAssignments, RoleInheritance, RestrictionFields,
    BdcSettings, AuditLogs, Replications, DynamicGenerationRules,
    AppAuthorizations, RoleApprovers, AccessDomains, AccessDomainFields,
  } = entities;

  // Propagate simulated user headers into the CAP request context user
  this.before('*', async (req) => {
    const simUser = req.headers['x-simulated-user'] || req.headers['X-Simulated-User'];
    if (simUser) {
      req.user = new cds.User({ id: simUser });
    }
  });

  const { getSessionPermissions } = require('./lib/authGuard');

  // Action: getCurrentUserPermissions
  this.on('getCurrentUserPermissions', async (req) => {
    try {
      const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
      return perms;
    } catch (e) {
      return req.reject(e.status || 403, e.message);
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
          canManageReplications: true,
          canViewAuditLogs: true,
          canManageSettings: true,
          allowedEnvironments: 'ALL',
          allowedAccessDomains: '',
          isActive: true
        }));
        console.log(`[auth] Successfully bootstrapped super admin user: ${superAdminId}`);
      }
    } catch (e) {
      console.error('[auth] Failed to bootstrap super admin user:', e.message);
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

  // ---------------------------------------------------------------------------
  // Entity CRUD handlers (roles, assignments, restrictions)
  // ---------------------------------------------------------------------------

  const handlerDeps = {
    cds,
    queueReplication: boundQueueReplication,
    syncAssignmentToHana: boundSyncAssignment,
    syncRoleAssignmentsToHana: boundSyncRoleAssignments,
    resolveEffectiveRestrictions
  };

  registerRoleHandlers(this, entities, handlerDeps);
  registerAssignmentHandlers(this, entities, handlerDeps);
  registerRestrictionHandlers(this, entities, handlerDeps);
  registerAccessDomainHandlers(this);
  registerAppAuthorizationsHandlers(this, entities);
  registerSystemHandlers(this, entities);

  // ---------------------------------------------------------------------------
  // Org Role Generation actions
  // ---------------------------------------------------------------------------

  this.on('generateOrgRole', makeGenerateOrgRoleHandler(cds, entities));
  this.on('generateAllOrgRoles', makeGenerateAllOrgRolesHandler(cds, entities));

  // ---------------------------------------------------------------------------
  // Access Resolution actions
  // ---------------------------------------------------------------------------

  this.on('resolveEffectiveRestrictions', makeResolveEffectiveRestrictionsHandler(cds, entities));
  this.on('simulateAccess', makeSimulateAccessHandler(cds, entities));

  // ---------------------------------------------------------------------------
  // BDC / HANA connection & data actions
  // ---------------------------------------------------------------------------

  this.on('testBdcConnection', makeTestBdcConnectionHandler(cds, entities, HanaClient, BdcClient));
  this.on('fetchBdcSpaces', makeFetchBdcSpacesHandler(BdcClient));
  this.on('fetchBdcAssets', makeFetchBdcAssetsHandler(BdcClient));
  this.on('fetchBdcRelationalValues', makeFetchBdcRelationalValuesHandler(BdcClient));
  this.on('fetchBdcAssetColumns', makeFetchBdcAssetColumnsHandler(BdcClient));
  this.on('fetchBdcAssetKeyColumns', makeFetchBdcAssetKeyColumnsHandler(BdcClient));
  this.on('fetchRawBdcSpaces', makeFetchRawBdcSpacesHandler(BdcClient));
  this.on('fetchRawBdcAssets', makeFetchRawBdcAssetsHandler(BdcClient));
  this.on('fetchRawBdcRelationalValues', makeFetchRawBdcRelationalValuesHandler(BdcClient));
  this.on('fetchRawBdcAssetColumns', makeFetchRawBdcAssetColumnsHandler(BdcClient));
  this.on('fetchRawBdcUsers', makeFetchRawBdcUsersHandler(BdcClient));
  this.on('fetchBdcAssociations', makeFetchBdcAssociationsHandler(BdcClient));
  this.on('fetchRawHanaViews', makeFetchRawHanaViewsHandler(cds, entities, HanaClient));
  this.on('runBdcTaskChain', makeRunBdcTaskChainHandler(BdcClient));
  this.on('fetchBdcTaskChainLog', makeFetchBdcTaskChainLogHandler(BdcClient));
  this.on('searchScimUsers', makeSearchScimUsersHandler(cds, entities, BdcClient));

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
