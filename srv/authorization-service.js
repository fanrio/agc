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
    BdcSettings, AuditLogs, Replications, DynamicGenerationRules
  } = entities;

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
