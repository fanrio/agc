'use strict';

const cds = require('@sap/cds');
const { getSessionPermissions, requirePermission } = require('../lib/authGuard');

function registerSystemHandlers(service, entities) {
  const { AppAuthorizations, BdcSettings, RestrictionFields, Replications } = entities;

  // Settings CRUD protection
  service.before(['CREATE', 'UPDATE', 'DELETE'], ['BdcSettings', 'RestrictionFields'], async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(perms, 'canManageSettings', req);
  });

  // Action protections (Settings & Administration)
  service.before('syncDynamicRule', async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(perms, 'canManageSettings', req);
  });

  service.before([
    'testBdcConnection', 'fetchBdcSpaces', 'fetchBdcAssets',
    'fetchBdcRelationalValues', 'fetchBdcAssetColumns', 'fetchBdcAssetKeyColumns', 'fetchRawBdcSpaces',
    'fetchRawBdcAssets', 'fetchRawBdcRelationalValues', 'fetchRawBdcAssetColumns',
    'fetchBdcAssociations', 'runBdcTaskChain', 'fetchBdcTaskChainLog',
    'fetchRawHanaViews'
  ], async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(perms, 'canManageSettings', req);
  });

  // Replications CRUD protection
  service.before(['CREATE', 'UPDATE', 'DELETE'], 'Replications', async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(perms, 'canManageReplications', req);
  });

  // Replications Action protection
  service.before(['triggerReplication', 'checkReplicationStatuses'], async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(perms, 'canManageReplications', req);
  });

  // UUID auto-generation (consolidated — same for all entities below)
  ['OrgNodes', 'BdcSettings', 'DynamicGenerationRules', 'DynamicRuleFieldMappings', 'GeneratedResourceMap'].forEach(entity => {
    service.before('CREATE', entity, (req) => {
      if (!req.data.ID) req.data.ID = cds.utils.uuid();
      if (entity === 'BdcSettings') {
        if (req.data.isActive === undefined || req.data.isActive === null) {
          req.data.isActive = true;
        }
      }
    });
  });

  service.before('UPDATE', 'DynamicGenerationRules', async (req) => {
    if (req.data.mappings) {
      await cds.db.run(DELETE.from('fanrio.auth.DynamicRuleFieldMappings').where({ rule_ID: req.data.ID }));
    }
  });
}

module.exports = { registerSystemHandlers };
