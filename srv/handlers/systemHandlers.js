'use strict';

const cds = require('@sap/cds');
const { getSessionPermissions, requirePermission } = require('../lib/authGuard');

function registerSystemHandlers(service, entities) {
  const { AppAuthorizations } = entities;

  // Settings & Master Data CRUD protection
  service.before(
    ['CREATE', 'UPDATE', 'DELETE'],
    [
      'BdcSettings',
      'RestrictionFields',
      'DynamicGenerationRules',
      'DynamicRuleFieldMappings',
      'GeneratedResourceMap',
      'Customers',
      'Environments'
    ],
    async (req) => {
      const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
      requirePermission(perms, 'canManageSettings', req);
    }
  );

  // Direct READ on BdcSettings requires settings management permission
  service.before('READ', 'BdcSettings', async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(perms, 'canManageSettings', req);
  });

  // Strip sensitive credentials from expanded bdcConnection on RestrictionFields READ
  service.after('READ', 'RestrictionFields', (data) => {
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    for (const row of rows) {
      if (row && row.bdcConnection && typeof row.bdcConnection === 'object') {
        delete row.bdcConnection.password;
        delete row.bdcConnection.clientSecret;
        delete row.bdcConnection.apiToken;
      }
    }
  });

  // Org Structure CRUD & Generation Actions protection
  service.before(['CREATE', 'UPDATE', 'DELETE'], ['OrgNodes', 'OrgNodeAttributes'], async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    if (perms.isSuperAdmin || perms.canManageOrgRoles || perms.canManageSettings) return;
    requirePermission(perms, 'canManageOrgRoles', req);
  });

  service.before(['generateOrgRole', 'generateAllOrgRoles'], async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(perms, 'canManageOrgRoles', req);
  });

  // RestrictionFields deletion validation: must not be used in any AccessDomain
  service.before('DELETE', 'RestrictionFields', async (req) => {
    const id = req.params?.[0]?.ID ?? req.params?.[0] ?? req.data?.ID;
    if (!id) return;

    const domainFields = await cds.db.run(
      SELECT.from('fanrio.auth.AccessDomainFields')
        .columns('domain_ID')
        .where({ field_ID: id })
    );

    if (domainFields && domainFields.length > 0) {
      const domainIds = Array.from(new Set(domainFields.map(d => d.domain_ID || d.DOMAIN_ID).filter(Boolean)));
      let domainNames = [];
      if (domainIds.length > 0) {
        const domains = await cds.db.run(
          SELECT.from('fanrio.auth.AccessDomains')
            .columns('name')
            .where({ ID: { in: domainIds } })
        );
        domainNames = domains.map(d => `"${d.name || d.NAME}"`);
      }
      const namesStr = domainNames.slice(0, 5).join(', ');
      const extra = domainNames.length > 5 ? ` and ${domainNames.length - 5} more` : '';
      return req.error(
        400,
        `Cannot delete Restriction Field: It is currently assigned to ${domainIds.length} Access Domain(s) (${namesStr || domainIds.join(', ')}${extra}). Please remove it from the Access Domain(s) first.`
      );
    }
  });

  // Action protections (Settings & Administration)
  service.before('syncDynamicRule', async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(perms, 'canManageSettings', req);
  });

  service.before([
    'testBdcConnection', 'fetchBdcSpaces', 'fetchBdcAssets',
    'fetchBdcAssetColumns', 'fetchBdcAssetKeyColumns', 'fetchRawBdcSpaces',
    'fetchRawBdcAssets', 'fetchRawBdcRelationalValues', 'fetchRawBdcAssetColumns',
    'fetchRawBdcUsers', 'fetchBdcAssociations', 'runBdcTaskChain', 'fetchBdcTaskChainLog',
    'fetchRawHanaViews'
  ], async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(perms, 'canManageSettings', req);
  });

  // fetchBdcRelationalValues is used both in Admin settings and in the Role Wizard by role managers
  service.before('fetchBdcRelationalValues', async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    if (
      perms.isSuperAdmin ||
      perms.canManageSettings ||
      perms.canManageSingleRoles ||
      perms.canManageDerivedRoles ||
      perms.canManageOrgRoles
    ) {
      return;
    }
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
